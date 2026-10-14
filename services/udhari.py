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
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from db_config import get_db
from services.vendor_manager import get_phone_variants, _normalize_phone

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_name(name: str) -> str:
    return name.strip().lower()


def get_or_create_customer(vendor_phone: str, customer_name: str) -> Dict[str, Any]:
    db = get_db()
    key = _normalize_name(customer_name)
    canonical = _normalize_phone(vendor_phone) if vendor_phone != "web-client" else "web-client"
    variants = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    doc = db["udhari"].find_one(
        {"vendor_phone": {"$in": variants}, "customer_name": key},
        {"_id": 0},
    )
    if doc:
        return doc
    now = _now_iso()
    new_doc = {
        "vendor_phone": canonical,
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
    canonical = _normalize_phone(vendor_phone) if vendor_phone != "web-client" else "web-client"
    variants = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    get_or_create_customer(vendor_phone, customer_name)
    now = _now_iso()
    db["udhari_transactions"].insert_one({
        "vendor_phone": canonical,
        "customer_name": key,
        "tx_type": "credit",
        "amount": float(amount),
        "note": note.strip(),
        "created_at": now,
    })
    db["udhari"].update_one(
        {"vendor_phone": {"$in": variants}, "customer_name": key},
        {
            "$inc": {"total_due": amount, "total_given": amount},
            "$set": {
                "vendor_phone": canonical,
                "updated_at": now,
                "is_settled": False,
                "customer_name_display": customer_name.strip(),
            },
        },
    )
    summary = get_customer_summary(vendor_phone, customer_name)
    if not summary.get("customer_phone"):
        set_pending_customer_phone(vendor_phone, customer_name)
        summary["needs_customer_phone"] = True
    return summary


def record_payment(vendor_phone: str, customer_name: str, amount: float, note: str = "") -> Dict[str, Any]:
    if amount <= 0:
        raise ValueError(f"Payment amount must be positive, got {amount}")
    db = get_db()
    key = _normalize_name(customer_name)
    canonical = _normalize_phone(vendor_phone) if vendor_phone != "web-client" else "web-client"
    variants = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    customer = get_or_create_customer(vendor_phone, customer_name)
    current_due = float(customer.get("total_due", 0))
    actual_payment = min(amount, current_due)
    if actual_payment <= 0:
        return customer
    now = _now_iso()
    db["udhari_transactions"].insert_one({
        "vendor_phone": canonical,
        "customer_name": key,
        "tx_type": "payment",
        "amount": float(actual_payment),
        "note": note.strip(),
        "created_at": now,
    })
    new_due = max(0.0, current_due - actual_payment)
    db["udhari"].update_one(
        {"vendor_phone": {"$in": variants}, "customer_name": key},
        {
            "$inc": {"total_paid": actual_payment},
            "$set": {"vendor_phone": canonical, "total_due": new_due, "updated_at": now, "is_settled": new_due == 0.0},
        },
    )
    return get_customer_summary(vendor_phone, customer_name)


def get_customer_summary(vendor_phone: str, customer_name: str) -> Dict[str, Any]:
    db = get_db()
    key = _normalize_name(customer_name)
    phones = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    doc = db["udhari"].find_one({"vendor_phone": {"$in": phones}, "customer_name": key}, {"_id": 0})
    return doc or {}


def save_customer_phone(vendor_phone: str, customer_name: str, customer_phone: str) -> Dict[str, Any]:
    """Store the customer's WhatsApp number after explicit vendor confirmation."""
    raw_digits = "".join(ch for ch in customer_phone if ch.isdigit())
    if len(raw_digits) == 10:
        cleaned_phone = f"+91{raw_digits}"
    elif len(raw_digits) == 12 and raw_digits.startswith("91"):
        cleaned_phone = f"+{raw_digits}"
    elif len(raw_digits) >= 8:
        cleaned_phone = f"+{raw_digits}"
    else:
        raise ValueError("Valid customer WhatsApp number is required")
    vendor_digits = "".join(ch for ch in vendor_phone if ch.isdigit())
    if vendor_digits.startswith("91") and len(vendor_digits) == 12:
        vendor_digits = vendor_digits[2:]
    if raw_digits == vendor_digits or raw_digits == f"91{vendor_digits}":
        raise ValueError("Customer number cannot be the vendor's own number")
    key = _normalize_name(customer_name)
    phones = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    result = get_customer_summary(vendor_phone, customer_name)
    if not result:
        raise ValueError("Customer udhari account not found")
    db = get_db()
    db["udhari"].update_one(
        {"vendor_phone": {"$in": phones}, "customer_name": key},
        {"$set": {"customer_phone": cleaned_phone, "updated_at": _now_iso()}},
    )
    result["customer_phone"] = cleaned_phone
    return result


def set_pending_customer_phone(vendor_phone: str, customer_name: str) -> None:
    db = get_db()
    db["vendors"].update_one(
        {"phone": vendor_phone},
        {"$set": {"pending_udhari_phone_customer": _normalize_name(customer_name)}},
    )


def get_pending_customer_phone(vendor_phone: str) -> Optional[str]:
    db = get_db()
    vendor = db["vendors"].find_one(
        {"phone": vendor_phone},
        {"_id": 0, "pending_udhari_phone_customer": 1},
    )
    return (vendor or {}).get("pending_udhari_phone_customer")


def clear_pending_customer_phone(vendor_phone: str) -> None:
    db = get_db()
    db["vendors"].update_one(
        {"phone": vendor_phone},
        {"$unset": {"pending_udhari_phone_customer": ""}},
    )


def get_recent_reminder(vendor_phone: str, customer_name: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    return db["udhari_reminders"].find_one(
        {
            "vendor_phone": {"$in": get_phone_variants(vendor_phone)},
            "customer_name": _normalize_name(customer_name),
            "status": "sent",
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )


def record_udhari_reminder(
    vendor_phone: str,
    customer_name: str,
    customer_phone: str,
    amount: float,
    message_id: str,
) -> None:
    db = get_db()
    db["udhari_reminders"].insert_one({
        "vendor_phone": _normalize_phone(vendor_phone),
        "customer_name": _normalize_name(customer_name),
        "customer_phone": customer_phone,
        "amount_due": float(amount),
        "message_id": message_id,
        "status": "sent",
        "created_at": _now_iso(),
    })


def match_udhari_reminder(text: str) -> Optional[str]:
    match = re.search(
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ko|की|का|के)\s+"
        r"(?:udhari|udhar|udhaar|उधारी|उधार)\s+(?:ka\s+)?"
        r"(?:reminder|yaad|message)",
        text.strip().lower(),
    )
    if match:
        return match.group(1).title()
    match = re.search(
        r"(?:([a-zA-Z\u0900-\u097F]+)\s+(?:ko|को)\s+)?"
        r"(?:udhari\s+)?(?:reminder|yaad|message)\s+"
        r"(?:bhej(?:o|na)?|send|do)(?:\s+(?:to|ko))?"
        r"(?:\s+([a-zA-Z\u0900-\u097F]+))?",
        text.strip().lower(),
    )
    if match:
        return (match.group(1) or match.group(2)).title() if (match.group(1) or match.group(2)) else None
    match = re.search(
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ko|की|का|के)?\s*"
        r"(?:udhari|udhar|udhaar|उधारी|उधार)\s+"
        r"(?:ka\s+)?(?:reminder|yaad|message)",
        text.strip().lower(),
    )
    return match.group(1).title() if match else None


def list_customers(vendor_phone: str, only_outstanding: bool = False, search: str = "") -> List[Dict[str, Any]]:
    db = get_db()
    phones = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    query: Dict[str, Any] = {"vendor_phone": {"$in": phones}}
    if only_outstanding:
        query["total_due"] = {"$gt": 0}
    if search.strip():
        query["customer_name"] = {"$regex": _normalize_name(search), "$options": "i"}
    docs = list(db["udhari"].find(query, {"_id": 0}).sort("total_due", -1).limit(200))
    payment_rows = list(db["udhari_transactions"].aggregate([
        {
            "$match": {
                "vendor_phone": {"$in": phones},
                "tx_type": "payment",
            }
        },
        {
            "$group": {
                "_id": "$customer_name",
                "total_paid": {"$sum": "$amount"},
            }
        },
    ]))
    payments_by_customer = {
        row.get("_id"): float(row.get("total_paid") or 0)
        for row in payment_rows
    }
    # Deduplicate in case same customer is in multiple phone keys
    seen = set()
    unique = []
    for d in docs:
        cname = d.get("customer_name")
        if cname not in seen:
            seen.add(cname)
            if cname in payments_by_customer:
                d["total_paid"] = payments_by_customer[cname]
            unique.append(d)
    return unique


def get_customer_transactions(vendor_phone: str, customer_name: str, limit: int = 50) -> List[Dict[str, Any]]:
    db = get_db()
    key = _normalize_name(customer_name)
    phones = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    return list(
        db["udhari_transactions"]
        .find({"vendor_phone": {"$in": phones}, "customer_name": key}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )


def get_recent_vendor_transactions(vendor_phone: str, limit: int = 20) -> List[Dict[str, Any]]:
    db = get_db()
    phones = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    return list(
        db["udhari_transactions"]
        .find({"vendor_phone": {"$in": phones}}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )


def get_udhari_totals(vendor_phone: str) -> Dict[str, Any]:
    db = get_db()
    phones = get_phone_variants(vendor_phone) if vendor_phone != "web-client" else ["web-client"]
    pipeline = [
        {"$match": {"vendor_phone": {"$in": phones}}},
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
    payment_total = list(db["udhari_transactions"].aggregate([
        {
            "$match": {
                "vendor_phone": {"$in": phones},
                "tx_type": "payment",
            }
        },
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ]))
    if payment_total:
        row["total_recovered_all_time"] = float(payment_total[0].get("total") or 0)
    return row


def format_udhari_added_msg(
    customer_name: str,
    amount: float,
    total_due: float,
    needs_customer_phone: bool = False,
) -> str:
    phone_prompt = (
        "\n\n📱 Customer ka WhatsApp number country code ke saath bhejiye "
        "(jaise 919876543210), taaki future reminder bhej sakein."
        if needs_customer_phone else ""
    )
    return (
        f"✅ *Udhari Record ho gaya!*\n\n"
        f"👤 Customer: *{customer_name}*\n"
        f"💸 Diya: *₹{amount:,.0f}*\n"
        f"📊 Ab Baaki: *₹{total_due:,.0f}*\n\n"
        f"_VyapaarSaathi Khata — {datetime.now(timezone.utc).strftime('%d %b %Y')}_"
        f"{phone_prompt}"
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


def format_customer_query_reply(vendor_phone: str, customer_name: str) -> str:
    """Format WhatsApp response when vendor asks about a specific customer's udhari."""
    summary = get_customer_summary(vendor_phone, customer_name)
    display_name = (summary.get("customer_name_display") if summary else "") or customer_name.strip().title()

    if not summary:
        return (
            f"🔍 *{display_name}* naam ka koi udhari record nahi mila 🙏\n\n"
            f"Naya khata shuru karne ke liye bol sakte hain:\n"
            f"👉 *\"{display_name} ko 500 rupay udhari diya\"*"
        )

    txns = get_customer_transactions(vendor_phone, customer_name, limit=4)
    due = float(summary.get("total_due", 0))
    given = float(summary.get("total_given", 0))
    paid = float(summary.get("total_paid", 0))

    if due > 0:
        status_line = "⏳ *Baaki hai (Payment Pending)*"
        due_highlight = f"🔴 *Kul Baaki: ₹{due:,.0f}*"
    else:
        status_line = "✅ *Sab Chukta Ho Gaya (All Clear! 🎉)*"
        due_highlight = "🟢 *Kul Baaki: ₹0 (Poora Chukta)*"

    lines = [
        f"📒 *Udhari Hisaab — {display_name}*\n",
        due_highlight,
        f"💸 Total Diya: ₹{given:,.0f}",
        f"💰 Total Mila: ₹{paid:,.0f}",
        f"Status: {status_line}",
    ]

    if txns:
        lines.append("\n_Aakhri Transactions:_")
        for t in txns[:4]:
            ttype = t.get("tx_type")
            amt = float(t.get("amount", 0))
            note = str(t.get("note", "")).strip()
            date_str = str(t.get("created_at", ""))[:10]
            if ttype == "credit":
                t_str = f"💸 +₹{amt:,.0f} (Udhari) • {date_str}"
            else:
                t_str = f"💰 -₹{amt:,.0f} (Mila) • {date_str}"
            if note:
                t_str += f" _{note}_"
            lines.append(t_str)

    if due > 0:
        lines.append(f"\n💡 _Payment aane par boliye:_ *\"{display_name} ne {int(due)} rupay diye\"*")

    return "\n".join(lines)


# ─── PDF Report Generation ────────────────────────────────────────────────────

def _fmt_inr(n: float) -> str:
    """Format number in Indian number system: 34,10,000.00"""
    sign = "-" if n < 0 else ""
    n = abs(n)
    int_part = int(n)
    dec_part = f"{n - int_part:.2f}"[2:]
    s = str(int_part)
    if len(s) <= 3:
        formatted = s
    else:
        formatted = s[-3:]
        rem = s[:-3]
        while len(rem) > 2:
            formatted = rem[-2:] + "," + formatted
            rem = rem[:-2]
        formatted = rem + "," + formatted
    return f"{sign}{formatted}.{dec_part}"


class UdhariPDF(FPDF):
    """Clean, high-readability PDF generator for Customer Credit (Khata) Register."""

    def __init__(self):
        super().__init__(orientation="P", unit="pt", format="A4")
        self._unicode_font = ""
        for font_path in (
            os.getenv("UDHARI_PDF_FONT", ""),
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        ):
            if not font_path or not Path(font_path).is_file():
                continue
            try:
                self.add_font("UdhariUnicode", "", font_path)
                self.add_font("UdhariUnicode", "B", font_path)
                self.add_font("UdhariUnicode", "I", font_path)
                self._unicode_font = "UdhariUnicode"
                break
            except Exception as exc:
                logger.warning("Could not load Udhari PDF font %s: %s", font_path, exc)
        self.set_auto_page_break(auto=True, margin=36)
        self.ml = 36
        self.mr = 36
        self.pw = 595.28
        self.cw = self.pw - self.ml - self.mr

    def set_font(self, family=None, style="", size=0):
        if family == "Helvetica" and self._unicode_font:
            family = self._unicode_font
        super().set_font(family, style, size)

    def footer(self):
        self.set_y(-28)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(140, 148, 160)
        self.cell(
            self.cw,
            14,
            f"Generated by VyapaarSaathi Khata - AI Voice & WhatsApp Assistant | Page {self.page_no()}",
            align="C",
        )


def generate_udhari_pdf(vendor_phone: str, vendor_name: str = "") -> Optional[str]:
    """
    Generate a professional Customer Credit Register (Udhari Khata) PDF.
    Returns the public URL (e.g., /static/reports/udhari_...pdf) or None on failure.
    """
    db = get_db()
    
    # Resolve vendor business name
    if not vendor_name or vendor_name == vendor_phone:
        vdoc = db["vendors"].find_one({"phone": vendor_phone})
        if not vdoc and vendor_phone != "web-client":
            vdoc = db["vendors"].find_one({"phone": f"whatsapp:{vendor_phone.replace('whatsapp:', '')}"})
        if vdoc:
            vendor_name = vdoc.get("business_name") or vdoc.get("name") or "VyapaarSaathi Merchant"
        else:
            vendor_name = "VyapaarSaathi Merchant"

    customers = list_customers(vendor_phone)
    totals = get_udhari_totals(vendor_phone)
    recent_txs = get_recent_vendor_transactions(vendor_phone, limit=15)

    tot_given = float(totals.get("total_given_all_time", 0))
    tot_paid = float(totals.get("total_recovered_all_time", 0))
    tot_due = float(totals.get("total_outstanding", 0))
    now_str = datetime.now(timezone.utc).strftime("%d %b %Y, %I:%M %p")

    pdf = UdhariPDF()
    pdf.add_page()

    # ── Top Header Banner ─────────────────────────────────────────────────────
    pdf.set_fill_color(15, 23, 42)  # Slate 900
    pdf.rect(0, 0, pdf.pw, 68, "F")
    pdf.set_xy(pdf.ml, 16)
    pdf.set_font("Helvetica", "B", 15)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(pdf.cw, 18, "VYAPAARSAATHI | CUSTOMER CREDIT REGISTER (UDHARI)", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(203, 213, 225)
    phone_clean = vendor_phone.replace("whatsapp:", "")
    pdf.cell(pdf.cw, 14, f"Merchant: {vendor_name} | Account: {phone_clean} | Generated: {now_str}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_y(80)

    # ── KPI Summary Cards ─────────────────────────────────────────────────────
    card_w = (pdf.cw - 18) / 3
    card_h = 44

    cards = [
        ("TOTAL CREDIT GIVEN", "Rs. " + _fmt_inr(tot_given), (248, 250, 252), (15, 23, 42)),
        ("TOTAL RECOVERED", "Rs. " + _fmt_inr(tot_paid), (240, 253, 244), (22, 101, 52)),
        ("NET OUTSTANDING", "Rs. " + _fmt_inr(tot_due), (255, 247, 237), (194, 65, 12)),
    ]

    y_top = pdf.get_y()
    for idx, (label, val, bg, text_c) in enumerate(cards):
        x = pdf.ml + idx * (card_w + 9)
        pdf.set_fill_color(*bg)
        pdf.set_draw_color(226, 232, 240)
        pdf.rect(x, y_top, card_w, card_h, "DF")
        pdf.set_xy(x + 8, y_top + 6)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(100, 116, 139)
        pdf.cell(card_w - 16, 11, label)
        pdf.set_xy(x + 8, y_top + 20)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(*text_c)
        pdf.cell(card_w - 16, 16, val)

    pdf.set_y(y_top + card_h + 16)

    # ── Customer Table Header ─────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(30, 41, 59)
    pdf.set_text_color(255, 255, 255)
    pdf.set_draw_color(30, 41, 59)

    cols = [
        ("#", 26, "C"),
        ("Customer Name", 160, "L"),
        ("Given (Rs.)", 85, "R"),
        ("Paid (Rs.)", 85, "R"),
        ("Due Balance (Rs.)", 95, "R"),
        ("Status", 72, "C"),
    ]

    for title, w, align in cols:
        pdf.cell(w, 20, " " + title + " ", border=1, fill=True, align=align)
    pdf.ln(20)

    # ── Customer Rows ─────────────────────────────────────────────────────────
    if not customers:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(100, 116, 139)
        pdf.cell(pdf.cw, 24, "No udhari records found. All accounts clear!", border="B", align="C")
        pdf.ln(24)
    else:
        pdf.set_font("Helvetica", "", 9)
        for idx, c in enumerate(customers, start=1):
            c_name = str(c.get("customer_name_display") or c.get("customer_name") or f"Customer {idx}").strip()
            c_given = float(c.get("total_given", 0))
            c_paid = float(c.get("total_paid", 0))
            c_due = float(c.get("total_due", 0))
            c_status = "PENDING" if c_due > 0 else "SETTLED"

            bg = (255, 255, 255) if idx % 2 != 0 else (248, 250, 252)
            pdf.set_fill_color(*bg)
            pdf.set_draw_color(226, 232, 240)
            pdf.set_text_color(30, 41, 59)

            pdf.cell(26, 18, str(idx), border="B", fill=True, align="C")
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(160, 18, " " + c_name[:24], border="B", fill=True, align="L")
            pdf.set_font("Helvetica", "", 9)
            pdf.cell(85, 18, _fmt_inr(c_given) + " ", border="B", fill=True, align="R")
            pdf.cell(85, 18, _fmt_inr(c_paid) + " ", border="B", fill=True, align="R")

            pdf.set_font("Helvetica", "B", 9)
            if c_due > 0:
                pdf.set_text_color(194, 65, 12)
            else:
                pdf.set_text_color(22, 101, 52)
            pdf.cell(95, 18, _fmt_inr(c_due) + " ", border="B", fill=True, align="R")

            if c_status == "PENDING":
                pdf.set_text_color(194, 65, 12)
            else:
                pdf.set_text_color(22, 101, 52)
            pdf.cell(72, 18, c_status, border="B", fill=True, align="C")
            pdf.ln(18)

    # ── Grand Total Row ───────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(241, 245, 249)
    pdf.set_text_color(15, 23, 42)
    pdf.cell(186, 20, "  TOTAL", border="TB", fill=True, align="L")
    pdf.cell(85, 20, _fmt_inr(tot_given) + " ", border="TB", fill=True, align="R")
    pdf.cell(85, 20, _fmt_inr(tot_paid) + " ", border="TB", fill=True, align="R")
    pdf.set_text_color(194, 65, 12)
    pdf.cell(95, 20, _fmt_inr(tot_due) + " ", border="TB", fill=True, align="R")
    pdf.cell(72, 20, "", border="TB", fill=True, align="C")
    pdf.ln(28)

    # ── Recent Transactions Log ───────────────────────────────────────────────
    if recent_txs and pdf.get_y() < 640:
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(15, 23, 42)
        pdf.cell(pdf.cw, 16, "RECENT TRANSACTIONS LOG", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(4)

        tx_cols = [
            ("Date", 70, "C"),
            ("Customer", 120, "L"),
            ("Type", 90, "C"),
            ("Amount (Rs.)", 85, "R"),
            ("Notes / Context", 158, "L"),
        ]

        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(241, 245, 249)
        pdf.set_text_color(71, 85, 105)
        for title, w, align in tx_cols:
            pdf.cell(w, 16, " " + title, border="B", fill=True, align=align)
        pdf.ln(16)

        pdf.set_font("Helvetica", "", 8)
        for t in recent_txs[:10]:
            if pdf.get_y() > 750:
                break
            created_raw = str(t.get("created_at") or "")[:10]
            try:
                dt_obj = datetime.fromisoformat(str(t.get("created_at")))
                dt_str = dt_obj.strftime("%d/%m/%Y")
            except Exception:
                dt_str = created_raw or "-"

            cname = str(t.get("customer_name") or "-").title()
            tx_type = "Credit Given" if t.get("tx_type") == "credit" else "Payment Received"
            amt = float(t.get("amount", 0))
            note = str(t.get("note") or "").strip()

            pdf.set_text_color(30, 41, 59)
            pdf.cell(70, 16, dt_str, border="B", align="C")
            pdf.cell(120, 16, " " + cname[:18], border="B", align="L")
            if "Credit" in tx_type:
                pdf.set_text_color(194, 65, 12)
            else:
                pdf.set_text_color(22, 101, 52)
            pdf.cell(90, 16, tx_type, border="B", align="C")
            pdf.cell(85, 16, _fmt_inr(amt) + " ", border="B", align="R")
            pdf.set_text_color(100, 116, 139)
            pdf.cell(158, 16, " " + note[:26], border="B", align="L")
            pdf.ln(16)

    # ── Write and Save PDF ────────────────────────────────────────────────────
    safe_phone = vendor_phone.replace("+", "").replace(":", "_").replace(" ", "_")
    file_name = f"udhari_{safe_phone}_{uuid.uuid4().hex[:8]}.pdf"
    pdf_bytes = bytes(pdf.output())

    try:
        target_dir = Path("static/reports")
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / file_name
        with target_path.open("wb") as f:
            f.write(pdf_bytes)

        public_url = f"/static/reports/{file_name}"
        logger.info("Udhari report saved locally: %s", public_url)
        return public_url
    except Exception as exc:
        logger.exception("Failed to save Udhari report PDF: %s", exc)
        return None


def handle_all_udhari_report(vendor_phone: str, vendor_name: str = "") -> Tuple[str, Optional[str]]:
    """
    Handle request for all-customer udhari report.
    Generates PDF and returns (caption, pdf_url).
    """
    totals = get_udhari_totals(vendor_phone)
    total_customers = totals.get("total_customers", 0)
    active_customers = totals.get("active_customers", 0)
    outstanding = float(totals.get("total_outstanding", 0))
    total_given = float(totals.get("total_given_all_time", 0))
    total_recovered = float(totals.get("total_recovered_all_time", 0))

    if total_customers == 0:
        msg = (
            "🎉 *Aapka koi udhari baaki nahi hai!*\n\n"
            "Abhi kisi bhi customer ka udhari record nahi hai.\n"
            "Naya khata banane ke liye boliye:\n"
            "👉 *'Ramesh ko 500 rupay udhari diya'*"
        )
        return (msg, None)

    try:
        pdf_url = generate_udhari_pdf(vendor_phone=vendor_phone, vendor_name=vendor_name)
    except Exception as exc:
        logger.exception("Udhari report generation failed for %s: %s", vendor_phone, exc)
        pdf_url = None

    caption = (
        f"📄 *VyapaarSaathi — Udhari Khata Report (PDF)*\n\n"
        f"🔴 Kul Baaki (Total Due): *₹{outstanding:,.0f}*\n"
        f"👥 Active Baaki Khate: *{active_customers} customers*\n"
        f"💸 Kul Diya: *₹{total_given:,.0f}* | 💰 Recovered: *₹{total_recovered:,.0f}*\n\n"
        + (
            f"📎 *Udhari Report PDF aapke WhatsApp par bhej di gayi hai!*"
            if pdf_url
            else "⚠️ PDF abhi generate nahi ho paayi. Udhari summary upar di gayi hai."
        )
    )
    return (caption, pdf_url)


def match_udhari_query_or_report(text: str) -> Optional[Tuple[str, Optional[str]]]:
    """
    Deterministic fast-path matching for customer udhari queries and full report requests.
    Supports English, Hinglish, and Devanagari Hindi / Marathi.
    Returns:
      ("UDHARI_REPORT", None)
      ("UDHARI_QUERY", customer_name)
      None (if not matched)
    """
    cleaned = text.strip().lower()

    # 1. Overall Udhari report requests (Latin + Devanagari)
    report_keywords = [
        "sab ki udhari", "sabki udhari", "sab ke udhari", "sabka hisaab", "sabka hisab",
        "sab ka hisaab", "sab ka hisab", "udhari report", "udhari ka report",
        "udhari ki report", "udhari list", "udhari register", "kitna udhari baki",
        "total udhari", "kul udhari", "udhari ka hisab", "udhari ka hisaab",
        "kiska kitna baki", "kiske kitne baki", "udhari pdf", "khata report",
        "kisko kitna diya", "kiske paas kitna baki", "all udhari", "full udhari",
        "ibhari report", "ibhari ki report", "ibhari ka report",
        # Devanagari
        "सबकी उधारी", "सब के उधारी", "सब की उधारी", "उधारी रिपोर्ट", "उधारी की रिपोर्ट",
        "उधारी का रिपोर्ट", "कुल उधारी", "उधारी रजिस्टर", "उधारी लिस्ट", "सबका हिसाब",
        "सब का हिसाब", "उधारी का हिसाब", "उधारी हिसाब", "खाता रिपोर्ट", "उधारी पीडीएफ",
    ]
    if any(k in cleaned for k in report_keywords):
        return ("UDHARI_REPORT", None)

    # 2. Customer-specific queries (Latin + Devanagari)
    patterns = [
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ki|ke|ka|की|के|का)\s+(?:udhari|उधारी|उधार)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ka|ki|ke|का|की|के)\s+(?:hisaab|hisab|हिसाब|खाता)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ka|ki|ke|का|की|के)\s+kitn[a-z\u0900-\u097F]*\s+(?:baki|baaki|बाकी|बकाया)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ka|ki|ke|का|की|के)\s+khata",
        r"(?:udhari|hisaab|hisab|उधारी|हिसाब|खाता)\s+(?:of|dekhna|batao|बताओ|दिखाओ)\s+([a-zA-Z\u0900-\u097F]+)",
    ]
    for pat in patterns:
        m = re.search(pat, cleaned)
        if m:
            name = m.group(1).strip()
            if name.lower() in ("sab", "sabka", "sabki", "sabke", "kiska", "kiske", "total", "all", "सब", "सबका", "सबकी", "सबके"):
                return ("UDHARI_REPORT", None)
            if name.lower() in ("meri", "mera", "apna", "apni", "store", "dukaan", "मेरी", "मेरा", "अपना", "अपनी"):
                return ("UDHARI_REPORT", None)
            return ("UDHARI_QUERY", name.title())

    return None


def match_udhari_action(text: str) -> Optional[Tuple[str, str, float]]:
    """
    Deterministic fast-path matching for adding credit or recording payment.
    Returns:
      ("UDHARI_PAYMENT", customer_name, amount)
      ("UDHARI_ADD", customer_name, amount)
      None (if not matched)
    """
    cleaned = text.strip().lower()

    # 1. Payment received (wapas, chukaye, jama, paid, de diye)
    # e.g., "Ramesh ne 200 wapas diye", "रमेश ने 200 रुपये वापस दिए", "Ramesh paid 500"
    pay_patterns = [
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ne|se|ने|से)\s+(\d+(?:\.\d+)?)\s*(?:rupaye|rupay|rupiay|rupiye|rupya|rupee|rupees|rs|रुपये|रुपए)?\s*(?:wapas|vaapas|wapis|vapis|de|diye|diya|chukaye|jama|bheje|वापस|दिए|दिया|जमा|चुकाए)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:paid|returned)\s*(\d+(?:\.\d+)?)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:se|से)\s+(\d+(?:\.\d+)?)\s*(?:rupaye|rupay|rupiay|rupiye|rupya|rupee|rupees|rs|रुपये|रुपए)?\s*(?:aaye|mile|aaya|आए|मिले)",
    ]
    for pat in pay_patterns:
        m = re.search(pat, cleaned)
        if m:
            name, amt = m.group(1).strip(), float(m.group(2))
            return ("UDHARI_PAYMENT", name.title(), amt)

    # 2. Udhari given (udhari diya, udhari pe diya, baki)
    # e.g., "Ramesh ko 500 rupay udhari diye", "रमेश को 500 रुपये उधार दिए"
    add_patterns = [
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ko|ने|को)?\s*(\d+(?:\.\d+)?)\s*(?:rupaye|rupay|rupiay|rupiye|rupya|rupee|rupees|rs|रुपये|रुपए)?\s*(?:ki|ke|ka)?\s*(?:udhari|udhar|udhaari|उधारी|उधार|baaki|baki)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ko|ने|को)\s*(\d+(?:\.\d+)?)\s*(?:rupaye|rupay|rupiay|rupiye|rupya|rupee|rupees|rs|रुपये|रुपए)?\s*(?:diye|diya|दिए|दिया)\s*(?:udhari|udhar|udhaari|उधारी|उधार)?",
    ]
    for pat in add_patterns:
        m = re.search(pat, cleaned)
        if m:
            name, amt = m.group(1).strip(), float(m.group(2))
            return ("UDHARI_ADD", name.title(), amt)

    return None


def match_udhari_actions(text: str) -> List[Tuple[str, str, float]]:
    """Find every explicit Udhari add/payment action in one transcript."""
    cleaned = text.strip().lower()
    matches: List[Tuple[int, str, str, float]] = []

    pay_patterns = [
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ne|se|ने|से)\s+(\d+(?:\.\d+)?)\s*"
        r"(?:rupaye|rupay|rupiay|rupiye|rupya|rupee|rupees|rs|रुपये|रुपए)?\s*"
        r"(?:wapas|vaapas|wapis|vapis|lautaa|lota|laut|de|diye|diya|chukaye|jama|bheje|वापस|लौटाया|लौटाए|दिए|दिया|जमा|चुकाए)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:paid|returned)\s*(\d+(?:\.\d+)?)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:se|से)\s+(\d+(?:\.\d+)?)\s*"
        r"(?:rupaye|rupay|rupiay|rupiye|rupya|rupee|rupees|rs|रुपये|रुपए)?\s*"
        r"(?:aaye|mile|aaya|आए|मिले)",
    ]
    add_patterns = [
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ko|ने|को)?\s*(\d+(?:\.\d+)?)\s*"
        r"(?:rupaye|rupay|rupiay|rupiye|rupya|rupee|rupees|rs|रुपये|रुपए)?\s*"
        r"(?:ki|ke|ka)?\s*(?:udhari|udhar|udhaari|उधारी|उधार|baaki|baki)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:ko|ने|को)\s*(\d+(?:\.\d+)?)\s*"
        r"(?:rupaye|rupay|rupiay|rupiye|rupya|rupee|rupees|rs|रुपये|रुपए)?\s*"
        r"(?:diye|diya|दिए|दिया)\s*(?:udhari|udhar|udhaari|उधारी|उधार)?",
    ]
    for pattern in pay_patterns:
        for match in re.finditer(pattern, cleaned):
            matches.append((match.start(), "UDHARI_PAYMENT", match.group(1).title(), float(match.group(2))))
    for pattern in add_patterns:
        for match in re.finditer(pattern, cleaned):
            matches.append((match.start(), "UDHARI_ADD", match.group(1).title(), float(match.group(2))))

    unique = {}
    for position, action, name, amount in sorted(matches):
        key = (position, action, name.lower(), amount)
        unique[key] = (action, name, amount)
    return list(unique.values())
