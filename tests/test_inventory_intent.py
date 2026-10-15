import pytest

from services.voice_ledger import (
    ExtractedEntry,
    _build_inventory_snapshot_message,
    _looks_like_mixed_entry,
    _looks_like_multiple_udhari,
    _looks_like_inventory_request,
    _looks_like_pnl_report_request,
    match_delete_item,
    normalize_spoken_numbers,
    process_transcript_message,
    save_to_db,
)
from services.conversation_engine import analyze_voice_input
from services.conversation_engine import (
    _clear_pending,
    _fallback_number_extraction,
    get_pending,
    process_follow_up_answer,
)


def test_inventory_keyword_variants_are_detected():
    assert _looks_like_inventory_request("mujhe mere inventry dekhne he")
    assert _looks_like_inventory_request("mujhe meri inventory dekhni hai")
    assert _looks_like_inventory_request("mera stock dikhao")


def test_inventory_keyword_detector_ignores_updates_and_sales():
    assert not _looks_like_inventory_request("50 samosa stock update karo")
    assert not _looks_like_inventory_request("aaj 10 samosa beche")


def test_udhari_mixed_with_sale_is_not_treated_as_udhari_only():
    assert _looks_like_mixed_entry("2 samosa beche, Ramesh ko 60 udhari diya")
    assert not _looks_like_mixed_entry("Ramesh ko 60 udhari diya")


def test_phonetic_udhari_report_is_not_misclassified_as_pnl():
    from services.udhari import match_udhari_query_or_report

    transcript = "Mujhe Ibhari ki report chaiye."
    normalized = normalize_spoken_numbers(transcript)
    assert "udhari" in normalized.lower()
    assert match_udhari_query_or_report(normalized) == ("UDHARI_REPORT", None)
    assert not _looks_like_pnl_report_request(transcript)


def test_multiple_udhari_stays_on_full_extraction_path():
    assert _looks_like_multiple_udhari(
        "Ramesh ko 500 udhari diya aur Suresh ko 300 udhari diya"
    )
    assert _looks_like_multiple_udhari(
        "Ramesh ne 500 clear kiye aur Suresh ne 300 wapas diye"
    )
    assert not _looks_like_multiple_udhari("Ramesh ko 500 udhari diya")


def test_multiple_udhari_actions_are_all_detected():
    from services.udhari import match_udhari_actions

    assert match_udhari_actions(
        "Ramesh ko 500 udhari diya aur Suresh ko 300 udhari diya"
    ) == [
        ("UDHARI_ADD", "Ramesh", 500.0),
        ("UDHARI_ADD", "Suresh", 300.0),
    ]
    assert match_udhari_actions(
        "Ramesh ne 500 wapas diye aur Suresh ne 300 jama kiye"
    ) == [
        ("UDHARI_PAYMENT", "Ramesh", 500.0),
        ("UDHARI_PAYMENT", "Suresh", 300.0),
    ]
    assert match_udhari_actions(
        "Soham ne 20 rupay lautaa die, Ram ne 10 rupay lautaa die"
    ) == [
        ("UDHARI_PAYMENT", "Soham", 20.0),
        ("UDHARI_PAYMENT", "Ram", 10.0),
    ]


def test_new_udhari_phrase_preserves_spoken_amount_and_customer():
    from services.udhari import match_udhari_action

    assert match_udhari_action("Sakshi ko 20 rupya udhar deya") == (
        "UDHARI_ADD",
        "Sakshi",
        20.0,
    )


def test_noisy_whisper_udhari_phrase_does_not_invent_amount():
    from services.udhari import match_udhari_action

    normalized = normalize_spoken_numbers("Sakshi go bís rúbía udhahertía.")
    assert normalized == "Sakshi ko 20 rupya udhari diya."
    assert match_udhari_action(normalized) == ("UDHARI_ADD", "Sakshi", 20.0)


def test_full_udhari_clear_can_be_extracted_without_amount():
    entry = ExtractedEntry(
        intent="UDHARI_PAYMENT",
        customer_name="Ramesh",
        clear_all=True,
        amount=None,
    )
    assert entry.clear_all is True
    assert entry.amount is None


def test_udhari_only_does_not_require_inventory():
    result = analyze_voice_input(
        [
            {
                "intent": "UDHARI_ADD",
                "customer_name": "Ramesh",
                "amount": 60,
            }
        ],
        phone="test-vendor",
        inventory_items=[],
    )

    assert result["status"] == "complete"
    assert result["entries_to_save"][0]["intent"] == "UDHARI_ADD"


def test_new_item_follow_up_fallback_maps_price_and_daily_stock():
    assert _fallback_number_extraction("20 rupay ka, roj 100 banata hoon", "NEW_ITEM") == {
        "quantity": None,
        "amount": None,
        "price_per_unit": 20.0,
        "daily_stock": 100.0,
    }


def test_new_item_follow_up_completes_when_extraction_model_returns_no_json(monkeypatch):
    phone = "follow-up-test"
    _clear_pending(phone)
    monkeypatch.setattr(
        "services.conversation_engine._extract_answer_data",
        lambda *_args: {},
    )
    monkeypatch.setattr(
        "services.inventory.upsert_inventory_item",
        lambda **_kwargs: None,
    )

    analyze_result = analyze_voice_input(
        [{"intent": "ADD_ENTRY", "type": "income", "category": "samosa", "quantity": 50, "amount": None}],
        phone,
        [],
    )
    assert analyze_result["status"] == "pending"

    result = process_follow_up_answer(
        phone,
        "20 rupay ka, roj 100 banata hoon",
        [],
        [],
    )

    assert result["status"] == "complete"
    assert result["entries_to_save"][0]["amount"] == 1000.0
    assert result["entries_to_save"][0]["quantity"] == 50
    assert result["inventory_created"]["price"] == 20.0
    assert not get_pending(phone)


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


def test_normalize_common_whisper_phonetic_spellings():
    assert normalize_spoken_numbers(
        "Kramis ko paanso rupay uadhar diya, samose bich diya"
    ) == "Kramis ko 500 rupay udhari diya, samose bech diya"


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


@pytest.mark.parametrize(
    "phrase,expected_item",
    [
        ("dhokla delet karo", "dhokla"),
        ("dhokla delete karo", "dhokla"),
        ("dhokla delete", "dhokla"),
        ("delete dhokla", "dhokla"),
        ("remove dhokla", "dhokla"),
        ("dhokla remove karo", "dhokla"),
        ("dhokla hatao", "dhokla"),
        ("dhokla hata do", "dhokla"),
        ("dhokla nikaal do", "dhokla"),
        ("dhokla ko delete karo", "dhokla"),
        ("dhokla ko inventory se delete karo", "dhokla"),
        ("inventory se dhokla delete karo", "dhokla"),
        ("inventory se dhokla hata do", "dhokla"),
        ("dhokla item delete karo", "dhokla"),
        ("dhokla stock hata do", "dhokla"),
        ("dhokla stock delete karo", "dhokla"),
        ("meri inventory se dhokla delete karo", "dhokla"),
        ("ढोकला डिलीट करो", "ढोकला"),
        ("ढोकला हटाओ", "ढोकला"),
        ("ढोकला हटा दो", "ढोकला"),
        ("डिलीट ढोकला", "ढोकला"),
        ("इन्वेंटरी से ढोकला डिलीट करो", "ढोकला"),
    ],
)
def test_match_delete_item_detects_all_variants(phrase, expected_item):
    assert match_delete_item(phrase) == expected_item


@pytest.mark.parametrize(
    "phrase",
    [
        "10 dhokla becha",
        "dhokla 20 bech diya",
        "dhokla stock 50",
        "50 samosa stock update karo",
        "dhokla ka rate 20 rupay",
        "mera hisaab bhejo",
        "inventory dikhao",
        "mera stock dikhao",
        "dhokla khareeda 200",
        "Ramesh ko 500 udhari diya",
        "Ramesh ne 500 diya",
    ],
)
def test_match_delete_item_ignores_non_delete(phrase):
    assert match_delete_item(phrase) is None


def test_inventory_request_detector_ignores_delete_commands():
    assert not _looks_like_inventory_request("inventory se dhokla delete karo")
    assert not _looks_like_inventory_request("dhokla inventory se delete karo")
    assert not _looks_like_inventory_request("dhokla ko inventory se hata do")
    assert not _looks_like_inventory_request("dhokla delet karo")
    assert not _looks_like_inventory_request("meri inventory se samosa hatao")
    # Pure view commands should still match
    assert _looks_like_inventory_request("meri inventory dekhni hai")
    assert _looks_like_inventory_request("mera stock dikhao")


def test_delete_inventory_item_fast_path(monkeypatch):
    deleted_calls = []

    def mock_delete(phone, item_name):
        deleted_calls.append((phone, item_name))
        return True

    monkeypatch.setattr("services.inventory.delete_inventory_item", mock_delete)
    monkeypatch.setattr("services.voice_ledger.invalidate_inventory_cache", lambda _p: None)

    reply = process_transcript_message("whatsapp:+919999999999", "dhokla delet karo")
    assert "dhokla" in reply
    assert "delete kar diya gaya" in reply
    assert "Current profit" not in reply
    assert len(deleted_calls) == 1
    assert deleted_calls[0] == ("whatsapp:+919999999999", "dhokla")


def test_delete_inventory_item_not_found(monkeypatch):
    monkeypatch.setattr("services.inventory.delete_inventory_item", lambda phone=None, item_name=None: False)
    monkeypatch.setattr("services.voice_ledger.invalidate_inventory_cache", lambda _p: None)

    reply = process_transcript_message("whatsapp:+919999999999", "dhokla delet karo")
    assert "dhokla" in reply
    assert "nahi mila" in reply
    assert "Current profit" not in reply

