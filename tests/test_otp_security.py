import pytest
from fastapi.testclient import TestClient
import main as main_module
from services.settings import get_settings


def _configure_env(monkeypatch) -> None:
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "fake-token")
    monkeypatch.setenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "123")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "123")
    monkeypatch.setenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "verify-token")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("MONGODB_URI", "mongodb://localhost:27017")
    monkeypatch.setenv("MONGODB_DB_NAME", "testdb")
    get_settings.cache_clear()


def test_reject_fake_phone_numbers(monkeypatch):
    _configure_env(monkeypatch)
    client = TestClient(main_module.app)

    # 1. Invalid patterns
    invalid_numbers = [
        "1234567890",  # Starts with 1
        "0987654321",  # Starts with 0
        "1111111111",  # Starts with 1
        "98765",       # Less than 10 digits
        "abcdefghij",  # Letters
    ]

    for num in invalid_numbers:
        res = client.post("/auth/request-otp", json={"phone": num})
        assert res.status_code == 400, f"Expected 400 for {num}, got {res.status_code}"


def test_reject_unauthorized_1234_bypass(monkeypatch):
    _configure_env(monkeypatch)
    client = TestClient(main_module.app)

    test_num = "9820099999"
    try:
        main_module.get_db()["otps"].delete_one({"phone": f"whatsapp:+91{test_num}"})
    except Exception:
        pass

    # Mock send_whatsapp_reply so request-otp succeeds
    monkeypatch.setattr(main_module, "send_whatsapp_reply", lambda to_phone, body: "wamid.12345")

    # Request OTP for a valid phone number
    res_req = client.post("/auth/request-otp", json={"phone": test_num})
    assert res_req.status_code == 200

    # Attempt to log in with 1234 backdoor — must be REJECTED with 400!
    res_verify = client.post("/auth/verify-otp", json={"phone": test_num, "otp": "1234"})
    assert res_verify.status_code == 400
    assert "Incorrect OTP" in res_verify.json()["detail"] or "Invalid OTP" in res_verify.json()["detail"]
