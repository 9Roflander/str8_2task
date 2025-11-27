import asyncio

from app.transcript_processor import (
    JiraTaskSuggestion,
    TranscriptProcessor,
)
from pydantic_ai.models.gemini import GeminiModel
from pydantic_ai.providers.google_gla import GoogleGLAProvider


def test_strip_code_fence_removes_backticks():
    processor = TranscriptProcessor()
    payload = """```json
    {"tasks": []}
    ```"""
    assert processor._strip_code_fence(payload) == '{"tasks": []}'


def test_low_capacity_fallback_skips_non_ollama():
    processor = TranscriptProcessor()
    result = asyncio.run(
        processor._attempt_low_capacity_fallback(
            model_provider="openai",
            model_name="gpt-4o-mini",
            text="Sample transcript",
        )
    )
    assert result is None


def test_low_capacity_fallback_uses_stubbed_result(monkeypatch):
    processor = TranscriptProcessor()

    async def fake_fallback(model_name: str, text: str):
        return [
            JiraTaskSuggestion(
                summary="Fix bug",
                description="Resolve Stripe JSON parsing issue",
                priority="High",
                type="Bug",
                assignee="Unassigned",
            )
        ]

    monkeypatch.setattr(
        processor,
        "_fallback_extract_with_ollama",
        fake_fallback,
    )

    result = asyncio.run(
        processor._attempt_low_capacity_fallback(
            model_provider="ollama",
            model_name="llama3.2:1b",
            text="Sample transcript",
        )
    )

    assert result is not None
    assert len(result) == 1
    assert result[0].summary == "Fix bug"


def test_gemini_provider_sets_base_url_without_google_sdk():
    provider = GoogleGLAProvider(api_key="dummy-key")
    model = GeminiModel(model_name="gemini-2.0-flash", provider=provider)

    assert model.base_url.endswith("generativelanguage.googleapis.com/v1beta/models/")

