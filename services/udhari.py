"""
udhari.py — Customer Credit (Khata / Udhari) Service
======================================================
Business logic for managing customer credit accounts for vendors.

Data model (MongoDB collection: "udhari"):
  - vendor_phone: str        — vendor's WhatsApp phone key
  - customer_name: str       — customer's name (lowercased index)
  - customer_name_display: str — original casing
  - total_due: float         — current outstanding amount (always >= 0)
  - total_given: float       — cumulative credit ever given
  - total_paid: float        — cumulative payments received
  - created_at: str          — ISO timestamp of first entry
  - updated_at: str          — ISO timestamp of last update
  - is_settled: bool         — True if total_due == 0
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db_config import get_db

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_name(name: str) -> str:
    return name.strip().lower()


def get_or_create_customer(vendor_phone: str, customer_name: str) -> Dict[str, Any]:
    db = get_db()
    key = _normalize_name(customer_name)
    doc = db["udhari"].find_one(
        {"vendor_phone": vendor_phone, "customer_name": key},
        {"_id": 0},
    )
    if doc:
        return doc
    now = _now_iso()
    new_doc = {
        "vendor_phone": vendor_phone,
        "customer_name": key,
        "customer_name_display": customer_name.strip(),
        "total_due": 0.0,
        "total_given": 0.0,
        "total_paid": 0.0,
        "created_at": now,
        "updated_at": now,
        "is_settled": True,
    }
    db["udhari"].insert_one(new_doc)
    new_doc.pop("_id", None)
    return new_doc


def add_udhari(vendor_phone: str, customer_name: str, amount: float, note: str = "") -> Dict[str, Any]:
    if amount <= 0:
        raise ValueError(f"Udhari amount must be positive, got {amount}")
    db = get_db()
    key = _normalize_name(customer_name)
    get_or_create_customer(vendor_phone, customer_name)
    now = _now_iso()
    db["udhari_transactions"].insert_one({
        "vendor_phone": vendor_phone,
        "customer_name": key,
        "tx_type": "credit",
        "amount": float(amount),
        "note": note.strip(),
        "created_at": now,
    })
    db["udhari"].update_one(
        {"vendor_phone": vendor_phone, "customer_name": key},
        {
            "$inc": {"total_due": amount, "total_given": amount},
            "$set": {
                "updated_at": now,
                "is_settled": False,
                "customer_name_display": customer_name.strip(),
            },
        },
    )
    return get_customer_summary(vendor_phone, customer_name)


def record_payment(vendor_phone: str, customer_name: str, amount: float, note: str = "") -> Dict[str, Any]:
    if amount <= 0:
        raise ValueError(f"Payment amount must be positive, got {amount}")
    db = get_db()
    key = _normalize_name(customer_name)
    customer = get_or_create_customer(vendor_phone, customer_name)
    current_due = float(customer.get("total_due", 0))
    actual_payment = min(amount, current_due)
    if actual_payment <= 0:
        return customer
    now = _now_iso()
    db["udhari_transactions"].insert_one({
        "vendor_phone": vendor_phone,
        "customer_name": key,
        "tx_type": "payment",
        "amount": float(actual_payment),
        "note": note.strip(),
        "created_at": now,
    })
    new_due = max(0.0, current_due - actual_payment)
    db["udhari"].update_one(
        {"vendor_phone": vendor_phone, "customer_name": key},
        {
            "$inc": {"total_paid": actual_payment},
            "$set": {"total_due": new_due, "updated_at": now, "is_settled": new_due == 0.0},
        },
    )
    return get_customer_summary(vendor_phone, customer_name)


def get_customer_summary(vendor_phone: str, customer_name: str) -> Dict[str, Any]:
    db = get_db()
    key = _normalize_name(customer_name)
    doc = db["udhari"].find_one({"vendor_phone": vendor_phone, "customer_name": key}, {"_id": 0})
    return doc or {}


def list_customers(vendor_phone: str, only_outstanding: bool = False, search: str = "") -> List[Dict[str, Any]]:
    db = get_db()
    query: Dict[str, Any] = {"vendor_phone": vendor_phone}
    if only_outstanding:
        query["total_due"] = {"$gt": 0}
    if search.strip():
        query["customer_name"] = {"$regex": _normalize_name(search), "$options": "i"}
    return list(db["udhari"].find(query, {"_id": 0}).sort("total_due", -1).limit(200))


def get_customer_transactions(vendor_phone: str, customer_name: str, limit: int = 50) -> List[Dict[str, Any]]:
    db = get_db()
    key = _normalize_name(customer_name)
    return list(
        db["udhari_transactions"]
        .find({"vendor_phone": vendor_phone, "customer_name": key}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )


def get_udhari_totals(vendor_phone: str) -> Dict[str, Any]:
    db = get_db()
    pipeline = [
        {"$match": {"vendor_phone": vendor_phone}},
        {
            "$group": {
                "_id": None,
                "total_outstanding": {"$sum": "$total_due"},
                "total_customers": {"$sum": 1},
                "active_customers": {"$sum": {"$cond": [{"$gt": ["$total_due", 0]}, 1, 0]}},
                "total_given_all_time": {"$sum": "$total_given"},
                "total_recovered_all_time": {"$sum": "$total_paid"},
            }
        },
    ]
    result = list(db["udhari"].aggregate(pipeline))
    if not result:
        return {
            "total_outstanding": 0.0,
            "total_customers": 0,
            "active_customers": 0,
            "total_given_all_time": 0.0,
            "total_recovered_all_time": 0.0,
        }
    row = result[0]
    row.pop("_id", None)
    return row


def format_udhari_added_msg(customer_name: str, amount: float, total_due: float) -> str:
    return (
        f"✅ *Udhari Record ho gaya!*\n\n"
        f"👤 Customer: *{customer_name}*\n"
        f"💸 Diya: *₹{amount:,.0f}*\n"
        f"📊 Ab Baaki: *₹{total_due:,.0f}*\n\n"
        f"_VyapaarSaathi Khata — {datetime.now(timezone.utc).strftime('%d %b %Y')}_"
    )


def format_payment_received_msg(customer_name: str, paid: float, remaining: float) -> str:
    if remaining == 0:
        status_line = "🎉 *Poora hisaab clear ho gaya!*"
    else:
        status_line = f"📊 Ab Baaki: *₹{remaining:,.0f}*"
    return (
        f"✅ *Payment Mili!*\n\n"
        f"👤 Customer: *{customer_name}*\n"
        f"💰 Mila: *₹{paid:,.0f}*\n"
        f"{status_line}\n\n"
        f"_VyapaarSaathi Khata — {datetime.now(timezone.utc).strftime('%d %b %Y')}_"
    )


def format_customer_khata_msg(customer_name: str, summary: Dict[str, Any], txns: List[Dict[str, Any]]) -> str:
    due = float(summary.get("total_due", 0))
    given = float(summary.get("total_given", 0))
    paid = float(summary.get("total_paid", 0))
    lines = [
        f"📒 *Khata — {customer_name}*\n",
        f"💸 Total Diya: ₹{given:,.0f}",
        f"💰 Total Mila: ₹{paid:,.0f}",
        f"📊 *Baaki: ₹{due:,.0f}*\n",
    ]
    if txns:
        lines.append("_Recent transactions:_")
        for t in txns[:5]:
            emoji = "💸" if t.get("tx_type") == "credit" else "💰"
            amt = float(t.get("amount", 0))
            note = t.get("note", "")
            date_str = str(t.get("created_at", ""))[:10]
            line = f"{emoji} ₹{amt:,.0f}  {date_str}"
            if note:
                line += f"  _{note}_"
            lines.append(line)
    return "\n".join(lines)
