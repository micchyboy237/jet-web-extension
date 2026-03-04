import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from summarizer_server import app, client as openai_client  # assuming file named summarizer_server.py

@pytest.fixture
def test_client():
    return TestClient(app)

@pytest.fixture
def mock_openai():
    with patch.object(openai_client.chat.completions, "create", new_callable=AsyncMock) as mock:
        mock.return_value = AsyncMock()
        mock.return_value.choices = [AsyncMock()]
        mock.return_value.choices[0].delta.content = "Mocked summary chunk"
        yield mock

@pytest.fixture
def simple_html():
    return """
    <html>
      <body>
        <h2>Resources</h2>
        <p><a href="/internal.pdf">Download PDF</a></p>
        <a href="https://external.com">External link</a>
        <footer>
          <a href="/about">About us</a>
        </footer>
      </body>
    </html>
    """

@pytest.fixture
def complex_html():
    return """
    <div class="article">
      <h1>Main Title</h1>
      <div class="content">
        <a href="/page1">Page 1</a>
        <a href="https://ads.com">Ad</a>
      </div>
      <aside class="sidebar">
        <a href="/sponsor">Sponsor</a>
      </aside>
    </div>
    <footer class="footer">
      <a href="/privacy">Privacy</a>
    </footer>
    """
