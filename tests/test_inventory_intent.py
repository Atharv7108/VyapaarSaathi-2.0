import pytest

from services.voice_ledger import (
    _build_inventory_snapshot_message,
    _looks_like_inventory_request,
    normalize_spoken_numbers,
    save_to_db,
)


def test_inventory_keyword_variants_are_detected():
    assert _looks_like_inventory_request("mujhe mere inventry dekhne he")
    assert _looks_like_inventory_request("mujhe meri inventory dekhni hai")
    assert _looks_like_inventory_request("mera stock dikhao")


def test_inventory_keyword_detector_ignores_updates_and_sales():
    assert not _looks_like_inventory_request("50 samosa stock update karo")
    assert not _looks_like_inventory_request("aaj 10 samosa beche")


def test_inventory_snapshot_message_contains_stock_and_price():
    message = _build_inventory_snapshot_message(
        [
            {
                "item_name": "samosa",
                "item_name_hi": "samosa",
                "unit": "piece",
                "current_stock": 22,
                "daily_stock": 50,
                "price_per_unit": 15,
            }
        ]
    )

    assert "Aapki inventory" in message
    assert "samosa" in message
    assert "22/50 piece" in message
    assert "15/piece" in message
    assert "Instant Alert: Abhi koi critical low-stock item nahi hai" in message


def test_inventory_snapshot_message_includes_low_stock_alerts():
    message = _build_inventory_snapshot_message(
        [
            {
                "item_name": "chai",
                "item_name_hi": "chai",
                "unit": "cup",
                "current_stock": 8,
                "daily_stock": 50,
                "price_per_unit": 12,
            }
        ]
    )

    assert "Instant Alert: Low stock" in message
    assert "chai: 8/50 left" in message


def test_inventory_snapshot_message_includes_stockout_alerts():
    message = _build_inventory_snapshot_message(
        [
            {
                "item_name": "vada pav",
                "item_name_hi": "vada pav",
                "unit": "piece",
                "current_stock": 0,
                "daily_stock": 40,
                "price_per_unit": 20,
            }
        ]
    )

    assert "Instant Alert: Stockout" in message
    assert "vada pav: stockout" in message


@pytest.mark.parametrize(
    ("spoken", "expected"),
    [
        ("aaj bees chai teen sau mein bechi", "aaj 20 chai 300 mein bechi"),
        ("pachaas samose beche", "50 samose beche"),
        ("Ramesh ko paanch sau udhari diya", "Ramesh ko 500 udhari diya"),
        ("आज बीस चाय तीन सौ में बेची", "आज 20 चाय 300 में बेची"),
    ],
)
def test_normalize_spoken_numbers(spoken, expected):
    assert normalize_spoken_numbers(spoken) == expected


def test_save_rejects_income_without_amount_or_known_price(monkeypatch):
    class _Ledger:
        def insert_one(self, _record):
            raise AssertionError("incomplete income must not be inserted")

    class _Database:
        def __getitem__(self, name):
            assert name == "ledger"
            return _Ledger()

    monkeypatch.setattr("services.voice_ledger.get_db", lambda: _Database())
    monkeypatch.setattr("services.inventory.get_inventory", lambda _phone: [])

    with pytest.raises(ValueError, match="without an amount"):
        save_to_db(
            phone="web-client",
            extracted_data={
                "type": "income",
                "category": "samosa",
                "quantity": 50,
                "amount": None,
            },
            audio_url="",
        )
