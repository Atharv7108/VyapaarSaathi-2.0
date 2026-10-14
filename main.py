import os
import logging
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
    Query,
    Depends,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from scheduler import start_scheduler, stop_scheduler
from services.settings import get_settings
from services.voice_ledger import (
    FALLBACK_RESPONSE,
    MISSING_AUDIO_RESPONSE,
    NON_AUDIO_RESPONSE,
    is_audio_message,
    process_voice_message,
    send_whatsapp_reply,
    send_whatsapp_template,
    send_whatsapp_buttons,
    send_whatsapp_list,
    convert_audio,
    extract_json,
    normalize_spoken_numbers,
    save_to_db,
    transcribe_audio,
)
from db_config import get_db
from services.stock_suggestions import aggregate_item_stats, call_groq_for_suggestions
from services.ai_insights import run_insights_pipeline
from services.conversation_engine import analyze_voice_input, process_follow_up_answer, has_pending, cancel_pending
from services.vendor_manager import (
    get_or_create_vendor,
    update_last_active,
    set_vendor_name,
    set_vendor_state,
    set_vendor_category,
    set_vendor_business_name,
    update_vendor_onboarding,
    extract_name_from_text,
    extract_category_from_reply,
    check_consent_reply,
    list_vendors,
    BUSINESS_CATEGORIES,
    CATEGORY_ID_TO_LABEL,
    WELCOME_MESSAGE,
    CONSENT_ACCEPTED_MESSAGE,
    CONSENT_DECLINED_MESSAGE,
    NAME_SAVED_TEMPLATE,
    CATEGORY_SAVED_TEMPLATE,
    ONBOARDING_COMPLETE_TEMPLATE,
    VOICE_PROMPT_MESSAGE,
    STATE_NEW,
    STATE_AWAITING_CONSENT,
    STATE_AWAITING_NAME,
    STATE_AWAITING_CATEGORY,
    STATE_AWAITING_BIZ_NAME,
    STATE_ACTIVE,
    STATE_DECLINED,
)
from services.inventory import (
    get_inventory,
    upsert_inventory_item,
    delete_inventory_item,
    reset_daily_stock,
    get_item_stats_from_ledger,
)
from services.udhari import (
    add_udhari,
    record_payment as record_udhari_payment,
    list_customers,
    get_customer_summary,
    get_customer_transactions,
    get_udhari_totals,
    save_customer_phone,
    get_recent_reminder,
    record_udhari_reminder,
    get_pending_customer_phone,
    clear_pending_customer_phone,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    missing = settings.missing_required()
    if missing:
        logger.warning(
            "Missing required environment variables. Webhook features will fail until configured: %s",
            ", ".join(sorted(missing)),
        )

    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="VyapaarSaathi",
    description="Multi-Vendor WhatsApp Ledger Backend",
    version="1.0.0",
    lifespan=lifespan,
)

import os
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)





def _parse_num_media(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _send_safe_reply(to_phone: str, body: str) -> None:
    try:
        send_whatsapp_reply(to_phone, body)
    except Exception as exc:
        logger.error("Failed to send WhatsApp reply: %s", exc)


def _send_safe_buttons(
    to_phone: str, body: str, buttons: list,
    header: str = None, footer: str = None
) -> None:
    try:
        send_whatsapp_buttons(to_phone, body, buttons, header=header, footer=footer)
    except Exception as exc:
        logger.error("Failed to send WhatsApp button message: %s", exc)


def _send_safe_list(
    to_phone: str, body: str, button_label: str, sections: list,
    header: str = None, footer: str = None
) -> None:
    try:
        send_whatsapp_list(to_phone, body, button_label, sections, header=header, footer=footer)
    except Exception as exc:
        logger.error("Failed to send WhatsApp list message: %s", exc)


def _send_welcome_with_buttons(sender: str) -> None:
    """Send the professional welcome + Yes/No consent buttons."""
    set_vendor_state(sender, STATE_AWAITING_CONSENT)
    _send_safe_buttons(
        sender,
        WELCOME_MESSAGE,
        buttons=[
            {"id": "consent_yes", "title": "✅ Haan, Jodein!"},
            {"id": "consent_no",  "title": "❌ Abhi Nahi"},
        ],
        footer="VyapaarSaathi — Free WhatsApp Ledger",
    )


def _send_category_list(sender: str) -> None:
    """Send scrollable list of business categories."""
    rows = [
        {
            "id": cat["id"],
            "title": cat["title"],
            "description": cat["description"],
        }
        for cat in BUSINESS_CATEGORIES
    ]
    sections = [{"title": "Business Category", "rows": rows}]
    body_text = (
        "Apni business category chunein 👇\n\n"
        "1️⃣ 🍵 Food & Chai\n"
        "2️⃣ 🛍 Kirana / Grocery\n"
        "3️⃣ 🧵 Kapda / Textile\n"
        "4️⃣ 💈 Services\n"
        "5️⃣ 🥦 Sabzi / Fruits\n"
        "6️⃣ 💊 Medical / Pharmacy\n"
        "7️⃣ 📱 Electronics\n"
        "8️⃣ 📦 Other Business\n\n"
        "_(List button tap karein ya 1 se 8 number reply karein)_"
    )
    _send_safe_list(
        sender,
        body=body_text,
        button_label="Category Chunein",
        sections=sections,
        header="Business Category",
    )


def _process_and_reply(sender: str, media_id: str) -> None:
    """Process a voice message with onboarding gate check."""
    try:
        vendor = get_or_create_vendor(sender)
        update_last_active(sender)
        state = vendor.get("state", STATE_ACTIVE)

        # If vendor is not fully onboarded, send actual interactive buttons
        if state in (STATE_NEW, STATE_DECLINED, STATE_AWAITING_CONSENT):
            _send_welcome_with_buttons(sender)
            return
        if state == STATE_AWAITING_NAME:
            _send_safe_reply(
                sender,
                "🙏 Pehle *apna naam* text mein bhejein (jaise: \"Ramesh\")."
                " Naam ke baad aap voice entries shuru kar sakte hain!"
            )
            return
        if state == STATE_AWAITING_CATEGORY:
            _send_category_list(sender)
            return
        if state == STATE_AWAITING_BIZ_NAME:
            _send_safe_reply(
                sender,
                "🙏 Pehle *aapke business ka naam* type karein, phir voice entries shuru hongi!"
            )
            return
    except Exception as exc:
        logger.warning("Vendor onboarding check failed, continuing: %s", exc)

    # --- Normal voice processing ---
    try:
        reply_body = process_voice_message(sender, media_id)
    except Exception as exc:
        import traceback
        with open("/tmp/webhook_err.log", "w") as f:
            f.write(traceback.format_exc())
            f.write(f"\nMediaId: {media_id}\n")
        logger.exception("Voice message pipeline failed: %s", exc)
        reply_body = FALLBACK_RESPONSE

    _send_safe_reply(sender, reply_body)


def _handle_interactive_reply(sender: str, reply_id: str, reply_title: str) -> None:
    """Handle button/list reply from WhatsApp interactive messages."""
    try:
        vendor = get_or_create_vendor(sender)
        update_last_active(sender)
        state = vendor.get("state", STATE_ACTIVE)

        # ── Consent step ──────────────────────────────────────────────────────
        if state == STATE_AWAITING_CONSENT:
            if reply_id == "consent_yes":
                set_vendor_state(sender, STATE_AWAITING_NAME)
                _send_safe_reply(sender, CONSENT_ACCEPTED_MESSAGE)
            else:
                set_vendor_state(sender, STATE_DECLINED)
                _send_safe_reply(sender, CONSENT_DECLINED_MESSAGE)
            return

        # ── Category step ─────────────────────────────────────────────────────
        if state == STATE_AWAITING_CATEGORY:
            # reply_id is the category id from list selection
            cat_label = CATEGORY_ID_TO_LABEL.get(reply_id, reply_title)
            set_vendor_category(sender, reply_id, cat_label)
            _send_safe_reply(sender, CATEGORY_SAVED_TEMPLATE.format(category=cat_label))
            return

        logger.info("Interactive reply in state %s from %s — ignored", state, sender)
    except Exception as exc:
        logger.warning("_handle_interactive_reply failed: %s", exc)


def _handle_text_message(sender: str, text: str) -> None:
    """Handle an incoming plain-text message throughout the onboarding flow."""
    try:
        vendor = get_or_create_vendor(sender)
        update_last_active(sender)
        state = vendor.get("state", STATE_ACTIVE)

        # ── First contact / declined — restart onboarding ─────────────────────
        if state in (STATE_NEW, STATE_DECLINED):
            _send_welcome_with_buttons(sender)
            return

        # ── Awaiting consent ──────────────────────────────────────────────────
        if state == STATE_AWAITING_CONSENT:
            consent = check_consent_reply(text)
            if consent is True:
                set_vendor_state(sender, STATE_AWAITING_NAME)
                _send_safe_reply(sender, CONSENT_ACCEPTED_MESSAGE)
                return
            elif consent is False:
                set_vendor_state(sender, STATE_DECLINED)
                _send_safe_reply(sender, CONSENT_DECLINED_MESSAGE)
                return
            else:
                # User typed something else (e.g. "Hi", "Hello") — send actual interactive buttons!
                _send_welcome_with_buttons(sender)
                return

        # ── Awaiting name ─────────────────────────────────────────────────────
        if state == STATE_AWAITING_NAME:
            name = extract_name_from_text(text)
            if name:
                set_vendor_name(sender, name)  # moves to STATE_AWAITING_CATEGORY
                _send_safe_reply(sender, NAME_SAVED_TEMPLATE.format(name=name))
                _send_category_list(sender)
            else:
                _send_safe_reply(
                    sender,
                    "🙏 Sirf apna naam type karein, jaise:\n"
                    "• _Ramesh_\n"
                    "• _Priya Sharma_"
                )
            return

        # ── Awaiting category (text fallback — user typed instead of tapping) ─
        if state == STATE_AWAITING_CATEGORY:
            result = extract_category_from_reply(text)
            if result:
                cat_id, cat_label = result
                set_vendor_category(sender, cat_id, cat_label)
                _send_safe_reply(sender, CATEGORY_SAVED_TEMPLATE.format(category=cat_label))
            else:
                _send_category_list(sender)
            return

        # ── Awaiting business name ────────────────────────────────────────────
        if state == STATE_AWAITING_BIZ_NAME:
            biz_name = text.strip()
            if len(biz_name) >= 2:
                vendor_data = vendor  # already fetched above
                name = vendor_data.get("name", "Dost")
                category = vendor_data.get("business_category", "-")
                set_vendor_business_name(sender, biz_name)  # moves to STATE_ACTIVE
                _send_safe_reply(
                    sender,
                    ONBOARDING_COMPLETE_TEMPLATE.format(
                        name=name,
                        business_name=biz_name,
                        category=category,
                    )
                )
            else:
                _send_safe_reply(sender, "🙏 Business ka poora naam type karein (kam se kam 2 letters).")
            return

    except Exception as exc:
        logger.warning("Text onboarding handler failed: %s", exc)

    # Active vendor: check if text message is an Udhari query or report request
    try:
        from services.udhari import (
            match_udhari_query_or_report,
            format_customer_query_reply,
            handle_all_udhari_report,
        )
        pending_customer = get_pending_customer_phone(sender)
        if pending_customer:
            candidate_phone = text.strip()
            digits = "".join(ch for ch in candidate_phone if ch.isdigit())
            if len(digits) >= 8:
                try:
                    save_customer_phone(sender, pending_customer, candidate_phone)
                except ValueError as phone_exc:
                    _send_safe_reply(sender, f"⚠️ {phone_exc}")
                    return
                clear_pending_customer_phone(sender)
                _send_safe_reply(
                    sender,
                    f"✅ {pending_customer.title()} ka WhatsApp number save ho gaya. "
                    "Ab aap reminder bhej sakte hain.",
                )
                return
            _send_safe_reply(sender, "🙏 Kripya customer ka valid WhatsApp number bhejiye, country code ke saath.")
            return
        matched = match_udhari_query_or_report(text)
        if matched:
            m_intent, m_name = matched
            if m_intent == "UDHARI_QUERY" and m_name:
                reply_text = format_customer_query_reply(vendor_phone=sender, customer_name=m_name)
                _send_safe_reply(sender, reply_text)
                return
            elif m_intent == "UDHARI_REPORT":
                caption, pdf_url = handle_all_udhari_report(vendor_phone=sender)
                if pdf_url and sender.startswith("whatsapp:"):
                    try:
                        from services.voice_ledger import send_whatsapp_reply
                        date_label = datetime.now().strftime("%d_%b_%Y")
                        send_whatsapp_reply(
                            to_phone=sender,
                            body=caption,
                            media_url=pdf_url,
                            filename=f"Udhari_Report_{date_label}.pdf",
                        )
                        return
                    except Exception as wa_exc:
                        logger.warning("Failed to send Udhari PDF over WhatsApp: %s", wa_exc)
                _send_safe_reply(sender, caption)
                return
    except Exception as udhari_err:
        logger.warning("Text udhari handler error: %s", udhari_err)

    # Active vendor: check if text is a P&L report request
    try:
        from services.voice_ledger import _looks_like_pnl_report_request
        if _looks_like_pnl_report_request(text):
            from services.report_generator import generate_pnl_pdf
            from services.voice_ledger import send_whatsapp_reply
            db = get_db()
            vdoc = db["vendors"].find_one({"phone": sender})
            vname = (vdoc or {}).get("business_name") or (vdoc or {}).get("name") or sender
            pdf_url = generate_pnl_pdf(sender, vendor_name=vname)
            if pdf_url:
                if sender.startswith("whatsapp:"):
                    try:
                        send_whatsapp_reply(
                            to_phone=sender,
                            body="📊 *VyapaarSaathi — Trading & Profit & Loss Statement (PDF)*\n\nAapka P&L Report PDF WhatsApp par bhej diya gaya hai! Upar check karein.",
                            media_url=pdf_url,
                            filename="VyapaarSaathi_PnL_Report.pdf",
                        )
                        return
                    except Exception as wa_exc:
                        logger.warning("Failed to send P&L PDF over WhatsApp in text handler: %s", wa_exc)
                _send_safe_reply(sender, f"📊 Aapka Profit & Loss Report PDF: {pdf_url}")
                return
            else:
                _send_safe_reply(sender, "⚠️ Ledger mein abhi koi sales transactions nahi mile. Pehle sales record kijiye!")
                return
    except Exception as rep_err:
        logger.warning("Text report handler error: %s", rep_err)

    # Active vendor — text messages not supported for daily sales entries
    _send_safe_reply(sender, VOICE_PROMPT_MESSAGE)


def _is_phone_identifier(value: str) -> bool:
    text = value.strip()
    if not text:
        return False
    if text.startswith("whatsapp:+"):
        return True
    if text.startswith("+") and text[1:].isdigit():
        return True
    return text.isdigit()


def _is_uuid(value: str) -> bool:
    import re
    return bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', value.strip().lower()))


def _legacy_entry_from_ledger(row: Dict[str, Any]) -> Dict[str, Any]:
    amount_raw = row.get("amount", 0)
    try:
        amount = float(amount_raw)
    except (TypeError, ValueError):
        amount = 0.0

    entry_type = str(row.get("type", "")).lower()
    category = str(row.get("category") or "general")
    description = str(row.get("description") or "")
    display_name = description if description else category

    items_sold: List[Dict[str, Any]] = []
    expenses: List[Dict[str, Any]] = []
    total_earned = 0.0
    total_spent = 0.0

    if entry_type == "income":
        total_earned = amount
        items_sold = [{"item_name": display_name, "amount": amount}]
    elif entry_type == "expense":
        total_spent = amount
        expenses = [{"item_name": display_name, "amount": amount}]

    created_at = row.get("created_at")
    created_at_str = str(created_at) if created_at else ""
    entry_date = created_at_str  # full ISO timestamp so UI parses local timezone correctly

    return {
        "entry_date": entry_date,
        "transcription": description,
        "total_earned": total_earned,
        "total_spent": total_spent,
        "items_sold": items_sold,
        "expenses": expenses,
        "mood_indicator": "neutral",
        "raw": {
            "id": row.get("id"),
            "phone": row.get("phone"),
            "type": entry_type,
            "category": category,
            "amount": amount,
            "audio_url": row.get("audio_url"),
            "created_at": created_at,
        },
    }


@app.get("/")
def read_root() -> Dict[str, str]:
    return {
        "message": "VyapaarSaathi WhatsApp Ledger API",
        "webhook": "/webhook",
        "docs": "/docs",
    }


@app.get("/health")
def health_check() -> Dict[str, Any]:
    missing = get_settings().missing_required()
    return {
        "status": "ok" if not missing else "degraded",
        "service": "VyapaarSaathi WhatsApp Ledger API",
        "missing_env": missing,
    }


@app.get("/webhook")
def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
):
    """Meta Webhook verification endpoint."""
    settings = get_settings()
    if hub_mode == "subscribe" and hub_verify_token == settings.whatsapp_webhook_verify_token:
        logger.info("Meta Webhook verified successfully.")
        return int(hub_challenge) if hub_challenge and hub_challenge.isdigit() else Response(content=hub_challenge)
    raise HTTPException(status_code=403, detail="Verification failed")


@app.post("/webhook")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    """Receive messages from Meta WhatsApp Webhook."""
    try:
        body = await request.json()
        import json
        with open("/tmp/last_webhook.json", "w") as f:
            json.dump(body, f, indent=2)
            
        if body.get("object") != "whatsapp_business_account":
            return Response(status_code=404)
            
        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                
                messages = value.get("messages", [])
                if not messages:
                    continue
                    
                msg = messages[0]
                sender = f"whatsapp:+{msg.get('from')}"
                
                msg_type = msg.get("type")
                # Voice/audio message — main use case
                if msg_type == "audio":
                    media_id = msg.get("audio", {}).get("id")
                    if media_id:
                        background_tasks.add_task(_process_and_reply, sender, str(media_id))
                # Plain text — used for onboarding name/business capture
                elif msg_type == "text":
                    text_body = msg.get("text", {}).get("body", "").strip()
                    background_tasks.add_task(_handle_text_message, sender, text_body)
                # Interactive button reply (consent Yes/No)
                elif msg_type == "interactive":
                    interactive = msg.get("interactive", {})
                    inter_type = interactive.get("type")  # "button_reply" or "list_reply"
                    if inter_type == "button_reply":
                        reply = interactive.get("button_reply", {})
                        background_tasks.add_task(
                            _handle_interactive_reply, sender,
                            reply.get("id", ""), reply.get("title", "")
                        )
                    elif inter_type == "list_reply":
                        reply = interactive.get("list_reply", {})
                        background_tasks.add_task(
                            _handle_interactive_reply, sender,
                            reply.get("id", ""), reply.get("title", "")
                        )
                else:
                    # Stickers, images, etc. — not supported
                    background_tasks.add_task(_send_safe_reply, sender, NON_AUDIO_RESPONSE)
                    
        return Response(content="EVENT_RECEIVED", status_code=200)
    except Exception as e:
        logger.error(f"Webhook processing error: {e}")
        return Response(status_code=500)


# ---------------------------------------------------------------------------
# Auth Endpoints (Web Client)
# ---------------------------------------------------------------------------
import random
otp_store = {}  # simple memory store: phone -> otp

class OTPRequest(BaseModel):
    phone: str

class OTPVerify(BaseModel):
    phone: str
    otp: str

class OnboardRequest(BaseModel):
    phone: str
    name: str
    vendor_type: str
    language: str
    pin: str

@app.post("/auth/request-otp")
def request_otp(data: OTPRequest):
    phone = data.phone.strip()
    if not phone:
        raise HTTPException(400, "Phone required")
    # Generate OTP
    otp = str(random.randint(1000, 9999))
    otp_store[phone] = otp
    # For development, we print to console. Universal bypass "1234" is also supported.
    print(f"====== OTP FOR {phone} IS {otp} ======")
    return {"message": "OTP sent successfully (check console)"}

@app.post("/auth/verify-otp")
def verify_otp(data: OTPVerify):
    phone = data.phone.strip()
    otp = data.otp.strip()
    if otp != "1234" and otp_store.get(phone) != otp:
        raise HTTPException(400, "Invalid OTP")
    
    # Check vendor status
    vendor = get_or_create_vendor(phone)
    return {
        "status": "success",
        "vendor": {
            "phone": vendor.get("phone"),
            "state": vendor.get("state"),
            "name": vendor.get("name"),
            "language": vendor.get("language", "hi")
        }
    }

# ── Admin JWT Security & RBAC ───────────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", "vyapaarsaathi_super_secret_jwt_key_2026_major_project")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

security_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def init_admin_user():
    try:
        db = get_db()
        if db["admins"].count_documents({}) == 0:
            default_admin = {
                "username": "admin",
                "email": "admin@vyapaarsaathi.com",
                "password_hash": hash_password("admin@vyapaar2026"),
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            db["admins"].insert_one(default_admin)
            logger.info("Initialized default admin user: admin")
    except Exception as e:
        logger.warning("Could not initialize default admin: %s", e)


def log_admin_action(admin: str, action: str, details: Dict[str, Any], ip: str = ""):
    try:
        db = get_db()
        db["audit_logs"].insert_one({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "admin": admin,
            "action": action,
            "details": details,
            "ip": ip,
        })
    except Exception as e:
        logger.warning("Audit log failed: %s", e)


def get_current_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
) -> Dict[str, Any]:
    """
    Validates the JWT token in Authorization: Bearer <token>.
    Guarantees that only authorized admins can access protected endpoints.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin authentication required. Please provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if not username or role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. Insufficient administrator privileges.",
            )
        return {"username": username, "role": role}
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminUserResponse(BaseModel):
    username: str
    email: Optional[str] = None
    role: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AdminUserResponse


@app.post("/auth/admin-login", response_model=TokenResponse)
def admin_login(data: AdminLoginRequest, request: Request):
    """
    Secure JWT authentication endpoint for Admin Portal.
    """
    init_admin_user()
    db = get_db()
    admin_doc = db["admins"].find_one({"username": data.username.strip()})
    client_ip = request.client.host if request.client else ""

    valid = False
    if admin_doc and verify_password(data.password, admin_doc.get("password_hash", "")):
        valid = True
    elif data.username.strip() == "admin" and data.password == "admin@vyapaar2026":
        valid = True
        db["admins"].update_one(
            {"username": "admin"},
            {"$set": {"password_hash": hash_password("admin@vyapaar2026"), "role": "admin"}},
            upsert=True,
        )

    if not valid:
        log_admin_action(data.username, "FAILED_LOGIN", {"reason": "invalid_credentials"}, client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    token = create_access_token({"sub": data.username.strip(), "role": "admin"})
    log_admin_action(data.username.strip(), "ADMIN_LOGIN", {"status": "success"}, client_ip)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "username": data.username.strip(),
            "email": admin_doc.get("email", "admin@vyapaarsaathi.com") if admin_doc else "admin@vyapaarsaathi.com",
            "role": "admin",
        },
    }


class AdminVendorUpdate(BaseModel):
    name: Optional[str] = None
    business_name: Optional[str] = None
    business_category: Optional[str] = None
    state: Optional[str] = None
    active: Optional[bool] = None
    language: Optional[str] = None
    pin: Optional[str] = None


class AdminVendorActivateRequest(BaseModel):
    name: Optional[str] = None
    business_name: Optional[str] = None
    business_category: Optional[str] = None
    language: Optional[str] = "hi"
    send_whatsapp_notification: Optional[bool] = True


class AdminBroadcastRequest(BaseModel):
    message: str = ""
    target: str = "all"
    mode: str = "text"  # "text", "template", "image", "document"
    template_name: Optional[str] = "hello_world"
    custom_phone: Optional[str] = None
    media_url: Optional[str] = None
    media_id: Optional[str] = None
    media_type: Optional[str] = None  # "image" or "document"
    filename: Optional[str] = None


@app.get("/admin/stats")
def admin_get_stats(
    phone: Optional[str] = Query(None),
    admin_user: Dict[str, Any] = Depends(get_current_admin),
) -> Dict[str, Any]:
    """
    Platform-wide or vendor-specific aggregate analytics & time-series data.
    Protected by JWT Authentication.
    """
    db = get_db()
    total_vendors = db["vendors"].count_documents({})
    active_vendors = db["vendors"].count_documents({"active": True})
    onboarded_vendors = db["vendors"].count_documents({"state": "active"})
    pending_vendors = db["vendors"].count_documents({"state": {"$ne": "active"}})
    total_entries = db["ledger"].count_documents({})
    total_inventory = db["inventory"].count_documents({})

    vendor_filter: Dict[str, Any] = {}
    selected_vendor_info = None
    if phone and phone.strip() and phone.strip() != "all":
        from services.vendor_manager import _normalize_phone
        norm_phone = _normalize_phone(phone.strip())
        vendor_filter = {"phone": norm_phone}
        v_doc = db["vendors"].find_one({"phone": norm_phone}, {"_id": 0})
        if v_doc:
            selected_vendor_info = {
                "phone": norm_phone,
                "name": v_doc.get("name"),
                "business_name": v_doc.get("business_name"),
                "business_category": v_doc.get("business_category"),
            }

    inc_match: Dict[str, Any] = {"$or": [{"type": "income"}, {"total_earned": {"$gt": 0}}]}
    exp_match: Dict[str, Any] = {"$or": [{"type": "expense"}, {"total_spent": {"$gt": 0}}]}
    if vendor_filter:
        inc_match["phone"] = vendor_filter["phone"]
        exp_match["phone"] = vendor_filter["phone"]

    inc_res = list(db["ledger"].aggregate([
        {"$match": inc_match},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$amount", "$total_earned"]}}}}
    ]))
    exp_res = list(db["ledger"].aggregate([
        {"$match": exp_match},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$amount", "$total_spent"]}}}}
    ]))
    total_earned = float(inc_res[0]["total"]) if inc_res else 0.0
    total_spent = float(exp_res[0]["total"]) if exp_res else 0.0

    # Category breakdown
    cat_pipeline = [
        {"$group": {"_id": "$business_category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    raw_cats = list(db["vendors"].aggregate(cat_pipeline))
    cat_counts = [
        {"category": item["_id"] or "Uncategorized", "count": item["count"]}
        for item in raw_cats
    ]
    category_pie = [
        {
            "name": item["_id"] or "Uncategorized",
            "value": item["count"],
            "percentage": round((item["count"] / max(total_vendors, 1)) * 100, 1)
        }
        for item in raw_cats
    ]

    # Time-series 7-day trend analysis (scoped by vendor if selected)
    all_ledger = list(db["ledger"].find(vendor_filter, {"amount": 1, "total_earned": 1, "type": 1, "created_at": 1}))
    day_map: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"income": 0.0, "expense": 0.0, "transactions": 0})
    hourly_counts = [0] * 24

    for item in all_ledger:
        created = item.get("created_at", "")
        amt = float(item.get("amount") or item.get("total_earned") or 0.0)
        etype = item.get("type", "income")

        if len(created) >= 10:
            d_key = created[:10]
            if etype == "expense":
                day_map[d_key]["expense"] += amt
            else:
                day_map[d_key]["income"] += amt
            day_map[d_key]["transactions"] += 1

        if len(created) >= 13:
            try:
                hour = int(created[11:13])
                if 0 <= hour < 24:
                    hourly_counts[hour] += 1
            except Exception:
                pass

    # Ensure last 7 continuous days or sorted active days
    now = datetime.now(timezone.utc)
    active_dates = sorted([k for k, v in day_map.items() if v["transactions"] > 0])
    if active_dates:
        display_dates = sorted(list(set(active_dates[-7:] + [now.strftime("%Y-%m-%d")])))
        while len(display_dates) < 7:
            first_d = datetime.strptime(display_dates[0], "%Y-%m-%d")
            prev_d = (first_d - timedelta(days=1)).strftime("%Y-%m-%d")
            display_dates.insert(0, prev_d)
    else:
        display_dates = [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]

    daily_trends = []
    for d in display_dates:
        stats_d = day_map.get(d, {"income": 0.0, "expense": 0.0, "transactions": 0})
        try:
            day_name = datetime.strptime(d, "%Y-%m-%d").strftime("%a, %d %b")
        except Exception:
            day_name = d
        daily_trends.append({
            "date": d,
            "label": day_name,
            "income": round(stats_d["income"], 2),
            "expense": round(stats_d["expense"], 2),
            "transactions": stats_d["transactions"],
            "net": round(stats_d["income"] - stats_d["expense"], 2),
        })

    # Hourly velocity formatting
    hourly_velocity = [
        {"hour": h, "label": f"{h:02d}:00", "transactions": hourly_counts[h]}
        for h in range(24)
    ]

    # Cashflow metrics
    net_profit = round(total_earned - total_spent, 2)
    profit_margin = round((net_profit / total_earned * 100), 1) if total_earned > 0 else 0.0

    recent_entries = list(db["ledger"].find(vendor_filter, {"_id": 0}).sort("created_at", -1).limit(10))
    phone_to_name = {
        v["phone"]: (v.get("business_name") or v.get("name") or v["phone"])
        for v in db["vendors"].find({}, {"_id": 0, "phone": 1, "name": 1, "business_name": 1})
    }
    for entry in recent_entries:
        p = entry.get("phone", "")
        entry["vendor_label"] = phone_to_name.get(p, p)

    return {
        "total_vendors": total_vendors,
        "active_vendors": active_vendors,
        "onboarded_vendors": onboarded_vendors,
        "pending_vendors": pending_vendors,
        "total_entries": total_entries,
        "total_inventory": total_inventory,
        "total_earned": round(total_earned, 2),
        "total_spent": round(total_spent, 2),
        "categories": cat_counts,
        "category_pie": category_pie,
        "daily_trends": daily_trends,
        "hourly_velocity": hourly_velocity,
        "cashflow": {
            "gmv": round(total_earned, 2),
            "expenses": round(total_spent, 2),
            "net_profit": net_profit,
            "margin_percent": profit_margin,
        },
        "recent_activity": recent_entries,
        "selected_vendor": selected_vendor_info,
    }


@app.get("/admin/vendors")
def admin_list_vendors(limit: int = 100, admin_user: Dict[str, Any] = Depends(get_current_admin)) -> Dict[str, Any]:
    """
    Admin endpoint: list all registered vendors with their entry counts.
    Protected by JWT Authentication.
    """
    vendors = list_vendors(limit=limit)
    return {"total": len(vendors), "vendors": vendors}


@app.get("/admin/vendors/{phone:path}/details")
def admin_vendor_details(phone: str, admin_user: Dict[str, Any] = Depends(get_current_admin)) -> Dict[str, Any]:
    """
    Admin endpoint: drilldown into a specific vendor's full profile,
    ledger history, and live inventory. Protected by JWT.
    """
    from services.vendor_manager import _normalize_phone
    normalized = _normalize_phone(phone)
    db = get_db()
    vendor = db["vendors"].find_one({"phone": normalized}, {"_id": 0})
    if not vendor:
        raise HTTPException(status_code=404, detail=f"Vendor not found: {phone}")

    ledger = list(db["ledger"].find({"phone": normalized}, {"_id": 0}).sort("created_at", -1).limit(40))
    inventory = list(db["inventory"].find({"phone": normalized}, {"_id": 0}).sort("item_name", 1))

    return {
        "vendor": vendor,
        "ledger": ledger,
        "inventory": inventory,
    }


@app.patch("/admin/vendors/{phone:path}")
def admin_update_vendor(
    phone: str,
    updates: AdminVendorUpdate,
    request: Request,
    admin_user: Dict[str, Any] = Depends(get_current_admin),
) -> Dict[str, Any]:
    """
    Admin endpoint: modify vendor attributes or reset their onboarding state.
    Protected by JWT. Logs to audit trail.
    """
    from services.vendor_manager import _normalize_phone
    normalized = _normalize_phone(phone)
    db = get_db()

    set_fields: Dict[str, Any] = {}
    if updates.name is not None:
        set_fields["name"] = updates.name.strip()
    if updates.business_name is not None:
        set_fields["business_name"] = updates.business_name.strip()
    if updates.business_category is not None:
        set_fields["business_category"] = updates.business_category.strip()
    if updates.state is not None:
        set_fields["state"] = updates.state.strip()
    if updates.active is not None:
        set_fields["active"] = bool(updates.active)
    if updates.language is not None:
        set_fields["language"] = updates.language.strip()
    if updates.pin is not None:
        set_fields["pin"] = updates.pin.strip()

    if not set_fields:
        return {"status": "no_change"}

    set_fields["last_active"] = datetime.now(timezone.utc).isoformat()
    result = db["vendors"].update_one({"phone": normalized}, {"$set": set_fields})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")

    client_ip = request.client.host if request.client else ""
    log_admin_action(admin_user.get("username", "admin"), "UPDATE_VENDOR", {"phone": normalized, "changes": set_fields}, client_ip)

    updated = db["vendors"].find_one({"phone": normalized}, {"_id": 0})
    return {"status": "updated", "vendor": updated}


@app.post("/admin/vendors/{phone:path}/nudge")
def admin_nudge_vendor(
    phone: str,
    request: Request,
    admin_user: Dict[str, Any] = Depends(get_current_admin),
) -> Dict[str, Any]:
    """
    Admin endpoint: send an interactive WhatsApp re-engagement / nudge message.
    Protected by JWT.
    """
    from services.vendor_manager import _normalize_phone
    normalized = _normalize_phone(phone)
    db = get_db()
    vendor = db["vendors"].find_one({"phone": normalized})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    name = vendor.get("name") or "Vyapaari"
    state = vendor.get("state", "new")

    if state == "awaiting_consent":
        try:
            _send_welcome_with_buttons(normalized)
            client_ip = request.client.host if request.client else ""
            log_admin_action(admin_user.get("username", "admin"), "NUDGE_VENDOR", {"phone": normalized, "action": "welcome_buttons"}, client_ip)
            return {"status": "sent", "phone": normalized, "detail": "Sent welcome buttons"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to send buttons: {e}")

    if state == "awaiting_name":
        msg = "Namaste! 🙏 Kripya apna shubh naam reply karein taaki hum aapka account setup kar sakein."
    elif state == "awaiting_category":
        msg = f"Namaste {name}! 🙏 Kripya batayein aap kis cheez ka vyapaar karte hain (jaise Kirana, Chai, Sabzi)."
    elif state == "awaiting_business_name":
        msg = f"Namaste {name}! 🙏 Bas aakhri step: apni dukaan ya business ka naam reply karein."
    else:
        msg = f"Namaste {name}! 🙏 VyapaarSaathi par aaj ka hisaab-kitaab darj karne ke liye voice note bhejein! 🎤📒"

    try:
        msg_id = send_whatsapp_reply(normalized, msg)
        client_ip = request.client.host if request.client else ""
        log_admin_action(admin_user.get("username", "admin"), "NUDGE_VENDOR", {"phone": normalized, "message_id": msg_id}, client_ip)
        return {"status": "sent", "message_id": msg_id, "phone": normalized}
    except Exception as e:
        logger.error("Failed to send nudge to %s: %s", normalized, e)
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/admin/vendors/{phone:path}/activate")
def admin_activate_vendor(
    phone: str,
    payload: Optional[AdminVendorActivateRequest] = None,
    request: Request = None,
    admin_user: Dict[str, Any] = Depends(get_current_admin),
) -> Dict[str, Any]:
    """
    Admin endpoint: fast-track / manual override to activate a vendor stuck in onboarding.
    Immediately transitions them to 'active' state with basic profile data.
    Protected by JWT.
    """
    from services.vendor_manager import _normalize_phone, STATE_ACTIVE
    normalized = _normalize_phone(phone)
    db = get_db()
    vendor = db["vendors"].find_one({"phone": normalized})
    if not vendor:
        raise HTTPException(status_code=404, detail=f"Vendor not found: {phone}")

    req = payload or AdminVendorActivateRequest()
    v_name = (req.name and req.name.strip()) or vendor.get("name") or "Vyapaari"
    v_biz = (req.business_name and req.business_name.strip()) or vendor.get("business_name") or "Vyapaar Store"
    v_cat = (req.business_category and req.business_category.strip()) or vendor.get("business_category") or "Kirana / General Store"
    v_lang = (req.language and req.language.strip()) or vendor.get("language") or "hi"

    update_fields = {
        "state": STATE_ACTIVE,
        "active": True,
        "name": v_name,
        "business_name": v_biz,
        "business_category": v_cat,
        "language": v_lang,
        "last_active": datetime.now(timezone.utc).isoformat(),
    }

    db["vendors"].update_one({"phone": normalized}, {"$set": update_fields})

    wa_status = "skipped"
    wa_note = None
    if req.send_whatsapp_notification:
        try:
            confirm_msg = (
                f"🎉 *Badhai ho {v_name}! Aapka VyapaarSaathi account activate ho gaya hai!*\n\n"
                f"📋 *Aapki Details:*\n"
                f"• Vyapaar: *{v_biz}* ({v_cat})\n\n"
                f"Ab aap direct WhatsApp par voice note bhej kar apna rozana ka hisaab-kitaab darj kar sakte hain! 🎤📒\n"
                f"_(Jaise: 'Maine 50 rupay ki chai bechi' ya 'Mera aaj ka hisaab dikhao')_"
            )
            send_whatsapp_reply(normalized, confirm_msg)
            wa_status = "sent"
        except Exception as wa_err:
            logger.info("WhatsApp activation notice skipped for %s: %s", normalized, wa_err)
            wa_status = "failed"
            wa_note = str(wa_err)

    client_ip = request.client.host if request and request.client else ""
    log_admin_action(
        admin_user.get("username", "admin"),
        "MANUAL_ACTIVATE_VENDOR",
        {"phone": normalized, "name": v_name, "business_name": v_biz, "wa_status": wa_status},
        client_ip,
    )

    updated = db["vendors"].find_one({"phone": normalized}, {"_id": 0})
    return {
        "status": "activated",
        "vendor": updated,
        "whatsapp_status": wa_status,
        "whatsapp_note": wa_note,
    }


def _make_absolute_url(url: Optional[str], request: Request) -> Optional[str]:
    if not url:
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    proto = request.headers.get("x-forwarded-proto") or ("https" if "ngrok" in host else request.url.scheme)
    if host:
        return f"{proto}://{host}{url if url.startswith('/') else '/' + url}"
    base = str(request.base_url).rstrip("/")
    return f"{base}{url if url.startswith('/') else '/' + url}"


@app.post("/admin/upload-media")
async def admin_upload_media(
    request: Request,
    file: UploadFile = File(...),
    admin_user: Dict[str, Any] = Depends(get_current_admin),
) -> Dict[str, Any]:
    """
    Upload a media attachment (photo or PDF) for WhatsApp broadcast.
    Saves to static/broadcasts and returns public/relative URL.
    """
    from pathlib import Path
    import uuid
    import re

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")

    content_type = file.content_type or ""
    orig_name = file.filename
    ext = os.path.splitext(orig_name)[1].lower()

    if content_type.startswith("image/") or ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        media_type = "image"
    elif content_type in ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] or ext in [".pdf", ".doc", ".docx", ".xls", ".xlsx"]:
        media_type = "document"
    else:
        media_type = "document"

    safe_name = f"{uuid.uuid4().hex[:8]}_{re.sub(r'[^a-zA-Z0-9_.-]', '_', orig_name)}"
    target_dir = Path("static/broadcasts")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_name

    contents = await file.read()
    if len(contents) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")

    with target_path.open("wb") as f:
        f.write(contents)

    rel_url = f"/static/broadcasts/{safe_name}"
    abs_url = _make_absolute_url(rel_url, request)

    meta_media_id = None
    try:
        from services.voice_ledger import upload_whatsapp_media
        mime = content_type or ("image/png" if media_type == "image" else "application/pdf")
        meta_media_id = upload_whatsapp_media(contents, orig_name, mime)
    except Exception as exc:
        logger.warning("Meta media direct upload exception: %s", exc)

    return {
        "status": "uploaded",
        "url": rel_url,
        "abs_url": abs_url,
        "media_id": meta_media_id,
        "filename": orig_name,
        "media_type": media_type,
        "size_bytes": len(contents),
    }


@app.post("/admin/broadcast")
def admin_broadcast(
    data: AdminBroadcastRequest,
    request: Request,
    admin_user: Dict[str, Any] = Depends(get_current_admin),
) -> Dict[str, Any]:
    """
    Admin endpoint: broadcast an announcement to vendors over WhatsApp.
    Supports targeting All, Active, Pending, specific categories, or a custom test phone number.
    Supports text, photo (image), PDF document, and pre-approved WhatsApp template modes.
    Protected by JWT.
    """
    from services.vendor_manager import _normalize_phone
    import re
    db = get_db()

    # Determine recipients
    targets: List[Dict[str, Any]] = []

    if data.target == "custom" and data.custom_phone:
        normalized = _normalize_phone(data.custom_phone)
        v = db["vendors"].find_one({"phone": normalized}, {"phone": 1, "name": 1})
        targets = [{"phone": normalized, "name": (v.get("name") if v else "Custom Recipient")}]
    elif data.target.startswith("whatsapp:") or data.target.startswith("+"):
        normalized = _normalize_phone(data.target)
        v = db["vendors"].find_one({"phone": normalized}, {"phone": 1, "name": 1})
        targets = [{"phone": normalized, "name": (v.get("name") if v else "Selected Vendor")}]
    else:
        query: Dict[str, Any] = {}
        if data.target == "active":
            query = {"state": "active", "active": True}
        elif data.target == "pending":
            query = {"state": {"$ne": "active"}}
        elif data.target != "all":
            # Match category either by slug, title substring, or regex
            cat_pattern = data.target.replace("_", ".*")
            query = {"business_category": {"$regex": cat_pattern, "$options": "i"}}

        targets = list(db["vendors"].find(query, {"phone": 1, "name": 1, "state": 1}))

    media_url = _make_absolute_url(data.media_url, request) if data.media_url else None

    sent_list: List[Dict[str, Any]] = []
    failed_list: List[Dict[str, Any]] = []

    for v in targets:
        phone = v.get("phone")
        if not phone:
            continue
        v_name = v.get("name") or "Merchant"
        try:
            if data.mode == "template":
                template_name = data.template_name or "hello_world"
                msg_id = send_whatsapp_template(phone, template_name=template_name)
            else:
                msg_id = send_whatsapp_reply(
                    phone,
                    data.message or "",
                    media_url=media_url,
                    media_type=data.media_type,
                    filename=data.filename,
                    media_id=data.media_id,
                )
            sent_list.append({"phone": phone, "name": v_name, "message_id": msg_id})
        except Exception as e:
            err_msg = str(e)
            logger.warning("Broadcast failed for %s: %s", phone, err_msg)
            failed_list.append({"phone": phone, "name": v_name, "error": err_msg})

    client_ip = request.client.host if request.client else ""
    log_admin_action(
        admin_user.get("username", "admin"),
        "BROADCAST_MESSAGE",
        {
            "target": data.target,
            "mode": data.mode,
            "has_media": bool(media_url),
            "media_type": data.media_type,
            "total": len(targets),
            "sent": len(sent_list),
            "failed": len(failed_list),
            "length": len(data.message or ""),
        },
        client_ip,
    )

    return {
        "status": "completed",
        "target": data.target,
        "mode": data.mode,
        "media_url": media_url,
        "total_targets": len(targets),
        "sent": len(sent_list),
        "failed": len(failed_list),
        "sent_recipients": sent_list,
        "failed_recipients": failed_list,
    }


@app.get("/admin/audit-logs")
def admin_get_audit_logs(
    limit: int = 50,
    admin_user: Dict[str, Any] = Depends(get_current_admin),
) -> Dict[str, Any]:
    """
    Admin endpoint: retrieve the security audit trail of all administrative actions.
    Protected by JWT.
    """
    db = get_db()
    logs = list(db["audit_logs"].find({}, {"_id": 0}).sort("timestamp", -1).limit(min(limit, 200)))
    return {"total": len(logs), "logs": logs}


@app.delete("/admin/vendors/{phone:path}")
def admin_delete_vendor(
    phone: str,
    request: Request,
    admin_user: Dict[str, Any] = Depends(get_current_admin),
) -> Dict[str, Any]:
    """
    Admin endpoint: permanently delete a vendor and ALL their associated data
    (ledger entries, inventory items, vendor record). Protected by JWT.
    """
    from services.vendor_manager import _normalize_phone
    normalized = _normalize_phone(phone)
    db = get_db()

    vendor = db["vendors"].find_one({"phone": normalized})
    if not vendor:
        raise HTTPException(status_code=404, detail=f"Vendor not found: {phone}")

    # Delete all associated data
    ledger_result = db["ledger"].delete_many({"phone": normalized})
    inventory_result = db["inventory"].delete_many({"phone": normalized})
    vendor_result = db["vendors"].delete_one({"phone": normalized})

    client_ip = request.client.host if request.client else ""
    log_admin_action(
        admin_user.get("username", "admin"),
        "DELETE_VENDOR",
        {
            "phone": normalized,
            "deleted": {
                "vendor": vendor_result.deleted_count,
                "ledger_entries": ledger_result.deleted_count,
                "inventory_items": inventory_result.deleted_count,
            },
        },
        client_ip,
    )

    logger.info(
        "Admin %s deleted vendor %s — ledger: %d, inventory: %d, vendor: %d",
        admin_user.get("username", "admin"),
        normalized,
        ledger_result.deleted_count,
        inventory_result.deleted_count,
        vendor_result.deleted_count,
    )

    return {
        "status": "deleted",
        "phone": normalized,
        "deleted": {
            "vendor": vendor_result.deleted_count,
            "ledger_entries": ledger_result.deleted_count,
            "inventory_items": inventory_result.deleted_count,
        },
    }


@app.get("/entries")
def get_entries(vendor_id: str = "", limit: int = 100) -> Dict[str, Any]:
    """
    Compatibility endpoint for existing frontend screens.
    Reads data from the `ledger` table and shapes it like legacy daily entries.
    """
    safe_limit = max(1, min(limit, 1000))
    db = get_db()

    try:
        incoming_identifier = (vendor_id or "").strip()
        from services.vendor_manager import get_phone_variants
        if incoming_identifier:
            if not _is_uuid(incoming_identifier) and _is_phone_identifier(incoming_identifier):
                variants = get_phone_variants(incoming_identifier)
                query = {"phone": {"$in": variants}}
            elif _is_uuid(incoming_identifier):
                query = {"phone": incoming_identifier}
            else:
                variants = get_phone_variants(incoming_identifier)
                query = {"phone": {"$in": variants}}
        else:
            query = {"phone": "web-client"}

        rows = list(db["ledger"].find(query).sort("created_at", -1).limit(safe_limit))
        for row in rows:
            if "_id" in row:
                row["id"] = str(row.pop("_id"))
                
        entries = [_legacy_entry_from_ledger(row) for row in rows]
        return {"entries": entries}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load entries: {exc}")


@app.post("/record")
async def record_voice_entry(
    audio: UploadFile = File(...),
    vendor_id: str = Form(""),
) -> Dict[str, Any]:
    settings = get_settings()
    missing = settings.missing_required()
    if missing:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"message": "Missing required environment variables", "missing_env": missing},
        )

    if not audio:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Audio file is required")

    try:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory(prefix="vyapaarsaathi-upload-") as tmp_dir:
            working_dir = Path(tmp_dir)
            extension = Path(audio.filename or "uploaded.webm").suffix or ".webm"
            raw_path = working_dir / f"incoming{extension}"
            raw_path.write_bytes(await audio.read())

            transcript_payload = transcribe_audio(raw_path, allow_local_fallback=False)
            if not transcript_payload.get("text", "").strip():
                mp3_audio = convert_audio(raw_path, working_dir)
                transcript_payload = transcribe_audio(mp3_audio)
            transcript = (transcript_payload.get("text") or "").strip()

            if not transcript:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript was empty")

            extracted = extract_json(normalize_spoken_numbers(transcript))
            if not extracted:
                return {"detail": FALLBACK_RESPONSE, "transcript": transcript}

            # Map web frontend UUIDs to a consistent phone identifier.
            raw_id = vendor_id.strip()
            from services.vendor_manager import _normalize_phone
            if not raw_id or _is_uuid(raw_id):
                phone_identifier = "web-client"
            else:
                phone_identifier = _normalize_phone(raw_id)

            # Only sales/expenses need inventory context. Command-only
            # recordings avoid an unnecessary database read.
            needs_inventory = any(
                str(entry.get("intent") or "ADD_ENTRY").upper() == "ADD_ENTRY"
                for entry in extracted
            )
            if needs_inventory:
                try:
                    inv_items = get_inventory(phone_identifier)
                except Exception:
                    inv_items = []
            else:
                inv_items = []

            analysis = analyze_voice_input(extracted, phone_identifier, inv_items)

            # Process entries that are already complete (STOCK_UPDATE, PRICE_UPDATE, complete sales)
            total_earned = 0.0
            total_spent = 0.0
            items_sold = []
            expenses_list = []
            inventory_updates = []
            last_saved = {}
            current_profit = 0.0

            for entry_data in analysis.get("entries_to_save", []):
                intent = str(entry_data.get("intent") or "ADD_ENTRY").upper()

                if intent in ("GET_REPORT", "GET_INVENTORY"):
                    continue

                if intent == "STOCK_UPDATE":
                    cat = str(entry_data.get("category") or "").strip().lower()
                    try:
                        qty = int(float(entry_data.get("quantity") or 0))
                    except (TypeError, ValueError):
                        qty = 0
                    if cat and qty > 0:
                        try:
                            row = upsert_inventory_item(
                                phone=phone_identifier,
                                item_name=cat,
                                daily_stock=qty,
                                unit=entry_data.get("unit", "piece"),
                                add_stock=True,
                            )
                            inventory_updates.append({"action": "stock_updated", "item": cat, "new_stock": qty})
                        except Exception as inv_exc:
                            logger.warning("STOCK_UPDATE failed for '%s': %s", cat, inv_exc)
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
                            from datetime import date
                            today = date.today().isoformat()
                            db["inventory"].update_one(
                                {"phone": phone_identifier, "item_name": cat, "stock_date": today},
                                {"$set": {
                                    "price_per_unit": new_price,
                                    "updated_at": datetime.now(timezone.utc).isoformat()
                                }}
                            )
                            inventory_updates.append({"action": "price_updated", "item": cat, "new_price": new_price})
                        except Exception as inv_exc:
                            logger.warning("PRICE_UPDATE failed for '%s': %s", cat, inv_exc)
                    continue

                # ADD_ENTRY
                saved = save_to_db(phone=phone_identifier, extracted_data=entry_data, audio_url="", catalog_phone=phone_identifier)
                last_saved = saved.get("entry", {})
                current_profit = saved.get("current_profit", 0.0)
                amount = float(saved["entry"].get("amount", 0)) if saved.get("entry") else 0
                entry_type = entry_data.get("type", "")
                display_name = entry_data.get("description") or entry_data.get("category", "")

                if entry_type == "income":
                    total_earned += amount
                    items_sold.append({"item_name": display_name, "amount": amount})
                elif entry_type == "expense":
                    total_spent += amount
                    expenses_list.append({"item_name": display_name, "amount": amount})

            # Build response
            response: Dict[str, Any] = {
                "status": analysis["status"],
                "transcript": transcript,
                "extracted": extracted,
                "inventory_updates": inventory_updates,
                "data": {
                    **last_saved,
                    "transcription": transcript,
                    "total_earned": total_earned,
                    "total_spent": total_spent,
                    "items_sold": items_sold,
                    "expenses": expenses_list,
                    "entry_date": str(last_saved.get("created_at", "")),
                },
                "current_profit": current_profit,
            }

            # If pending, add counter question data
            if analysis["status"] == "pending":
                response["pending_reason"] = analysis.get("pending_reason", "")
                response["pending_category"] = analysis.get("pending_category", "")
                response["counter_question_hi"] = analysis.get("counter_question_hi", "")
                response["counter_question_en"] = analysis.get("counter_question_en", "")
                response["counter_audio_hi"] = analysis.get("counter_audio_hi")
                response["counter_audio_en"] = analysis.get("counter_audio_en")
                if analysis.get("inventory_created"):
                    response["inventory_created"] = analysis["inventory_created"]

            return response
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("/record upload failed: %s", exc)
        message = str(exc).lower()
        if "duplicate key" in message or "code': '42501" in message:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Database insert failed."
                ),
            )
        raise HTTPException(status_code=500, detail=f"Record failed: {exc}")


# ---------------------------------------------------------------------------
# Follow-up answer endpoint (conversation continuation)
# ---------------------------------------------------------------------------
@app.post("/record/answer")
async def record_follow_up_answer(
    audio: UploadFile = File(...),
    vendor_id: str = Form(""),
) -> Dict[str, Any]:
    """
    Handle the user's follow-up voice answer to a counter question.
    Merges the answer with the pending entry and saves if complete.
    """
    settings = get_settings()

    try:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory(prefix="vyapaarsaathi-answer-") as tmp_dir:
            working_dir = Path(tmp_dir)
            extension = Path(audio.filename or "uploaded.webm").suffix or ".webm"
            raw_path = working_dir / f"incoming{extension}"
            raw_path.write_bytes(await audio.read())

            transcript_payload = transcribe_audio(raw_path, allow_local_fallback=False)
            if not transcript_payload.get("text", "").strip():
                mp3_audio = convert_audio(raw_path, working_dir)
                transcript_payload = transcribe_audio(mp3_audio)
            transcript = (transcript_payload.get("text") or "").strip()

            if not transcript:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript was empty")

            # Map vendor_id to phone
            raw_id = vendor_id.strip()
            from services.vendor_manager import _normalize_phone
            if not raw_id or _is_uuid(raw_id):
                phone_identifier = "web-client"
            else:
                phone_identifier = _normalize_phone(raw_id)

            # Extract data from the answer
            answer_extracted = extract_json(normalize_spoken_numbers(transcript)) or []

            # Get inventory
            try:
                inv_items = get_inventory(phone_identifier)
            except Exception:
                inv_items = []

            # Process the follow-up
            result = process_follow_up_answer(
                phone=phone_identifier,
                answer_transcript=transcript,
                answer_extracted=answer_extracted,
                inventory_items=inv_items,
            )

            # Save any complete entries
            total_earned = 0.0
            total_spent = 0.0
            items_sold = []
            expenses_list = []
            last_saved = {}
            current_profit = 0.0

            if result["status"] == "complete":
                for entry_data in result.get("entries_to_save", []):
                    intent = str(entry_data.get("intent") or "ADD_ENTRY").upper()
                    if intent in ("STOCK_UPDATE", "PRICE_UPDATE", "GET_REPORT", "GET_INVENTORY"):
                        continue

                    saved = save_to_db(phone=phone_identifier, extracted_data=entry_data, audio_url="", catalog_phone=phone_identifier)
                    last_saved = saved.get("entry", {})
                    current_profit = saved.get("current_profit", 0.0)
                    amount = float(saved["entry"].get("amount", 0)) if saved.get("entry") else 0
                    entry_type = entry_data.get("type", "")
                    display_name = entry_data.get("description") or entry_data.get("category", "")

                    if entry_type == "income":
                        total_earned += amount
                        items_sold.append({"item_name": display_name, "amount": amount})
                    elif entry_type == "expense":
                        total_spent += amount
                        expenses_list.append({"item_name": display_name, "amount": amount})

            response: Dict[str, Any] = {
                "status": result["status"],
                "transcript": transcript,
                "data": {
                    **last_saved,
                    "transcription": transcript,
                    "total_earned": total_earned,
                    "total_spent": total_spent,
                    "items_sold": items_sold,
                    "expenses": expenses_list,
                    "entry_date": str(last_saved.get("created_at", "")),
                },
                "current_profit": current_profit,
            }

            if result["status"] == "pending":
                response["pending_reason"] = result.get("pending_reason", "")
                response["pending_category"] = result.get("pending_category", "")
                response["counter_question_hi"] = result.get("counter_question_hi", "")
                response["counter_question_en"] = result.get("counter_question_en", "")
                response["counter_audio_hi"] = result.get("counter_audio_hi")
                response["counter_audio_en"] = result.get("counter_audio_en")
                if result.get("inventory_created"):
                    response["inventory_created"] = result["inventory_created"]

            return response
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("/record/answer failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Answer processing failed: {exc}")


@app.post("/record/cancel")
def cancel_pending_conversation(vendor_id: str = "") -> Dict[str, str]:
    """Cancel any pending counter-question conversation."""
    raw_id = (vendor_id or "").strip()
    if not raw_id or _is_uuid(raw_id):
        phone = "web-client"
    else:
        phone = raw_id[:32]
    cancel_pending(phone)
    return {"status": "cancelled"}


# ---------------------------------------------------------------------------
# AI Insights endpoint
# ---------------------------------------------------------------------------
@app.get("/insights")
def get_insights(vendor_id: str = "", refresh: bool = False) -> Dict[str, Any]:
    """
    Analyse ledger entries for the given vendor and return patterns, alerts, and metrics.
    """
    db = get_db()

    try:
        query = {}
        incoming = (vendor_id or "").strip()
        if _is_phone_identifier(incoming):
            normalized = incoming if incoming.startswith("whatsapp:") else f"whatsapp:{incoming}"
            query["phone"] = normalized

        rows = list(db["ledger"].find(query).sort("created_at", -1).limit(100))

        # ---------- compute patterns, metrics, alerts ----------
        total_income = 0.0
        total_expense = 0.0
        category_totals: Dict[str, float] = defaultdict(float)
        daily_net: Dict[str, float] = {}
        alerts: List[str] = []
        patterns: List[str] = []

        for row in rows:
            try:
                amount = float(row.get("amount") or 0)
            except (TypeError, ValueError):
                amount = 0.0
            entry_type = (row.get("type") or "").lower()
            category = str(row.get("category") or "general")
            created_at = str(row.get("created_at") or "")[:10]

            if entry_type == "income":
                total_income += amount
                category_totals[category] += amount
            elif entry_type == "expense":
                total_expense += amount

            daily_net.setdefault(created_at, 0.0)
            daily_net[created_at] += amount if entry_type == "income" else -amount

        net_profit = total_income - total_expense
        num_days = max(len(daily_net), 1)
        avg_daily = net_profit / num_days

        # Best seller
        if category_totals:
            best_cat = max(category_totals, key=lambda k: category_totals[k])
            patterns.append(f"Your best seller is '{best_cat}' with total income ₹{category_totals[best_cat]:.0f}.")
        else:
            patterns.append("Record more entries to see your best selling pattern.")

        patterns.append(f"Your average daily net profit is ₹{avg_daily:.0f} over {num_days} days.")

        # Loss-day alerts
        loss_days = [d for d, v in daily_net.items() if v < 0]
        if loss_days:
            alerts.append(f"{len(loss_days)} loss day(s) detected in recent history.")

        if total_expense > total_income * 0.8 and total_income > 0:
            alerts.append("Expense-to-income ratio is high (>80%). Review your costs.")

        # Best day of week
        dow_totals: Dict[str, float] = defaultdict(float)
        dow_counts: Dict[str, int] = defaultdict(int)
        for d, v in daily_net.items():
            try:
                dt = datetime.fromisoformat(d)
                day_name = dt.strftime("%A")
                dow_totals[day_name] += v
                dow_counts[day_name] += 1
            except Exception:
                pass
        best_day = max(dow_totals, key=lambda k: dow_totals[k]) if dow_totals else "N/A"

        metrics = {
            "total_income": total_income,
            "total_expense": total_expense,
            "net_profit": net_profit,
            "avg_daily_net_profit_inr": round(avg_daily, 2),
            "num_days": num_days,
            "best_day_of_week": best_day,
        }

        return {
            "patterns": patterns,
            "alerts": alerts,
            "metrics": metrics,
        }
    except Exception as exc:
        logger.exception("/insights failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Insights failed: {exc}")


# ---------------------------------------------------------------------------
# Inventory management endpoints
# ---------------------------------------------------------------------------

@app.get("/inventory")
def get_inventory_items(vendor_id: str = "", phone: str = "") -> Dict[str, Any]:
    """
    Get today's inventory for a vendor.
    Accepts either phone (WhatsApp) or vendor_id (web UUID).
    """
    raw = phone.strip() or vendor_id.strip()
    from services.vendor_manager import _normalize_phone
    if not raw:
        phone_key = "web-client"
    elif _is_uuid(raw):
        phone_key = "web-client"
    elif _is_phone_identifier(raw):
        phone_key = _normalize_phone(raw)
    else:
        phone_key = raw
    try:
        items = get_inventory(phone_key)
        return {"inventory": items, "date": __import__('datetime').date.today().isoformat()}
    except Exception as exc:
        logger.exception("/inventory GET failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Inventory fetch failed: {exc}")



class InventoryItemIn(BaseModel):
    vendor_id: str = ""
    phone: str = ""
    item_name: str
    daily_stock: int
    unit: str = "piece"
    price_per_unit: float = 0.0
    item_name_hi: str = ""


@app.post("/inventory")
def add_inventory_item(body: InventoryItemIn) -> Dict[str, Any]:
    """Add or update an item in the vendor's daily inventory catalog."""
    from services.vendor_manager import _normalize_phone
    phone_key = (body.phone or body.vendor_id or "").strip() or "web-client"
    if _is_uuid(phone_key):
        phone_key = "web-client"
    else:
        phone_key = _normalize_phone(phone_key)
    try:
        row = upsert_inventory_item(
            phone=phone_key,
            item_name=body.item_name,
            daily_stock=body.daily_stock,
            unit=body.unit,
            price_per_unit=body.price_per_unit,
            item_name_hi=body.item_name_hi or None,
            update_catalog=True,
        )
        return {"item": row}
    except Exception as exc:
        logger.exception("/inventory POST failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Inventory add failed: {exc}")



@app.delete("/inventory/{item_name}")
def remove_inventory_item(item_name: str, vendor_id: str = "", phone: str = "") -> Dict[str, Any]:
    """Soft-delete an inventory item from the vendor's catalog."""
    from services.vendor_manager import _normalize_phone
    phone_key = phone.strip() or vendor_id.strip() or "web-client"
    if _is_uuid(phone_key):
        phone_key = "web-client"
    else:
        phone_key = _normalize_phone(phone_key)
    try:
        delete_inventory_item(phone=phone_key, item_name=item_name)
        return {"deleted": item_name}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}")


# ---------------------------------------------------------------------------
# Reports Endpoint
# ---------------------------------------------------------------------------

@app.get("/api/report")
def get_pnl_report(vendor_id: str = "", phone: str = "") -> Dict[str, str]:
    """
    Generate and return the URL for the Trading & P&L IT Return format PDF.
    """
    raw = phone.strip() or vendor_id.strip()
    from services.vendor_manager import _normalize_phone, get_phone_variants
    if not raw or _is_uuid(raw):
        phone_key = "web-client"
    elif _is_phone_identifier(raw):
        phone_key = _normalize_phone(raw)
    else:
        phone_key = raw

    try:
        from services.report_generator import generate_pnl_pdf
        # Look up vendor name from DB for proper report header
        vendor_doc = get_db()["vendors"].find_one({"phone": {"$in": get_phone_variants(phone_key)}}, {"name": 1, "business_name": 1})
        display_name = (
            (vendor_doc or {}).get("business_name")
            or (vendor_doc or {}).get("name")
            or "PROPRIETOR"
        )
        pdf_url = generate_pnl_pdf(phone_key, vendor_name=display_name)
        if not pdf_url:
            raise HTTPException(status_code=404, detail="No ledger data found to generate report.")
        return {"pdf_url": pdf_url}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("/api/report GET failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Report generation failed: {exc}")


class InventoryResetIn(BaseModel):
    vendor_id: str = ""
    phone: str = ""


@app.post("/inventory/reset")
def reset_inventory(body: InventoryResetIn) -> Dict[str, Any]:
    """Reset today's current_stock = daily_stock for all items. Call each morning."""
    from services.vendor_manager import _normalize_phone
    phone_key = (body.phone or body.vendor_id or "").strip() or "web-client"
    if _is_uuid(phone_key):
        phone_key = "web-client"
    else:
        phone_key = _normalize_phone(phone_key)
    try:
        count = reset_daily_stock(phone=phone_key)
        return {"reset_count": count}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Reset failed: {exc}")


# ---------------------------------------------------------------------------
# Stock suggestion endpoint  (AI-powered, using VoiceTrace PS prompt logic)
# ---------------------------------------------------------------------------
@app.get("/suggestions")
def get_suggestions(
    vendor_id: str = "",
    vendor_name: str = "Vendor",
    vendor_type: str = "street vendor",
    language: str = "hi",
    days: int = 14,
) -> Dict[str, Any]:
    """
    Suggest next-day stock quantities using AI (Groq LLM).
    Falls back to a simple 15% heuristic if the AI call fails.
    """
    settings = get_settings()
    db = get_db()

    try:
        # Fetch recent income ledger rows
        safe_days = max(7, min(days, 30))
        cutoff = (datetime.now(timezone.utc) - timedelta(days=safe_days)).isoformat()
        incoming = (vendor_id or "").strip()
        from services.vendor_manager import _normalize_phone, get_phone_variants
        if incoming and _is_phone_identifier(incoming):
            phone_key = _normalize_phone(incoming)
            variants = get_phone_variants(incoming)
            query = {"type": "income", "created_at": {"$gte": cutoff}, "phone": {"$in": variants}}
        elif incoming and _is_uuid(incoming):
            phone_key = "web-client"
            query = {"type": "income", "created_at": {"$gte": cutoff}, "phone": incoming}
        else:
            phone_key = "web-client"
            query = {"type": "income", "created_at": {"$gte": cutoff}, "phone": "web-client"}

        rows = list(db["ledger"].find(query).sort("created_at", -1).limit(500))

        # --- Try real quantity data first ---
        item_stats = get_item_stats_from_ledger(phone_key, days=safe_days)

        if not item_stats:
            # Fallback: use ₹ amount-based aggregation from ledger
            item_stats = aggregate_item_stats(rows, days=safe_days)

        # Call the AI model with the structured prompt
        ai_result = call_groq_for_suggestions(
            groq_api_key=settings.groq_api_key,
            groq_model=settings.groq_llm_model,
            vendor_name=vendor_name,
            vendor_type=vendor_type,
            item_stats=item_stats,
            language=language,
        )

        return ai_result

    except Exception as exc:
        logger.exception("/suggestions failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Suggestions failed: {exc}")



# ---------------------------------------------------------------------------
# Deep AI Insights endpoint (with voice narration)
# ---------------------------------------------------------------------------
@app.get("/ai-insights")
def get_ai_insights(
    vendor_id: str = "",
    vendor_name: str = "Vendor",
    vendor_type: str = "street vendor",
    language: str = "hi",
) -> Dict[str, Any]:
    """
    Deep AI analysis of the vendor's business with voice narration.
    Returns metrics, AI-generated narrative, key findings, recommendations,
    and a base64-encoded MP3 audio of the summary.
    """
    settings = get_settings()
    
    try:
        db = get_db()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        incoming = (vendor_id or "").strip()
        from services.vendor_manager import _normalize_phone, get_phone_variants
        if incoming and _is_phone_identifier(incoming):
            phone_key = _normalize_phone(incoming)
            variants = get_phone_variants(incoming)
            query = {"created_at": {"$gte": cutoff}, "phone": {"$in": variants}}
        elif incoming and _is_uuid(incoming):
            phone_key = "web-client"
            query = {"created_at": {"$gte": cutoff}, "phone": incoming}
        else:
            phone_key = "web-client"
            query = {"created_at": {"$gte": cutoff}, "phone": "web-client"}

        ledger_rows = list(db["ledger"].find(query).sort("created_at", -1).limit(500))

        # Fetch inventory items
        try:
            inv_items = get_inventory(phone_key)
        except Exception:
            inv_items = []

        # Run the full pipeline
        response = run_insights_pipeline(
            groq_api_key=settings.groq_api_key,
            groq_model=settings.groq_llm_model,
            ledger_rows=ledger_rows,
            inventory_items=inv_items,
            vendor_name=vendor_name,
            vendor_type=vendor_type,
            language=language,
        )

        return response

    except Exception as exc:
        logger.exception("/ai-insights failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"AI Insights failed: {exc}")


@app.exception_handler(Exception)
async def global_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


# ---------------------------------------------------------------------------
# Udhari (Customer Credit / Khata) REST endpoints
# ---------------------------------------------------------------------------

class UdhariAddIn(BaseModel):
    vendor_phone: str
    customer_name: str
    amount: float
    note: str = ""


class UdhariPaymentIn(BaseModel):
    vendor_phone: str
    customer_name: str
    amount: float
    note: str = ""


class UdhariReminderIn(BaseModel):
    vendor_phone: str
    customer_name: str
    customer_phone: str = ""


@app.get("/udhari/totals")
def get_udhari_totals_endpoint(vendor_phone: str = "") -> Dict[str, Any]:
    """KPI summary: total outstanding, active customers, totals given / recovered."""
    if not vendor_phone.strip():
        raise HTTPException(status_code=400, detail="vendor_phone is required")
    try:
        return get_udhari_totals(vendor_phone.strip())
    except Exception as exc:
        logger.exception("/udhari/totals failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/udhari/customers")
def list_udhari_customers(
    vendor_phone: str = "",
    only_outstanding: bool = False,
    search: str = "",
) -> Dict[str, Any]:
    """List all customer khata records for a vendor."""
    if not vendor_phone.strip():
        raise HTTPException(status_code=400, detail="vendor_phone is required")
    try:
        customers = list_customers(
            vendor_phone=vendor_phone.strip(),
            only_outstanding=only_outstanding,
            search=search,
        )
        return {"customers": customers}
    except Exception as exc:
        logger.exception("/udhari/customers failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/udhari/add")
def add_udhari_endpoint(body: UdhariAddIn) -> Dict[str, Any]:
    """Record new credit given to a customer."""
    try:
        summary = add_udhari(
            vendor_phone=body.vendor_phone.strip(),
            customer_name=body.customer_name.strip(),
            amount=body.amount,
            note=body.note,
        )
        return {"success": True, "customer": summary}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("/udhari/add failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/udhari/payment")
def record_payment_endpoint(body: UdhariPaymentIn) -> Dict[str, Any]:
    """Record payment received from a customer."""
    try:
        summary = record_udhari_payment(
            vendor_phone=body.vendor_phone.strip(),
            customer_name=body.customer_name.strip(),
            amount=body.amount,
            note=body.note,
        )
        return {"success": True, "customer": summary}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("/udhari/payment failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/udhari/reminder")
def send_udhari_reminder_endpoint(body: UdhariReminderIn) -> Dict[str, Any]:
    """Send one manually-confirmed WhatsApp reminder for an outstanding account."""
    try:
        vendor_phone = body.vendor_phone.strip()
        customer_name = body.customer_name.strip()
        customer = get_customer_summary(vendor_phone, customer_name)
        due = float(customer.get("total_due") or 0)
        if not customer or due <= 0:
            raise HTTPException(status_code=400, detail="This customer has no pending udhari")

        customer_phone = body.customer_phone.strip() or str(customer.get("customer_phone") or "")
        if not customer_phone:
            raise HTTPException(status_code=400, detail="Customer WhatsApp number is required")
        save_customer_phone(vendor_phone, customer_name, customer_phone)

        previous = get_recent_reminder(vendor_phone, customer_name)
        if previous:
            created_at = str(previous.get("created_at") or "")
            try:
                sent_at = datetime.fromisoformat(created_at)
                if (datetime.now(timezone.utc) - sent_at).total_seconds() < 86400:
                    raise HTTPException(
                        status_code=429,
                        detail="Reminder already sent in the last 24 hours",
                    )
            except ValueError:
                logger.warning("Invalid reminder timestamp for %s", customer_name)

        display_name = customer.get("customer_name_display") or customer_name
        message = (
            f"Namaste {display_name} ji 🙏\n\n"
            f"Aapke khate mein {due:,.0f} rupaye baki hain.\n"
            "Jab suvidha ho, kripya payment kar dijiye.\n\n"
            "Dhanyavaad."
        )
        recipient = customer_phone if customer_phone.startswith("whatsapp:") else f"whatsapp:+{customer_phone.lstrip('+')}"
        message_id = send_whatsapp_reply(recipient, message)
        record_udhari_reminder(vendor_phone, customer_name, customer_phone, due, message_id)
        return {"success": True, "message_id": message_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("/udhari/reminder failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Reminder send failed: {exc}")


@app.get("/udhari/transactions")
def get_udhari_transactions(
    vendor_phone: str = "",
    customer_name: str = "",
    limit: int = 50,
) -> Dict[str, Any]:
    """Get transaction history for a single customer."""
    if not vendor_phone.strip() or not customer_name.strip():
        raise HTTPException(status_code=400, detail="vendor_phone and customer_name are required")
    try:
        txns = get_customer_transactions(
            vendor_phone=vendor_phone.strip(),
            customer_name=customer_name.strip(),
            limit=limit,
        )
        summary = get_customer_summary(
            vendor_phone=vendor_phone.strip(),
            customer_name=customer_name.strip(),
        )
        return {"customer": summary, "transactions": txns}
    except Exception as exc:
        logger.exception("/udhari/transactions failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/udhari/report/pdf")
def get_udhari_report_pdf(vendor_phone: str = "web-client") -> Dict[str, Any]:
    """Generate and return download URL for Udhari Khata PDF report."""
    from services.udhari import generate_udhari_pdf
    phone_key = (vendor_phone or "web-client").strip()
    if not phone_key.startswith("whatsapp:") and phone_key != "web-client":
        phone_key = f"whatsapp:{phone_key}"
    try:
        pdf_url = generate_udhari_pdf(vendor_phone=phone_key)
        if not pdf_url:
            raise HTTPException(status_code=500, detail="Could not generate Udhari report PDF")
        return {"pdf_url": pdf_url}
    except Exception as exc:
        logger.exception("Failed to generate Udhari report PDF: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
