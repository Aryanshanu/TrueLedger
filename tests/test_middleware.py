"""Tests for the two security-shaped middlewares backend/main.py ships
with - CORS and the sliding-window rate limiter - neither of which had any
test verifying it actually does what it claims (the CORS wildcard bug
fixed this session shipped and sat live with zero coverage catching it)."""

from __future__ import annotations

import importlib
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    """Reloads backend.main fresh so ALLOWED_ORIGINS env var changes (used
    by the CORS tests below) are actually picked up - the module computes
    allowed_origins once at import time."""
    import backend.main as main_module

    importlib.reload(main_module)
    return TestClient(main_module.app)


def test_cors_allows_configured_frontend_origin(client):
    resp = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:8080",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:8080"


def test_cors_rejects_arbitrary_origin(client):
    """Regression test for the "*" wildcard bug: a origin not on the
    allow-list must NOT get an Access-Control-Allow-Origin header back -
    that header being absent is what makes the browser block the response
    for a credentialess cross-origin fetch from that origin."""
    resp = client.options(
        "/health",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in {k.lower() for k in resp.headers.keys()}


def test_cors_does_not_allow_credentials():
    """allow_credentials must stay False: the frontend sends no cookies,
    and allow_credentials=True combined with a broad allow-list (or any
    future accidental wildcard) would let any allowed origin read
    cookie-authenticated responses once auth is added."""
    import backend.main as main_module

    assert main_module.app.user_middleware  # sanity: middleware is actually registered
    cors_mw = next(m for m in main_module.app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert cors_mw.kwargs["allow_credentials"] is False


def test_allowed_origins_env_var_overrides_default_and_excludes_wildcard(monkeypatch):
    """ALLOWED_ORIGINS is the escape hatch for a real deploy's frontend URL -
    confirm it's actually read, and that nothing reintroduces a bare "*"."""
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://example.com, https://two.example.com")
    import backend.main as main_module

    importlib.reload(main_module)
    assert main_module.allowed_origins == ["https://example.com", "https://two.example.com"]
    assert "*" not in main_module.allowed_origins


def test_rate_limit_returns_429_after_threshold(client):
    # /health is exempt from rate limiting (see test below), so any other
    # route works for this test; mock get_consent so it never touches a
    # real Firestore client (no credentials in this environment) - the
    # rate limiter runs before the route handler regardless of what that
    # handler returns, so what's mocked here doesn't affect what's tested.
    with patch("backend.main.get_consent", return_value={}):
        for _ in range(120):
            resp = client.get("/borrowers/b_clean/consent-status")
        resp = client.get("/borrowers/b_clean/consent-status")
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_rate_limit_does_not_apply_to_health_check(client):
    for _ in range(130):
        resp = client.get("/health")
        assert resp.status_code == 200
