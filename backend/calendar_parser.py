"""
Moodle iCal Feed Ingestion & Event Categorization Service
--------------------------------------------------------
Fetches and parses RFC 5545 iCalendar (.ics) feeds from the IIIT Dharwad Moodle LMS,
normalizes datetimes to Asia/Kolkata (IST), categorizes academic events (assignment, quiz, exam, lecture),
and filters events for temporal WhatsApp dispatch slots.
"""
from __future__ import annotations

import os
import re
import json
import time
import datetime
from zoneinfo import ZoneInfo
from typing import List, Dict, Any, Optional, Tuple

import requests
from icalendar import Calendar, Event
from dotenv import load_dotenv
from pathlib import Path

_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path, override=True)
else:
    load_dotenv(override=True)

# Constants & Timezone
IST = ZoneInfo("Asia/Kolkata")
CACHE_KEY = "moodle_ical_events_cache"
DEFAULT_CACHE_TTL = 43200  # 12 hours (12 * 3600 seconds)

# The only two Cloud Scheduler cron slots (IST). Both deliver the same full-day agenda.
SLOT_LABELS: Dict[str, str] = {
    "8am": "8:00 AM Daily Reminder",
    "4pm": "4:00 PM Daily Reminder",
}


def get_moodle_feed_url() -> str:
    """Build or retrieve the authenticated Moodle export URL."""
    custom_url = os.getenv("MOODLE_ICAL_URL")
    if custom_url and custom_url.strip():
        return custom_url.strip()

    user_id = os.getenv("MOODLE_USER_ID", "699").strip()
    auth_token = os.getenv("MOODLE_AUTH_TOKEN", "").strip()

    if not auth_token:
        auth_token = "demo_token"

    return f"https://learning.iiitdwd.ac.in/calendar/export_execute.php?userid={user_id}&authtoken={auth_token}&preset_what=all&preset_time=custom"


def categorize_event(summary: str, description: str = "") -> str:
    """Classify event into assignment, quiz, exam, lecture, lab, or general."""
    text = f"{summary} {description}".lower()

    if any(k in text for k in ["midsem", "endsem", "exam", "examination", "viva", "eval", "evaluation"]):
        return "exam"
    if any(k in text for k in ["quiz", "test", "mcq", "assessment"]):
        return "quiz"
    if any(k in text for k in ["assignment", "homework", "hw", "submission", "due", "turnin", "task"]):
        return "assignment"
    if any(k in text for k in ["lab", "practical", "hands-on", "workshop"]):
        return "lab"
    if any(k in text for k in ["lecture", "session", "class", "tutorial", "sync", "meet"]):
        return "lecture"
    return "general"


def _normalize_dt(dt_val: Any) -> Tuple[datetime.datetime, bool]:
    """
    Convert ical datetime or date to an IST-aware datetime.
    Returns (datetime_obj, is_all_day).
    """
    if dt_val is None:
        now = datetime.datetime.now(IST)
        return now, False

    # Check if this is a date-only object (all-day event)
    if isinstance(dt_val, datetime.date) and not isinstance(dt_val, datetime.datetime):
        # Full day event: set to 00:00:00 IST
        dt = datetime.datetime.combine(dt_val, datetime.time.min).replace(tzinfo=IST)
        return dt, True

    if isinstance(dt_val, datetime.datetime):
        if dt_val.tzinfo is None:
            # Naive datetime: assume IST
            return dt_val.replace(tzinfo=IST), False
        else:
            # Convert timezone to IST
            return dt_val.astimezone(IST), False

    # Fallback
    return datetime.datetime.now(IST), False


MEETING_URL_REGEX = re.compile(r'https?://[^\s<>"\'\)\]\}]+')


def detect_meeting_platform(url: str) -> str:
    """Classify video meeting or LMS platform from URL."""
    url_lower = url.lower()
    if "zoom.us" in url_lower:
        return "zoom"
    if "meet.google.com" in url_lower:
        return "meet"
    if "teams.microsoft.com" in url_lower or "teams.live.com" in url_lower:
        return "teams"
    if "webex.com" in url_lower:
        return "webex"
    if "bigbluebutton" in url_lower or "/bbb" in url_lower:
        return "bbb"
    if "moodle" in url_lower or "learning.iiitdwd.ac.in" in url_lower:
        return "moodle"
    return "link"


def extract_meeting_info(
    url_prop: str = "",
    location: str = "",
    description: str = ""
) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract meeting URL and identify platform (zoom, meet, teams, webex, bbb, moodle, link).
    Picks video conference links with higher priority if multiple links are found.
    Returns (meeting_url, meeting_platform).
    """
    candidates: List[str] = []

    def _clean_and_add(raw_str: str):
        if not raw_str:
            return
        matches = MEETING_URL_REGEX.findall(raw_str)
        for m in matches:
            cleaned = m.rstrip(".,;:!?)]}")
            if cleaned and cleaned not in candidates:
                candidates.append(cleaned)

    # 1. Collect candidate URLs from url property, location, and description
    _clean_and_add(url_prop)
    _clean_and_add(location)
    _clean_and_add(description)

    if not candidates:
        return None, None

    # 2. Prioritize video conferencing platforms over generic URLs
    priority_platforms = {"zoom", "meet", "teams", "webex", "bbb"}
    for cand in candidates:
        platform = detect_meeting_platform(cand)
        if platform in priority_platforms:
            return cand, platform

    # 3. Otherwise return the first valid URL
    first_url = candidates[0]
    return first_url, detect_meeting_platform(first_url)


def parse_ical_content(ics_text: str | bytes) -> List[Dict[str, Any]]:
    """Parse raw iCalendar content into standardized, categorized event dictionaries."""
    if isinstance(ics_text, str):
        ics_bytes = ics_text.encode("utf-8")
    else:
        ics_bytes = ics_text

    events: List[Dict[str, Any]] = []

    try:
        cal = Calendar.from_ical(ics_bytes)
    except Exception as e:
        print(f"⚠️ [iCal Parse Error]: {e}")
        return []

    for component in cal.walk():
        if component.name != "VEVENT":
            continue

        uid = str(component.get("uid") or f"evt_{len(events) + 1}")
        summary = str(component.get("summary") or "Untitled Event").strip()
        description = str(component.get("description") or "").strip()
        location = str(component.get("location") or "").strip()
        url_prop = str(component.get("url") or "").strip()

        dtstart_prop = component.get("dtstart")
        dtend_prop = component.get("dtend")

        start_raw = dtstart_prop.dt if dtstart_prop else None
        end_raw = dtend_prop.dt if dtend_prop else None

        start_dt, is_all_day_start = _normalize_dt(start_raw)
        if end_raw:
            end_dt, is_all_day_end = _normalize_dt(end_raw)
            is_all_day = is_all_day_start or is_all_day_end
        else:
            # Default duration 1 hour or end of day if all-day
            if is_all_day_start:
                end_dt = start_dt + datetime.timedelta(days=1)
                is_all_day = True
            else:
                end_dt = start_dt + datetime.timedelta(hours=1)
                is_all_day = False

        category = categorize_event(summary, description)

        # Categorize slot within the day
        hour = start_dt.hour
        if is_all_day:
            day_slot = "all_day"
        elif hour < 12:
            day_slot = "morning"
        elif hour < 17:
            day_slot = "afternoon"
        else:
            day_slot = "evening"

        meeting_url, meeting_platform = extract_meeting_info(
            url_prop=url_prop,
            location=location,
            description=description
        )

        events.append({
            "id": uid,
            "title": summary,
            "description": description,
            "location": location,
            "url": url_prop or meeting_url,
            "meeting_url": meeting_url,
            "meeting_platform": meeting_platform,
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "start_time_formatted": start_dt.strftime("%I:%M %p"),
            "end_time_formatted": end_dt.strftime("%I:%M %p"),
            "date_formatted": start_dt.strftime("%A, %b %d, %Y"),
            "is_all_day": is_all_day,
            "category": category,
            "day_slot": day_slot,
            "timestamp_start": start_dt.timestamp(),
            "timestamp_end": end_dt.timestamp()
        })

    # Sort chronologically by start time
    events.sort(key=lambda x: x["timestamp_start"])
    return events


class MoodleCalendarService:
    def __init__(self, redis_client=None):
        self._custom_redis = redis_client
        self._memory_cache: Optional[Dict[str, Any]] = None
        self._cache_timestamp: float = 0

    @property
    def redis(self):
        """Resolve Redis client dynamically from redis_service if not explicitly provided."""
        if self._custom_redis is not None:
            return self._custom_redis
        try:
            from backend.redis_service import redis_cache
            if redis_cache and redis_cache.enabled and redis_cache.client:
                return redis_cache.client
        except Exception:
            pass
        return None

    @redis.setter
    def redis(self, value):
        self._custom_redis = value

    def fetch_raw_feed(self, url: Optional[str] = None) -> str:
        """Fetch raw ics feed from Moodle LMS."""
        feed_url = url or get_moodle_feed_url()
        try:
            resp = requests.get(feed_url, timeout=15)
            if resp.status_code == 200 and resp.text:
                print(f"📡 [Moodle iCal]: Successfully fetched calendar feed ({len(resp.text)} chars).")
                return resp.text
            print(f"⚠️ [Moodle iCal Warning]: HTTP {resp.status_code} fetching calendar feed.")
            return ""
        except Exception as e:
            print(f"⚠️ [Moodle iCal Network Error]: {e}")
            return ""

    def get_events(self, refresh: bool = False) -> List[Dict[str, Any]]:
        """Get parsed events, utilizing Redis or in-memory cache with 12-hour TTL."""
        now_ts = time.time()

        # 1. Check in-memory / redis cache unless refresh requested
        if not refresh:
            if self.redis:
                try:
                    cached = self.redis.get(CACHE_KEY)
                    if cached:
                        data = json.loads(cached)
                        if isinstance(data, list):
                            return data
                except Exception as e:
                    print(f"⚠️ [Redis Calendar Cache Warning]: {e}")

            if self._memory_cache and (now_ts - self._cache_timestamp < DEFAULT_CACHE_TTL):
                return self._memory_cache.get("events", [])

        # 2. Fetch fresh feed
        raw_feed = self.fetch_raw_feed()
        if not raw_feed:
            # If fetch failed but we have stale cache, return stale cache as fallback
            if self._memory_cache:
                return self._memory_cache.get("events", [])
            return []

        # 3. Parse and cache
        events = parse_ical_content(raw_feed)

        # Cache in Redis
        if self.redis:
            try:
                self.redis.setex(CACHE_KEY, DEFAULT_CACHE_TTL, json.dumps(events))
            except Exception as e:
                print(f"⚠️ [Redis Set Warning]: {e}")

        # Cache in memory
        self._memory_cache = {"events": events, "cached_at": now_ts}
        self._cache_timestamp = now_ts
        return events

    def get_dashboard_agenda(self, days: int = 7, refresh: bool = False) -> Dict[str, Any]:
        """Group events into today's timeline and upcoming week for the React dashboard."""
        events = self.get_events(refresh=refresh)
        now = datetime.datetime.now(IST)
        today_date = now.date()
        end_date = today_date + datetime.timedelta(days=days)

        today_events: List[Dict[str, Any]] = []
        upcoming_events: List[Dict[str, Any]] = []

        for evt in events:
            evt_start = datetime.datetime.fromisoformat(evt["start"]).astimezone(IST)
            evt_date = evt_start.date()

            if evt_date == today_date:
                today_events.append(evt)
            elif today_date < evt_date <= end_date:
                upcoming_events.append(evt)

        # Breakdown today by slots
        morning = [e for e in today_events if e["day_slot"] in ("morning", "all_day")]
        afternoon = [e for e in today_events if e["day_slot"] == "afternoon"]
        evening = [e for e in today_events if e["day_slot"] == "evening"]

        assignment_count = sum(1 for e in today_events + upcoming_events if e["category"] == "assignment")
        quiz_count = sum(1 for e in today_events + upcoming_events if e["category"] == "quiz")
        exam_count = sum(1 for e in today_events + upcoming_events if e["category"] == "exam")

        return {
            "status": "success",
            "last_synced": datetime.datetime.fromtimestamp(self._cache_timestamp, tz=IST).isoformat() if self._cache_timestamp else now.isoformat(),
            "counts": {
                "today": len(today_events),
                "upcoming": len(upcoming_events),
                "assignments": assignment_count,
                "quizzes": quiz_count,
                "exams": exam_count
            },
            "today": {
                "all": today_events,
                "morning": morning,
                "afternoon": afternoon,
                "evening": evening
            },
            "upcoming": upcoming_events
        }

    def filter_events_for_slot(
        self,
        slot: str,
        now: Optional[datetime.datetime] = None
    ) -> Tuple[List[Dict[str, Any]], str, Optional[List[Dict[str, Any]]]]:
        """
        Build the daily reminder payload for a Cloud Scheduler cron dispatch slot.

        Only two slots exist: '8am' and '4pm' IST. Both are reminders for the
        entire day, so they return IDENTICAL data:
        - matched: every event happening today (00:00 – 23:59:59 IST), including
          events already past, events spanning into today, and all-day events.
        - tomorrow_preview: every event starting tomorrow (00:00 – 23:59:59 IST).

        Only the slot_label differs between the two slots.

        Returns: (matched_events, slot_label, tomorrow_preview_events)
        Raises: ValueError for any slot other than '8am' / '4pm'.
        """
        slot_norm = str(slot or "").strip().lower()
        if slot_norm not in SLOT_LABELS:
            raise ValueError(f"Invalid slot '{slot}'. Expected one of: {', '.join(SLOT_LABELS)}.")
        slot_label = SLOT_LABELS[slot_norm]

        events = self.get_events(refresh=True)
        curr = (now or datetime.datetime.now(IST)).astimezone(IST)
        today = curr.date()
        tomorrow = today + datetime.timedelta(days=1)

        today_start = datetime.datetime.combine(today, datetime.time.min, tzinfo=IST)
        tomorrow_start = datetime.datetime.combine(tomorrow, datetime.time.min, tzinfo=IST)
        day_after_start = tomorrow_start + datetime.timedelta(days=1)

        matched: List[Dict[str, Any]] = []
        tomorrow_preview: List[Dict[str, Any]] = []

        for e in events:
            e_start = datetime.datetime.fromisoformat(e["start"]).astimezone(IST)
            e_end = datetime.datetime.fromisoformat(e["end"]).astimezone(IST)

            starts_today = today_start <= e_start < tomorrow_start
            spans_into_today = e_start < today_start < e_end
            if starts_today or spans_into_today:
                matched.append(e)
            elif tomorrow_start <= e_start < day_after_start:
                tomorrow_preview.append(e)

        return matched, slot_label, tomorrow_preview


# Global singleton instance
calendar_service = MoodleCalendarService()
