from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def test_missing_facility():
    response = client.get("/api/v1/facilities/invalid_id")
    assert response.status_code == 404
    assert "Facility 'invalid_id' not found" in response.text
    print("test_missing_facility: passed")

def test_ask_without_api_key(monkeypatch):
    # An empty value overrides backend/.env; popping the variable would let the
    # .env file's real key back in and leak into later tests.
    monkeypatch.setenv("GEMINI_API_KEY", "")
    response = client.post("/api/v1/ask", json={"message": "hello"})
    assert response.status_code == 503
    assert "is not configured" in response.text
    print("test_ask_without_api_key: passed")

def test_security_headers():
    response = client.get("/health")
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("Strict-Transport-Security") == "max-age=31536000; includeSubDomains"
    print("test_security_headers: passed")
