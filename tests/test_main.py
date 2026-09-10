import main as main_module

from fastapi.testclient import TestClient

from services.settings import get_settings


class _FakeCollection:
    def __init__(self, rows):
        self._rows = rows

    def find(self, *args, **kwargs):
        class _Cursor:
            def __init__(self, rows):
                self._rows = rows
            def sort(self, *args, **kwargs): return self
            def limit(self, *args, **kwargs): return self
            def __iter__(self): return iter(self._rows)
        return _Cursor(self._rows)

class _FakeDB:
    def __init__(self, rows):
        self._rows = rows
    
    def __getitem__(self, key):
        return _FakeCollection(self._rows)

def _configure_env(monkeypatch) -> None:
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "fake-token")
    monkeypatch.setenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "123")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "123")
    monkeypatch.setenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "verify-token")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("MONGODB_URI", "mongodb://localhost:27017")
    monkeypatch.setenv("MONGODB_DB_NAME", "testdb")
    get_settings.cache_clear()


def test_read_root(monkeypatch):
    _configure_env(monkeypatch)
    client = TestClient(main_module.app)

    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["webhook"] == "/webhook"


def test_entries_compatibility_endpoint(monkeypatch):
    _configure_env(monkeypatch)
    client = TestClient(main_module.app)

    rows = [
        {
            "id": "1",
            "phone": "whatsapp:+919999999999",
            "amount": 500,
            "type": "income",
            "category": "tea",
            "description": "chai bechi",
            "audio_url": "https://example.com/audio1",
            "created_at": "2026-03-28T10:00:00Z",
        },
        {
            "id": "2",
            "phone": "whatsapp:+919999999999",
            "amount": 200,
            "type": "expense",
            "category": "milk",
            "description": "doodh kharida",
            "audio_url": "https://example.com/audio2",
            "created_at": "2026-03-28T09:00:00Z",
        },
    ]

    monkeypatch.setattr(main_module, "get_db", lambda: _FakeDB(rows))

    response = client.get("/entries?vendor_id=whatsapp:+919999999999&limit=7")
    assert response.status_code == 200
    payload = response.json()
    assert "entries" in payload
    assert len(payload["entries"]) == 2
    assert payload["entries"][0]["total_earned"] == 500.0
    assert payload["entries"][1]["total_spent"] == 200.0
