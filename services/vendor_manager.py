"""
services/vendor_manager.py
--------------------------
Manages vendor registration and onboarding for multi-vendor scoping.

Each vendor is uniquely identified by their WhatsApp phone number.
All their ledger/inventory data is already scoped by this phone key.
This module adds a formal `vendors` collection to track who they are
and runs a lightweight onboarding flow the first time they message.
"""

import logging
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from db_config import get_db

logger = logging.getLogger(__name__)

# Onboarding state constants stored in vendor document
STATE_NEW = "new"                      # Just registered, welcome sent
STATE_AWAITING_NAME = "awaiting_name"  # Prompted for name, waiting for reply
STATE_ACTIVE = "active"                # Fully onboarded, use normally

WELCOME_MESSAGE = (
    "🙏 *VyapaarSaathi mein aapka swagat hai!*\n\n"
    "Main aapka WhatsApp ledger AI hoon. Aap mujhe voice messages bhej ke apni daily bikri, "
    "kharcha, aur stock record kar sakte hain.\n\n"
    "Shuru karne se pehle, *apna naam batayein* (jaise: \"Mera naam Ramesh hai\")."
)

NAME_SAVED_TEMPLATE = (
    "✅ *Shukriya, {name}!*\n\n"
    "Ab aap taiyaar hain. Voice message bhejein jaise:\n"
    "• _\"Maine 50 rupay ki chai bechi\"_\n"
    "• _\"100 rupay ka aata kharida\"_\n"
    "• _\"Mera hisaab dikhao\"_\n\n"
    "Main sab kuch record kar lunga! 📒"
)


def _normalize_phone(phone: str) -> str:
    p = phone.strip()
    if not p.startswith("whatsapp:"):
        p = f"whatsapp:{p}"
    return p


def get_vendor(phone: str) -> Optional[Dict[str, Any]]:
    try:
        db = get_db()
        return db["vendors"].find_one({"phone": _normalize_phone(phone)})
    except Exception as exc:
        logger.warning("get_vendor failed for %s: %s", phone, exc)
        return None


def get_or_create_vendor(phone: str) -> Dict[str, Any]:
    normalized = _normalize_phone(phone)
    try:
        db = get_db()
        vendor = db["vendors"].find_one({"phone": normalized})
        if vendor:
            return vendor
        now = datetime.now(timezone.utc).isoformat()
        new_vendor: Dict[str, Any] = {
            "phone": normalized,
            "name": None,
            "business_name": None,
            "state": STATE_NEW,
            "language": "hi",
            "registered_at": now,
            "last_active": now,
            "active": True,
        }
        db["vendors"].insert_one(new_vendor)
        logger.info("New vendor registered: %s", normalized)
        return new_vendor
    except Exception as exc:
        logger.warning("get_or_create_vendor failed for %s: %s", phone, exc)
        return {"phone": normalized, "name": None, "state": STATE_ACTIVE}


def update_last_active(phone: str) -> None:
    try:
        db = get_db()
        db["vendors"].update_one(
            {"phone": _normalize_phone(phone)},
            {"$set": {"last_active": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception as exc:
        logger.warning("update_last_active failed for %s: %s", phone, exc)


def set_vendor_name(phone: str, name: str) -> None:
    try:
        db = get_db()
        db["vendors"].update_one(
            {"phone": _normalize_phone(phone)},
            {"$set": {
                "name": name.strip(),
                "state": STATE_ACTIVE,
                "last_active": datetime.now(timezone.utc).isoformat(),
            }},
        )
        logger.info("Vendor name saved for %s: %s", phone, name.strip())
    except Exception as exc:
        logger.warning("set_vendor_name failed for %s: %s", phone, exc)


def update_vendor_onboarding(phone: str, name: str, vendor_type: str, language: str, pin: str) -> None:
    try:
        db = get_db()
        db["vendors"].update_one(
            {"phone": _normalize_phone(phone)},
            {"$set": {
                "name": name.strip(),
                "vendor_type": vendor_type,
                "language": language,
                "pin": pin,
                "state": STATE_ACTIVE,
                "last_active": datetime.now(timezone.utc).isoformat(),
            }},
        )
        logger.info("Vendor onboarding complete for %s", phone)
    except Exception as exc:
        logger.warning("update_vendor_onboarding failed for %s: %s", phone, exc)


def set_vendor_state(phone: str, state: str) -> None:
    try:
        db = get_db()
        db["vendors"].update_one(
            {"phone": _normalize_phone(phone)},
            {"$set": {"state": state, "last_active": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception as exc:
        logger.warning("set_vendor_state failed for %s: %s", phone, exc)


def extract_name_from_text(text: str) -> Optional[str]:
    text = text.strip()
    # Common words that are NOT names
    non_names = {
        "selling", "buying", "sold", "becha", "bechi", "kharida", "rupay", "rupee",
        "chai", "samosa", "vada", "aata", "dal", "chawal", "sabzi", "stock", "mera",
        "meri", "aaj", "kal", "hisaab", "report", "record", "dikhao",
    }
    patterns = [
        r"(?:mera naam|mera name|mera naa?m|main hoon|mai hoon|mera naa?m hai)\s+([A-Za-z\u0900-\u097F]+)",
        r"(?:my name is|i am|i'm|naam hai)\s+([A-Za-z\u0900-\u097F]+)",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            candidate = m.group(1).strip().title()
            if candidate.lower() not in non_names:
                return candidate
    # Short text (1-3 words, no digits) treated as a name
    words = text.split()
    if 1 <= len(words) <= 3 and not any(c.isdigit() for c in text):
        candidate = text.title()
        # Reject if any word is a known non-name
        if not any(w.lower() in non_names for w in words):
            return candidate
    return None


def list_vendors(limit: int = 100) -> List[Dict[str, Any]]:
    try:
        db = get_db()
        vendors = list(db["vendors"].find({}, {"_id": 0}).sort("registered_at", -1).limit(limit))
        for v in vendors:
            try:
                v["entry_count"] = db["ledger"].count_documents({"phone": v["phone"]})
            except Exception:
                v["entry_count"] = 0
        return vendors
    except Exception as exc:
        logger.warning("list_vendors failed: %s", exc)
        return []
