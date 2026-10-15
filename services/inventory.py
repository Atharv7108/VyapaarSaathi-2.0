"""
services/inventory.py

Real inventory management for VyapaarSaathi.

Handles:
- Catalog CRUD (vendor sets up items they sell)
- Today's stock management (daily_stock → current_stock)
- Auto-deduction when voice entries contain quantity
- History aggregation for AI stock suggestions
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from collections import defaultdict

from db_config import get_db
from services.vendor_manager import get_phone_variants, _normalize_phone

logger = logging.getLogger(__name__)

TABLE = "inventory"
LEDGER = "ledger"


def _normalize_item_name(item_name: Any) -> str:
    """Use one key for catalog and voice-history item matching."""
    return " ".join(str(item_name or "").strip().lower().split())


# ─── Today's date helper ──────────────────────────────────────────────────────

def _today() -> str:
    return date.today().isoformat()


# ─── Catalog & daily stock operations ────────────────────────────────────────

def get_inventory(phone: str) -> List[Dict[str, Any]]:
    """
    Return today's inventory for a vendor.

    Merges TWO sources:
    1. Manual catalog rows from `inventory` table (vendor set these up or auto-created)
    2. Voice-detected items aggregated from `ledger` table (auto-discovered)

    Manual catalog items take priority. Items only seen in voice are shown as
    "auto" items with sales history but no explicit daily_stock target.
    Data is strictly isolated per vendor phone — no cross-tenant leakage.
    """
    db = get_db()
    today = _today()
    cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    phone_variants = get_phone_variants(phone) if phone != "web-client" else ["web-client"]

    # ── Source 1: Manual catalog items ───────────────────────────────────────
    manual_rows = list(db[TABLE].find({
        "phone": {"$in": phone_variants},
        "stock_date": today,
        "is_active": True
    }).sort("item_name", 1))

    # If no rows for today, auto-roll over from yesterday's catalog
    if not manual_rows and phone != "web-client":
        try:
            carried = reset_daily_stock(phone)
            if carried > 0:
                logger.info("Auto-rolled %d inventory rows for %s on %s", carried, phone, today)
                manual_rows = list(db[TABLE].find({
                    "phone": {"$in": phone_variants},
                    "stock_date": today,
                    "is_active": True
                }).sort("item_name", 1))
        except Exception as exc:
            logger.warning("Auto-rollover failed for %s: %s", phone, exc)

    manual_items: Dict[str, Dict[str, Any]] = {}
    for row in manual_rows:
        name = _normalize_item_name(row.get("item_name"))
        if name:
            manual_items[name] = row

    # ── Source 2: Voice-detected items from ledger (last 30 days) ────────────
    query: Dict[str, Any] = {
        "type": "income",
        "created_at": {"$gte": cutoff_30d}
    }
    if phone != "web-client":
        query["phone"] = {"$in": phone_variants}
    else:
        query["phone"] = "web-client"
        
    ledger_rows = list(db[LEDGER].find(query).sort("created_at", 1).limit(1000))

    # Aggregate by item: total qty sold today, total ever, avg
    item_today_qty: Dict[str, float] = defaultdict(float)
    item_total_qty: Dict[str, float] = defaultdict(float)
    item_total_amt: Dict[str, float] = defaultdict(float)
    item_days: Dict[str, set] = defaultdict(set)

    for row in ledger_rows:
        cat = _normalize_item_name(row.get("category") or "general")
        day = str(row.get("created_at", ""))[:10]
        try:
            amt = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        try:
            qty = float(row.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0

        item_total_amt[cat] += amt
        item_days[cat].add(day)
        if qty > 0:
            item_total_qty[cat] += qty
            if day == today:
                item_today_qty[cat] += qty

    # ── Merge both sources ────────────────────────────────────────────────────
    all_items: List[Dict[str, Any]] = []

    # Fetch all items explicitly soft-deleted by the vendor to prevent resurrecting them
    inactive_rows = list(db[TABLE].find({
        "phone": {"$in": phone_variants},
        "is_active": False,
    }, {"item_name": 1, "item_name_hi": 1}))
    deleted_names = set()
    for row in inactive_rows:
        if row.get("item_name"):
            deleted_names.add(_normalize_item_name(row["item_name"]))
        if row.get("item_name_hi"):
            deleted_names.add(_normalize_item_name(row["item_name_hi"]))

    # Only include voice items that have NOT been explicitly deleted by the vendor
    voice_item_names = set(item_days.keys()) - deleted_names
    all_item_names = (voice_item_names | set(manual_items.keys())) - deleted_names

    for item_name in sorted(all_item_names):
        if item_name in manual_items:
            # Manual catalog item — show with full stock data
            row = dict(manual_items[item_name])
            # Strip MongoDB _id (ObjectId is not JSON serializable)
            row.pop("_id", None)
            # Add voice-derived stats as extra fields
            row["voice_sold_today"] = item_today_qty.get(item_name, 0)
            row["voice_total_sold"] = item_total_qty.get(item_name, 0)
            row["voice_total_revenue"] = round(item_total_amt.get(item_name, 0), 2)
            row["voice_days_tracked"] = len(item_days.get(item_name, set()))
            row["source"] = "catalog"
            all_items.append(row)
        else:
            # Voice-only item — auto-discovered from recordings
            n_days = max(len(item_days[item_name]), 1)
            avg_qty = item_total_qty[item_name] / n_days if item_total_qty[item_name] > 0 else 0
            avg_rev = item_total_amt[item_name] / n_days
            all_items.append({
                "id": None,
                "phone": phone,
                "item_name": item_name,
                "item_name_hi": item_name,
                "unit": "piece",
                # Synthesised stock from voice history
                "daily_stock": round(avg_qty * 1.1) if avg_qty > 0 else 0,
                "current_stock": max(0, round(avg_qty - item_today_qty.get(item_name, 0))),
                "price_per_unit": round(avg_rev / avg_qty, 2) if avg_qty > 0 else round(avg_rev, 2),
                "stock_date": today,
                "is_active": True,
                "source": "voice",           # flag: auto-discovered, not manually configured
                "voice_sold_today": item_today_qty.get(item_name, 0),
                "voice_total_sold": item_total_qty[item_name],
                "voice_total_revenue": round(item_total_amt[item_name], 2),
                "voice_days_tracked": n_days,
            })

    return all_items



def upsert_inventory_item(
    phone: str,
    item_name: str,
    daily_stock: int,
    unit: str = "piece",
    price_per_unit: float = 0.0,
    item_name_hi: Optional[str] = None,
    add_stock: bool = False,
    update_catalog: bool = False,
) -> Dict[str, Any]:
    """
    Create or update an item in the vendor's catalog for today.

    3 modes (for existing items):

      1. add_stock=True   → RESTOCK: Add qty to current_stock (capped at daily_stock).
                             daily_stock stays the same.
                             Used when vendor says "I made 20 more vadapav".
                             Example: daily=50, current=0, add 20 → current=20, daily=50

      2. update_catalog=True → CATALOG UPDATE: Change daily_stock / price / unit.
                               current_stock is NOT touched.
                               Used when vendor edits from the frontend inventory form.
                               Example: daily 50→70, current stays at 20 → "20 / 70"

      3. Both False (default) → SET: Sets both daily_stock and current_stock.
                                Used when creating a brand-new item.
                                Example: new item "dhokla" → daily=50, current=50
    """
    db = get_db()
    today = _today()
    phone_variants = get_phone_variants(phone) if phone != "web-client" else ["web-client"]
    canonical_phone = _normalize_phone(phone) if phone != "web-client" else "web-client"

    # Check if row already exists for today
    existing = list(db[TABLE].find({
        "phone": {"$in": phone_variants},
        "item_name": item_name.lower().strip(),
        "stock_date": today
    }))

    rows = existing

    if rows:
        existing_doc = rows[0]
        existing_id = existing_doc["_id"]
        existing_current = int(existing_doc.get("current_stock") or 0)
        existing_daily = int(existing_doc.get("daily_stock") or daily_stock)
        existing_price = float(existing_doc.get("price_per_unit") or 0)

        if add_stock:
            # ── MODE 1: RESTOCK ──────────────────────────────────────
            # Add qty to current_stock, keep daily_stock the same
            new_current = min(existing_current + daily_stock, existing_daily)
            new_daily = existing_daily
            logger.info(
                "RESTOCK '%s': current %d + %d = %d (of %d daily)",
                item_name, existing_current, daily_stock, new_current, new_daily,
            )
        elif update_catalog:
            # ── MODE 2: CATALOG UPDATE ───────────────────────────────
            # Update daily_stock / price / unit. current_stock stays as is.
            new_daily = daily_stock
            new_current = existing_current  # Don't change what's available!
            logger.info(
                "CATALOG UPDATE '%s': daily %d → %d, current stays at %d",
                item_name, existing_daily, new_daily, new_current,
            )
        else:
            # ── MODE 3: SET (full reset) ─────────────────────────────
            new_current = daily_stock
            new_daily = daily_stock
            logger.info(
                "SET '%s': daily=%d, current=%d",
                item_name, new_daily, new_current,
            )

        payload: Dict[str, Any] = {
            "phone": canonical_phone,
            "item_name": item_name.lower().strip(),
            "item_name_hi": item_name_hi or item_name,
            "unit": unit,
            "daily_stock": new_daily,
            "current_stock": new_current,
            "price_per_unit": price_per_unit if price_per_unit > 0 else existing_price,
            "stock_date": today,
            "is_active": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        # Ensure any soft-deleted historical rows for this item are reactivated
        db[TABLE].update_many(
            {
                "phone": {"$in": phone_variants},
                "item_name": item_name.lower().strip(),
                "is_active": False,
            },
            {"$set": {"is_active": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )

        db[TABLE].update_one({"_id": existing_id}, {"$set": payload})
        payload["id"] = str(existing_id)
    else:
        # Brand new item — daily_stock and current_stock = qty
        payload = {
            "phone": canonical_phone,
            "item_name": item_name.lower().strip(),
            "item_name_hi": item_name_hi or item_name,
            "unit": unit,
            "daily_stock": daily_stock,
            "current_stock": daily_stock,
            "price_per_unit": price_per_unit,
            "stock_date": today,
            "is_active": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        res = db[TABLE].insert_one(payload)
        payload["id"] = str(res.inserted_id)
        if "_id" in payload: del payload["_id"]
        logger.info("Created inventory '%s': stock=%d, price=₹%.0f", item_name, daily_stock, price_per_unit)

    return payload


def delete_inventory_item(phone: str, item_name: str) -> bool:
    """Soft-delete an inventory item (marks is_active=False for all dates)."""
    db = get_db()
    phone_variants = get_phone_variants(phone) if phone != "web-client" else ["web-client"]
    cleaned = (item_name or "").strip().lower()
    if not cleaned:
        return False

    escaped = re.escape(cleaned)
    result = db[TABLE].update_many(
        {
            "phone": {"$in": phone_variants},
            "$or": [
                {"item_name": {"$regex": f"^{escaped}$", "$options": "i"}},
                {"item_name_hi": {"$regex": f"^{escaped}$", "$options": "i"}},
            ],
            "is_active": {"$ne": False},
        },
        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    # If the item only existed in voice ledger history (not yet in manual inventory table),
    # record an inactive inventory row so get_inventory won't resurrect it
    if result.modified_count == 0 and result.matched_count == 0:
        canonical_phone = _normalize_phone(phone) if phone != "web-client" else "web-client"
        db[TABLE].update_one(
            {"phone": canonical_phone, "item_name": cleaned, "stock_date": _today()},
            {"$set": {
                "phone": canonical_phone,
                "item_name": cleaned,
                "item_name_hi": cleaned,
                "is_active": False,
                "stock_date": _today(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
        return True

    return bool(result.modified_count or result.matched_count)


def reset_daily_stock(phone: str) -> int:
    """
    Reset current_stock = daily_stock for all active items for this vendor.
    Called each morning (by scheduler or when vendor opens app).
    Also creates today's rows by copying yesterday's catalog if needed.
    """
    db = get_db()
    today = _today()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    phone_variants = get_phone_variants(phone) if phone != "web-client" else ["web-client"]
    canonical_phone = _normalize_phone(phone) if phone != "web-client" else "web-client"

    # Check if today's rows already exist
    today_check = list(db[TABLE].find({
        "phone": {"$in": phone_variants},
        "stock_date": today,
        "is_active": True
    }, {"_id": 1}))

    if today_check:
        # Today exists — just reset current_stock = daily_stock
        rows = list(db[TABLE].find({
            "phone": {"$in": phone_variants},
            "stock_date": today,
            "is_active": True
        }, {"_id": 1, "daily_stock": 1}))
        
        for row in rows:
            db[TABLE].update_one(
                {"_id": row["_id"]},
                {"$set": {"current_stock": row.get("daily_stock", 0), "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
        return len(rows)

    # Today's rows don't exist — copy from yesterday's catalog
    yesterday_rows = list(db[TABLE].find({
        "phone": {"$in": phone_variants},
        "stock_date": yesterday,
        "is_active": True
    }))

    if not yesterday_rows:
        return 0

    new_rows = []
    for row in yesterday_rows:
        new_rows.append({
            "phone": canonical_phone,
            "item_name": row["item_name"],
            "item_name_hi": row.get("item_name_hi", row["item_name"]),
            "unit": row.get("unit", "piece"),
            "daily_stock": row.get("daily_stock", 0),
            "current_stock": row.get("daily_stock", 0),  # Fresh day — full stock
            "price_per_unit": row.get("price_per_unit", 0),
            "stock_date": today,
            "is_active": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    db[TABLE].insert_many(new_rows)
    return len(new_rows)


# ─── Auto-deduct after voice entry ───────────────────────────────────────────

def deduct_stock(
    phone: str,
    item_name: str,
    quantity: float,
    amount: float = 0.0,
    auto_create: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Deduct `quantity` from current_stock for `item_name` today.

    Called automatically after a voice entry with a quantity/amount is saved.
    Returns the updated row.
    If the item is not found in inventory and auto_create is True:
    Automatically creates the item in the vendor's inventory with reasonable defaults
    and deducts the sold quantity, ensuring the vendor's catalog is automatically populated.
    """
    if quantity <= 0 and amount <= 0:
        return None

    db = get_db()
    today = _today()
    item_key = item_name.lower().strip()
    phone_variants = get_phone_variants(phone) if phone != "web-client" else ["web-client"]
    canonical_phone = _normalize_phone(phone) if phone != "web-client" else "web-client"

    rows = list(db[TABLE].find({
        "phone": {"$in": phone_variants},
        "stock_date": today,
        "is_active": True
    }))

    # Try exact match first, then partial/fuzzy match
    matched = None
    for row in rows:
        if row["item_name"] == item_key:
            matched = row
            break
    if not matched:
        # Normalize: remove spaces, try substring match both ways
        item_norm = item_key.replace(" ", "")
        for row in rows:
            row_norm = row["item_name"].replace(" ", "")
            if item_norm in row_norm or row_norm in item_norm:
                matched = row
                break

    # If item doesn't exist yet, auto-create it!
    if not matched:
        if not auto_create:
            logger.info("No inventory item found for '%s' on %s — skipping deduction", item_name, today)
            return None

        qty_num = float(quantity) if quantity and quantity > 0 else 1.0
        unit = "cup" if any(w in item_key for w in ("coffee", "chai", "tea")) else "piece"
        unit_price = (amount / qty_num) if (amount > 0 and qty_num > 0) else float(amount or 0.0)
        init_daily = max(50, int(qty_num * 2))
        init_current = max(0, init_daily - int(qty_num))

        logger.info(
            "Auto-creating missing inventory item '%s' for %s: daily=%d, current=%d, price=₹%.0f",
            item_name, canonical_phone, init_daily, init_current, unit_price
        )
        created_doc = upsert_inventory_item(
            phone=canonical_phone,
            item_name=item_name,
            daily_stock=init_daily,
            unit=unit,
            price_per_unit=unit_price,
            add_stock=False,
        )
        # Update current stock to reflect the sale
        db[TABLE].update_one(
            {"phone": {"$in": phone_variants}, "item_name": item_key, "stock_date": today},
            {"$set": {"current_stock": init_current, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        created_doc["current_stock"] = init_current
        return {**created_doc, "stockout": init_current == 0}

    # Item exists — deduct quantity
    deduct_qty = int(quantity) if quantity and quantity > 0 else 1
    new_stock = max(0, int(matched["current_stock"]) - deduct_qty)
    db[TABLE].update_one(
        {"_id": matched["_id"]},
        {"$set": {"current_stock": new_stock, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    row = dict(matched)
    if "_id" in row: row["id"] = str(row.pop("_id"))
    row["current_stock"] = new_stock
    stockout = new_stock == 0
    logger.info(
        "Deducted %g %s of '%s'. Stock: %d → %d%s",
        deduct_qty, matched.get("unit", "piece"), item_name,
        matched["current_stock"], new_stock,
        " ⚠️ STOCKOUT" if stockout else ""
    )
    return {**row, "stockout": stockout}


# ─── History aggregation for AI suggestions ───────────────────────────────────

def get_item_stats_from_ledger(phone: str, days: int = 14) -> List[Dict[str, Any]]:
    """
    Aggregate real quantity data from ledger history for AI stock suggestions.

    This pulls rows where quantity IS NOT NULL (i.e., vendor mentioned a count)
    and builds the `item_stats` schema required by the AI suggestion prompt.
    """
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    phone_variants = get_phone_variants(phone) if phone != "web-client" else ["web-client"]

    rows = list(db[LEDGER].find({
        "phone": {"$in": phone_variants},
        "type": "income",
        "created_at": {"$gte": cutoff},
        "quantity": {"$exists": True, "$ne": None}
    }).sort("created_at", 1).limit(1000))

    if not rows:
        return []  # Caller falls back to amount-based heuristic

    # Build: item → date → list of quantities
    item_daily: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        cat = str(row.get("category") or "general").strip().lower()
        qty = row.get("quantity")
        if qty is None:
            continue
        try:
            qty = float(qty)
        except (TypeError, ValueError):
            continue
        day = str(row.get("created_at", ""))[:10]
        item_daily[cat][day].append(qty)

    # Also fetch today's inventory for unit/price metadata
    inv_rows = get_inventory(phone)
    inv_meta: Dict[str, Dict[str, Any]] = {r["item_name"]: r for r in inv_rows}

    stats: List[Dict[str, Any]] = []
    for item_name, day_map in item_daily.items():
        # Per-day totals
        daily_totals = {day: sum(qtys) for day, qtys in day_map.items()}
        sorted_days = sorted(daily_totals.keys())
        sorted_vals = [daily_totals[d] for d in sorted_days]

        n = len(sorted_vals)
        avg = sum(sorted_vals) / n
        last3 = sum(sorted_vals[-3:]) / min(n, 3)

        # Determine trend
        if n >= 3:
            first_half = sum(sorted_vals[:n//2])
            second_half = sum(sorted_vals[n//2:])
            if second_half > first_half * 1.15:
                trend = "increasing"
            elif second_half < first_half * 0.85:
                trend = "decreasing"
            else:
                trend = "stable"
        else:
            trend = "stable"

        meta = inv_meta.get(item_name, {})

        stats.append({
            "item_name": item_name,
            "item_name_hi": meta.get("item_name_hi", item_name),
            "unit": meta.get("unit", "piece"),
            "days_tracked": n,
            "avg_qty_sold": round(avg, 1),
            "max_qty_sold": round(max(sorted_vals), 1),
            "min_qty_sold": round(min(sorted_vals), 1),
            "total_qty_sold": round(sum(sorted_vals), 1),
            "stockout_days": 0,  # TODO: track via inventory.current_stock == 0 snapshots
            "waste_days": 0,
            "sell_through_rate": min(1.0, n / days),
            "trend": trend,
            "last_3_days_avg": round(last3, 1),
            "price_per_unit": float(meta.get("price_per_unit", 0)),
        })

    stats.sort(key=lambda s: s["days_tracked"], reverse=True)
    return stats
