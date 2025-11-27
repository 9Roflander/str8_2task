"""
WebSocket Hub for Browser Extension Communication

This module manages WebSocket connections from browser extensions,
allowing the Meeting Minutes app to send LLM-generated questions
directly to meeting chats.
"""

from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional
import logging
import json
import asyncio
from datetime import datetime

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections from browser extensions."""
    
    def __init__(self):
        # Map of connection_id -> WebSocket
        self.active_connections: Dict[str, WebSocket] = {}
        # Track connection metadata
        self.connection_info: Dict[str, dict] = {}
        # Message queue for offline extensions
        self.pending_messages: List[dict] = []
        
    async def connect(self, websocket: WebSocket, connection_id: str) -> bool:
        """Accept a new WebSocket connection from an extension."""
        try:
            await websocket.accept()
            self.active_connections[connection_id] = websocket
            self.connection_info[connection_id] = {
                "connected_at": datetime.now().isoformat(),
                "last_activity": datetime.now().isoformat(),
            }
            logger.info(f"Extension connected: {connection_id}")
            
            # Send any pending messages
            await self._flush_pending_messages(connection_id)
            return True
        except Exception as e:
            logger.error(f"Failed to accept connection {connection_id}: {e}")
            return False
    
    def disconnect(self, connection_id: str):
        """Remove a disconnected extension."""
        if connection_id in self.active_connections:
            del self.active_connections[connection_id]
        if connection_id in self.connection_info:
            del self.connection_info[connection_id]
        logger.info(f"Extension disconnected: {connection_id}")
    
    async def send_message_to_chat(
        self, 
        message: str, 
        platform: Optional[str] = None,
        connection_id: Optional[str] = None
    ) -> dict:
        """
        Send a message to be posted in the meeting chat.
        
        Args:
            message: The message text to post
            platform: Target platform (google-meet, zoom, microsoft-teams) or None for auto-detect
            connection_id: Specific connection to use, or None to broadcast
            
        Returns:
            dict with success status and details
        """
        if not self.active_connections:
            # Queue message for when an extension connects
            self.pending_messages.append({
                "action": "postMessage",
                "message": message,
                "platform": platform,
                "queued_at": datetime.now().isoformat()
            })
            logger.warning("No active extensions, message queued")
            return {
                "success": False, 
                "error": "No browser extension connected",
                "queued": True
            }
        
        payload = json.dumps({
            "action": "postMessage",
            "message": message,
            "platform": platform
        })
        
        results = []
        
        if connection_id and connection_id in self.active_connections:
            # Send to specific connection
            try:
                await self.active_connections[connection_id].send_text(payload)
                self.connection_info[connection_id]["last_activity"] = datetime.now().isoformat()
                results.append({"connection_id": connection_id, "success": True})
            except Exception as e:
                logger.error(f"Failed to send to {connection_id}: {e}")
                results.append({"connection_id": connection_id, "success": False, "error": str(e)})
        else:
            # Broadcast to all connections
            for conn_id, websocket in self.active_connections.items():
                try:
                    await websocket.send_text(payload)
                    self.connection_info[conn_id]["last_activity"] = datetime.now().isoformat()
                    results.append({"connection_id": conn_id, "success": True})
                except Exception as e:
                    logger.error(f"Failed to send to {conn_id}: {e}")
                    results.append({"connection_id": conn_id, "success": False, "error": str(e)})
        
        success_count = sum(1 for r in results if r.get("success"))
        return {
            "success": success_count > 0,
            "sent_to": success_count,
            "total_connections": len(self.active_connections),
            "details": results
        }
    
    async def send_questions_to_chat(
        self,
        questions: List[str],
        delay_between: float = 2.0,
        platform: Optional[str] = None
    ) -> dict:
        """
        Send multiple questions to the meeting chat with delays.
        
        Args:
            questions: List of question strings to post
            delay_between: Seconds to wait between messages
            platform: Target platform or None for auto-detect
            
        Returns:
            dict with success status and per-question results
        """
        results = []
        for i, question in enumerate(questions):
            result = await self.send_message_to_chat(question, platform)
            results.append({
                "question": question,
                "result": result
            })
            
            # Wait between messages (except after the last one)
            if i < len(questions) - 1 and result.get("success"):
                await asyncio.sleep(delay_between)
        
        success_count = sum(1 for r in results if r["result"].get("success"))
        return {
            "success": success_count == len(questions),
            "sent": success_count,
            "total": len(questions),
            "results": results
        }
    
    async def _flush_pending_messages(self, connection_id: str):
        """Send queued messages to a newly connected extension."""
        if not self.pending_messages:
            return
            
        websocket = self.active_connections.get(connection_id)
        if not websocket:
            return
            
        logger.info(f"Flushing {len(self.pending_messages)} pending messages to {connection_id}")
        
        sent_indices = []
        for i, msg in enumerate(self.pending_messages):
            try:
                await websocket.send_text(json.dumps(msg))
                sent_indices.append(i)
                await asyncio.sleep(1.0)  # Delay between queued messages
            except Exception as e:
                logger.error(f"Failed to flush message {i}: {e}")
                break
        
        # Remove sent messages from queue
        for i in reversed(sent_indices):
            self.pending_messages.pop(i)
    
    def get_status(self) -> dict:
        """Get current connection status."""
        return {
            "connected_extensions": len(self.active_connections),
            "connections": [
                {
                    "id": conn_id,
                    **info
                }
                for conn_id, info in self.connection_info.items()
            ],
            "pending_messages": len(self.pending_messages)
        }
    
    async def ping_all(self) -> dict:
        """Send ping to all connections to check health."""
        results = []
        for conn_id, websocket in list(self.active_connections.items()):
            try:
                await websocket.send_text(json.dumps({"action": "ping"}))
                results.append({"connection_id": conn_id, "status": "ok"})
            except Exception as e:
                logger.warning(f"Ping failed for {conn_id}, removing: {e}")
                self.disconnect(conn_id)
                results.append({"connection_id": conn_id, "status": "disconnected"})
        
        return {"results": results}


# Global connection manager instance
extension_manager = ConnectionManager()


async def handle_extension_websocket(websocket: WebSocket, connection_id: str):
    """
    Handle a WebSocket connection from a browser extension.
    
    This is the main WebSocket handler that should be mounted in FastAPI.
    """
    connected = await extension_manager.connect(websocket, connection_id)
    if not connected:
        return
    
    try:
        while True:
            # Wait for messages from the extension
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                action = message.get("action")
                
                if action == "pong":
                    # Response to ping
                    logger.debug(f"Received pong from {connection_id}")
                    
                elif action == "status":
                    # Extension reporting its status
                    logger.info(f"Extension status from {connection_id}: {message}")
                    extension_manager.connection_info[connection_id].update({
                        "platform": message.get("platform"),
                        "meeting_active": message.get("meeting_active", False)
                    })
                    
                elif action == "message_sent":
                    # Confirmation that a message was posted
                    logger.info(f"Message confirmed sent by {connection_id}: {message.get('message_id')}")
                    
                elif action == "error":
                    # Error from extension
                    logger.error(f"Extension error from {connection_id}: {message.get('error')}")
                    
                else:
                    logger.debug(f"Unknown action from {connection_id}: {action}")
                    
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON from {connection_id}: {data[:100]}")
                
    except WebSocketDisconnect:
        extension_manager.disconnect(connection_id)
    except Exception as e:
        logger.error(f"WebSocket error for {connection_id}: {e}")
        extension_manager.disconnect(connection_id)



