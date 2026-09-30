from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_recommendations_can_be_filtered_to_pending():
    res = client.get("/api/v1/recommendations?status=pending")
    assert res.status_code == 200
    recs = res.json()["recommendations"]
    assert all(r["status"] == "pending" for r in recs)


def test_ask_reports_unconfigured_without_key():
    res = client.post("/api/v1/ask", json={"message": "hello"})
    assert res.status_code == 503
    assert "is not configured" in res.text


def test_ask_answers_when_agent_is_available(monkeypatch):
    from unittest.mock import MagicMock

    from app.api.deps import get_health_agent
    from app.core.config import get_settings

    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    get_settings.cache_clear()
    agent = MagicMock()
    agent.ask.return_value = {"answer": "ok", "tool_calls": []}
    app.dependency_overrides[get_health_agent] = lambda: agent
    try:
        res = client.post("/api/v1/ask", json={"message": "hello"})
    finally:
        app.dependency_overrides.pop(get_health_agent, None)
    assert res.status_code == 200
