import importlib
import json
import logging
import mimetypes
import os
import subprocess
import tempfile
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import requests
from pydantic import BaseModel, Field, ValidationError, model_validator

from services.settings import get_settings
from db_config import get_db

logger = logging.getLogger(__name__)

FALLBACK_RESPONSE = "Samajh nahi aaya, dobara boliye 🙏"
MISSING_AUDIO_RESPONSE = "Voice note nahi mila. Kripya dobara bhejiye."
NON_AUDIO_RESPONSE = "Yeh audio message nahi hai. Kripya voice note bhejiye."

GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

SUPPORTED_AUDIO_EXTENSIONS = (
    ".ogg",
    ".oga",
    ".opus",
    ".mp3",
    ".m4a",
    ".wav",
    ".amr",
    ".aac",
    ".webm",
)

LOW_STOCK_RATIO_THRESHOLD = 0.2

# In-memory state to avoid sending duplicate proactive alerts every scheduler tick.
_stock_alert_state: Dict[str, str] = {}


class ExtractedEntry(BaseModel):
    intent: Literal[
        "ADD_ENTRY",
        "STOCK_UPDATE",
        "PRICE_UPDATE",
        "GET_REPORT",
        "GET_INVENTORY",
        "UDHARI_ADD",
        "UDHARI_PAYMENT",
        "UDHARI_QUERY",
        "UDHARI_REPORT",
    ] = "ADD_ENTRY"
    # ADD_ENTRY fields (required for ADD_ENTRY, ignored for others)
    amount: Optional[float] = Field(default=None)
    type: Optional[Literal["income", "expense"]] = Field(default=None)
    category: Optional[str] = Field(default="report", max_length=100)
    description: Optional[str] = Field(default="", max_length=500)
    # Quantity — extracted from voice for ADD_ENTRY, required for STOCK_UPDATE
    quantity: Optional[float] = Field(default=None)
    # Price — used by PRICE_UPDATE
    price_per_unit: Optional[float] = Field(default=None)
    # Customer credit (Udhari) — used by UDHARI_ADD, UDHARI_PAYMENT, UDHARI_QUERY
    customer_name: Optional[str] = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def check_intent_fields(self):
        if self.intent == "ADD_ENTRY":
            # If vendor says "10 samosa bech diya" → quantity present, amount missing.
            # We allow this — amount will be computed from inventory price later.
            if self.quantity is not None and self.quantity > 0 and (self.amount is None or self.amount <= 0):
                self.amount = 0  # Placeholder — will be filled from price_per_unit × qty
            # Fix type: sell/bech = income, not expense. LLM sometimes gets this wrong.
            desc = (self.description or "").lower() + " " + (self.category or "").lower()
            sell_words = ["bech", "sell", "sold", "bechi", "बेच", "बेची", "bej", "बेज"]
            if any(w in desc for w in sell_words):
                self.type = "income"
            if self.type is None:
                self.type = "income"  # Default to income for sales

        elif self.intent == "STOCK_UPDATE":
            if self.quantity is None or self.quantity <= 0:
                raise ValueError("STOCK_UPDATE requires quantity > 0")
        elif self.intent == "PRICE_UPDATE":
            if self.price_per_unit is None or self.price_per_unit <= 0:
                raise ValueError("PRICE_UPDATE requires price_per_unit > 0")
        elif self.intent in {"GET_REPORT", "GET_INVENTORY", "UDHARI_REPORT"}:
            # No extra validation needed — just a request
            pass
        elif self.intent == "UDHARI_QUERY":
            if not self.customer_name or not self.customer_name.strip():
                self.intent = "UDHARI_REPORT"
        elif self.intent in {"UDHARI_ADD", "UDHARI_PAYMENT"}:
            if not self.customer_name or not self.customer_name.strip():
                raise ValueError(f"{self.intent} requires customer_name")
            if self.amount is None or self.amount <= 0:
                raise ValueError(f"{self.intent} requires amount > 0")
        return self



class ExtractedEntries(BaseModel):
    entries: List[ExtractedEntry]


def _normalize_whatsapp_number(value: str) -> str:
    number = value.strip()
    if number.startswith("whatsapp:"):
        return number
    return f"whatsapp:{number}"


def _format_inr(value: float) -> str:
    rounded = round(float(value), 2)
    if rounded.is_integer():
        return f"₹{int(rounded)}"
    return f"₹{rounded:.2f}"


def _safe_json_load(raw_content: str) -> Dict[str, Any]:
    cleaned = raw_content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    return json.loads(cleaned.strip())


def _guess_extension(content_type: str, media_url: str) -> str:
    parsed_content_type = (content_type or "").split(";", maxsplit=1)[0].strip().lower()
    if parsed_content_type:
        extension = mimetypes.guess_extension(parsed_content_type)
        if extension:
            return extension

    media_path = media_url.split("?", maxsplit=1)[0].lower()
    for extension in SUPPORTED_AUDIO_EXTENSIONS:
        if media_path.endswith(extension):
            return extension

    return ".bin"


def is_audio_message(media_content_type: str, media_url: str) -> bool:
    lowered = (media_content_type or "").lower()
    if "audio/" in lowered or "application/ogg" in lowered:
        return True

    media_path = (media_url or "").split("?", maxsplit=1)[0].lower()
    return media_path.endswith(SUPPORTED_AUDIO_EXTENSIONS)


def download_audio(media_id: str, destination_dir: Path) -> Path:
    settings = get_settings()
    destination_dir.mkdir(parents=True, exist_ok=True)
    
    # Meta Graph API requires a 2-step download process for media:
    # 1. Fetch the media URL using the media ID
    media_info_url = f"https://graph.facebook.com/v19.0/{media_id}"
    info_resp = requests.get(
        media_info_url,
        headers={"Authorization": f"Bearer {settings.whatsapp_api_token}"},
        timeout=15,
    )
    info_resp.raise_for_status()
    actual_url = info_resp.json().get("url")
    
    if not actual_url:
        raise RuntimeError(f"Could not retrieve media URL from Meta for ID {media_id}")

    # 2. Download the binary audio data
    response = requests.get(
        actual_url,
        headers={"Authorization": f"Bearer {settings.whatsapp_api_token}"},
        timeout=45,
    )

    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(f"Unable to download WhatsApp media: {exc}") from exc

    extension = _guess_extension(response.headers.get("Content-Type", ""), actual_url)
    audio_path = destination_dir / f"incoming{extension}"
    audio_path.write_bytes(response.content)
    return audio_path


def convert_audio(input_audio: Path, destination_dir: Path) -> Path:
    settings = get_settings()
    destination_dir.mkdir(parents=True, exist_ok=True)

    output_audio = destination_dir / "normalized.mp3"
    command = [
        settings.ffmpeg_binary,
        "-y",
        "-i",
        str(input_audio),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(output_audio),
    ]

    try:
        process = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg binary not found. Install ffmpeg before running webhook flow.") from exc

    if process.returncode != 0:
        stderr_tail = process.stderr.strip().splitlines()[-5:]
        raise RuntimeError("ffmpeg conversion failed: " + " | ".join(stderr_tail))

    if not output_audio.exists():
        raise RuntimeError("ffmpeg conversion failed: output file not generated")

    return output_audio


# ---------------------------------------------------------------------------
# Local Whisper model (lazy-loaded, cached)
# ---------------------------------------------------------------------------
_whisper_model = None
_whisper_model_name = None


def _get_whisper_model():
    """Load the local Whisper model once and cache it."""
    global _whisper_model, _whisper_model_name
    import whisper as openai_whisper

    # Use large-v3 for best Hindi/Marathi accuracy (you have it downloaded at ~/.cache/whisper/)
    model_name = os.environ.get("WHISPER_LOCAL_MODEL", "large-v3")
    if _whisper_model is None or _whisper_model_name != model_name:
        logger.info("Loading local Whisper model: %s (this may take a moment)...", model_name)
        _whisper_model = openai_whisper.load_model(model_name)
        _whisper_model_name = model_name
        logger.info("Whisper model '%s' loaded successfully.", model_name)
    return _whisper_model


def transcribe_audio(audio_path: Path) -> Dict[str, str]:
    """Transcribe audio using the LOCAL Whisper model (not Groq cloud)."""
    model = _get_whisper_model()
    logger.info("Transcribing with local Whisper (%s): %s", _whisper_model_name, audio_path.name)

    result = model.transcribe(
        str(audio_path),
        language="hi",       # Force Hindi — prevents misdetecting as English
        task="transcribe",
        fp16=False,          # CPU doesn't support FP16
        initial_prompt="Hindi, Marathi, Hinglish mein business transaction. Chai bechi 500 rupay, doodh pe 200 kharch.",
    )

    text = (result.get("text") or "").strip()
    language = (result.get("language") or "hi").strip().lower()
    logger.info("Local Whisper result — lang: %s, text: %s", language, text[:200])
    return {"text": text, "language": language}


def extract_json(transcript: str) -> Optional[List[Dict[str, Any]]]:
    settings = get_settings()

    system_prompt = (
        "You are a strict JSON extraction service for a small-business ledger. "
        "User audio transcripts can be Hindi, Marathi, Hinglish, or mixed language. "
        "Extract ALL commands and return JSON: {'entries': [...]}\n\n"

        "=== intent: ADD_ENTRY (vendor sold or spent money) ===\n"
        "Keys: intent, amount, type, category, description, quantity.\n"
        "RULES:\n"
        "- 'bech', 'bechi', 'bej', 'sell', 'sold', 'diya' = type:'income' (NEVER expense).\n"
        "- 'kharcha', 'kharch', 'liya', 'buy', 'bought', 'spent' = type:'expense'.\n"
        "- amount: the RUPEE number. If only quantity is said (no rupees), set amount to null.\n"
        "- quantity: the COUNT of units sold/bought. Extract if mentioned, else null.\n"
        "- category: concise lowercase item name (chai, samosa, milk, pav bhaji).\n"
        "EXAMPLES:\n"
        "  '100 rupay ke pav bhaji bech diya' → amount:100, type:'income', category:'pav bhaji', quantity:null\n"
        "  '10 samosa bej diya' → amount:null, type:'income', category:'samosa', quantity:10\n"
        "  '40 chai bechi 400 mein' → amount:400, type:'income', category:'chai', quantity:40\n"
        "  'doodh pe 200 kharch' → amount:200, type:'expense', category:'milk', quantity:null\n"
        "  '20 vadapav aur 30 samosa bech diya' → TWO entries, both income\n\n"

        "=== intent: STOCK_UPDATE (vendor sets/restocks inventory) ===\n"
        "Use ONLY when vendor says they are PREPARING/RESTOCKING, NOT selling.\n"
        "Keys: intent, category, quantity. (No amount, no type.)\n"
        "Examples: 'chai ka stock 100', 'maine 80 samosa banaya', 'aaj 60 vada pav rakha'\n\n"

        "=== intent: PRICE_UPDATE (vendor changes price of an item) ===\n"
        "Use ONLY when vendor mentions a NEW rate/price, NOT a sale.\n"
        "Keys: intent, category, price_per_unit. (No amount, no type.)\n"
        "Examples: 'chai ka rate 12 rupay', 'samosa ab 20 ka'\n\n"

        "=== intent: GET_REPORT (vendor asks for their record/report) ===\n"
        "Use when vendor asks for their report, record, hisaab, statement.\n"
        "Keys: intent (only). Set category to 'report'.\n"
        "Examples: 'mera record do', 'mujhe mera hisaab do', 'give me my report', "
        "'mera record bhejo', 'weekly report do', 'mera hisaab kitab bhejo'\n\n"

        "=== intent: GET_INVENTORY (vendor asks to see stock/inventory) ===\n"
        "Use when vendor asks to view inventory, stock list, or available items.\n"
        "Keys: intent (only). Set category to 'inventory'.\n"
        "Examples: 'mujhe meri inventory dekhni hai', 'mera stock dikhao', "
        "'kitna stock bacha hai', 'show my inventory', 'stock list bhejo'\n\n"

        "=== intent: UDHARI_ADD (vendor gave credit to a customer) ===\n"
        "Use when vendor says they GAVE goods/money on credit (udhari diya, udhaar diya, baaki rakha).\n"
        "Keys: intent, customer_name, amount. (customer_name = person's name, amount = rupees.)\n"
        "RULES:\n"
        "- 'udhari diya', 'udhaar diya', 'baaki rakha', 'credit diya', 'khata mein daal' = UDHARI_ADD\n"
        "- Extract the customer NAME carefully — it is a person's name, not an item.\n"
        "EXAMPLES:\n"
        "  'Ramesh ko 500 ka udhari diya' → intent:'UDHARI_ADD', customer_name:'Ramesh', amount:500\n"
        "  'Suresh ne 200 baaki rakha, chai pi ke gaya' → intent:'UDHARI_ADD', customer_name:'Suresh', amount:200\n"
        "  'Priya ko 150 ka udhaar diya biscuit ke liye' → intent:'UDHARI_ADD', customer_name:'Priya', amount:150\n\n"

        "=== intent: UDHARI_PAYMENT (customer paid back their udhari) ===\n"
        "Use when vendor says a customer PAID back / cleared their due (paise diya, payment mili, udhari chukaya).\n"
        "Keys: intent, customer_name, amount.\n"
        "RULES:\n"
        "- 'ne diya', 'payment diya', 'udhari chukaya', 'baaki chukaya', 'paise aaye', 'clear kiya' = UDHARI_PAYMENT\n"
        "- If customer paid FULL, use the amount mentioned.\n"
        "EXAMPLES:\n"
        "  'Ramesh ne 500 diya' → intent:'UDHARI_PAYMENT', customer_name:'Ramesh', amount:500\n"
        "  'Suresh ne apna udhari chukaya, 300 diya' → intent:'UDHARI_PAYMENT', customer_name:'Suresh', amount:300\n"
        "  'Priya ne 100 diye partial payment' → intent:'UDHARI_PAYMENT', customer_name:'Priya', amount:100\n\n"

        "=== intent: UDHARI_QUERY (vendor asks about a specific customer's balance/udhari) ===\n"
        "Use when vendor asks about how much a specific customer owes or asks to show their udhari/hisaab.\n"
        "Keys: intent:'UDHARI_QUERY', customer_name:'<name>'.\n"
        "EXAMPLES:\n"
        "  'Ramesh ki udhari batao' → intent:'UDHARI_QUERY', customer_name:'Ramesh'\n"
        "  'Ramesh ke udhari batao' → intent:'UDHARI_QUERY', customer_name:'Ramesh'\n"
        "  'Ramesh ka kitna baki hai' → intent:'UDHARI_QUERY', customer_name:'Ramesh'\n"
        "  'Suresh ka hisaab batao' → intent:'UDHARI_QUERY', customer_name:'Suresh'\n"
        "  'Priya ki udhari kitni hai' → intent:'UDHARI_QUERY', customer_name:'Priya'\n\n"

        "=== intent: UDHARI_REPORT (vendor asks for ALL customers udhari / report / list / pdf) ===\n"
        "Use when vendor asks for all udhari, overall udhari report, udhari register, or pdf.\n"
        "Keys: intent:'UDHARI_REPORT'. (No customer_name or set to null).\n"
        "EXAMPLES:\n"
        "  'Sab ki udhari batao' → intent:'UDHARI_REPORT'\n"
        "  'Sab ke udhari batao' → intent:'UDHARI_REPORT'\n"
        "  'Udhari ka report do' → intent:'UDHARI_REPORT'\n"
        "  'Udhari list bhejo' → intent:'UDHARI_REPORT'\n"
        "  'Udhari ka hisaab bhejo' → intent:'UDHARI_REPORT'\n"
        "  'Kitna udhari baki hai total report do' → intent:'UDHARI_REPORT'\n"
        "  'Udhari report pdf bhejo' → intent:'UDHARI_REPORT'\n\n"

        "Return ONLY valid JSON. No explanation.\n"
    )


    payload: Dict[str, Any] = {
        "model": settings.groq_llm_model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": "Transcript: " + transcript,
            },
        ],
    }

    headers = {
        "Authorization": f"Bearer {settings.groq_api_key}",
        "Content-Type": "application/json",
    }

    response = requests.post(
        GROQ_CHAT_COMPLETIONS_URL,
        headers=headers,
        json=payload,
        timeout=60,
    )

    # Some models may reject strict response_format. Retry once without it.
    if response.status_code == 400 and "response_format" in response.text:
        payload.pop("response_format", None)
        response = requests.post(
            GROQ_CHAT_COMPLETIONS_URL,
            headers=headers,
            json=payload,
            timeout=60,
        )

    if response.status_code >= 400:
        logger.warning("Groq extraction call failed: %s", response.text)
        return None

    try:
        content = (
            response.json()
            .get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        parsed_payload = _safe_json_load(content)
        # Support both {"entries": [...]} and a bare single-object response
        if "entries" in parsed_payload and isinstance(parsed_payload["entries"], list):
            raw_list = parsed_payload["entries"]
        elif "intent" in parsed_payload:
            raw_list = [parsed_payload]
        else:
            logger.warning("Unexpected Groq extraction shape: %s", parsed_payload)
            return None

        results = []
        for item in raw_list:
            try:
                validated = ExtractedEntry.model_validate(item)
                results.append(validated.model_dump())
            except (ValidationError, ValueError) as exc:
                logger.warning("Skipping invalid entry from Groq: %s — %s", item, exc)
        return results if results else None
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        logger.warning("Groq extraction parse/validation failed: %s", exc)
        return None


def _calculate_current_profit(phone: str) -> float:
    db = get_db()
    rows = list(db["ledger"].find({"phone": phone}, {"amount": 1, "type": 1, "_id": 0}))

    profit = 0.0
    for row in rows:
        try:
            amount = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0

        entry_type = (row.get("type") or "").lower()
        if entry_type == "income":
            profit += amount
        elif entry_type == "expense":
            profit -= amount

    return profit


def save_to_db(phone: str, extracted_data: Dict[str, Any], audio_url: str, catalog_phone: str = "") -> Dict[str, Any]:
    """Save a single extracted entry. extracted_data is a single entry dict.
    catalog_phone: the phone key used for inventory lookups (defaults to phone if not given).
    Pass 'web-client' to make WhatsApp entries use the shared web-client catalog."""
    db = get_db()
    # Use catalog_phone for inventory if provided, else fall back to phone
    inv_phone = catalog_phone if catalog_phone else phone

    # Extract quantity if provided (may be None / missing)
    raw_qty = extracted_data.get("quantity")
    quantity: Optional[float] = None
    if raw_qty is not None:
        try:
            quantity = float(raw_qty)
            if quantity <= 0:
                quantity = None
        except (TypeError, ValueError):
            quantity = None

    # Compute amount from inventory price if vendor only said quantity, no ₹ amount
    raw_amount = extracted_data.get("amount") or 0
    try:
        amount = float(raw_amount)
    except (TypeError, ValueError):
        amount = 0.0

    if amount <= 0 and quantity is not None and quantity > 0:
        # Look up price from inventory
        try:
            from services.inventory import get_inventory
            inv_items = get_inventory(inv_phone)
            cat_lower = str(extracted_data.get("category") or "").strip().lower()
            for inv_item in inv_items:
                if inv_item.get("item_name") == cat_lower:
                    price = float(inv_item.get("price_per_unit") or 0)
                    if price > 0:
                        amount = quantity * price
                        logger.info("Computed amount ₹%.2f from qty=%g × price=₹%.2f for '%s'",
                                    amount, quantity, price, cat_lower)
                    break
        except Exception as price_exc:
            logger.warning("Price lookup failed: %s", price_exc)

        # If still 0, set amount = quantity (placeholder to prevent DB constraint violation)
        if amount <= 0:
            amount = quantity
            logger.info("No price found for '%s', using amount=quantity=%g", extracted_data.get("category"), quantity)

    record = {
        "phone": phone,
        "amount": amount,
        "type": extracted_data.get("type") or "income",
        "category": extracted_data.get("category") or "general",
        "description": extracted_data.get("description") or extracted_data.get("category") or "",
        "audio_url": audio_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if quantity is not None:
        record["quantity"] = quantity


    insert_result = db["ledger"].insert_one(record)
    record["id"] = str(insert_result.inserted_id)
    if "_id" in record:
        del record["_id"]
    inserted = record
    current_profit = _calculate_current_profit(phone)

    # Auto-deduct from inventory for ALL income entries
    # If quantity is known, use it directly. If only amount, compute qty from price.
    stockout_info = None
    stock_alert = None
    if record.get("type") == "income":
        deduct_qty = quantity  # may be None
        category = (extracted_data.get("category") or "").lower().strip()

        # If no quantity but we have amount, compute from inventory price
        if deduct_qty is None and amount > 0 and category:
            try:
                from services.inventory import get_inventory
                inv_items = get_inventory(inv_phone)
                # Also check web-client if inv_phone is different
                if inv_phone != "web-client" and not inv_items:
                    inv_items = get_inventory("web-client")
                for inv_item in inv_items:
                    if inv_item.get("item_name") == category or \
                       category.replace(" ", "") in inv_item.get("item_name", "").replace(" ", "") or \
                       inv_item.get("item_name", "").replace(" ", "") in category.replace(" ", ""):
                        price = float(inv_item.get("price_per_unit") or 0)
                        if price > 0:
                            deduct_qty = amount / price
                            logger.info("Computed qty=%.1f from amount=₹%.0f / price=₹%.0f for '%s'",
                                        deduct_qty, amount, price, category)
                        break
            except Exception as price_exc:
                logger.warning("Price lookup for qty computation failed: %s", price_exc)

        if deduct_qty is not None and deduct_qty > 0:
            try:
                from services.inventory import deduct_stock
                stockout_info = deduct_stock(
                    phone=inv_phone,
                    item_name=category,
                    quantity=deduct_qty,
                )
            except Exception as inv_exc:
                logger.warning("Inventory deduction failed for '%s': %s", category, inv_exc)

        if stockout_info:
            try:
                current_stock = float(stockout_info.get("current_stock") or 0)
            except (TypeError, ValueError):
                current_stock = 0.0
            try:
                daily_stock = float(stockout_info.get("daily_stock") or 0)
            except (TypeError, ValueError):
                daily_stock = 0.0

            ratio = (current_stock / daily_stock) if daily_stock > 0 else None
            is_stockout = bool(stockout_info.get("stockout"))
            is_low_stock = bool(
                not is_stockout
                and ratio is not None
                and ratio <= LOW_STOCK_RATIO_THRESHOLD
            )

            if is_stockout or is_low_stock:
                stock_alert = {
                    "item_name": str(stockout_info.get("item_name") or category),
                    "current_stock": current_stock,
                    "daily_stock": daily_stock,
                    "ratio": ratio,
                    "stockout": is_stockout,
                    "low_stock": is_low_stock,
                }

    return {
        "entry": inserted,
        "current_profit": current_profit,
        "quantity": quantity,
        "stockout": stockout_info.get("stockout") if stockout_info else False,
        "inventory_updated": stockout_info is not None,
        "stock_alert": stock_alert,
    }



def _handle_meta_response(response: requests.Response, recipient: str) -> Dict[str, Any]:
    if not response.ok:
        try:
            err_json = response.json().get("error", {})
            err_code = err_json.get("code")
            err_msg = err_json.get("message", response.text)
            err_data = err_json.get("error_data", {}).get("details", "")

            if err_code == 131030:
                raise RuntimeError(
                    f"Meta Sandbox restriction: Recipient +{recipient} is not in your allowed test numbers on Meta Developer Portal. "
                    f"Add this phone number in your Meta WhatsApp test recipient list, or use 'Approve & Activate' to onboard them directly."
                )
            elif err_code == 131047:
                raise RuntimeError(
                    f"WhatsApp 24-Hour window expired for +{recipient}. Meta requires pre-approved template messages to re-engage past 24 hours. "
                    f"You can use 'Approve & Activate' to onboard them directly."
                )
            elif err_code == 190:
                raise RuntimeError("Meta WhatsApp Access Token has expired. Please update WHATSAPP_API_TOKEN in your environment.")
            else:
                detail_str = f" - {err_data}" if err_data else ""
                raise RuntimeError(f"WhatsApp API error ({err_code}): {err_msg}{detail_str}")
        except (ValueError, KeyError, AttributeError):
            response.raise_for_status()

    return response.json()


def upload_whatsapp_media(file_bytes: bytes, filename: str, mime_type: str) -> Optional[str]:
    """Uploads media binary directly to Meta Cloud API and returns the media ID."""
    try:
        settings = get_settings()
        url = f"https://graph.facebook.com/v19.0/{settings.whatsapp_phone_number_id}/media"
        headers = {"Authorization": f"Bearer {settings.whatsapp_api_token}"}
        files = {"file": (filename, file_bytes, mime_type)}
        data = {"messaging_product": "whatsapp", "type": mime_type}
        resp = requests.post(url, headers=headers, files=files, data=data, timeout=30)
        resp_data = resp.json()
        if resp.status_code == 200 and "id" in resp_data:
            logger.info("Uploaded media to Meta: id=%s (%s)", resp_data["id"], filename)
            return str(resp_data["id"])
        logger.warning("Meta media upload non-200: %s %s", resp.status_code, resp.text)
    except Exception as e:
        logger.warning("upload_whatsapp_media failed: %s", e)
    return None


def send_whatsapp_reply(
    to_phone: str,
    body: str,
    media_url: Optional[str] = None,
    media_type: Optional[str] = None,
    filename: Optional[str] = None,
    media_id: Optional[str] = None,
) -> str:
    settings = get_settings()

    url = f"https://graph.facebook.com/v19.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_api_token}",
        "Content-Type": "application/json",
    }
    
    recipient = to_phone.replace("whatsapp:", "").replace("+", "")
    
    # If media_url points to a local file and we don't have a media_id yet, upload directly to Meta
    if not media_id and media_url and not (media_url.startswith("http://") or media_url.startswith("https://")):
        local_rel = media_url.lstrip("/")
        if os.path.exists(local_rel):
            try:
                with open(local_rel, "rb") as f:
                    content_bytes = f.read()
                clean_name = filename or os.path.basename(local_rel)
                clean_ext = os.path.splitext(clean_name)[1].lower()
                mime = (
                    "image/png" if clean_ext == ".png"
                    else "image/jpeg" if clean_ext in [".jpg", ".jpeg"]
                    else "image/webp" if clean_ext == ".webp"
                    else "application/pdf" if clean_ext == ".pdf"
                    else "application/octet-stream"
                )
                media_id = upload_whatsapp_media(content_bytes, clean_name, mime)
            except Exception as read_err:
                logger.warning("Could not upload local media %s to Meta: %s", local_rel, read_err)

    if media_id:
        clean_name = filename or "attachment"
        is_image = (
            media_type == "image"
            or clean_name.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))
        )
        if is_image:
            image_obj: Dict[str, Any] = {"id": media_id}
            if body:
                image_obj["caption"] = body
            payload: Dict[str, Any] = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient,
                "type": "image",
                "image": image_obj,
            }
        else:
            doc_obj: Dict[str, Any] = {"id": media_id}
            if body:
                doc_obj["caption"] = body
            if filename:
                doc_obj["filename"] = filename
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient,
                "type": "document",
                "document": doc_obj,
            }
    elif media_url:
        clean_url = media_url.split("?")[0].lower()
        is_image = (
            media_type == "image"
            or clean_url.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))
        )

        if is_image:
            image_obj = {"link": media_url}
            if body:
                image_obj["caption"] = body
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient,
                "type": "image",
                "image": image_obj,
            }
        else:
            doc_obj = {"link": media_url}
            if body:
                doc_obj["caption"] = body
            clean_name = filename or os.path.basename(clean_url) or "document.pdf"
            doc_obj["filename"] = clean_name
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient,
                "type": "document",
                "document": doc_obj,
            }
    else:
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient,
            "type": "text",
            "text": {"preview_url": False, "body": body},
        }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=20)
        data = _handle_meta_response(response, recipient)
        return data.get("messages", [{}])[0].get("id", "")
    except Exception as exc:
        raise RuntimeError(f"{exc}") from exc


def send_whatsapp_template(to_phone: str, template_name: str = "hello_world", language_code: str = "en_US") -> str:
    """Send an official pre-approved Meta WhatsApp template (works even outside 24h customer window)."""
    settings = get_settings()
    url = f"https://graph.facebook.com/v19.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_api_token}",
        "Content-Type": "application/json",
    }
    recipient = to_phone.replace("whatsapp:", "").replace("+", "")
    payload = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": language_code}
        }
    }
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        data = _handle_meta_response(response, recipient)
        return data.get("messages", [{}])[0].get("id", "")
    except Exception as exc:
        raise RuntimeError(f"{exc}") from exc


def send_whatsapp_buttons(
    to_phone: str,
    body: str,
    buttons: List[Dict[str, str]],
    header: Optional[str] = None,
    footer: Optional[str] = None,
) -> str:
    """Send an interactive button message (max 3 buttons).
    
    Each button dict: {"id": "btn_id", "title": "Button Text"} (title max 20 chars)
    """
    settings = get_settings()
    url = f"https://graph.facebook.com/v19.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_api_token}",
        "Content-Type": "application/json",
    }
    recipient = to_phone.replace("whatsapp:", "").replace("+", "")

    btn_list = [
        {"type": "reply", "reply": {"id": b["id"], "title": b["title"][:20]}}
        for b in buttons[:3]
    ]

    interactive: Dict[str, Any] = {
        "type": "button",
        "body": {"text": body},
        "action": {"buttons": btn_list},
    }
    if header:
        interactive["header"] = {"type": "text", "text": header}
    if footer:
        interactive["footer"] = {"text": footer}

    payload: Dict[str, Any] = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipient,
        "type": "interactive",
        "interactive": interactive,
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        data = _handle_meta_response(response, recipient)
        return data.get("messages", [{}])[0].get("id", "")
    except Exception as exc:
        logger.warning("send_whatsapp_buttons failed: %s", exc)
        if "Meta Sandbox restriction" in str(exc) or "24-Hour window expired" in str(exc):
            raise
        # Fallback: send as plain text with options listed
        fallback_text = body + "\n\n" + "\n".join(
            f"{i+1}️⃣ {b['title']}" for i, b in enumerate(buttons)
        )
        return send_whatsapp_reply(to_phone, fallback_text)


def send_whatsapp_list(
    to_phone: str,
    body: str,
    button_label: str,
    sections: List[Dict[str, Any]],
    header: Optional[str] = None,
    footer: Optional[str] = None,
) -> str:
    """Send an interactive list message (supports up to 10 rows across sections).
    
    sections format:
    [{"title": "Section Title", "rows": [{"id": "row_id", "title": "Row Title", "description": "Optional"}]}]
    """
    settings = get_settings()
    url = f"https://graph.facebook.com/v19.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_api_token}",
        "Content-Type": "application/json",
    }
    recipient = to_phone.replace("whatsapp:", "").replace("+", "")

    interactive: Dict[str, Any] = {
        "type": "list",
        "body": {"text": body},
        "action": {
            "button": button_label[:20],
            "sections": sections,
        },
    }
    if header:
        interactive["header"] = {"type": "text", "text": header}
    if footer:
        interactive["footer"] = {"text": footer}

    payload: Dict[str, Any] = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipient,
        "type": "interactive",
        "interactive": interactive,
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        data = _handle_meta_response(response, recipient)
        return data.get("messages", [{}])[0].get("id", "")
    except Exception as exc:
        logger.warning("send_whatsapp_list failed: %s", exc)
        if "Meta Sandbox restriction" in str(exc) or "24-Hour window expired" in str(exc):
            raise
        # Fallback: send as plain text
        all_rows = []
        row_num = 1
        for sec in sections:
            for row in sec.get("rows", []):
                all_rows.append(f"{row_num}️⃣ {row['title']}")
                row_num += 1
        fallback_text = body + "\n\n" + "\n".join(all_rows)
        return send_whatsapp_reply(to_phone, fallback_text)




def _build_inventory_snapshot_message(items: List[Dict[str, Any]]) -> str:
    """Create a concise WhatsApp-friendly inventory snapshot."""

    def _fmt_number(value: Any) -> str:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return "-"
        if number.is_integer():
            return str(int(number))
        return f"{number:.1f}".rstrip("0").rstrip(".")

    if not items:
        return "📦 Aapki inventory abhi khali hai. Pehle items add kijiye."

    max_items = 15
    lines = ["📦 Aapki inventory:"]
    low_stock_lines: List[str] = []
    stockout_lines: List[str] = []

    for idx, item in enumerate(items[:max_items], start=1):
        item_name = str(item.get("item_name_hi") or item.get("item_name") or f"item {idx}").strip()
        unit = str(item.get("unit") or "piece")
        current = _fmt_number(item.get("current_stock"))
        daily = _fmt_number(item.get("daily_stock"))
        stock_text = f"{current}/{daily} {unit}" if daily != "-" else f"{current} {unit}"

        try:
            current_num = float(item.get("current_stock") or 0)
        except (TypeError, ValueError):
            current_num = 0.0
        try:
            daily_num = float(item.get("daily_stock") or 0)
        except (TypeError, ValueError):
            daily_num = 0.0

        if daily_num > 0:
            ratio = current_num / daily_num
            if current_num <= 0:
                stockout_lines.append(f"- {item_name}: stockout (0/{int(daily_num)})")
            elif ratio <= LOW_STOCK_RATIO_THRESHOLD:
                pct = int(round(ratio * 100))
                low_stock_lines.append(f"- {item_name}: {int(current_num)}/{int(daily_num)} left ({pct}%)")

        price_suffix = ""
        try:
            price = float(item.get("price_per_unit") or 0)
            if price > 0:
                price_value = str(int(price)) if price.is_integer() else f"{price:.2f}".rstrip("0").rstrip(".")
                price_suffix = f" | ₹{price_value}/{unit}"
        except (TypeError, ValueError):
            price_suffix = ""

        lines.append(f"{idx}. {item_name} - stock {stock_text}{price_suffix}")

    remaining = len(items) - max_items
    if remaining > 0:
        lines.append(f"... aur {remaining} items.")

    if stockout_lines:
        lines.append("\n🚨 Instant Alert: Stockout")
        lines.extend(stockout_lines[:5])

    if low_stock_lines:
        lines.append(f"\n⚠️ Instant Alert: Low stock (<= {int(LOW_STOCK_RATIO_THRESHOLD * 100)}%)")
        lines.extend(low_stock_lines[:5])

    if not stockout_lines and not low_stock_lines:
        lines.append("\n✅ Instant Alert: Abhi koi critical low-stock item nahi hai.")

    lines.append("\nStock badhane ke liye bolo: '50 samosa stock update karo'.")
    return "\n".join(lines)


def _format_stock_alert_line(stock_alert: Dict[str, Any]) -> Optional[str]:
    item_name = str(stock_alert.get("item_name") or "item").strip()
    if not item_name:
        item_name = "item"

    try:
        current_stock = float(stock_alert.get("current_stock") or 0)
    except (TypeError, ValueError):
        current_stock = 0.0
    try:
        daily_stock = float(stock_alert.get("daily_stock") or 0)
    except (TypeError, ValueError):
        daily_stock = 0.0

    current_text = str(int(current_stock)) if current_stock.is_integer() else f"{current_stock:.1f}".rstrip("0").rstrip(".")
    daily_text = str(int(daily_stock)) if daily_stock > 0 and daily_stock.is_integer() else (
        f"{daily_stock:.1f}".rstrip("0").rstrip(".") if daily_stock > 0 else "-"
    )

    if bool(stock_alert.get("stockout")):
        return f"🚨 {item_name}: STOCKOUT ({current_text}/{daily_text} left)"

    if bool(stock_alert.get("low_stock")):
        ratio = stock_alert.get("ratio")
        try:
            pct = int(round(float(ratio) * 100))
        except (TypeError, ValueError):
            pct = int(LOW_STOCK_RATIO_THRESHOLD * 100)
        return f"⚠️ {item_name}: low stock {current_text}/{daily_text} left ({pct}%)"

    return None


def _inventory_alert_level(current_stock: float, daily_stock: float, units_threshold: int) -> Optional[str]:
    if daily_stock <= 0:
        return None
    if current_stock <= 0:
        return "stockout"
    if current_stock <= units_threshold:
        return "low_units"
    ratio = current_stock / daily_stock
    if ratio <= LOW_STOCK_RATIO_THRESHOLD:
        return "low_ratio"
    return None


def _format_stock_monitor_line(
    item_name: str,
    current_stock: float,
    daily_stock: float,
    unit: str,
    level: str,
    units_threshold: int,
) -> str:
    current_text = str(int(current_stock)) if float(current_stock).is_integer() else f"{current_stock:.1f}".rstrip("0").rstrip(".")
    daily_text = str(int(daily_stock)) if float(daily_stock).is_integer() else f"{daily_stock:.1f}".rstrip("0").rstrip(".")

    if level == "stockout":
        return f"- {item_name}: STOCKOUT ({current_text}/{daily_text} {unit})"
    if level == "low_units":
        return f"- {item_name}: low stock {current_text}/{daily_text} {unit} (<= {units_threshold})"
    ratio = (current_stock / daily_stock) if daily_stock > 0 else 0
    pct = int(round(ratio * 100))
    return f"- {item_name}: low stock {current_text}/{daily_text} {unit} ({pct}%)"


def _recent_whatsapp_recipients(days: int = 30) -> List[str]:
    settings = get_settings()
    explicit = [p.strip() for p in (settings.instant_stock_alert_recipients or "").split(",") if p.strip()]
    if explicit:
        recipients: List[str] = []
        seen = set()
        for phone in explicit:
            normalized = phone if phone.startswith("whatsapp:") else f"whatsapp:{phone}"
            if normalized in seen:
                continue
            seen.add(normalized)
            recipients.append(normalized)
        return recipients

    db = get_db()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    try:
        rows = list(db["ledger"].find(
            {"phone": {"$regex": "^whatsapp:"}, "created_at": {"$gte": since}},
            {"phone": 1, "created_at": 1}
        ).sort("created_at", -1).limit(300))
    except Exception as exc:  # pragma: no cover - network/db path
        logger.warning("Failed to load WhatsApp recipients for stock alerts: %s", exc)
        return []

    recipients: List[str] = []
    seen = set()
    for row in rows:
        phone = str(row.get("phone") or "").strip()
        if not phone.startswith("whatsapp:"):
            continue
        if phone in seen:
            continue
        seen.add(phone)
        recipients.append(phone)
    return recipients


def run_instant_stock_alert_job() -> int:
    """Proactively send WhatsApp alerts when inventory gets low/stockout."""
    settings = get_settings()
    if not settings.enable_instant_stock_alerts:
        return 0

    recipients = _recent_whatsapp_recipients()
    if not recipients:
        logger.info("Instant stock alert job: no recent WhatsApp recipients found.")
        return 0

    db = get_db()
    today = date.today().isoformat()
    units_threshold = settings.instant_stock_alert_units_threshold

    try:
        query = {
            "stock_date": today,
            "is_active": True,
            "phone": "web-client"
        }
        rows = list(db["inventory"].find(query).sort("item_name", 1).limit(1000))
    except Exception as exc:  # pragma: no cover - network/db path
        logger.warning("Instant stock alert job failed to fetch inventory: %s", exc)
        return 0

    active_keys: set[str] = set()
    new_alert_lines: List[str] = []

    for row in rows:
        item_name = str(row.get("item_name_hi") or row.get("item_name") or "item").strip()
        item_key = str(row.get("item_name") or item_name).strip().lower()
        key = f"{today}:{item_key}"
        active_keys.add(key)

        try:
            current_stock = float(row.get("current_stock") or 0)
        except (TypeError, ValueError):
            current_stock = 0.0
        try:
            daily_stock = float(row.get("daily_stock") or 0)
        except (TypeError, ValueError):
            daily_stock = 0.0
        unit = str(row.get("unit") or "piece")

        level = _inventory_alert_level(current_stock, daily_stock, units_threshold)
        if not level:
            _stock_alert_state.pop(key, None)
            continue

        state_value = f"{level}:{int(current_stock)}:{int(daily_stock)}"
        previous = _stock_alert_state.get(key)
        _stock_alert_state[key] = state_value

        # Alert only when newly entering alert state or stock values changed.
        if previous == state_value:
            continue

        new_alert_lines.append(
            _format_stock_monitor_line(
                item_name=item_name,
                current_stock=current_stock,
                daily_stock=daily_stock,
                unit=unit,
                level=level,
                units_threshold=units_threshold,
            )
        )

    # Remove stale state for items not present today.
    for existing_key in list(_stock_alert_state.keys()):
        if existing_key.startswith(f"{today}:") and existing_key not in active_keys:
            _stock_alert_state.pop(existing_key, None)

    if not new_alert_lines:
        return 0

    unique_lines = list(dict.fromkeys(new_alert_lines))
    body = (
        "🚨 Instant Inventory Alert\n"
        + "\n".join(unique_lines[:10])
        + "\n\nReply with: '50 samosa stock update karo'"
    )

    sent_count = 0
    for recipient in recipients:
        try:
            send_whatsapp_reply(recipient, body)
            sent_count += 1
        except Exception as exc:  # pragma: no cover - external API path
            logger.warning("Instant stock alert send failed for %s: %s", recipient, exc)

    if sent_count:
        logger.info("Instant stock alert sent to %d recipient(s).", sent_count)
    return sent_count


def _looks_like_inventory_request(transcript: str) -> bool:
    """Best-effort keyword detector for inventory view requests."""
    text = " ".join((transcript or "").strip().lower().split())
    if not text:
        return False

    request_markers = (
        "inventory",
        "inventry",
        "stock list",
        "stock dikha",
        "stock dikhao",
        "stock dekh",
        "stock dikh",
        "mera stock",
        "meri inventory",
        "mere inventory",
        "mujhe meri inventory",
        "mujhe mere inventory",
        "kitna stock",
        "stock bacha",
        "show inventory",
        "show my inventory",
        "show stock",
        "available stock",
    )

    update_or_transaction_markers = (
        "stock update",
        "add stock",
        "stock badha",
        "stock badhao",
        "rate update",
        "price update",
        "bech",
        "sold",
        "kharch",
    )

    has_request = any(marker in text for marker in request_markers)
    has_update_or_transaction = any(marker in text for marker in update_or_transaction_markers)
    return has_request and not has_update_or_transaction


def _looks_like_pnl_report_request(text: str) -> bool:
    cleaned = text.strip().lower()
    if "udhari" in cleaned or "udhaar" in cleaned or "khata" in cleaned:
        return False
    triggers = [
        "report", "pnl", "profit and loss", "profit loss", "mera hisaab", "mera hisab",
        "hisaab bhejo", "hisab bhejo", "weekly report", "p&l", "statement", "balance sheet",
        "mera record", "record bhejo", "record do", "hisaab do", "hisab do",
    ]
    return any(t in cleaned for t in triggers)


def process_voice_message(phone: str, media_id: str) -> str:
    from services.conversation_engine import (
        analyze_voice_input, process_follow_up_answer, has_pending, get_pending,
    )
    from services.inventory import get_inventory
    catalog_phone = "web-client"

    with tempfile.TemporaryDirectory(prefix="vyapaarsaathi-wa-") as tmp_dir:
        working_dir = Path(tmp_dir)
        raw_audio = download_audio(media_id, working_dir)
        mp3_audio = convert_audio(raw_audio, working_dir)
        transcript_payload = transcribe_audio(mp3_audio)

    transcript = transcript_payload.get("text", "").strip()
    if not transcript:
        return FALLBACK_RESPONSE

    # Fast path: handle common inventory view commands deterministically.
    if _looks_like_inventory_request(transcript):
        try:
            inventory_items = get_inventory(catalog_phone)
            if not inventory_items:
                inventory_items = get_inventory(phone)
            return _build_inventory_snapshot_message(inventory_items)
        except Exception as inv_exc:
            logger.error("Inventory keyword path failed: %s", inv_exc)
            return "⚠️ Inventory laane mein problem aayi. Kripya dobara try kijiye."

    # Fast path: handle Udhari query or report requests deterministically
    try:
        from services.udhari import (
            match_udhari_query_or_report,
            format_customer_query_reply,
            handle_all_udhari_report,
        )
        udhari_fast = match_udhari_query_or_report(transcript)
        if udhari_fast:
            u_intent, u_name = udhari_fast
            if u_intent == "UDHARI_QUERY" and u_name:
                return format_customer_query_reply(vendor_phone=phone, customer_name=u_name)
            elif u_intent == "UDHARI_REPORT":
                caption, pdf_url = handle_all_udhari_report(vendor_phone=phone)
                if pdf_url and phone.startswith("whatsapp:"):
                    try:
                        date_label = datetime.now().strftime("%d_%b_%Y")
                        send_whatsapp_reply(
                            to_phone=phone,
                            body=caption,
                            media_url=pdf_url,
                            filename=f"Udhari_Report_{date_label}.pdf",
                        )
                        return "📄 Aapka Udhari Report PDF WhatsApp par bhej diya gaya hai! Upar check karein."
                    except Exception as wa_exc:
                        logger.warning("Failed to send WhatsApp Udhari PDF in fast path: %s", wa_exc)
                return caption
    except Exception as fast_exc:
        logger.warning("Udhari fast-path check failed: %s", fast_exc)

    # Fast path: handle P&L report requests deterministically
    if _looks_like_pnl_report_request(transcript):
        try:
            from services.report_generator import generate_pnl_pdf
            db = get_db()
            vdoc = db["vendors"].find_one({"phone": phone})
            vname = (vdoc or {}).get("business_name") or (vdoc or {}).get("name") or phone
            pdf_url = generate_pnl_pdf(phone, vendor_name=vname)
            if pdf_url and phone.startswith("whatsapp:"):
                try:
                    send_whatsapp_reply(
                        to_phone=phone,
                        body="📊 *VyapaarSaathi — Trading & Profit & Loss Statement (PDF)*\n\nAapka P&L Report PDF WhatsApp par bhej diya gaya hai! Upar check karein.",
                        media_url=pdf_url,
                        filename="VyapaarSaathi_PnL_Report.pdf",
                    )
                    return "📊 Aapka Profit & Loss Report PDF WhatsApp par bhej diya gaya hai! Upar check karein."
                except Exception as wa_exc:
                    logger.warning("Failed to send P&L PDF over WhatsApp in fast-path: %s", wa_exc)
            elif pdf_url:
                return f"📊 Aapka Profit & Loss Report PDF tayyar hai: {pdf_url}"
            else:
                return "⚠️ Ledger mein abhi koi sales transactions nahi mile. Pehle sales record kijiye!"
        except Exception as report_exc:
            logger.error("Report fast-path failed: %s", report_exc)
            return "⚠️ Report generate karne mein problem aayi. Kripya dobara try kijiye."

    extracted = extract_json(transcript)
    if not extracted:
        return FALLBACK_RESPONSE

    # Get inventory for conversation engine.
    # Always use the shared 'web-client' catalog so WhatsApp and web UI
    # share the same items, prices and stock levels.
    try:
        inv_items = get_inventory(catalog_phone)
        if not inv_items:
            inv_items = get_inventory(phone)
    except Exception:
        inv_items = []

    # ── Check if this is a follow-up answer to a pending question ─────────
    if has_pending(phone):
        result = process_follow_up_answer(
            phone=phone,
            answer_transcript=transcript,
            answer_extracted=extracted,
            inventory_items=inv_items,
        )

        if result["status"] == "pending":
            # Still pending — send another counter question
            question = result.get("counter_question_hi", "")
            if result.get("inventory_created"):
                inv_info = result["inventory_created"]
                question = f"✅ {inv_info['item']} inventory mein add ho gaya (₹{int(inv_info['price'])}/piece).\n{question}"
            return f"🤖 {question}"

        if result["status"] == "complete":
            # Save all entries — use web-client as canonical phone so web UI sees them
            return _save_and_reply(phone, result.get("entries_to_save", []), media_id, catalog_phone=catalog_phone)

    # ── Fresh message — analyze against inventory ────────────────────────
    # First handle command-style intents separately.
    for entry_data in extracted:
        intent = str(entry_data.get("intent") or "ADD_ENTRY").upper()

        # ── Udhari intents (customer credit / payment) ───────────────────
        if intent in ("UDHARI_ADD", "UDHARI_PAYMENT"):
            try:
                from services.udhari import add_udhari, record_payment, format_udhari_added_msg, format_payment_received_msg
                customer_name = (entry_data.get("customer_name") or "").strip()
                amount = float(entry_data.get("amount") or 0)
                if not customer_name or amount <= 0:
                    return "Samajh nahi aaya — customer ka naam aur amount dono boliye 🙏"
                if intent == "UDHARI_ADD":
                    summary = add_udhari(vendor_phone=phone, customer_name=customer_name, amount=amount, note=transcript[:100])
                    return format_udhari_added_msg(customer_name=customer_name, amount=amount, total_due=float(summary.get("total_due", 0)))
                else:  # UDHARI_PAYMENT
                    summary = record_payment(vendor_phone=phone, customer_name=customer_name, amount=amount, note=transcript[:100])
                    return format_payment_received_msg(customer_name=customer_name, paid=amount, remaining=float(summary.get("total_due", 0)))
            except Exception as udhari_exc:
                logger.error("Udhari intent failed: %s", udhari_exc)
                return "⚠️ Udhari update mein problem aayi. Kripya dobara boliye."

        if intent == "UDHARI_QUERY":
            try:
                from services.udhari import format_customer_query_reply, handle_all_udhari_report
                customer_name = (entry_data.get("customer_name") or "").strip()
                if not customer_name or customer_name.lower() in ("sab", "all", "sabka", "sabki", "sabke", "kiska", "kiske"):
                    intent = "UDHARI_REPORT"
                else:
                    return format_customer_query_reply(vendor_phone=phone, customer_name=customer_name)
            except Exception as udhari_exc:
                logger.error("UDHARI_QUERY failed: %s", udhari_exc)
                return "⚠️ Customer ka hisaab nikalne mein problem aayi. Kripya dobara boliye."

        if intent == "UDHARI_REPORT":
            try:
                from services.udhari import handle_all_udhari_report
                caption, pdf_url = handle_all_udhari_report(vendor_phone=phone)
                if pdf_url and phone.startswith("whatsapp:"):
                    try:
                        date_label = datetime.now().strftime("%d_%b_%Y")
                        send_whatsapp_reply(
                            to_phone=phone,
                            body=caption,
                            media_url=pdf_url,
                            filename=f"Udhari_Report_{date_label}.pdf",
                        )
                        return "📄 Aapka Udhari Report PDF WhatsApp par bhej diya gaya hai! Upar check karein."
                    except Exception as wa_exc:
                        logger.warning("Failed to send WhatsApp Udhari PDF: %s", wa_exc)
                return caption
            except Exception as udhari_exc:
                logger.error("UDHARI_REPORT failed: %s", udhari_exc)
                return "⚠️ Udhari report generate karne mein problem aayi. Kripya dobara try kijiye."

        if intent == "GET_REPORT":
            try:
                from services.report_generator import generate_pnl_pdf
                db = get_db()
                vdoc = db["vendors"].find_one({"phone": phone})
                vname = (vdoc or {}).get("business_name") or (vdoc or {}).get("name") or phone
                pdf_url = generate_pnl_pdf(phone, vendor_name=vname)
                if pdf_url:
                    if phone.startswith("whatsapp:"):
                        try:
                            send_whatsapp_reply(
                                to_phone=phone,
                                body="📊 *VyapaarSaathi — Trading & Profit & Loss Statement (PDF)*\n\nAapka P&L Report PDF WhatsApp par bhej diya gaya hai! Upar check karein.",
                                media_url=pdf_url,
                                filename="VyapaarSaathi_PnL_Report.pdf",
                            )
                        except Exception as wa_exc:
                            logger.warning("WhatsApp send reply failed in GET_REPORT: %s", wa_exc)
                    return "📊 Aapka Profit & Loss Report PDF WhatsApp par bhej diya gaya hai! Upar check karein."
                else:
                    return "⚠️ Ledger mein abhi koi sales transactions nahi mile. Pehle sales record kijiye!"
            except Exception as report_exc:
                logger.error("GET_REPORT failed: %s", report_exc)
                return "⚠️ Report generation failed. Please try again."

        if intent == "GET_INVENTORY":
            try:
                inventory_items = get_inventory(catalog_phone)
                if not inventory_items:
                    inventory_items = get_inventory(phone)
                return _build_inventory_snapshot_message(inventory_items)
            except Exception as inv_exc:
                logger.error("GET_INVENTORY failed: %s", inv_exc)
                return "⚠️ Inventory laane mein problem aayi. Kripya dobara try kijiye."

    # Analyze all entries against inventory
    analysis = analyze_voice_input(extracted, phone, inv_items)

    if analysis["status"] == "pending":
        # Send counter question — save any complete entries first
        alert_lines: List[str] = []
        if analysis.get("entries_to_save"):
            alert_lines = _save_and_reply_silent(
                phone,
                analysis["entries_to_save"],
                media_id,
                catalog_phone=catalog_phone,
            )
        question = analysis.get("counter_question_hi", "")
        if alert_lines:
            unique_alerts = list(dict.fromkeys(alert_lines))
            return "🚨 Instant Alert:\n" + "\n".join(unique_alerts[:5]) + f"\n\n🤖 {question}"
        return f"🤖 {question}"

    # All complete — save everything
    return _save_and_reply(phone, analysis.get("entries_to_save", []), media_id, catalog_phone=catalog_phone)


def _save_and_reply(phone: str, entries: List[Dict[str, Any]], media_url: str, catalog_phone: str = "web-client") -> str:
    """Save entries and build WhatsApp reply text."""
    total_income = 0.0
    total_expense = 0.0
    parts = []
    inventory_confirmations = []
    stock_alert_lines: List[str] = []
    current_profit = 0.0

    for entry_data in entries:
        intent = str(entry_data.get("intent") or "ADD_ENTRY").upper()

        if intent == "STOCK_UPDATE":
            cat = str(entry_data.get("category") or "").strip().lower()
            try:
                qty = int(float(entry_data.get("quantity") or 0))
            except (TypeError, ValueError):
                qty = 0
            if cat and qty > 0:
                try:
                    from services.inventory import upsert_inventory_item
                    upsert_inventory_item(phone=catalog_phone, item_name=cat, daily_stock=qty, unit=entry_data.get("unit", "piece"), add_stock=True)
                    inventory_confirmations.append(f"📦 {cat} stock → {qty}")
                except Exception as inv_exc:
                    logger.warning("STOCK_UPDATE failed '%s': %s", cat, inv_exc)
            continue

        if intent == "PRICE_UPDATE":
            cat = str(entry_data.get("category") or "").strip().lower()
            try:
                new_price = float(entry_data.get("price_per_unit") or 0)
            except (TypeError, ValueError):
                new_price = 0.0
            if cat and new_price > 0:
                try:
                    db = get_db()
                    db["inventory"].update_one(
                        {"phone": catalog_phone, "item_name": cat, "stock_date": date.today().isoformat()},
                        {"$set": {
                            "price_per_unit": new_price,
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        }}
                    )
                    inventory_confirmations.append(f"💰 {cat} rate → ₹{new_price:.0f}")
                except Exception as inv_exc:
                    logger.warning("PRICE_UPDATE failed '%s': %s", cat, inv_exc)
            continue

        if intent in ("GET_REPORT", "GET_INVENTORY"):
            continue

        # ADD_ENTRY — save under real phone but use shared catalog for inventory ops
        try:
            saved = save_to_db(phone=phone, extracted_data=entry_data, audio_url=media_url, catalog_phone=catalog_phone)
            current_profit = float(saved["current_profit"])
            amount = float(saved["entry"].get("amount", 0))
            qty = saved.get("quantity")
            entry_type = entry_data.get("type") or "income"
            category = entry_data.get("category", "")
            inv_updated = saved.get("inventory_updated", False)
            stock_alert_line = _format_stock_alert_line(saved.get("stock_alert") or {})
            if stock_alert_line:
                stock_alert_lines.append(stock_alert_line)

            if entry_type == "income":
                total_income += amount
                qty_str = f" ({int(qty)} {category})" if qty else f" ({category})"
                amt_str = f" {_format_inr(amount)}" if amount > 0 else ""
                stock_str = " 📦 Stock updated" if inv_updated else ""
                parts.append(f"Income{amt_str}{qty_str}{stock_str}")
            else:
                total_expense += amount
                parts.append(f"Expense {_format_inr(amount)} ({category})")
        except Exception as save_exc:
            logger.warning("save_to_db failed for entry %s: %s", entry_data, save_exc)
            continue

    reply_parts = []
    if parts:
        reply_parts.append("✅ " + ", ".join(parts))
        reply_parts.append(f"Current profit: {_format_inr(current_profit)}")
    if inventory_confirmations:
        reply_parts.append("🔄 Updated: " + " | ".join(inventory_confirmations))
    if stock_alert_lines:
        unique_alerts = list(dict.fromkeys(stock_alert_lines))
        reply_parts.append("🚨 Instant Alert:\n" + "\n".join(unique_alerts[:5]))

    if not reply_parts:
        return FALLBACK_RESPONSE

    return "\n".join(reply_parts)


def _save_and_reply_silent(phone: str, entries: List[Dict[str, Any]], media_url: str, catalog_phone: str = "web-client") -> List[str]:
    """Save entries silently (used for partial saves) and return stock alerts."""
    alert_lines: List[str] = []
    for entry_data in entries:
        intent = str(entry_data.get("intent") or "ADD_ENTRY").upper()
        if intent in ("STOCK_UPDATE", "PRICE_UPDATE", "GET_REPORT", "GET_INVENTORY"):
            continue
        try:
            saved = save_to_db(phone=phone, extracted_data=entry_data, audio_url=media_url, catalog_phone=catalog_phone)
            stock_alert_line = _format_stock_alert_line(saved.get("stock_alert") or {})
            if stock_alert_line:
                alert_lines.append(stock_alert_line)
        except Exception as exc:
            logger.warning("Silent save failed: %s", exc)
    return alert_lines


def _build_weekly_summary_message(total_income: float, total_expense: float) -> str:
    net_profit = total_income - total_expense
    return (
        "Weekly summary:\n"
        f"Income: {_format_inr(total_income)}\n"
        f"Expense: {_format_inr(total_expense)}\n"
        f"Net: {_format_inr(net_profit)}"
    )


def _generate_tts_file(summary_text: str, destination_dir: Path) -> Optional[Path]:
    try:
        gtts_class = getattr(importlib.import_module("gtts"), "gTTS")
    except ImportError:
        logger.info("gTTS not installed. Sending text-only weekly summary.")
        return None

    destination_dir.mkdir(parents=True, exist_ok=True)
    output_path = destination_dir / "weekly_summary.mp3"
    try:
        tts = gtts_class(text=summary_text, lang="hi")
        tts.save(str(output_path))
    except Exception as exc:  # pragma: no cover - external dependency path
        logger.warning("TTS generation failed: %s", exc)
        return None

    return output_path


def _upload_weekly_audio(tts_path: Path, phone: str) -> Optional[str]:
    safe_phone = phone.replace("whatsapp:", "").replace("+", "")
    import shutil
    import os
    
    # Ensure directory exists
    target_dir = Path("static/weekly_summaries") / safe_phone
    target_dir.mkdir(parents=True, exist_ok=True)
    
    file_name = f"{uuid.uuid4()}.mp3"
    target_path = target_dir / file_name
    
    try:
        shutil.copy2(tts_path, target_path)
        # Assuming app is running and /static is mounted
        return f"/static/weekly_summaries/{safe_phone}/{file_name}"
    except Exception as exc:  # pragma: no cover
        logger.warning("Weekly summary upload failed: %s", exc)
        return None


def run_weekly_summary_job() -> int:
    settings = get_settings()
    db = get_db()

    start_time = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows = list(db["ledger"].find(
        {"created_at": {"$gte": start_time}}, 
        {"phone": 1, "amount": 1, "type": 1}
    ))

    aggregates: Dict[str, Dict[str, float]] = defaultdict(lambda: {"income": 0.0, "expense": 0.0})
    for row in rows:
        phone = row.get("phone")
        if not phone:
            continue
        try:
            amount = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        row_type = (row.get("type") or "").lower()
        if row_type in {"income", "expense"}:
            aggregates[phone][row_type] += amount

    sent_count = 0
    for phone, values in aggregates.items():
        summary_text = _build_weekly_summary_message(values["income"], values["expense"])
        media_url: Optional[str] = None

        if settings.enable_weekly_summary_tts:
            with tempfile.TemporaryDirectory(prefix="vyapaarsaathi-weekly-") as tmp_dir:
                tts_file = _generate_tts_file(summary_text, Path(tmp_dir))
                if tts_file:
                    media_url = _upload_weekly_audio(tts_file, phone)

        try:
            send_whatsapp_reply(phone, summary_text, media_url=media_url)
            sent_count += 1
        except Exception as exc:  # pragma: no cover - external API path
            logger.warning("Weekly summary send failed for %s: %s", phone, exc)

    return sent_count


__all__ = [
    "FALLBACK_RESPONSE",
    "MISSING_AUDIO_RESPONSE",
    "NON_AUDIO_RESPONSE",
    "download_audio",
    "convert_audio",
    "transcribe_audio",
    "extract_json",
    "save_to_db",
    "send_whatsapp_reply",
    "is_audio_message",
    "process_voice_message",
    "run_instant_stock_alert_job",
    "run_weekly_summary_job",
]
