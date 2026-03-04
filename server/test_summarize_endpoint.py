import pytest
from unittest.mock import patch

from summarizer_server import app


@pytest.mark.asyncio
async def test_summarize_small_content(test_client, mock_openai):
    payload = {"html": "<h1>Test</h1><p>Small content</p>"}

    with patch("summarizer_server.client.chat.completions.create", mock_openai):
        response = test_client.post("/summarize", json=payload)

    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    # We can't easily test full stream content in sync client,
    # but at least endpoint responds
