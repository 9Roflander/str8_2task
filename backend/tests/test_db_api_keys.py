import pytest

from app.db import DatabaseManager


@pytest.mark.asyncio
async def test_save_and_get_gemini_key(tmp_path):
    db_path = tmp_path / "gemini_keys.db"
    manager = DatabaseManager(str(db_path))

    await manager.save_api_key("test-secret", "gemini")
    retrieved = await manager.get_api_key("gemini")

    assert retrieved == "test-secret"


