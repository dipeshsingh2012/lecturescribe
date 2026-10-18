import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import app, validate_proxy_url, ALLOWED_PDF_DOMAINS, RESTRICTED_PUBLISHER_DOMAINS


def test_validate_proxy_url_rejects_empty_and_non_https():
    with pytest.raises(HTTPException) as exc1:
        validate_proxy_url("")
    assert exc1.value.status_code == 400

    with pytest.raises(HTTPException) as exc2:
        validate_proxy_url("http://arxiv.org/pdf/1706.03762.pdf")
    assert exc2.value.status_code == 400
    assert "Only secure HTTPS URLs are permitted" in exc2.value.detail


def test_validate_proxy_url_rejects_restricted_commercial_publishers():
    restricted_sample = [
        "https://jamanetwork.com/journals/jama/fullarticle/2492881",
        "https://www.sciencedirect.com/science/article/pii/S0140673620301835",
        "https://link.springer.com/article/10.1007/s00134-016-4577-4",
        "https://doi.org/10.1001/jama.2016.0287"
    ]
    for url in restricted_sample:
        with pytest.raises(HTTPException) as exc:
            validate_proxy_url(url)
        assert exc.value.status_code == 400
        assert "publisher security restrictions" in exc.value.detail


def test_validate_proxy_url_rejects_unallowed_domains():
    with pytest.raises(HTTPException) as exc:
        validate_proxy_url("https://random-untrusted-site.com/paper.pdf")
    assert exc.value.status_code == 403
    assert "not in the allowed list" in exc.value.detail


def test_validate_proxy_url_rejects_ssrf_private_ips():
    # Mock socket.getaddrinfo to return a private IP (e.g. 192.168.1.10 or 127.0.0.1)
    with patch("socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (2, 1, 6, "", ("127.0.0.1", 443))
        ]
        with pytest.raises(HTTPException) as exc:
            validate_proxy_url("https://arxiv.org/pdf/1706.03762.pdf")
        assert exc.value.status_code == 403
        assert "private or internal network addresses" in exc.value.detail


def test_validate_proxy_url_allows_open_access_sources():
    with patch("socket.getaddrinfo") as mock_dns:
        # Public IP
        mock_dns.return_value = [
            (2, 1, 6, "", ("151.101.65.140", 443))
        ]
        valid = validate_proxy_url("https://arxiv.org/pdf/1706.03762.pdf")
        assert valid == "https://arxiv.org/pdf/1706.03762.pdf"


def test_proxy_endpoint_rejection_for_jama():
    client = TestClient(app)
    response = client.get(
        "/api/literature/pdf-proxy",
        params={"url": "https://jamanetwork.com/journals/jama/article-pdf/2492881/jvp160018.pdf"}
    )
    assert response.status_code == 400
    assert "publisher security restrictions" in response.json()["detail"]


def test_proxy_endpoint_rejection_for_unlisted_domain():
    client = TestClient(app)
    response = client.get(
        "/api/literature/pdf-proxy",
        params={"url": "https://unknown-domain.org/test.pdf"}
    )
    assert response.status_code == 403
    assert "not in the allowed list" in response.json()["detail"]


def test_proxy_endpoint_streams_allowed_pdf():
    client = TestClient(app)
    with patch("socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [(2, 1, 6, "", ("151.101.65.140", 443))]

        class MockAsyncResponse:
            status_code = 200
            async def aiter_bytes(self, chunk_size=65536):
                yield b"%PDF-1.4 Mocked PDF content bytes"
            async def __aenter__(self):
                return self
            async def __aexit__(self, exc_type, exc_val, exc_tb):
                pass

        class MockAsyncClient:
            def __init__(self, *args, **kwargs):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, exc_type, exc_val, exc_tb):
                pass
            def stream(self, method, url, **kwargs):
                return MockAsyncResponse()

        with patch("httpx.AsyncClient", side_effect=MockAsyncClient):
            response = client.get(
                "/api/literature/pdf-proxy",
                params={"url": "https://arxiv.org/pdf/1706.03762.pdf"}
            )
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/pdf"
            assert "inline" in response.headers["content-disposition"]
            assert b"%PDF-1.4 Mocked PDF content bytes" in response.content

