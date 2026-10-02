"""
Twilio WhatsApp Dispatcher Service for LectureScribe
---------------------------------------------------
Formats and dispatches formatted academic schedule digests, deadline warnings,
and slot reminders to WhatsApp using the Twilio Programmable Messaging API.
Includes simulation / dry-run mode when credentials are not yet set.
"""
from __future__ import annotations

import os
import datetime
from zoneinfo import ZoneInfo
from typing import List, Dict, Any, Optional

import requests
from requests.auth import HTTPBasicAuth
from dotenv import load_dotenv
from pathlib import Path

_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path, override=True)
else:
    load_dotenv(override=True)

import re

IST = ZoneInfo("Asia/Kolkata")

CATEGORY_ICONS = {
    "exam": "🚨",
    "quiz": "🎯",
    "assignment": "📝",
    "lab": "🔬",
    "lecture": "📚",
    "general": "📌"
}

CATEGORY_LABELS = {
    "exam": "EXAM / VIVA",
    "quiz": "QUIZ / TEST",
    "assignment": "ASSIGNMENT DUE",
    "lab": "LAB SESSION",
    "lecture": "LECTURE",
    "general": "EVENT"
}


def _extract_url_and_clean_desc(description: str) -> tuple[Optional[str], Optional[str]]:
    """Extract clean meeting/portal URL and remove Moodle markdown noise."""
    if not description:
        return None, None

    url_match = re.search(r'https?://[^\s\)\]\}]+', description)
    direct_url = url_match.group(0) if url_match else None

    # Remove Moodle link indices e.g. [1], Links:\n------\n[1], etc.
    clean = re.sub(r'Links:\s*-+.*', '', description, flags=re.DOTALL)
    clean = re.sub(r'Join Zoom Meeting\s*(\[\d+\])?', '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\[\d+\]', '', clean)
    clean = re.sub(r'https?://[^\s]+', '', clean)
    clean = clean.replace('\n', ' ').strip()
    clean = re.sub(r'\s+', ' ', clean)

    if not clean or clean.lower() in ("join zoom meeting", "assignment", "attendance"):
        clean = None
    elif len(clean) > 85:
        clean = clean[:82] + "..."

    return direct_url, clean


def format_whatsapp_message(
    events: List[Dict[str, Any]],
    slot_label: str = "Schedule Alert",
    tomorrow_preview: Optional[List[Dict[str, Any]]] = None,
    is_test: bool = False
) -> str:
    """Format events into an aesthetically styled, scannable WhatsApp markdown message."""
    now = datetime.datetime.now(IST)
    date_str = now.strftime("%A, %d %B %Y")
    time_str = now.strftime("%I:%M %p")

    slot_lower = slot_label.lower()
    if "8" in slot_lower or "morning" in slot_lower:
        header_icon = "🌅"
    elif "4" in slot_lower or "afternoon" in slot_lower:
        header_icon = "🌆"
    elif "11" in slot_lower:
        header_icon = "☀️"
    elif "3" in slot_lower:
        header_icon = "☕"
    elif "6" in slot_lower or "evening" in slot_lower:
        header_icon = "🌙"
    else:
        header_icon = "📅"

    lines: List[str] = []
    lines.append(f"📅 *Schedule for Today ({date_str})*")
    lines.append(f"{header_icon} _{slot_label}_")
    lines.append("───────────────────────")

    if not events:
        lines.append("✨ *No classes, quizzes, or pending submissions!*")
        lines.append("Enjoy your focus time or revision. 🎓")
    else:
        for idx, evt in enumerate(events, 1):
            category = evt.get("category", "general")
            icon = CATEGORY_ICONS.get(category, "📌")
            cat_label = CATEGORY_LABELS.get(category, "EVENT")
            title = evt.get("title", "Untitled Event")
            start_str = evt.get("start_time_formatted", "")
            end_str = evt.get("end_time_formatted", "")
            is_all_day = evt.get("is_all_day", False)
            location = (evt.get("location") or "").strip()
            raw_desc = (evt.get("description") or "").strip()

            url, clean_desc = _extract_url_and_clean_desc(raw_desc)

            # Smart timing display (avoid 11:55 PM - 11:55 PM)
            if is_all_day:
                timing = "All Day"
            elif start_str == end_str:
                timing = f"Due at {end_str}"
            elif category in ("assignment", "quiz") and any(k in title.lower() for k in ["due", "close", "closes", "deadline"]):
                timing = f"Due by {end_str}"
            else:
                timing = f"{start_str} – {end_str}"

            lines.append(f"{icon} *{idx}. {title}*")
            lines.append(f"   🏷️ _{cat_label}_  •  ⏰ `{timing}`")

            if location:
                lines.append(f"   📍 _{location}_")
            if url:
                link_label = "Join Class" if ("zoom" in url.lower() or category in ("lecture", "lab")) else "View / Submit"
                lines.append(f"   🔗 *{link_label}:* {url}")
            elif clean_desc:
                lines.append(f"   ℹ️ {clean_desc}")

            lines.append("")

    # Add Tomorrow's preview if available (for 4pm / evening slot)
    if tomorrow_preview and len(tomorrow_preview) > 0:
        tomorrow_date = (now.date() + datetime.timedelta(days=1)).strftime("%A, %d %B %Y")
        lines.append("───────────────────────")
        lines.append(f"🌅 *Schedule for Tomorrow ({tomorrow_date}):*")
        for t_evt in tomorrow_preview:
            t_cat = t_evt.get("category", "general")
            t_icon = CATEGORY_ICONS.get(t_cat, "📌")
            t_title = t_evt.get("title", "Event")
            t_start = t_evt.get("start_time_formatted", "")
            lines.append(f"• {t_icon} *{t_title}* at `{t_start}`")
        lines.append("")

    lines.append("───────────────────────")
    lines.append("🤖 _LectureScribe AI Assistant_")

    return "\n".join(lines).strip()



class TwilioWhatsAppService:
    def __init__(self):
        self._refresh_env()

    def _refresh_env(self):
        """Dynamically reload .env to pick up any newly saved credentials."""
        if _env_path.exists():
            load_dotenv(dotenv_path=_env_path, override=True)
        else:
            load_dotenv(override=True)
        self.account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
        self.auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
        self.from_number = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886").strip()
        self.to_number = os.getenv("TWILIO_WHATSAPP_TO", "").strip()

    def is_configured(self) -> bool:
        """Check if Twilio credentials and recipient number are properly set."""
        self._refresh_env()
        return bool(self.account_sid and self.auth_token and self.to_number)

    def send_whatsapp_message(
        self,
        message_body: str,
        recipient: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Deliver message via Twilio Programmable Messaging API.
        Falls back gracefully to simulation mode if credentials are not configured.
        """
        self._refresh_env()
        target_to = (recipient or self.to_number).strip()
        if target_to and not target_to.startswith("whatsapp:"):
            # Ensure whatsapp: prefix
            target_to = f"whatsapp:{target_to}"

        # 1. Simulation / Dry Run if credentials missing or placeholder
        is_placeholder = any(p in self.auth_token.lower() for p in ["[authtoken]", "your_auth_token_here", "placeholder"])
        if not self.account_sid or not self.auth_token or is_placeholder or not target_to:
            print("\n================ [TWILIO WHATSAPP SIMULATION] ================")
            print(f"Recipient : {target_to or 'NOT CONFIGURED (set TWILIO_WHATSAPP_TO)'}")
            print(f"From      : {self.from_number}")
            print("Message Content:\n" + message_body)
            print("==============================================================\n")
            return {
                "status": "simulated",
                "message": "Twilio credentials not configured. Message simulated in server logs.",
                "recipient": target_to or "Not set",
                "body": message_body,
                "sent_at": datetime.datetime.now(IST).isoformat()
            }

        # 2. Live Twilio HTTP Request
        api_url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        payload = {
            "From": self.from_number if self.from_number.startswith("whatsapp:") else f"whatsapp:{self.from_number}",
            "To": target_to,
            "Body": message_body
        }

        try:
            resp = requests.post(
                api_url,
                data=payload,
                auth=HTTPBasicAuth(self.account_sid, self.auth_token),
                timeout=15
            )
            resp_data = resp.json()

            if resp.status_code in (200, 201):
                sid = resp_data.get("sid", "unknown_sid")
                print(f"✅ [Twilio WhatsApp Success]: Delivered message SID: {sid} to {target_to}")
                return {
                    "status": "sent",
                    "sid": sid,
                    "recipient": target_to,
                    "body": message_body,
                    "sent_at": datetime.datetime.now(IST).isoformat()
                }
            else:
                error_msg = resp_data.get("message") or resp.text
                print(f"❌ [Twilio WhatsApp Error]: HTTP {resp.status_code} - {error_msg}")
                return {
                    "status": "failed",
                    "error": error_msg,
                    "code": resp_data.get("code"),
                    "recipient": target_to,
                    "body": message_body
                }
        except Exception as e:
            print(f"❌ [Twilio WhatsApp Network Exception]: {e}")
            return {
                "status": "failed",
                "error": str(e),
                "recipient": target_to,
                "body": message_body
            }

    def dispatch_slot_alert(
        self,
        slot: str,
        events: List[Dict[str, Any]],
        slot_label: str,
        tomorrow_preview: Optional[List[Dict[str, Any]]] = None,
        force_send_empty: bool = False
    ) -> Dict[str, Any]:
        """Send formatted alert for a scheduled slot. Skips empty windows unless forced."""
        if not events and not force_send_empty:
            print(f"ℹ️ [Twilio WhatsApp]: No events found for slot '{slot}'. Skipping notification.")
            return {
                "status": "skipped",
                "reason": "No events found in target time window",
                "slot": slot
            }

        message_text = format_whatsapp_message(
            events=events,
            slot_label=slot_label,
            tomorrow_preview=tomorrow_preview,
            is_test=False
        )

        return self.send_whatsapp_message(message_text)

    def dispatch_test_alert(self, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Send immediate alert containing today's schedule."""
        message_text = format_whatsapp_message(
            events=events,
            slot_label="Academic Schedule Preview",
            tomorrow_preview=None
        )
        return self.send_whatsapp_message(message_text)


# Global singleton instance
whatsapp_service = TwilioWhatsAppService()
