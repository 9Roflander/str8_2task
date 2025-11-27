import aiosqlite
import json
import os
from datetime import datetime
from typing import Optional, Dict
import logging
from contextlib import asynccontextmanager
import sqlite3
try:
    from .schema_validator import SchemaValidator
except ImportError:
    # Handle case when running as script directly
    import sys
    import os
    sys.path.append(os.path.dirname(__file__))
    from schema_validator import SchemaValidator

logger = logging.getLogger(__name__)

class DatabaseManager:
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = os.getenv('DATABASE_PATH', 'meeting_minutes.db')
        self.db_path = db_path
        self.schema_validator = SchemaValidator(self.db_path)
        self._init_db()

    def _init_db(self):
        """Initialize the database with legacy approach"""
        try:
            # Run legacy initialization (handles all table creation)
            logger.info("Initializing database tables...")
            self._legacy_init_db()
            
            # Validate schema integrity
            logger.info("Validating schema integrity...")
            self.schema_validator.validate_schema()
            
        except Exception as e:
            logger.error(f"Database initialization failed: {str(e)}")
            raise



    def _legacy_init_db(self):
        """Legacy database initialization (for backward compatibility)"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Create meetings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    folder_path TEXT
                )
            """)

            # Migration: Add folder_path column to existing meetings table
            try:
                cursor.execute("ALTER TABLE meetings ADD COLUMN folder_path TEXT")
                logger.info("Added folder_path column to meetings table")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            # Create transcripts table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS transcripts (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    transcript TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    summary TEXT,
                    action_items TEXT,
                    key_points TEXT,
                    audio_start_time REAL,
                    audio_end_time REAL,
                    duration REAL,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
                )
            """)

            # Add new columns to existing transcripts table (migration for old databases)
            try:
                cursor.execute("ALTER TABLE transcripts ADD COLUMN audio_start_time REAL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cursor.execute("ALTER TABLE transcripts ADD COLUMN audio_end_time REAL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cursor.execute("ALTER TABLE transcripts ADD COLUMN duration REAL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            # Create summary_processes table (keeping existing functionality)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS summary_processes (
                    meeting_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT,
                    result TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    chunk_count INTEGER DEFAULT 0,
                    processing_time REAL DEFAULT 0.0,
                    metadata TEXT,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS transcript_chunks (
                    meeting_id TEXT PRIMARY KEY,
                    meeting_name TEXT,
                    transcript_text TEXT NOT NULL,
                    model TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    chunk_size INTEGER,
                    overlap INTEGER,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id)
                )
            """)

            # Create settings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    whisperModel TEXT NOT NULL,
                    groqApiKey TEXT,
                    openaiApiKey TEXT,
                    anthropicApiKey TEXT,
                    ollamaApiKey TEXT,
                    geminiApiKey TEXT
                )
            """)
            try:
                cursor.execute("ALTER TABLE settings ADD COLUMN geminiApiKey TEXT")
                logger.info("Added geminiApiKey column to settings table")
            except sqlite3.OperationalError:
                pass  # Column already exists

            # Create transcript_settings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS transcript_settings (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    whisperApiKey TEXT,
                    deepgramApiKey TEXT,
                    elevenLabsApiKey TEXT,
                    groqApiKey TEXT,
                    openaiApiKey TEXT
                )
            """)

            # Create jira_settings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS jira_settings (
                    id TEXT PRIMARY KEY,
                    url TEXT NOT NULL,
                    email TEXT NOT NULL,
                    api_token TEXT NOT NULL,
                    default_project_key TEXT,
                    default_issue_type TEXT
                )
            """)

            conn.commit()

    @asynccontextmanager
    async def _get_connection(self):
        """Get a new database connection"""
        conn = await aiosqlite.connect(self.db_path)
        try:
            yield conn
        finally:
            await conn.close()

    async def create_process(self, meeting_id: str) -> str:
        """Create a new process entry or update existing one and return its ID"""
        now = datetime.utcnow().isoformat()
        
        try:
            async with self._get_connection() as conn:
                # Begin transaction
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # First try to update existing process
                    await conn.execute(
                        """
                        UPDATE summary_processes 
                        SET status = ?, updated_at = ?, start_time = ?, error = NULL, result = NULL
                        WHERE meeting_id = ?
                        """,
                        ("PENDING", now, now, meeting_id)
                    )
                    
                    # If no rows were updated, insert a new one
                    if conn.total_changes == 0:
                        await conn.execute(
                            "INSERT INTO summary_processes (meeting_id, status, created_at, updated_at, start_time) VALUES (?, ?, ?, ?, ?)",
                            (meeting_id, "PENDING", now, now, now)
                        )
                    
                    await conn.commit()
                    logger.info(f"Successfully created/updated process for meeting_id: {meeting_id}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to create process for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in create_process: {str(e)}", exc_info=True)
            raise
        
        return meeting_id

    async def update_process(self, meeting_id: str, status: str, result: Optional[Dict] = None, error: Optional[str] = None, 
                           chunk_count: Optional[int] = None, processing_time: Optional[float] = None, 
                           metadata: Optional[Dict] = None):
        """Update a process status and result"""
        now = datetime.utcnow().isoformat()
        
        try:
            async with self._get_connection() as conn:
                # Begin transaction
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    update_fields = ["status = ?", "updated_at = ?"]
                    params = [status, now]
                    
                    if result:
                        # Validate result can be JSON serialized
                        try:
                            result_json = json.dumps(result)
                            update_fields.append("result = ?")
                            params.append(result_json)
                        except (TypeError, ValueError) as e:
                            logger.error(f"Failed to serialize result for meeting_id {meeting_id}: {str(e)}")
                            raise ValueError("Result data cannot be JSON serialized")
                            
                    if error:
                        # Sanitize error message to prevent log injection
                        sanitized_error = str(error).replace('\n', ' ').replace('\r', '')[:1000]
                        update_fields.append("error = ?")
                        params.append(sanitized_error)
                        
                    if chunk_count is not None:
                        update_fields.append("chunk_count = ?")
                        params.append(chunk_count)
                        
                    if processing_time is not None:
                        update_fields.append("processing_time = ?")
                        params.append(processing_time)
                        
                    if metadata:
                        # Validate metadata can be JSON serialized
                        try:
                            metadata_json = json.dumps(metadata)
                            update_fields.append("metadata = ?")
                            params.append(metadata_json)
                        except (TypeError, ValueError) as e:
                            logger.error(f"Failed to serialize metadata for meeting_id {meeting_id}: {str(e)}")
                            # Don't fail the whole operation for metadata serialization issues
                            
                    if status.upper() in ['COMPLETED', 'FAILED']:
                        update_fields.append("end_time = ?")
                        params.append(now)
                        
                    params.append(meeting_id)
                    query = f"UPDATE summary_processes SET {', '.join(update_fields)} WHERE meeting_id = ?"
                    
                    cursor = await conn.execute(query, params)
                    if cursor.rowcount == 0:
                        logger.warning(f"No process found to update for meeting_id: {meeting_id}")
                        
                    await conn.commit()
                    logger.debug(f"Successfully updated process status to {status} for meeting_id: {meeting_id}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to update process for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in update_process: {str(e)}", exc_info=True)
            raise

    async def save_transcript(self, meeting_id: str, transcript_text: str, model: str, model_name: str, 
                            chunk_size: int, overlap: int):
        """Save transcript data"""
        # Input validation
        if not meeting_id or not meeting_id.strip():
            raise ValueError("meeting_id cannot be empty")
        if not transcript_text or not transcript_text.strip():
            raise ValueError("transcript_text cannot be empty")
        if chunk_size <= 0 or overlap < 0:
            raise ValueError("Invalid chunk_size or overlap values")
        if len(transcript_text) > 10_000_000:  # 10MB limit
            raise ValueError("Transcript text too large (>10MB)")
            
        now = datetime.utcnow().isoformat()
        
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # First try to update existing transcript
                    await conn.execute("""
                        UPDATE transcript_chunks 
                        SET transcript_text = ?, model = ?, model_name = ?, chunk_size = ?, overlap = ?, created_at = ?
                        WHERE meeting_id = ?
                    """, (transcript_text, model, model_name, chunk_size, overlap, now, meeting_id))
                    
                    # If no rows were updated, insert a new one
                    if conn.total_changes == 0:
                        await conn.execute("""
                            INSERT INTO transcript_chunks (meeting_id, transcript_text, model, model_name, chunk_size, overlap, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (meeting_id, transcript_text, model, model_name, chunk_size, overlap, now))
                    
                    await conn.commit()
                    logger.info(f"Successfully saved transcript for meeting_id: {meeting_id} (size: {len(transcript_text)} chars)")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript for meeting_id {meeting_id}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_transcript: {str(e)}", exc_info=True)
            raise

    async def update_meeting_name(self, meeting_id: str, meeting_name: str):
        """Update meeting name in both meetings and transcript_chunks tables"""
        now = datetime.utcnow().isoformat()
        async with self._get_connection() as conn:
            # Update meetings table
            await conn.execute("""
                UPDATE meetings
                SET title = ?, updated_at = ?
                WHERE id = ?
            """, (meeting_name, now, meeting_id))
            
            # Update transcript_chunks table
            await conn.execute("""
                UPDATE transcript_chunks
                SET meeting_name = ?
                WHERE meeting_id = ?
            """, (meeting_name, meeting_id))
            
            await conn.commit()

    async def get_transcript_data(self, meeting_id: str):
        """Get transcript data for a meeting"""
        async with self._get_connection() as conn:
            # First try to get from transcript_chunks (for processed transcripts)
            async with conn.execute("""
                SELECT t.*, p.status, p.result, p.error 
                FROM transcript_chunks t 
                LEFT JOIN summary_processes p ON t.meeting_id = p.meeting_id 
                WHERE t.meeting_id = ?
            """, (meeting_id,)) as cursor:
                row = await cursor.fetchone()
                if row:
                    result = dict(zip([col[0] for col in cursor.description], row))
                    # Ensure transcript_text exists
                    if result.get("transcript_text"):
                        return result
            
            # If not found in transcript_chunks, try to get from transcripts table
            # and combine all transcript segments into full text
            async with conn.execute("""
                SELECT transcript, timestamp
                FROM transcripts
                WHERE meeting_id = ?
                ORDER BY timestamp ASC
            """, (meeting_id,)) as cursor:
                rows = await cursor.fetchall()
                if rows:
                    # Combine all transcript segments
                    transcript_text = "\n".join([row[0] for row in rows if row[0]])
                    if transcript_text:
                        # Get summary process status if exists
                        async with conn.execute("""
                            SELECT status, result, error
                            FROM summary_processes
                            WHERE meeting_id = ?
                        """, (meeting_id,)) as proc_cursor:
                            proc_row = await proc_cursor.fetchone()
                            result = {
                                "meeting_id": meeting_id,
                                "transcript_text": transcript_text,
                                "status": proc_row[0] if proc_row else None,
                                "result": proc_row[1] if proc_row else None,
                                "error": proc_row[2] if proc_row else None
                            }
                            return result
            
            return None

    async def save_meeting(self, meeting_id: str, title: str, folder_path: str = None):
        """Save or update a meeting"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # Check if meeting exists
                cursor.execute("SELECT id FROM meetings WHERE id = ? OR title = ?", (meeting_id, title))
                existing_meeting = cursor.fetchone()

                if not existing_meeting:
                    # Create new meeting with local timestamp and folder path
                    cursor.execute("""
                        INSERT INTO meetings (id, title, created_at, updated_at, folder_path)
                        VALUES (?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'), ?)
                    """, (meeting_id, title, folder_path))
                    logger.info(f"Saved meeting {meeting_id} with folder_path: {folder_path}")
                else:
                    # If we get here and meeting exists, throw error since we don't want duplicates
                    raise Exception(f"Meeting with ID {meeting_id} already exists")
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error saving meeting: {str(e)}")
            raise

    async def save_meeting_transcript(self, meeting_id: str, transcript: str, timestamp: str,
                                     summary: str = "", action_items: str = "", key_points: str = "",
                                     audio_start_time: float = None, audio_end_time: float = None, duration: float = None):
        """Save a transcript for a meeting with optional recording-relative timestamps"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # Save transcript with NEW timestamp fields for playback sync
                cursor.execute("""
                    INSERT INTO transcripts (
                        meeting_id, transcript, timestamp, summary, action_items, key_points,
                        audio_start_time, audio_end_time, duration
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (meeting_id, transcript, timestamp, summary, action_items, key_points,
                      audio_start_time, audio_end_time, duration))

                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error saving transcript: {str(e)}")
            raise

    async def get_meeting(self, meeting_id: str):
        """Get a meeting by ID with all its transcripts"""
        try:
            async with self._get_connection() as conn:
                # Get meeting details
                cursor = await conn.execute("""
                    SELECT id, title, created_at, updated_at
                    FROM meetings
                    WHERE id = ?
                """, (meeting_id,))
                meeting = await cursor.fetchone()
                
                if not meeting:
                    return None
                
                # Get all transcripts for this meeting with NEW timestamp fields
                cursor = await conn.execute("""
                    SELECT transcript, timestamp, audio_start_time, audio_end_time, duration
                    FROM transcripts
                    WHERE meeting_id = ?
                """, (meeting_id,))
                transcripts = await cursor.fetchall()

                return {
                    'id': meeting[0],
                    'title': meeting[1],
                    'created_at': meeting[2],
                    'updated_at': meeting[3],
                    'transcripts': [{
                        'id': meeting_id,
                        'text': transcript[0],
                        'timestamp': transcript[1],
                        # NEW: Recording-relative timestamps for playback sync
                        'audio_start_time': transcript[2],
                        'audio_end_time': transcript[3],
                        'duration': transcript[4]
                    } for transcript in transcripts]
                }
        except Exception as e:
            logger.error(f"Error getting meeting: {str(e)}")
            raise

    async def update_meeting_title(self, meeting_id: str, new_title: str):
        """Update a meeting's title"""
        now = datetime.utcnow().isoformat()
        async with self._get_connection() as conn:
            await conn.execute("""
                UPDATE meetings
                SET title = ?, updated_at = ?
                WHERE id = ?
            """, (new_title, now, meeting_id))
            await conn.commit()

    async def get_all_meetings(self):
        """Get all meetings with basic information"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("""
                SELECT id, title, created_at
                FROM meetings
                ORDER BY created_at DESC
            """)
            rows = await cursor.fetchall()
            return [{
                'id': row[0],
                'title': row[1],
                'created_at': row[2]
            } for row in rows]

    async def delete_meeting(self, meeting_id: str):
        """Delete a meeting and all its associated data"""
        if not meeting_id or not meeting_id.strip():
            raise ValueError("meeting_id cannot be empty")
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if meeting exists before deletion
                    cursor = await conn.execute("SELECT id FROM meetings WHERE id = ?", (meeting_id,))
                    meeting = await cursor.fetchone()
                    
                    if not meeting:
                        logger.warning(f"Meeting {meeting_id} not found for deletion")
                        await conn.rollback()
                        return False
                    
                    # Delete in proper order to respect foreign key constraints
                    # Delete from transcript_chunks
                    await conn.execute("DELETE FROM transcript_chunks WHERE meeting_id = ?", (meeting_id,))
                    
                    # Delete from summary_processes
                    await conn.execute("DELETE FROM summary_processes WHERE meeting_id = ?", (meeting_id,))
                    
                    # Delete from transcripts
                    await conn.execute("DELETE FROM transcripts WHERE meeting_id = ?", (meeting_id,))
                    
                    # Delete from meetings
                    cursor = await conn.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
                    
                    if cursor.rowcount == 0:
                        logger.error(f"Failed to delete meeting {meeting_id} - no rows affected")
                        await conn.rollback()
                        return False
                    
                    await conn.commit()
                    logger.info(f"Successfully deleted meeting {meeting_id} and all associated data")
                    return True
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to delete meeting {meeting_id}: {str(e)}", exc_info=True)
                    return False
                    
        except Exception as e:
            logger.error(f"Database connection error in delete_meeting: {str(e)}", exc_info=True)
            return False

    async def get_model_config(self):
        """Get the current model configuration"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("SELECT provider, model, whisperModel FROM settings")
            row = await cursor.fetchone()
            return dict(zip([col[0] for col in cursor.description], row)) if row else None

    async def save_model_config(self, provider: str, model: str, whisperModel: str):
        """Save the model configuration"""
        # Input validation
        if not provider or not provider.strip():
            raise ValueError("Provider cannot be empty")
        if not model or not model.strip():
            raise ValueError("Model cannot be empty")
        if not whisperModel or not whisperModel.strip():
            raise ValueError("Whisper model cannot be empty")
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if the configuration already exists
                    cursor = await conn.execute("SELECT id FROM settings")
                    existing_config = await cursor.fetchone()
                    if existing_config:
                        # Update existing configuration
                        await conn.execute("""
                            UPDATE settings 
                            SET provider = ?, model = ?, whisperModel = ?
                            WHERE id = '1'    
                        """, (provider, model, whisperModel))
                    else:
                        # Insert new configuration
                        await conn.execute("""
                            INSERT INTO settings (id, provider, model, whisperModel)
                            VALUES (?, ?, ?, ?)
                        """, ('1', provider, model, whisperModel))
                    
                    await conn.commit()
                    logger.info(f"Successfully saved model configuration: {provider}/{model}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save model configuration: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_model_config: {str(e)}", exc_info=True)
            raise


    async def save_api_key(self, api_key: str, provider: str):
        """Save the API key"""
        provider_list = ["openai", "claude", "groq", "ollama", "gemini"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"
        elif provider == "gemini":
            api_key_name = "geminiApiKey"
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if settings row exists
                    cursor = await conn.execute("SELECT id FROM settings WHERE id = '1'")
                    existing_config = await cursor.fetchone()
                    
                    if existing_config:
                        # Update existing configuration
                        await conn.execute(f"UPDATE settings SET {api_key_name} = ? WHERE id = '1'", (api_key,))
                    else:
                        # Insert new configuration with default values and the API key
                        await conn.execute(f"""
                            INSERT INTO settings (id, provider, model, whisperModel, {api_key_name})
                            VALUES (?, ?, ?, ?, ?)
                        """, ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', api_key))
                        
                    await conn.commit()
                    logger.info(f"Successfully saved API key for provider: {provider}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save API key for provider {provider}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_api_key: {str(e)}", exc_info=True)
            raise

    async def get_api_key(self, provider: str):
        """Get the API key"""
        provider_list = ["openai", "claude", "groq", "ollama", "gemini"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"
        elif provider == "gemini":
            api_key_name = "geminiApiKey"
        async with self._get_connection() as conn:
            cursor = await conn.execute(f"SELECT {api_key_name} FROM settings WHERE id = '1'")
            row = await cursor.fetchone()
            return row[0] if row and row[0] else ""

    async def get_transcript_config(self):
        """Get the current transcript configuration"""
        async with self._get_connection() as conn:
            cursor = await conn.execute("SELECT provider, model FROM transcript_settings")
            row = await cursor.fetchone()
            if row:
                return dict(zip([col[0] for col in cursor.description], row))
            else:
                # Return default configuration if no transcript settings exist
                return {
                    "provider": "localWhisper",
                    "model": "large-v3"
                }

    async def save_transcript_config(self, provider: str, model: str):
        """Save the transcript settings"""
        # Input validation
        if not provider or not provider.strip():
            raise ValueError("Provider cannot be empty")
        if not model or not model.strip():
            raise ValueError("Model cannot be empty")
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if the configuration already exists
                    cursor = await conn.execute("SELECT id FROM transcript_settings")
                    existing_config = await cursor.fetchone()
                    if existing_config:
                        # Update existing configuration
                        await conn.execute("""
                            UPDATE transcript_settings 
                            SET provider = ?, model = ?
                            WHERE id = '1'
                        """, (provider, model))
                    else:
                        # Insert new configuration
                        await conn.execute("""
                            INSERT INTO transcript_settings (id, provider, model)
                            VALUES (?, ?, ?)
                        """, ('1', provider, model))
                    
                    await conn.commit()
                    logger.info(f"Successfully saved transcript configuration: {provider}/{model}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript configuration: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_transcript_config: {str(e)}", exc_info=True)
            raise

    async def save_transcript_api_key(self, api_key: str, provider: str):
        """Save the transcript API key"""
        provider_list = ["localWhisper","deepgram","elevenLabs","groq","openai"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "localWhisper":
            api_key_name = "whisperApiKey"
        elif provider == "deepgram":
            api_key_name = "deepgramApiKey"
        elif provider == "elevenLabs":
            api_key_name = "elevenLabsApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "openai":
            api_key_name = "openaiApiKey"
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                
                try:
                    # Check if transcript settings row exists
                    cursor = await conn.execute("SELECT id FROM transcript_settings WHERE id = '1'")
                    existing_config = await cursor.fetchone()
                    
                    if existing_config:
                        # Update existing configuration
                        await conn.execute(f"UPDATE transcript_settings SET {api_key_name} = ? WHERE id = '1'", (api_key,))
                    else:
                        # Insert new configuration with default values and the API key
                        await conn.execute(f"""
                            INSERT INTO transcript_settings (id, provider, model, {api_key_name})
                            VALUES (?, ?, ?, ?)
                        """, ('1', 'localWhisper', 'large-v3', api_key))
                        
                    await conn.commit()
                    logger.info(f"Successfully saved transcript API key for provider: {provider}")
                    
                except Exception as e:
                    await conn.rollback()
                    logger.error(f"Failed to save transcript API key for provider {provider}: {str(e)}", exc_info=True)
                    raise
                    
        except Exception as e:
            logger.error(f"Database connection error in save_transcript_api_key: {str(e)}", exc_info=True)
            raise


    async def get_transcript_api_key(self, provider: str):
        """Get the transcript API key"""
        provider_list = ["localWhisper","deepgram","elevenLabs","groq","openai"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "localWhisper":
            api_key_name = "whisperApiKey"
        elif provider == "deepgram":
            api_key_name = "deepgramApiKey"
        elif provider == "elevenLabs":
            api_key_name = "elevenLabsApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "openai":
            api_key_name = "openaiApiKey"
        async with self._get_connection() as conn:
            cursor = await conn.execute(f"SELECT {api_key_name} FROM transcript_settings WHERE id = '1'")
            row = await cursor.fetchone()
            return row[0] if row and row[0] else ""

    async def search_transcripts(self, query: str):
        """Search through meeting transcripts for the given query"""
        if not query or query.strip() == "":
            return []
            
        # Convert query to lowercase for case-insensitive search
        search_query = f"%{query.lower()}%"
        
        try:
            async with self._get_connection() as conn:
                # Search in transcripts table
                cursor = await conn.execute("""
                    SELECT m.id, m.title, t.transcript, t.timestamp
                    FROM meetings m
                    JOIN transcripts t ON m.id = t.meeting_id
                    WHERE LOWER(t.transcript) LIKE ?
                    ORDER BY m.created_at DESC
                """, (search_query,))
                
                rows = await cursor.fetchall()
                
                # Also search in transcript_chunks for full transcripts
                cursor2 = await conn.execute("""
                    SELECT m.id, m.title, tc.transcript_text
                    FROM meetings m
                    JOIN transcript_chunks tc ON m.id = tc.meeting_id
                    WHERE LOWER(tc.transcript_text) LIKE ?
                    AND m.id NOT IN (SELECT DISTINCT meeting_id FROM transcripts WHERE LOWER(transcript) LIKE ?)
                    ORDER BY m.created_at DESC
                """, (search_query, search_query))
                
                chunk_rows = await cursor2.fetchall()
                
                # Combine results
                # Format: {'id': meeting_id, 'title': title, 'match_preview': snippet, 'timestamp': timestamp}
                formatted_results = []
                
                for row in rows:
                    formatted_results.append({
                        "id": row[0],
                        "title": row[1],
                        "match_preview": row[2][:200] + "..." if len(row[2]) > 200 else row[2],
                        "timestamp": row[3],
                        "type": "transcript_segment"
                    })
                    
                for row in chunk_rows:
                    formatted_results.append({
                        "id": row[0],
                        "title": row[1],
                        "match_preview": row[2][:200] + "..." if len(row[2]) > 200 else row[2],
                        "timestamp": "", # Full transcripts might not have a single timestamp
                        "type": "full_transcript"
                    })
                    
                return formatted_results
        except Exception as e:
            logger.error(f"Error searching transcripts: {str(e)}")
            return []

    async def save_jira_config(self, url: str, email: str, api_token: str = None, default_project_key: str = None, default_issue_type: str = None):
        """Save Jira configuration
        
        Args:
            url: Jira URL (required)
            email: Jira email (required)
            api_token: API token. If None, empty, or '********', keeps existing token (required for new configs)
            default_project_key: Optional default project key
            default_issue_type: Optional default issue type
        """
        if not url or not email:
            raise ValueError("URL and Email are required")
            
        try:
            async with self._get_connection() as conn:
                await conn.execute("BEGIN TRANSACTION")
                try:
                    # Check if config exists
                    cursor = await conn.execute("SELECT id, api_token FROM jira_settings WHERE id = '1'")
                    existing = await cursor.fetchone()
                    
                    # If api_token is masked, empty, or None, use existing token
                    if existing and (not api_token or api_token.strip() == '' or api_token == '********'):
                        existing_token = existing[1] if len(existing) > 1 else None
                        if existing_token:
                            api_token = existing_token
                            logger.info("Using existing API token (new token not provided or masked)")
                        else:
                            raise ValueError("API Token is required for new configuration")
                    elif not existing and (not api_token or api_token.strip() == '' or api_token == '********'):
                        raise ValueError("API Token is required for new configuration")
                    
                    if existing:
                        await conn.execute("""
                            UPDATE jira_settings 
                            SET url = ?, email = ?, api_token = ?, default_project_key = ?, default_issue_type = ?
                            WHERE id = '1'
                        """, (url, email, api_token, default_project_key, default_issue_type))
                    else:
                        await conn.execute("""
                            INSERT INTO jira_settings (id, url, email, api_token, default_project_key, default_issue_type)
                            VALUES ('1', ?, ?, ?, ?, ?)
                        """, (url, email, api_token, default_project_key, default_issue_type))
                    
                    await conn.commit()
                    logger.info("Successfully saved Jira configuration")
                except Exception as e:
                    await conn.rollback()
                    raise e
        except Exception as e:
            logger.error(f"Error saving Jira config: {str(e)}")
            raise

    async def get_jira_config(self):
        """Get Jira configuration"""
        try:
            async with self._get_connection() as conn:
                cursor = await conn.execute("""
                    SELECT url, email, api_token, default_project_key, default_issue_type 
                    FROM jira_settings WHERE id = '1'
                """)
                row = await cursor.fetchone()
                if row:
                    return {
                        "url": row[0],
                        "email": row[1],
                        "api_token": row[2],
                        "default_project_key": row[3],
                        "default_issue_type": row[4]
                    }
                return None
        except Exception as e:
            logger.error(f"Error getting Jira config: {str(e)}")
            raise
                

    async def delete_api_key(self, provider: str):
        """Delete the API key"""
        provider_list = ["openai", "claude", "groq", "ollama"]
        if provider not in provider_list:
            raise ValueError(f"Invalid provider: {provider}")
        if provider == "openai":
            api_key_name = "openaiApiKey"
        elif provider == "claude":
            api_key_name = "anthropicApiKey"
        elif provider == "groq":
            api_key_name = "groqApiKey"
        elif provider == "ollama":
            api_key_name = "ollamaApiKey"
        async with self._get_connection() as conn:
            await conn.execute(f"UPDATE settings SET {api_key_name} = NULL WHERE id = '1'")
            await conn.commit()
    
    async def update_meeting_summary(self, meeting_id: str, summary: dict):
        """Update a meeting's summary"""
        now = datetime.utcnow().isoformat()
        try:
            async with self._get_connection() as conn:
                # Check if the meeting exists
                cursor = await conn.execute("SELECT id FROM meetings WHERE id = ?", (meeting_id,))
                meeting = await cursor.fetchone()
                
                if not meeting:
                    raise ValueError(f"Meeting with ID {meeting_id} not found")
                
                # Update the summary in the summary_processes table
                await conn.execute("""
                    UPDATE summary_processes
                    SET result = ?, updated_at = ?
                    WHERE meeting_id = ?
                """, (json.dumps(summary), now, meeting_id))
                
                # Update the meeting's updated_at timestamp
                await conn.execute("""
                    UPDATE meetings
                    SET updated_at = ?
                    WHERE id = ?
                """, (now, meeting_id))
                
                await conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error updating meeting summary: {str(e)}")
            raise

   

