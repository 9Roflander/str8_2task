from pydantic import BaseModel, ValidationError, field_validator
from typing import List, Tuple, Literal, Optional
from pydantic_ai import Agent, exceptions as ai_exceptions
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.gemini import GeminiModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google_gla import GoogleGLAProvider
from pydantic_ai.providers.groq import GroqProvider
from pydantic_ai.providers.openai import OpenAIProvider

import json
import logging
import os
from dotenv import load_dotenv
from .db import DatabaseManager
from ollama import chat
import asyncio
from ollama import AsyncClient





# Set up logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()  # Load environment variables from .env file

db = DatabaseManager()

class Block(BaseModel):
    """Represents a block of content in a section.
    
    Block types must align with frontend rendering capabilities:
    - 'text': Plain text content
    - 'bullet': Bulleted list item
    - 'heading1': Large section heading
    - 'heading2': Medium section heading
    
    Colors currently supported:
    - 'gray': Gray text color
    - '' or any other value: Default text color
    """
    id: str
    type: Literal['bullet', 'heading1', 'heading2', 'text']
    content: str
    color: str  # Frontend currently only uses 'gray' or default

class Section(BaseModel):
    """Represents a section in the meeting summary"""
    title: str
    blocks: List[Block]

class MeetingNotes(BaseModel):
    """Represents the meeting notes"""
    meeting_name: str
    sections: List[Section]

class People(BaseModel):
    """Represents the people in the meeting. Always have this part in the output. Title - Person Name (Role, Details)"""
    title: str
    blocks: List[Block]

class SummaryResponse(BaseModel):
    """Represents the meeting summary response based on a section of the transcript"""
    MeetingName : str
    People : People
    SessionSummary : Section
    CriticalDeadlines: Section
    KeyItemsDecisions: Section
    ImmediateActionItems: Section
    NextSteps: Section
    MeetingNotes: MeetingNotes

class JiraTaskSuggestion(BaseModel):
    summary: str
    description: str
    priority: str
    type: str
    assignee: str = "Unassigned"
    # Enhanced fields for context-aware generation
    assignee_account_id: Optional[str] = None  # Jira account ID for direct assignment
    labels: Optional[List[str]] = None  # Suggested labels
    related_issues: Optional[List[str]] = None  # Related issue keys mentioned in transcript

    @field_validator('summary')
    @classmethod
    def validate_summary(cls, v: str) -> str:
        """Ensure summary is valid and readable"""
        if not v or len(v.strip()) < 10:
            raise ValueError("Summary must be at least 10 characters")
        # Check for gibberish (too many non-English characters or random patterns)
        words = v.split()
        if len(words) < 2:
            raise ValueError("Summary must have at least 2 words")
        # Check if most words are recognizable (basic check)
        valid_words = sum(1 for w in words if len(w) >= 2 and w[0].isalpha())
        if valid_words < len(words) * 0.5:
            raise ValueError("Summary contains too many invalid words")
        return v.strip()

    @field_validator('description')
    @classmethod
    def validate_description(cls, v: str) -> str:
        """Ensure description has meaningful content"""
        if not v or len(v.strip()) < 20:
            raise ValueError("Description must be at least 20 characters")
        return v.strip()

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, v: str) -> str:
        """Normalize priority values"""
        v = v.strip()
        # Common priority mappings
        priority_map = {
            'high': 'High', 'highest': 'Highest', 'critical': 'Highest',
            'medium': 'Medium', 'normal': 'Medium',
            'low': 'Low', 'lowest': 'Lowest', 'minor': 'Low'
        }
        return priority_map.get(v.lower(), v)

    @field_validator('type')
    @classmethod
    def validate_type(cls, v: str) -> str:
        """Normalize and validate issue type"""
        v = v.strip()
        # Map common variations
        type_map = {
            'bug': 'Bug', 'defect': 'Bug', 'error': 'Bug',
            'task': 'Task', 'action item': 'Task',
            'story': 'Story', 'user story': 'Story', 'feature': 'Story',
            'epic': 'Epic',
            'improvement': 'Improvement', 'enhancement': 'Improvement'
        }
        normalized = type_map.get(v.lower(), v)
        # Prevent Epic for single tasks (Epic should be rare)
        return normalized

class JiraTaskExtractionResponse(BaseModel):
    tasks: List[JiraTaskSuggestion]

# --- Main Class Used by main.py ---

class TranscriptProcessor:
    """Handles the processing of meeting transcripts using AI models."""
    def __init__(self):
        """Initialize the transcript processor."""
        logger.info("TranscriptProcessor initialized.")
        self.db = DatabaseManager()
        self.active_clients = []  # Track active Ollama client sessions
    async def process_transcript(self, text: str, model: str, model_name: str, chunk_size: int = 5000, overlap: int = 1000, custom_prompt: str = "") -> Tuple[int, List[str]]:
        """
        Process transcript text into chunks and generate structured summaries for each chunk using an AI model.

        Args:
            text: The transcript text.
            model: The AI model provider ('claude', 'ollama', 'groq', 'openai').
            model_name: The specific model name.
            chunk_size: The size of each text chunk.
            overlap: The overlap between consecutive chunks.
            custom_prompt: A custom prompt to use for the AI model.

        Returns:
            A tuple containing:
            - The number of chunks processed.
            - A list of JSON strings, where each string is the summary of a chunk.
        """

        logger.info(f"Processing transcript (length {len(text)}) with model provider={model}, model_name={model_name}, chunk_size={chunk_size}, overlap={overlap}")

        all_json_data = []
        agent = None # Define agent variable
        llm = None # Define llm variable

        try:
            # Select and initialize the AI model and agent
            if model == "claude":
                api_key = await db.get_api_key("claude")
                if not api_key: raise ValueError("ANTHROPIC_API_KEY environment variable not set")
                llm = AnthropicModel(model_name, provider=AnthropicProvider(api_key=api_key))
                logger.info(f"Using Claude model: {model_name}")
            elif model == "ollama":
                # Use environment variable for Ollama host configuration
                ollama_host = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
                ollama_base_url = f"{ollama_host}/v1"
                ollama_model = OpenAIModel(
                    model_name=model_name, provider=OpenAIProvider(base_url=ollama_base_url)
                )
                llm = ollama_model
                if model_name.lower().startswith("phi4") or model_name.lower().startswith("llama"):
                    chunk_size = 10000
                    overlap = 1000
                else:
                    chunk_size = 30000
                    overlap = 1000
                logger.info(f"Using Ollama model: {model_name}")
            elif model == "gemini":
                api_key = await db.get_api_key("gemini")
                # Fallback to environment variable if not in database
                if not api_key:
                    api_key = os.getenv("GOOGLE_API_KEY", "")
                    if api_key:
                        logger.info("Using Gemini API key from GOOGLE_API_KEY environment variable")
                if not api_key:
                    raise ValueError(
                        "Gemini API key is not configured. "
                        "Options: 1) Save the API key in the frontend settings (it will sync to backend), "
                        "2) Set GOOGLE_API_KEY environment variable, "
                        "3) Call POST /save-model-config with the API key."
                    )
                provider = GoogleGLAProvider(api_key=api_key)
                llm = GeminiModel(model_name, provider=provider)
                logger.info(f"Using Gemini model: {model_name}")
            elif model == "groq":
                api_key = await db.get_api_key("groq")
                if not api_key: raise ValueError("GROQ_API_KEY environment variable not set")
                llm = GroqModel(model_name, provider=GroqProvider(api_key=api_key))
                logger.info(f"Using Groq model: {model_name}")
            # --- ADD OPENAI SUPPORT HERE ---
            elif model == "openai":
                api_key = await db.get_api_key("openai")
                if not api_key: raise ValueError("OPENAI_API_KEY environment variable not set")
                llm = OpenAIModel(model_name, provider=OpenAIProvider(api_key=api_key))
                logger.info(f"Using OpenAI model: {model_name}")
            # --- END OPENAI SUPPORT ---
            else:
                logger.error(f"Unsupported model provider requested: {model}")
                raise ValueError(f"Unsupported model provider: {model}")

            # Initialize the agent with the selected LLM
            agent = Agent(
                llm,
                result_type=SummaryResponse,
                result_retries=2,
            )
            logger.info("Pydantic-AI Agent initialized.")

            # Split transcript into chunks
            step = chunk_size - overlap
            if step <= 0:
                logger.warning(f"Overlap ({overlap}) >= chunk_size ({chunk_size}). Adjusting overlap.")
                overlap = max(0, chunk_size - 100)
                step = chunk_size - overlap

            chunks = [text[i:i+chunk_size] for i in range(0, len(text), step)]
            num_chunks = len(chunks)
            logger.info(f"Split transcript into {num_chunks} chunks.")

            for i, chunk in enumerate(chunks):
                logger.info(f"Processing chunk {i+1}/{num_chunks}...")
                try:
                    # Run the agent to get the structured summary for the chunk
                    if model != "ollama":
                        summary_result = await agent.run(
                            f"""Given the following meeting transcript chunk, extract the relevant information according to the required JSON structure. If a specific section (like Critical Deadlines) has no relevant information in this chunk, return an empty list for its 'blocks'. Ensure the output is only the JSON data.

                            IMPORTANT: Block types must be one of: 'text', 'bullet', 'heading1', 'heading2'
                            - Use 'text' for regular paragraphs
                            - Use 'bullet' for list items
                            - Use 'heading1' for major headings
                            - Use 'heading2' for subheadings
                            
                            For the color field, use 'gray' for less important content or '' (empty string) for default.

                            **DETAIL EXTRACTION REQUIREMENTS:**
                            - **Task IDs & References**: Extract ALL task IDs, ticket numbers, project codes when mentioned (e.g., PROJ-404, TASK-123, JIRA-456). Include these in action items and relevant sections.
                            - **Specific Deadlines**: Extract EXACT deadlines mentioned (e.g., "by noon today", "3 PM", "Friday", "next quarter"). NEVER use generic placeholders like "None", "TBD", or "Not specified" unless the transcript explicitly states no deadline exists.
                            - **Owner Names**: Extract SPECIFIC owner names, roles, or team names (e.g., "Two developers", "Designer", "QA team", "Platform team"). NEVER use "No blocker" or generic placeholders.
                            - **Business Context**: Preserve ALL urgency indicators, dependencies, and escalation paths:
                              * Critical deadlines and their business drivers (e.g., "CEO demo on Friday", "release deadline")
                              * Escalation paths (e.g., "escalate to Platform team if not fixed by noon")
                              * Dependencies between tasks (e.g., "blocked by Stripe webhook fix")
                              * Communication gaps or blockers mentioned
                            - **Task References**: Capture ticket IDs, project codes, document links, and any reference numbers mentioned in the transcript.

                            **VALIDATION RULES:**
                            - NEVER use placeholder values: "None", "No blocker", "TBD", "N/A", "(Transcript Chunk X)", or similar generic terms
                            - If information is genuinely missing from the transcript, write "Not specified" (not "None" or "TBD")
                            - For action items: If owner/deadline not mentioned, write "Not specified" - NEVER use "No blocker" or "None"
                            - Reject any references to transcript chunks or internal processing markers

                            Transcript Chunk:
                            ---
                        {chunk}
                        ---

                        Please capture all relevant action items with SPECIFIC details (owners, deadlines, task IDs). Transcription can have spelling mistakes. correct it if required. context is important.
                        
                        While generating the summary, please add the following context:
                        ---
                        {custom_prompt}
                        ---
                        Make sure the output is only the JSON data.
                        """,
                    )
                    else:
                        logger.info(f"Using Ollama model: {model_name} and chunk size: {chunk_size} with overlap: {overlap}")
                        response = await self.chat_ollama_model(model_name, chunk, custom_prompt)
                        
                        # Check if response is already a SummaryResponse object or a string that needs validation
                        if isinstance(response, SummaryResponse):
                            summary_result = response
                        else:
                            # If it's a string (JSON), validate it
                            summary_result = SummaryResponse.model_validate_json(response)
                            
                        logger.info(f"Summary result for chunk {i+1}: {summary_result}")
                        logger.info(f"Summary result type for chunk {i+1}: {type(summary_result)}")

                    if hasattr(summary_result, 'data') and isinstance(summary_result.data, SummaryResponse):
                         final_summary_pydantic = summary_result.data
                    elif isinstance(summary_result, SummaryResponse):
                         final_summary_pydantic = summary_result
                    else:
                         logger.error(f"Unexpected result type from agent for chunk {i+1}: {type(summary_result)}")
                         continue # Skip this chunk

                    # Validate summary for placeholder values and missing fields
                    validation_warnings = self._validate_summary_quality(final_summary_pydantic)
                    if validation_warnings:
                        logger.warning(f"Summary validation warnings for chunk {i+1}: {validation_warnings}")

                    # Convert the Pydantic model to a JSON string
                    chunk_summary_json = final_summary_pydantic.model_dump_json()
                    all_json_data.append(chunk_summary_json)
                    logger.info(f"Successfully generated summary for chunk {i+1}.")

                except Exception as chunk_error:
                    logger.error(f"Error processing chunk {i+1}: {chunk_error}", exc_info=True)

            logger.info(f"Finished processing all {num_chunks} chunks.")
            return num_chunks, all_json_data

        except Exception as e:
            logger.error(f"Error during transcript processing: {str(e)}", exc_info=True)
            raise
    
    async def chat_ollama_model(self, model_name: str, transcript: str, custom_prompt: str):
        message = {
        'role': 'system',
        'content': f'''
        Given the following meeting transcript chunk, extract the relevant information according to the required JSON structure. If a specific section (like Critical Deadlines) has no relevant information in this chunk, return an empty list for its 'blocks'. Ensure the output is only the JSON data.

        **DETAIL EXTRACTION REQUIREMENTS:**
        - **Task IDs & References**: Extract ALL task IDs, ticket numbers, project codes when mentioned (e.g., PROJ-404, TASK-123, JIRA-456). Include these in action items and relevant sections.
        - **Specific Deadlines**: Extract EXACT deadlines mentioned (e.g., "by noon today", "3 PM", "Friday", "next quarter"). NEVER use generic placeholders like "None", "TBD", or "Not specified" unless the transcript explicitly states no deadline exists.
        - **Owner Names**: Extract SPECIFIC owner names, roles, or team names (e.g., "Two developers", "Designer", "QA team", "Platform team"). NEVER use "No blocker" or generic placeholders.
        - **Business Context**: Preserve ALL urgency indicators, dependencies, and escalation paths:
          * Critical deadlines and their business drivers (e.g., "CEO demo on Friday", "release deadline")
          * Escalation paths (e.g., "escalate to Platform team if not fixed by noon")
          * Dependencies between tasks (e.g., "blocked by Stripe webhook fix")
          * Communication gaps or blockers mentioned
        - **Task References**: Capture ticket IDs, project codes, document links, and any reference numbers mentioned in the transcript.

        **VALIDATION RULES:**
        - NEVER use placeholder values: "None", "No blocker", "TBD", "N/A", "(Transcript Chunk X)", or similar generic terms
        - If information is genuinely missing from the transcript, write "Not specified" (not "None" or "TBD")
        - For action items: If owner/deadline not mentioned, write "Not specified" - NEVER use "No blocker" or "None"
        - Reject any references to transcript chunks or internal processing markers

        Transcript Chunk:
            ---
            {transcript}
            ---
        Please capture all relevant action items with SPECIFIC details (owners, deadlines, task IDs). Transcription can have spelling mistakes. correct it if required. context is important.
        
        While generating the summary, please add the following context:
        ---
        {custom_prompt}
        ---

        Make sure the output is only the JSON data.
    
        ''',
        }

        # Create a client and track it for cleanup
        ollama_host = os.getenv('OLLAMA_HOST', 'http://127.0.0.1:11434')
        client = AsyncClient(host=ollama_host)
        self.active_clients.append(client)
        
        try:
            response = await client.chat(model=model_name, messages=[message], stream=True, format=SummaryResponse.model_json_schema())
            
            full_response = ""
            async for part in response:
                content = part['message']['content']
                print(content, end='', flush=True)
                full_response += content
            
            try:
                summary = SummaryResponse.model_validate_json(full_response)
                print("\n", summary.model_dump_json(indent=2), type(summary))
                return summary
            except Exception as e:
                print(f"\nError parsing response: {e}")
                return full_response
        except asyncio.CancelledError:
            logger.info("Ollama request was cancelled during shutdown")
            raise
        except Exception as e:
            logger.error(f"Error in Ollama chat: {e}")
            raise
        finally:
            # Remove the client from active clients list
            if client in self.active_clients:
                self.active_clients.remove(client)

    def _validate_summary_quality(self, summary: SummaryResponse) -> List[str]:
        """Validate summary for placeholder values and missing required fields."""
        warnings = []
        
        # Placeholder patterns to check
        placeholder_patterns = [
            "No blocker",
            "None",
            "TBD",
            "N/A",
            "Transcript Chunk",
        ]
        
        # Check ImmediateActionItems
        if hasattr(summary, 'ImmediateActionItems') and summary.ImmediateActionItems:
            for block in summary.ImmediateActionItems.blocks:
                content_lower = block.content.lower()
                for pattern in placeholder_patterns:
                    if pattern.lower() in content_lower:
                        warnings.append(f"Found placeholder '{pattern}' in ImmediateActionItems: {block.content[:100]}")
                
                # Check for missing critical information
                if not block.content or len(block.content.strip()) < 10:
                    warnings.append(f"Action item has very short or empty content: {block.content}")
        
        # Check NextSteps
        if hasattr(summary, 'NextSteps') and summary.NextSteps:
            for block in summary.NextSteps.blocks:
                content_lower = block.content.lower()
                for pattern in placeholder_patterns:
                    if pattern.lower() in content_lower:
                        warnings.append(f"Found placeholder '{pattern}' in NextSteps: {block.content[:100]}")
        
        
        return warnings

    def _build_context_prompt(self, project_context: Optional[dict]) -> str:
        """Build context section for the LLM prompt from project context."""
        if not project_context:
            return ""
        
        sections = []
        
        # Project and issue types with descriptions
        project_key = project_context.get('project_key', '')
        issue_types = project_context.get('issue_types', [])
        if issue_types:
            type_names = [t.get('name', '') for t in issue_types if t.get('name')]
            type_guidance = """
Issue Type Guidelines:
- Bug: For defects, errors, or broken functionality that needs fixing
- Task: For specific work items or action items to be completed
- Story: For user-facing features or requirements
- Epic: ONLY for large initiatives that span multiple tasks (rarely used for single items)
- Improvement: For enhancements to existing functionality"""
            sections.append(f"=== PROJECT ===\nProject Key: {project_key}\nAvailable Issue Types: {', '.join(type_names)}\n{type_guidance}")
        
        # Team members
        users = project_context.get('users', [])
        if users:
            user_lines = []
            for u in users[:20]:  # Limit to 20 users
                name = u.get('displayName', 'Unknown')
                account_id = u.get('accountId', '')
                email = u.get('emailAddress', '')
                user_lines.append(f"- {name} (accountId: {account_id}) - {email}")
            sections.append(f"=== TEAM MEMBERS (use accountId for assignee_account_id) ===\n" + "\n".join(user_lines))
        
        # Recent issues for duplicate detection
        recent_issues = project_context.get('recent_issues', [])
        if recent_issues:
            issue_lines = []
            for i in recent_issues[:15]:
                key = i.get('key', '')
                summary = i.get('summary', '')[:60]  # Truncate long summaries
                status = i.get('status', '')
                issue_lines.append(f"- {key}: {summary} [{status}]")
            sections.append(f"=== RECENT ISSUES (avoid creating duplicates) ===\n" + "\n".join(issue_lines))
        
        # Available labels
        labels = project_context.get('labels', [])
        if labels:
            sections.append(f"=== AVAILABLE LABELS ===\n{', '.join(labels[:30])}")
        
        # Custom fields (top 10 most useful)
        custom_fields = project_context.get('custom_fields', [])
        if custom_fields:
            field_lines = [f"- {f.get('name', '')} ({f.get('id', '')})" for f in custom_fields[:10]]
            sections.append(f"=== CUSTOM FIELDS (for reference) ===\n" + "\n".join(field_lines))
        
        # Available priorities
        priorities = project_context.get('priorities', [])
        if priorities:
            priority_names = [p.get('name', '') for p in priorities if p.get('name')]
            priority_guidance = """
Priority Guidelines:
- Use the EXACT priority names listed above
- Highest/Critical: System down, blocking all users, security breach
- High: Major functionality broken, significant user impact
- Medium: Important but not urgent, partial functionality affected
- Low: Minor issues, cosmetic, nice-to-have improvements
- Lowest: Backlog items with minimal impact"""
            sections.append(f"=== AVAILABLE PRIORITIES ===\n{', '.join(priority_names)}\n{priority_guidance}")
        
        return "\n\n".join(sections)

    def _post_process_tasks(self, tasks: List[JiraTaskSuggestion]) -> List[JiraTaskSuggestion]:
        """Post-process tasks to fix common issues and ensure quality."""
        processed = []
        
        for task in tasks:
            try:
                # Fix common summary issues
                summary = task.summary.strip()
                
                # Remove any gibberish or corrupted text
                if not self._is_valid_english(summary):
                    logger.warning(f"Skipping task with invalid summary: {summary[:50]}...")
                    continue
                
                # Ensure summary starts with a verb
                action_verbs = ['fix', 'implement', 'add', 'update', 'create', 'resolve', 
                               'investigate', 'review', 'remove', 'refactor', 'improve',
                               'configure', 'setup', 'set up', 'deploy', 'migrate', 'test',
                               'debug', 'optimize', 'enable', 'disable', 'address']
                first_word = summary.split()[0].lower() if summary.split() else ''
                if first_word not in action_verbs:
                    # Try to prepend an appropriate verb
                    if 'bug' in task.type.lower() or 'error' in summary.lower() or 'issue' in summary.lower():
                        summary = f"Fix {summary}"
                    elif 'outage' in summary.lower() or 'down' in summary.lower():
                        summary = f"Resolve {summary}"
                    else:
                        summary = f"Address {summary}"
                
                # Capitalize first letter
                summary = summary[0].upper() + summary[1:] if summary else summary
                
                # Fix type: prevent Epic for single issues
                issue_type = task.type
                if issue_type.lower() == 'epic':
                    # Check if this looks like a single issue
                    if 'outage' in summary.lower() or 'bug' in summary.lower() or 'error' in summary.lower() or 'fix' in summary.lower():
                        issue_type = 'Bug'
                    else:
                        issue_type = 'Task'
                    logger.info(f"Changed Epic to {issue_type} for task: {summary[:50]}...")
                
                # Fix priority based on keywords
                priority = task.priority
                desc_lower = task.description.lower()
                summary_lower = summary.lower()
                
                # Upgrade priority for severe issues
                if 'outage' in desc_lower or 'blocking' in desc_lower or 'down' in desc_lower or '500' in desc_lower:
                    if priority.lower() in ['low', 'lowest', 'medium']:
                        priority = 'High'
                        logger.info(f"Upgraded priority to High for: {summary[:50]}...")
                
                # Create cleaned task
                cleaned_task = JiraTaskSuggestion(
                    summary=summary,
                    description=task.description,
                    priority=priority,
                    type=issue_type,
                    assignee=task.assignee,
                    assignee_account_id=task.assignee_account_id,
                    labels=task.labels,
                    related_issues=task.related_issues
                )
                processed.append(cleaned_task)
                
            except Exception as e:
                logger.warning(f"Failed to post-process task: {e}")
                # Still include the original if post-processing fails
                processed.append(task)
        
        return processed

    def _is_valid_english(self, text: str) -> bool:
        """Check if text appears to be valid English (not gibberish)."""
        if not text or len(text) < 5:
            return False
        
        words = text.split()
        if len(words) < 2:
            return False
        
        # Check for common English words
        common_words = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 
                       'to', 'for', 'and', 'or', 'but', 'in', 'on', 'at', 'with',
                       'fix', 'add', 'update', 'create', 'implement', 'bug', 'error',
                       'issue', 'user', 'system', 'data', 'page', 'api', 'not', 'no'}
        
        # At least one common word should be present
        text_words = set(w.lower() for w in words)
        if not text_words.intersection(common_words):
            # No common words - might be gibberish
            # Check character distribution
            alpha_count = sum(1 for c in text if c.isalpha())
            if alpha_count < len(text) * 0.7:
                return False
            # Check for repeated unusual patterns
            for word in words:
                if len(word) > 3 and word.lower() not in common_words:
                    # Check if word has normal letter distribution
                    vowels = sum(1 for c in word.lower() if c in 'aeiou')
                    if vowels == 0 or vowels > len(word) * 0.7:
                        return False
        
        return True

    async def extract_jira_tasks(self, text: str, model: str, model_name: str, 
                                  project_context: Optional[dict] = None) -> List[JiraTaskSuggestion]:
        """Extract potential Jira tasks from transcript with optional project context"""
        logger.info(f"Extracting Jira tasks with model provider={model}, model_name={model_name}, has_context={project_context is not None}")
        
        agent = None
        llm = None

        try:
            # Select and initialize the AI model
            if model == "claude":
                api_key = await db.get_api_key("claude")
                if not api_key: raise ValueError("ANTHROPIC_API_KEY environment variable not set")
                llm = AnthropicModel(model_name, provider=AnthropicProvider(api_key=api_key))
            elif model == "ollama":
                ollama_host = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
                ollama_base_url = f"{ollama_host}/v1"
                llm = OpenAIModel(model_name, provider=OpenAIProvider(base_url=ollama_base_url))
            elif model == "gemini":
                api_key = await db.get_api_key("gemini")
                # Fallback to environment variable if not in database
                if not api_key:
                    api_key = os.getenv("GOOGLE_API_KEY", "")
                    if api_key:
                        logger.info("Using Gemini API key from GOOGLE_API_KEY environment variable")
                if not api_key:
                    raise ValueError(
                        "Gemini API key is not configured. "
                        "Options: 1) Save the API key in the frontend settings (it will sync to backend), "
                        "2) Set GOOGLE_API_KEY environment variable, "
                        "3) Call POST /save-model-config with the API key."
                    )
                provider = GoogleGLAProvider(api_key=api_key)
                llm = GeminiModel(model_name, provider=provider)
            elif model == "groq":
                api_key = await db.get_api_key("groq")
                if not api_key: raise ValueError("GROQ_API_KEY environment variable not set")
                llm = GroqModel(model_name, provider=GroqProvider(api_key=api_key))
            elif model == "openai":
                api_key = await db.get_api_key("openai")
                if not api_key: raise ValueError("OPENAI_API_KEY environment variable not set")
                llm = OpenAIModel(model_name, provider=OpenAIProvider(api_key=api_key))
            else:
                raise ValueError(f"Unsupported model provider: {model}")

            agent = Agent(
                llm,
                result_type=JiraTaskExtractionResponse,
                result_retries=2,
            )

            # Build context section from project data
            context_section = self._build_context_prompt(project_context)
            
            # Build the enhanced prompt with context
            if context_section:
                prompt = f"""
You are a senior project manager analyzing a meeting transcript to extract well-structured Jira tasks.

{context_section}

=== INSTRUCTIONS ===
Analyze the following meeting transcript and identify actionable tasks that should be tracked in Jira.

For each task, provide:

1. **summary**: A clear, actionable title (max 100 characters)
   - Start with a verb (Fix, Implement, Update, Investigate, Add)
   - Be specific about what needs to be done
   - Example: "Fix VPN authentication failure blocking user login"

2. **description**: A comprehensive description with:
   - **Problem/Context**: What is the issue or requirement?
   - **Impact**: Who is affected and how severely?
   - **Expected Outcome**: What should happen when this is resolved?
   - **Acceptance Criteria**: How do we know this is done?
   - **Notes**: Any additional context, workarounds, or dependencies
   
   For bugs, also include:
   - Steps to reproduce (if mentioned)
   - Error messages or symptoms
   - Environment details (if mentioned)

3. **priority**: Use ONLY from the available priorities listed above
   - Base priority on: user impact, urgency mentioned, business criticality
   - "Blocking users" = High or Highest
   - "Nice to have" = Low or Lowest

4. **type**: Select the most appropriate issue type
   - Bug: Something is broken/not working as expected
   - Task: A specific piece of work to complete
   - Story: A user-facing feature requirement
   - Epic: ONLY for large multi-task initiatives (rarely appropriate)
   - Improvement: Enhancement to existing functionality

5. **assignee**: Display name of the person assigned, or "Unassigned"

6. **assignee_account_id**: The accountId if matched to a team member, otherwise null

7. **labels**: 1-3 relevant labels from available labels, otherwise null

8. **related_issues**: Any issue keys mentioned (e.g., ["PROJ-123"]), otherwise null

=== CRITICAL REQUIREMENTS ===
1. ALL output MUST be in clear, grammatically correct English
2. Summary MUST start with an action verb: Fix, Implement, Update, Add, Investigate, Resolve, Create
3. Summary MUST be a complete, readable sentence (no gibberish or corrupted text)
4. Description MUST have at least 3-4 sentences explaining the issue
5. Do NOT use Epic for individual bugs or tasks - use Bug, Task, or Story instead
6. Priority MUST match the severity: "blocking users" = High, "outage" = Highest

=== QUALITY CHECKLIST ===
Before returning each task, verify:
- [ ] Summary is in proper English and makes sense
- [ ] Summary starts with a verb and is actionable
- [ ] Description explains the problem, impact, and expected outcome
- [ ] Priority matches the described severity
- [ ] Issue type is appropriate (Bug for defects, Task for work items)

=== MEETING CONTENT ===
(This may be a meeting summary with sections like Action Items, Key Points, etc., or a raw transcript)

{text}
"""
            else:
                # Fallback to basic prompt without context
                prompt = """
You are a senior project manager analyzing a meeting transcript to extract well-structured Jira tasks.

Analyze the following meeting transcript and identify actionable tasks.

For each task, provide:

1. **summary**: A clear, actionable title (max 100 characters)
   - Start with a verb (Fix, Implement, Update, Investigate, Add)
   - Be specific about what needs to be done

2. **description**: A comprehensive description including:
   - Problem/Context: What is the issue or requirement?
   - Impact: Who is affected and how severely?
   - Expected Outcome: What should happen when resolved?
   - Acceptance Criteria: How do we know this is done?

3. **priority**: High, Medium, or Low based on:
   - High: Blocking users, critical functionality broken
   - Medium: Important but not immediately urgent
   - Low: Nice-to-have, minor improvements

4. **type**: Select appropriately:
   - Bug: Something is broken
   - Task: Specific work item
   - Story: User-facing feature
   - Improvement: Enhancement to existing functionality
   (Do NOT use Epic for single issues)

5. **assignee**: Name of person assigned, or "Unassigned"
6. **assignee_account_id**: null (no project context)
7. **labels**: null (no project context)
8. **related_issues**: List any issue keys mentioned, otherwise null

=== CRITICAL REQUIREMENTS ===
- ALL output MUST be in clear, grammatically correct English
- Summary MUST start with an action verb and be a complete, readable sentence
- Description MUST explain the problem with at least 3-4 sentences
- Do NOT use Epic for individual issues

Focus on concrete action items. Ignore general discussion.

Meeting Content (may be a summary or transcript):
---
{text}
---
"""
            
            result = await agent.run(prompt.format(text=text))
            # Post-process tasks to ensure quality
            return self._post_process_tasks(result.data.tasks)

        except Exception as e:
            error_str = str(e)
            logger.error(f"Error extracting Jira tasks: {error_str}", exc_info=True)

            # Attempt a simpler fallback for small local models that struggle with tool-calling
            if isinstance(e, ai_exceptions.UnexpectedModelBehavior):
                fallback_tasks = await self._attempt_low_capacity_fallback(model, model_name, text)
                if fallback_tasks is not None:
                    return fallback_tasks

            # Check if it's a model format issue (common with small Ollama models)
            if "Exceeded maximum retries" in error_str or "UnexpectedModelBehavior" in error_str:
                model_hint = ""
                if model == "ollama" and "1b" in model_name.lower():
                    model_hint = f" The model '{model_name}' may be too small for structured task extraction. Consider using a larger model like 'llama3.2:3b' or 'qwen2.5:7b'."
                raise ValueError(
                    f"Model failed to generate properly formatted task data after multiple attempts.{model_hint} "
                    f"This usually means the model couldn't follow the required JSON structure. "
                    f"Try using a larger or more capable model."
                ) from e
            
            raise

    async def _attempt_low_capacity_fallback(
        self,
        model_provider: str,
        model_name: str,
        text: str,
    ) -> Optional[List[JiraTaskSuggestion]]:
        """Try a simplified JSON-only prompt when small local models can't follow tool calls."""
        if model_provider != "ollama":
            return None

        if not self._is_low_capacity_model(model_name):
            return None

        try:
            tasks = await self._fallback_extract_with_ollama(model_name, text)
            if tasks:
                logger.warning(
                    "Recovered Jira tasks using fallback JSON prompt with model '%s'", model_name
                )
            return tasks
        except Exception as fallback_error:
            logger.error(
                f"Fallback extraction failed for model {model_name}: {fallback_error}",
                exc_info=True,
            )
            return None

    def _is_low_capacity_model(self, model_name: str) -> bool:
        """Heuristic to detect tiny local models that often fail tool-calling (<= ~1B params)."""
        lowered = model_name.lower()
        markers = ("0.5b", "0_5b", "1b", "1.1b", "tiny", "mini", "small")
        return any(marker in lowered for marker in markers)

    async def _fallback_extract_with_ollama(
        self,
        model_name: str,
        text: str,
    ) -> Optional[List[JiraTaskSuggestion]]:
        """Run a secondary Ollama call asking for strict JSON and parse it manually."""
        system_prompt = (
            "You are a structured data extractor. "
            "Return ONLY valid JSON (no code fences) matching this schema: "
            '{"tasks":[{"summary":"", "description":"", "priority":"High|Medium|Low", '
            '"type":"Task|Bug|Story|Improvement", "assignee":"<name or Unassigned>"}]}. '
            "Never add extra keys."
        )
        user_prompt = (
            "Analyze this meeting transcript and produce actionable Jira tasks with the schema described. "
            "Focus on concrete work items, bugs, or follow-ups. Transcript:\n---\n"
            f"{text}\n---"
        )

        ollama_host = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
        client = AsyncClient(host=ollama_host)
        self.active_clients.append(client)
        try:
            response = await client.chat(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                options={"temperature": 0.1},
            )
        except Exception as request_error:
            logger.error(
                f"Ollama fallback request failed for model {model_name}: {request_error}",
                exc_info=True,
            )
            return None
        finally:
            if client in self.active_clients:
                self.active_clients.remove(client)

        raw_content = response.get("message", {}).get("content", "")
        if not raw_content:
            return None

        cleaned = self._strip_code_fence(raw_content)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning(
                "Fallback JSON parsing failed (invalid JSON). Raw response preview: %s",
                cleaned[:200],
            )
            return None

        tasks_data = parsed.get("tasks")
        if not isinstance(tasks_data, list):
            logger.warning("Fallback JSON did not include a 'tasks' list.")
            return None

        validated: List[JiraTaskSuggestion] = []
        for idx, task_data in enumerate(tasks_data):
            try:
                validated.append(JiraTaskSuggestion(**task_data))
            except ValidationError as ve:
                logger.warning(
                    "Skipping fallback task %s due to validation error: %s", idx, ve
                )

        return validated

    @staticmethod
    def _strip_code_fence(payload: str) -> str:
        """Remove ```json fences that small models often add even when asked not to."""
        trimmed = payload.strip()
        if not trimmed.startswith("```"):
            return trimmed
        trimmed = trimmed[3:]
        if trimmed.lstrip().lower().startswith("json"):
            trimmed = trimmed.lstrip()[4:]
        if trimmed.endswith("```"):
            trimmed = trimmed[:-3]
        return trimmed.strip()

    def cleanup(self):
        """Clean up resources used by the TranscriptProcessor."""
        logger.info("Cleaning up TranscriptProcessor resources")
        try:
            # Close database connections if any
            if hasattr(self, 'db') and self.db is not None:
                # self.db.close()
                logger.info("Database connection cleanup (using context managers)")
                
            # Cancel any active Ollama client sessions
            if hasattr(self, 'active_clients') and self.active_clients:
                logger.info(f"Terminating {len(self.active_clients)} active Ollama client sessions")
                for client in self.active_clients:
                    try:
                        # Close the client's underlying connection
                        if hasattr(client, '_client') and hasattr(client._client, 'close'):
                            asyncio.create_task(client._client.aclose())
                    except Exception as client_error:
                        logger.error(f"Error closing Ollama client: {client_error}", exc_info=True)
                # Clear the list
                self.active_clients.clear()
                logger.info("All Ollama client sessions terminated")
        except Exception as e:
            logger.error(f"Error during TranscriptProcessor cleanup: {str(e)}", exc_info=True)

        