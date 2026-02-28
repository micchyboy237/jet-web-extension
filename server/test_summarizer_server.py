"""
Tests for summarizer_server2.py (E2E and unit).
Run with: pytest server/test_summarizer_server2.py -q
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

# Make server importable from this directory
sys.path.insert(0, str(Path(__file__).parent))
from summarizer_server import app, clean_html

test_client = TestClient(app)


class TestSummarizerServer2:
    """E2E API and cleaning tests for summarizer_server2 (uses BDD docstrings)."""

    def test_summarize_small_html(self):
        """
        Given: Small real-world HTML snippet (news-article style).
        When: POST /summarize.
        Then: 200 + streamed summary contains expected key phrases.
        """
        # Given
        html = """
        <html><head><title>AI Breakthrough</title></head>
        <body>
        <h1>New LLM Released</h1>
        <p>Researchers announce model with 128K context window.</p>
        <ul><li>Feature 1</li><li>Feature 2</li></ul>
        </body></html>
        """
        # Mock stream (small path = direct streaming call)
        mock_part1 = MagicMock(
            choices=[
                MagicMock(delta=MagicMock(content="The webpage announces a new LLM "))
            ]
        )
        mock_part2 = MagicMock(
            choices=[MagicMock(delta=MagicMock(content="with 128K context."))]
        )
        mock_stream = [mock_part1, mock_part2]

        with patch("summarizer_server2.client.chat.completions.create") as mock_create:
            mock_create.return_value = iter(mock_stream)

            # When
            response = test_client.post("/summarize", json={"html": html})
            result = "".join(list(response.iter_text()))

            # Then
            expected = "The webpage announces a new LLM with 128K context."
            assert response.status_code == 200
            assert result == expected

    def test_summarize_large_html_hierarchical(self):
        """
        Given: Large HTML that triggers chunking (> CHUNK_SIZE_CHARS).
        When: POST /summarize.
        Then: Non-stream chunk calls + final streamed synthesis.
        """
        # Given (force large path)
        long_html = "<p>Section content.</p>" * 6000

        def mock_side_effect(*args, **kwargs):
            if kwargs.get("stream"):
                # final synthesis stream
                p1 = MagicMock(
                    choices=[
                        MagicMock(delta=MagicMock(content="Final combined summary."))
                    ]
                )
                return iter([p1])
            else:
                # chunk non-stream
                resp = MagicMock()
                resp.choices = [MagicMock(message=MagicMock(content="Section summary"))]
                return resp

        with patch(
            "summarizer_server2.client.chat.completions.create",
            side_effect=mock_side_effect,
        ) as mock_create:
            # When
            response = test_client.post("/summarize", json={"html": long_html})
            result = "".join(list(response.iter_text()))

            # Then
            expected = "Final combined summary."
            assert response.status_code == 200
            assert result == expected
            assert mock_create.call_count >= 2  # at least one chunk + final

    def test_clean_html(self):
        """
        Given: Raw HTML with noise.
        When: clean_html called.
        Then: Only relevant content returned.
        """
        # Given
        html = """
        <html><body>
        <nav>Ignore nav</nav>
        <h1>Main Title</h1>
        <p>Important paragraph.</p>
        <footer>Ignore footer</footer>
        </body></html>
        """
        # When
        result = clean_html(html)
        # Then
        expected = "Main Title\n\nImportant paragraph."
        assert result.strip() == expected
