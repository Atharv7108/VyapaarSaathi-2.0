import os
from dataclasses import dataclass
from functools import lru_cache
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()


def _to_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    whatsapp_api_token: str
    whatsapp_business_account_id: str
    whatsapp_phone_number_id: str
    whatsapp_webhook_verify_token: str
    groq_api_key: str
    supabase_url: str
    supabase_key: str
    supabase_service_role_key: str
    groq_llm_model: str
    groq_whisper_model: str
    ffmpeg_binary: str

    enable_weekly_summary: bool
    enable_weekly_summary_tts: bool
    enable_instant_stock_alerts: bool
    instant_stock_alert_interval_seconds: int
    instant_stock_alert_units_threshold: int
    instant_stock_alert_recipients: str

    def missing_required(self) -> List[str]:
        missing: List[str] = []
        required = {
            "WHATSAPP_API_TOKEN": self.whatsapp_api_token,
            "WHATSAPP_PHONE_NUMBER_ID": self.whatsapp_phone_number_id,
            "WHATSAPP_WEBHOOK_VERIFY_TOKEN": self.whatsapp_webhook_verify_token,
            "GROQ_API_KEY": self.groq_api_key,
            "SUPABASE_URL": self.supabase_url,
        }
        for key, value in required.items():
            if not value:
                missing.append(key)
        if not (self.supabase_service_role_key or self.supabase_key):
            missing.append("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY")
        return missing


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        whatsapp_api_token=os.getenv("WHATSAPP_API_TOKEN", ""),
        whatsapp_business_account_id=os.getenv("WHATSAPP_BUSINESS_ACCOUNT_ID", ""),
        whatsapp_phone_number_id=os.getenv("WHATSAPP_PHONE_NUMBER_ID", ""),
        whatsapp_webhook_verify_token=os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", ""),
        groq_api_key=os.getenv("GROQ_API_KEY", ""),
        supabase_url=os.getenv("SUPABASE_URL", ""),
        supabase_key=os.getenv("SUPABASE_KEY", ""),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
        groq_llm_model=os.getenv("GROQ_LLM_MODEL", "llama-3.3-70b-versatile"),
        groq_whisper_model=os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo"),
        ffmpeg_binary=os.getenv("FFMPEG_BINARY", "ffmpeg"),

        enable_weekly_summary=_to_bool(os.getenv("ENABLE_WEEKLY_SUMMARY"), default=False),
        enable_weekly_summary_tts=_to_bool(os.getenv("ENABLE_WEEKLY_SUMMARY_TTS"), default=False),
        enable_instant_stock_alerts=_to_bool(os.getenv("ENABLE_INSTANT_STOCK_ALERTS"), default=True),
        instant_stock_alert_interval_seconds=max(
            30,
            int(os.getenv("INSTANT_STOCK_ALERT_INTERVAL_SECONDS", "60") or "60"),
        ),
        instant_stock_alert_units_threshold=max(
            1,
            int(os.getenv("INSTANT_STOCK_ALERT_UNITS_THRESHOLD", "20") or "20"),
        ),
        instant_stock_alert_recipients=os.getenv("INSTANT_STOCK_ALERT_RECIPIENTS", ""),
    )


def ensure_required_settings() -> None:
    missing = get_settings().missing_required()
    if missing:
        raise RuntimeError(
            "Missing required environment variables: " + ", ".join(sorted(missing))
        )
