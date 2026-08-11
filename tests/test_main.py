import main as main_module

from fastapi.testclient import TestClient

from services.settings import get_settings


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows
        self._limit = 100
        self._phone_filter = None

    def select(self, _fields):
        return self

    def order(self, _field, desc=False):
        self._rows = sorted(
            self._rows,
            key=lambda row: row.get("created_at", ""),
            reverse=bool(desc),
        )
        return self

    def limit(self, value):
        self._limit = int(value)
        return self

    def eq(self, field, value):
        if field == "phone":
            self._phone_filter = value
        return self

    def execute(self):
        rows = self._rows
        if self._phone_filter is not None:
            rows = [row for row in rows if row.get("phone") == self._phone_filter]
        return _FakeResult(rows[: self._limit])


class _FakeSupabase:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return _FakeQuery(self._rows)


def _configure_env(monkeypatch) -> None:
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "fake-token")
    monkeypatch.setenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "123")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "123")
    monkeypatch.setenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "verify-token")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "service-role-key")
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

    monkeypatch.setattr(main_module, "get_supabase", lambda: _FakeSupabase(rows))

    response = client.get("/entries?vendor_id=whatsapp:+919999999999&limit=7")
    assert response.status_code == 200
    payload = response.json()
    assert "entries" in payload
    assert len(payload["entries"]) == 2
    assert payload["entries"][0]["total_earned"] == 500.0
    assert payload["entries"][1]["total_spent"] == 200.0
