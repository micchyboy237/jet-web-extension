import pytest
from fastapi.testclient import TestClient
from summarizer_server import app

@pytest.mark.asyncio
async def test_link_endpoint_basic(test_client, simple_html):
    payload = {
        "url": "https://example.com",
        "html": simple_html,
        "include_external": False,
    }
    response = test_client.post("/extract-grouped-links", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert any("Resources" in g["context"] for g in data)


@pytest.mark.asyncio
async def test_link_endpoint_error_handling(test_client):
    # Invalid JSON
    response = test_client.post("/extract-grouped-links", json={"url": ""})
    assert response.status_code == 422  # validation error

    # No url
    response = test_client.post("/extract-grouped-links", json={})
    assert response.status_code == 422
