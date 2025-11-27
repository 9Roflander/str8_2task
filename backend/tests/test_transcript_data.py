import asyncio
from pathlib import Path

import pytest

from app.db import DatabaseManager


@pytest.mark.asyncio
async def test_get_transcript_data_falls_back_to_transcripts(tmp_path: Path):
    """
    Ensure get_transcript_data returns combined transcript_text when only the
    transcripts table has data and transcript_chunks is empty.
    """
    db_path = tmp_path / "test_jira_transcripts.db"
    manager = DatabaseManager(str(db_path))

    meeting_id = "meeting-test-1"

    # Save meeting and a couple of transcript segments using the public helpers
    await manager.save_meeting(meeting_id, "Test Meeting")
    await manager.save_meeting_transcript(
        meeting_id=meeting_id,
        transcript="First part of the transcript.",
        timestamp="2025-01-01T10:00:00Z",
    )
    await manager.save_meeting_transcript(
        meeting_id=meeting_id,
        transcript="Second part of the transcript.",
        timestamp="2025-01-01T10:01:00Z",
    )

    data = await manager.get_transcript_data(meeting_id)

    assert data is not None
    assert "transcript_text" in data
    combined = data["transcript_text"]
    assert "First part of the transcript." in combined
    assert "Second part of the transcript." in combined


@pytest.mark.asyncio
async def test_get_transcript_data_returns_none_for_unknown_meeting(tmp_path: Path):
    """
    Ensure get_transcript_data returns None when there is no data for the
    given meeting_id in either transcript_chunks or transcripts.
    """
    db_path = tmp_path / "test_jira_transcripts_empty.db"
    manager = DatabaseManager(str(db_path))

    data = await manager.get_transcript_data("non-existent-meeting")
    assert data is None



