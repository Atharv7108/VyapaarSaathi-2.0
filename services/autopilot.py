"""Explainable daily business actions for a vendor.

This module deliberately uses deterministic rules. Recommendations must be
safe to act on and should show the business evidence behind each suggestion.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from db_config import get_db
from services.inventory import get_inventory
from services.vendor_manager import get_phone_variants
from services.udhari import list_customers


def _as_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except (TypeError, ValueError):
        return None


def _phone_filter(phone: str) -> Dict[str, Any]:
    if phone == "web-client":
        return {"phone": "web-client"}
    return {"phone": {"$in": get_phone_variants(phone)}}


def _recommendation(
    *,
    key: str,
    priority: str,
    title: str,
    message: str,
    reason: str,
    action_label: str,
    action_href: str,
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "key": key,
        "priority": priority,
        "title": title,
        "message": message,
        "reason": reason,
        "action": {"label": action_label, "href": action_href},
        "data": data or {},
    }


def build_autopilot_plan(phone: str, today: Optional[date] = None) -> Dict[str, Any]:
    """Build a vendor-specific, read-only plan for the current business day."""
    current_day = today or date.today()
    since = current_day - timedelta(days=13)
    db = get_db()
    ledger_rows = list(
        db["ledger"]
        .find(
            {
                **_phone_filter(phone),
                "created_at": {"$gte": since.isoformat()},
            },
            {"_id": 0, "amount": 1, "type": 1, "category": 1, "quantity": 1, "created_at": 1},
        )
        .sort("created_at", -1)
        .limit(1000)
    )

    daily_income: Dict[date, float] = defaultdict(float)
    daily_expense: Dict[date, float] = defaultdict(float)
    item_quantity: Dict[str, float] = defaultdict(float)
    for row in ledger_rows:
        row_day = _parse_date(row.get("created_at"))
        if row_day is None:
            continue
        amount = _as_float(row.get("amount"))
        if str(row.get("type") or "").lower() == "income":
            daily_income[row_day] += amount
            item_quantity[str(row.get("category") or "general").strip().lower()] += _as_float(row.get("quantity"))
        elif str(row.get("type") or "").lower() == "expense":
            daily_expense[row_day] += amount

    recommendations: List[Dict[str, Any]] = []
    inventory = get_inventory(phone)
    for item in inventory:
        daily_stock = _as_float(item.get("daily_stock"))
        current_stock = _as_float(item.get("current_stock"))
        if daily_stock <= 0 or current_stock / daily_stock > 0.2:
            continue
        restock = max(1, math.ceil(daily_stock - current_stock))
        item_name = str(item.get("item_name") or "item")
        recommendations.append(
            _recommendation(
                key=f"stock:{item_name}",
                priority="high" if current_stock <= 0 else "medium",
                title=f"Restock {item_name}",
                message=f"{item_name} has {current_stock:g} {item.get('unit', 'units')} left. Prepare about {restock:g} more.",
                reason=f"Current stock is {current_stock:g}/{daily_stock:g} of today's target.",
                action_label="Open inventory",
                action_href="/app/inventory",
                data={"item": item_name, "current_stock": current_stock, "recommended_quantity": restock},
            )
        )

    customers = list_customers(phone, only_outstanding=True)
    for customer in customers[:2]:
        due = _as_float(customer.get("total_due"))
        if due <= 0:
            continue
        updated = _parse_date(customer.get("updated_at"))
        age = (current_day - updated).days if updated else 0
        if age < 3 and due < 500:
            continue
        name = str(customer.get("customer_name_display") or customer.get("customer_name") or "customer")
        recommendations.append(
            _recommendation(
                key=f"udhari:{customer.get('customer_name', name)}",
                priority="high" if due >= 2000 or age >= 14 else "medium",
                title=f"Follow up with {name}",
                message=f"{name} has ₹{due:,.0f} outstanding.",
                reason=f"The balance has been open for {max(age, 1)} days.",
                action_label="Review udhari",
                action_href="/app/udhari",
                data={"customer": name, "amount_due": round(due, 2), "days_open": max(age, 1)},
            )
        )

    income_total = sum(daily_income.values())
    expense_total = sum(daily_expense.values())
    active_days = len(set(daily_income) | set(daily_expense))
    today_has_entry = current_day in daily_income or current_day in daily_expense
    avg_income = income_total / max(active_days, 1)
    avg_net = (income_total - expense_total) / max(active_days, 1)

    if not today_has_entry and active_days > 0:
        recommendations.append(
            _recommendation(
                key="record-today",
                priority="medium",
                title="Record today's business",
                message="Today's sales and expenses are not in the ledger yet.",
                reason=f"You have {active_days} active days in the last 14 days, so a daily entry keeps your trend accurate.",
                action_label="Add today's entry",
                action_href="/app/ledger",
                data={"average_daily_income": round(avg_income, 2)},
            )
        )

    if active_days >= 3 and avg_net < 0:
        recommendations.append(
            _recommendation(
                key="profit-risk",
                priority="high",
                title="Review today's costs",
                message=f"Your recent average net result is -₹{abs(avg_net):,.0f} per active day.",
                reason=f"Last 14 days: ₹{income_total:,.0f} income versus ₹{expense_total:,.0f} expenses.",
                action_label="Open insights",
                action_href="/app/insights",
                data={"income": round(income_total, 2), "expenses": round(expense_total, 2)},
            )
        )

    if item_quantity:
        top_item, top_quantity = max(item_quantity.items(), key=lambda pair: pair[1])
        if top_quantity > 0:
            recommendations.append(
                _recommendation(
                    key="top-demand",
                    priority="low",
                    title=f"Keep {top_item} ready",
                    message=f"{top_item} is your strongest tracked item with {top_quantity:g} units sold recently.",
                    reason="This is calculated from quantities recorded in the last 14 days.",
                    action_label="View stock",
                    action_href="/app/inventory",
                    data={"item": top_item, "quantity": top_quantity},
                )
            )

    priority_rank = {"high": 0, "medium": 1, "low": 2}
    recommendations.sort(key=lambda item: (priority_rank[item["priority"]], item["key"]))
    recommendations = recommendations[:5]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "date": current_day.isoformat(),
        "summary": {
            "active_days": active_days,
            "income_14d": round(income_total, 2),
            "expenses_14d": round(expense_total, 2),
            "average_daily_income": round(avg_income, 2),
            "average_daily_net": round(avg_net, 2),
        },
        "recommendations": recommendations,
    }


def _format_whatsapp_plan(plan: Dict[str, Any], language: str) -> str:
    recommendations = plan["recommendations"]
    if not recommendations:
        return (
            "🌅 *VyapaarSaathi — Aaj ka Business Plan*\n\n"
            "✅ Aaj koi urgent action nahi hai. Roz ka hisaab record karte rahein."
        )

    lines = ["🌅 *VyapaarSaathi — Aaj ka Business Plan*", ""]
    for index, item in enumerate(recommendations, start=1):
        lines.extend(
            [
                f"{index}. *{item['title']}*",
                item["message"],
                f"💡 Kyun: {item['reason']}",
                "",
            ]
        )
    lines.append("Dashboard par detail dekhne ke liye VyapaarSaathi kholein.")
    return "\n".join(lines)


def run_daily_autopilot_job(
    phones: Optional[List[str]] = None,
    allow_resend: bool = False,
) -> Dict[str, Any]:
    """Send one vendor-scoped briefing and return a delivery report."""
    from services.voice_ledger import send_whatsapp_reply

    db = get_db()
    today = date.today().isoformat()
    vendors = list(
        db["vendors"].find(
            {"state": "active", "active": {"$ne": False}},
            {"_id": 0, "phone": 1, "language": 1},
        ).limit(10000)
    )
    report: Dict[str, Any] = {
        "sent_count": 0,
        "skipped_count": 0,
        "failed_count": 0,
        "skipped": [],
        "failed": [],
        "sent_recipients": [],
        "failed_recipients": [],
    }
    for vendor in vendors:
        phone = str(vendor.get("phone") or "").strip()
        if phones is not None and phone not in phones:
            continue
        if not phone.startswith("whatsapp:"):
            report["skipped_count"] += 1
            report["skipped"].append({"phone": phone or "(missing)", "reason": "not a WhatsApp number"})
            continue
        if not allow_resend and db["autopilot_deliveries"].find_one({"phone": phone, "date": today}, {"_id": 1}):
            report["skipped_count"] += 1
            report["skipped"].append({"phone": phone, "reason": "already sent today"})
            continue
        try:
            plan = build_autopilot_plan(phone)
            message_id = send_whatsapp_reply(
                phone,
                _format_whatsapp_plan(plan, str(vendor.get("language") or "hi")),
            )
            if not message_id:
                raise RuntimeError("WhatsApp API returned no message ID")
            db["autopilot_deliveries"].insert_one(
                {
                    "phone": phone,
                    "date": today,
                    "sent_at": datetime.now(timezone.utc).isoformat(),
                    "recommendation_count": len(plan["recommendations"]),
                }
            )
            report["sent_count"] += 1
            report["sent_recipients"].append({"phone": phone, "message_id": message_id})
        except Exception as exc:
            report["failed_count"] += 1
            report["failed"].append({"phone": phone, "error": str(exc)})
            report["failed_recipients"].append({"phone": phone, "error": str(exc)})
            import logging
            logging.getLogger(__name__).exception("Daily Autopilot delivery failed for %s", phone)
    return report


def preview_daily_autopilot(phone: str) -> str:
    """Build the exact WhatsApp body without sending it."""
    return _format_whatsapp_plan(build_autopilot_plan(phone), "hi")
