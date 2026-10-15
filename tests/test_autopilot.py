from datetime import date

from services import autopilot


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def __iter__(self):
        return iter(self.rows)


class _Collection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, *_args, **_kwargs):
        return _Cursor(self.rows)


class _Db:
    def __init__(self, ledger_rows):
        self.collections = {
            "ledger": _Collection(ledger_rows),
        }

    def __getitem__(self, key):
        return self.collections.setdefault(key, _Collection([]))


def test_autopilot_prioritizes_low_stock_and_explains_reason(monkeypatch):
    monkeypatch.setattr(
        autopilot,
        "get_db",
        lambda: _Db(
            [
                {"type": "income", "amount": 1000, "category": "chai", "quantity": 50, "created_at": "2026-10-15T09:00:00+00:00"},
                {"type": "expense", "amount": 1200, "category": "milk", "created_at": "2026-10-14T09:00:00+00:00"},
            ]
        ),
    )
    monkeypatch.setattr(
        autopilot,
        "get_inventory",
        lambda _phone: [{"item_name": "chai", "unit": "cup", "daily_stock": 50, "current_stock": 5}],
    )
    monkeypatch.setattr(
        autopilot,
        "list_customers",
        lambda *_args, **_kwargs: [],
    )

    result = autopilot.build_autopilot_plan("web-client", today=date(2026, 10, 15))

    assert result["recommendations"][0]["key"] == "stock:chai"
    assert result["recommendations"][0]["data"]["recommended_quantity"] == 45
    assert "Current stock" in result["recommendations"][0]["reason"]


def test_autopilot_does_not_recommend_missing_entry_without_history(monkeypatch):
    monkeypatch.setattr(autopilot, "get_db", lambda: _Db([]))
    monkeypatch.setattr(autopilot, "get_inventory", lambda _phone: [])
    monkeypatch.setattr(autopilot, "list_customers", lambda *_args, **_kwargs: [])

    result = autopilot.build_autopilot_plan("web-client", today=date(2026, 10, 15))

    assert result["recommendations"] == []
    assert result["summary"]["active_days"] == 0
