"""
services/vendor_manager.py
--------------------------
Manages vendor registration and onboarding for multi-vendor scoping.

Each vendor is uniquely identified by their WhatsApp phone number.
All their ledger/inventory data is already scoped by this phone key.
This module adds a formal `vendors` collection to track who they are
and runs a multi-step interactive onboarding flow the first time they message.

Onboarding State Machine:
  new → awaiting_consent → awaiting_name → awaiting_category → awaiting_business_name → active
  (declined state for users who said No — they can restart by messaging again)
"""

import logging
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from db_config import get_db

logger = logging.getLogger(__name__)

# Onboarding state constants stored in vendor document
STATE_NEW               = "new"                     # First contact ever
STATE_AWAITING_CONSENT  = "awaiting_consent"        # Welcome sent, waiting for Yes/No
STATE_AWAITING_NAME     = "awaiting_name"           # Consent given, asking for name
STATE_AWAITING_CATEGORY = "awaiting_category"       # Name saved, asking for business category
STATE_AWAITING_BIZ_NAME = "awaiting_business_name"  # Category saved, asking for business name
STATE_ACTIVE            = "active"                  # Fully onboarded
STATE_DECLINED          = "declined"                # Said No — will restart if they message again

# Business category options (used in list message)
BUSINESS_CATEGORIES = [
    {"id": "food_chai",   "title": "🍵 Food & Chai",      "description": "Chai, snacks, tiffin, restaurant"},
    {"id": "kirana",      "title": "🛍 Kirana / Grocery",  "description": "General store, ration shop"},
    {"id": "kapda",       "title": "🧵 Kapda / Textile",   "description": "Clothes, fabric, tailoring"},
    {"id": "services",    "title": "💈 Services",          "description": "Salon, repair, coaching, etc."},
    {"id": "vegetables",  "title": "🥦 Sabzi / Fruits",    "description": "Vegetable or fruit vendor"},
    {"id": "medicine",    "title": "💊 Medical / Pharmacy","description": "Medicine shop, clinic"},
    {"id": "electronics", "title": "📱 Electronics",       "description": "Mobile, electrical, hardware"},
    {"id": "other",       "title": "📦 Other Business",    "description": "Any other type of business"},
]

CATEGORY_ID_TO_LABEL = {cat["id"]: cat["title"] for cat in BUSINESS_CATEGORIES}

# ── Message Templates ──────────────────────────────────────────────────────────

WELCOME_MESSAGE = (
    "🙏 *VyapaarSaathi mein aapka swagat hai!*\n\n"
    "Main aapka WhatsApp ledger AI hoon. Aap mujhe voice messages bhej ke apni daily bikri, "
    "kharcha, aur stock record kar sakte hain — bilkul *free* mein! 🎤📒\n\n"
    "Kya aap *VyapaarSaathi* se jud ke apna business shuru karna chahte hain?"
)

# Sent after user clicks "Haan, Jodein"
CONSENT_ACCEPTED_MESSAGE = (
    "✅ *Bahut achha!*\n\n"
    "Pehle, *apna poora naam* type karein:\n"
    "_(jaise: Ramesh, Suresh Kumar, Priya)_"
)

CONSENT_DECLINED_MESSAGE = (
    "🙏 Theek hai, koi baat nahi!\n\n"
    "Jab bhi aap tayaar hon, bas *'Hi'* bhejein — hum hamesha yahan hain. 😊"
)

NAME_SAVED_TEMPLATE = (
    "✅ *Shukriya, {name}!*\n\n"
    "Ab batayein — *aapka business kis category mein aata hai?*\n\n"
    "Neeche diye list mein se select karein 👇"
)

CATEGORY_SAVED_TEMPLATE = (
    "👍 *{category}* — noted!\n\n"
    "Ab *aapke business ka naam* type karein:\n"
    "_(jaise: Ramesh Kirana Store, Priya Beauty Parlour)_"
)

ONBOARDING_COMPLETE_TEMPLATE = (
    "🎉 *Welcome to VyapaarSaathi, {name}!*\n\n"
    "📋 *Aapki Details:*\n"
    "• Naam: *{name}*\n"
    "• Business: *{business_name}*\n"
    "• Category: *{category}*\n\n"
    "Ab aap taiyaar hain! Voice note bhejein jaise:\n"
    "• _\"Maine 50 rupay ki chai bechi\"_\n"
    "• _\"100 rupay ka aata kharida\"_\n"
    "• _\"Mera hisaab dikhao\"_\n\n"
    "Main sab kuch record kar lunga! 📒✨"
)

NAME_SAVED_TEMPLATE = NAME_SAVED_TEMPLATE  # keep alias for backward compat

VOICE_PROMPT_MESSAGE = (
    "🎤 *Voice message bhejein apni entry ke liye!*\n\n"
    "Text messages se entries nahi banti. "
    "Baat bolein aur main record kar lunga! 🙏"
)

# ── Normalization ──────────────────────────────────────────────────────────────

def _normalize_phone(phone: str) -> str:
    p = phone.strip()
    if not p.startswith("whatsapp:"):
        p = f"whatsapp:{p}"
    return p


# ── CRUD helpers ──────────────────────────────────────────────────────────────

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
            "business_category": None,
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


def set_vendor_state(phone: str, state: str) -> None:
    try:
        db = get_db()
        db["vendors"].update_one(
            {"phone": _normalize_phone(phone)},
            {"$set": {"state": state, "last_active": datetime.now(timezone.utc).isoformat()}},
        )
    except Exception as exc:
        logger.warning("set_vendor_state failed for %s: %s", phone, exc)


def set_vendor_name(phone: str, name: str) -> None:
    try:
        db = get_db()
        db["vendors"].update_one(
            {"phone": _normalize_phone(phone)},
            {"$set": {
                "name": name.strip(),
                "state": STATE_AWAITING_CATEGORY,
                "last_active": datetime.now(timezone.utc).isoformat(),
            }},
        )
        logger.info("Vendor name saved for %s: %s", phone, name.strip())
    except Exception as exc:
        logger.warning("set_vendor_name failed for %s: %s", phone, exc)


def set_vendor_category(phone: str, category_id: str, category_label: str) -> None:
    """Save business category and move to awaiting_business_name state."""
    try:
        db = get_db()
        db["vendors"].update_one(
            {"phone": _normalize_phone(phone)},
            {"$set": {
                "business_category_id": category_id,
                "business_category": category_label,
                "state": STATE_AWAITING_BIZ_NAME,
                "last_active": datetime.now(timezone.utc).isoformat(),
            }},
        )
        logger.info("Vendor category saved for %s: %s", phone, category_label)
    except Exception as exc:
        logger.warning("set_vendor_category failed for %s: %s", phone, exc)


def set_vendor_business_name(phone: str, business_name: str) -> None:
    """Save business name and mark vendor as fully active."""
    try:
        db = get_db()
        db["vendors"].update_one(
            {"phone": _normalize_phone(phone)},
            {"$set": {
                "business_name": business_name.strip(),
                "state": STATE_ACTIVE,
                "last_active": datetime.now(timezone.utc).isoformat(),
            }},
        )
        logger.info("Vendor business name saved for %s: %s", phone, business_name.strip())
    except Exception as exc:
        logger.warning("set_vendor_business_name failed for %s: %s", phone, exc)


def update_vendor_onboarding(phone: str, name: str, vendor_type: str, language: str, pin: str) -> None:
    """Used by web client onboarding form."""
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


# ── Name extraction ────────────────────────────────────────────────────────────

def extract_name_from_text(text: str) -> Optional[str]:
    text = text.strip()
    # Common words that are NOT names
    non_names = {
        "selling", "buying", "sold", "becha", "bechi", "kharida", "rupay", "rupee",
        "chai", "samosa", "vada", "aata", "dal", "chawal", "sabzi", "stock", "mera",
        "meri", "aaj", "kal", "hisaab", "report", "record", "dikhao",
        "hi", "hello", "hey", "namaste", "pranam", "heya", "ji", "haan", "nahi",
        "theek", "ok", "okay", "yes", "no", "ha", "na",
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


def extract_category_from_reply(text: str) -> Optional[tuple]:
    """Try to match a text reply to one of the known category IDs.
    Returns (category_id, category_label) or None."""
    text_lower = text.strip().lower()
    # Direct ID match (from button/list reply)
    for cat in BUSINESS_CATEGORIES:
        if text_lower == cat["id"]:
            return (cat["id"], cat["title"])
    # Fuzzy keyword match
    keyword_map = {
        "food_chai":   ["food", "chai", "snack", "tiffin", "restaurant", "dhaba"],
        "kirana":      ["kirana", "grocery", "ration", "general", "store"],
        "kapda":       ["kapda", "textile", "cloth", "tailor", "fabric"],
        "services":    ["service", "salon", "repair", "coaching", "beauty", "parlour"],
        "vegetables":  ["sabzi", "vegetable", "fruit", "subzi"],
        "medicine":    ["medicine", "medical", "pharmacy", "clinic", "dawai"],
        "electronics": ["electronic", "mobile", "phone", "electrical", "hardware"],
        "other":       ["other", "aur", "different"],
    }
    for cat_id, keywords in keyword_map.items():
        if any(kw in text_lower for kw in keywords):
            label = CATEGORY_ID_TO_LABEL.get(cat_id, cat_id)
            return (cat_id, label)
    return None


# ── Vendor listing ─────────────────────────────────────────────────────────────

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
