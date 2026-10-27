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
try:
    from icalendar import Calendar, Event
except ImportError:
    Calendar = None
    Event = None
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
    """Classify event into assignment, quiz, exam, lecture, lab, or schedule."""
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
    return "schedule"


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
    if Calendar is None:
        print("⚠️ [iCal Parse Error]: 'icalendar' module is not installed. Run 'pip install icalendar' or use project venv.")
        return []

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

        # Extract optional course category from iCal CATEGORIES property
        categories_prop = component.get("categories")
        course_name = ""
        if categories_prop:
            try:
                if hasattr(categories_prop, "cats") and categories_prop.cats:
                    course_name = str(categories_prop.cats[0]).strip()
                else:
                    course_name = str(categories_prop).strip()
            except Exception:
                course_name = ""

        # Generic Moodle/iCal category values that designate event scope rather than a specific course title
        GENERIC_CATEGORIES = {
            "course", "site", "user", "category", "group", "quiz", "assignment",
            "exam", "general", "event", "schedule", "lecture", "session"
        }
        if course_name.lower() in GENERIC_CATEGORIES:
            course_name = ""

        course_slug = re.sub(r"[^a-z0-9]+", "-", course_name.lower()).strip("-") if course_name else ""

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
            "date_iso": start_dt.strftime("%Y-%m-%d"),
            "is_all_day": is_all_day,
            "category": category,
            "day_slot": day_slot,
            "timestamp_start": start_dt.timestamp(),
            "timestamp_end": end_dt.timestamp(),
            "event_scope": "course" if course_slug else "site",
            "course_slug": course_slug,
            "course_name": course_name,
            "source_type": "moodle_ical",
            "approval_status": "approved",
            "ai_confidence": 1.0,
            "source_metadata": {}
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
        """Get parsed Moodle iCal events, utilizing Redis or in-memory cache with 12-hour TTL."""
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

    def get_merged_events(
        self,
        refresh: bool = False,
        course_slug: Optional[str] = None,
        user_email: Optional[str] = None,
        source_type: Optional[str] = None,
        category: Optional[str] = None,
        include_site: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Merge Moodle .ics events with native LectureScribe & AI-extracted events from PostgreSQL.
        Filters by course_slug, user_email, source_type, and category if provided.
        """
        clean_slug = re.sub(r"[^a-z0-9]+", "-", course_slug.lower()).strip("-") if course_slug else None
        clean_name = re.sub(r"^[0-9\.\s\-_]+", "", course_slug).strip() if course_slug else ""
        clean_slug_stripped = re.sub(r"[^a-z0-9]+", "-", clean_name.lower()).strip("-") if clean_name else ""
        clean_source = (source_type or "").strip().lower() if source_type else None
        clean_cat = (category or "").strip().lower() if category else None

        GENERIC_SLUGS = {
            "", "course", "site", "user", "category", "group", "general",
            "schedule", "event", "lecture", "session", "quiz", "assignment", "exam"
        }
        STOP_WORDS = {
            "introduction", "intro", "advanced", "fundamentals", "principles", "basics",
            "course", "lecture", "session", "lab", "to", "of", "and", "in", "for",
            "the", "a", "an", "i", "ii", "iii", "part"
        }

        # 1. Fetch Moodle iCal events unless filtered to a non-moodle source
        ical_events: List[Dict[str, Any]] = []
        if not clean_source or clean_source in ("all", "moodle_ical"):
            raw_ical = self.get_events(refresh=refresh)
            for ev in raw_ical:
                if clean_slug:
                    ev_slug = (ev.get("course_slug") or "").lower().strip("-")
                    title_desc = f"{ev.get('title', '')} {ev.get('description', '')}".lower()
                    ev_title_lower = (ev.get("title") or "").lower().strip()
                    slug_words = clean_slug.replace("-", " ").lower()
                    clean_words = clean_slug_stripped.replace("-", " ").lower() if clean_slug_stripped else ""
                    distinctive = [w for w in clean_words.split() if len(w) > 2 and w not in STOP_WORDS]
                    course_acronym = "".join([w[0] for w in clean_words.split() if w])

                    matches = False
                    if ev_slug and ev_slug not in GENERIC_SLUGS:
                        if ev_slug in (clean_slug, clean_slug_stripped):
                            matches = True
                        elif course_acronym and len(course_acronym) >= 3 and (ev_slug.startswith(course_acronym) or course_acronym in ev_slug):
                            matches = True

                    if not matches:
                        if (clean_words and (clean_words in title_desc or title_desc in clean_words or clean_words in ev_title_lower or ev_title_lower in clean_words)):
                            matches = True
                        elif (slug_words and (slug_words in title_desc or title_desc in slug_words or slug_words in ev_title_lower or ev_title_lower in slug_words)):
                            matches = True
                        elif distinctive and all(w in title_desc or w in ev_title_lower for w in distinctive):
                            matches = True

                    if not matches:
                        continue
                ical_events.append(ev)

        # 2. Fetch PostgreSQL / In-Memory native & AI calendar events
        db_events: List[Dict[str, Any]] = []
        try:
            from backend.database import db_manager
            db_events = db_manager.get_calendar_events(
                course_slug=clean_slug,
                user_email=user_email,
                approval_status="approved",
                source_type=clean_source,
                include_site=False if clean_slug else include_site,
            )
        except Exception as e:
            print(f"⚠️ [Calendar DB Merge Warning]: {e}")

        # 3. Merge and deduplicate by event ID (prefer DB event if overridden)
        merged_by_id: Dict[str, Dict[str, Any]] = {}
        for ev in ical_events:
            merged_by_id[str(ev.get("id"))] = ev
        for ev in db_events:
            merged_by_id[str(ev.get("id"))] = ev

        merged_list = list(merged_by_id.values())
        if clean_cat and clean_cat != "all":
            merged_list = [e for e in merged_list if e.get("category") == clean_cat]

        merged_list.sort(key=lambda x: x.get("timestamp_start", 0))
        return merged_list

    def get_dashboard_agenda(
        self,
        days: int = 7,
        refresh: bool = False,
        course_slug: Optional[str] = None,
        user_email: Optional[str] = None,
        source_type: Optional[str] = None,
        category: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Group merged events into today's timeline, upcoming window, and full calendar list."""
        events = self.get_merged_events(
            refresh=refresh,
            course_slug=course_slug,
            user_email=user_email,
            source_type=source_type,
            category=category,
            include_site=False if course_slug else True,
        )

        # Fetch pending review AI events for the banner/staging badge
        pending_events: List[Dict[str, Any]] = []
        try:
            from backend.database import db_manager
            pending_events = db_manager.get_calendar_events(
                course_slug=course_slug,
                user_email=user_email,
                approval_status="pending_review",
            )
        except Exception:
            pending_events = []

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
        ai_count = sum(
            1 for e in events if e.get("source_type") in ("pdf_ai", "transcript_ai")
        )

        return {
            "status": "success",
            "last_synced": datetime.datetime.fromtimestamp(self._cache_timestamp, tz=IST).isoformat() if self._cache_timestamp else now.isoformat(),
            "course_filter": course_slug,
            "counts": {
                "today": len(today_events),
                "upcoming": len(upcoming_events),
                "total": len(events),
                "assignments": assignment_count,
                "quizzes": quiz_count,
                "exams": exam_count,
                "ai_extracted": ai_count,
                "pending_review": len(pending_events),
            },
            "today": {
                "all": today_events,
                "morning": morning,
                "afternoon": afternoon,
                "evening": evening
            },
            "upcoming": upcoming_events,
            "all_events": events,
            "pending_review": pending_events,
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
          events already past, events spanning into today, and all-day events
          (from both Moodle iCal and approved AI/manual calendar events).
        - tomorrow_preview: every event starting tomorrow (00:00 – 23:59:59 IST).

        Only the slot_label differs between the two slots.

        Returns: (matched_events, slot_label, tomorrow_preview_events)
        Raises: ValueError for any slot other than '8am' / '4pm'.
        """
        slot_norm = str(slot or "").strip().lower()
        if slot_norm not in SLOT_LABELS:
            raise ValueError(f"Invalid slot '{slot}'. Expected one of: {', '.join(SLOT_LABELS)}.")
        slot_label = SLOT_LABELS[slot_norm]

        events = self.get_merged_events(refresh=True)
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

    def export_ics(
        self,
        course_slug: Optional[str] = None,
        user_email: Optional[str] = None,
    ) -> str:
        """Export merged calendar events as an RFC 5545 iCalendar (.ics) string."""
        if Calendar is None or Event is None:
            raise RuntimeError("The 'icalendar' module is required to export .ics files. Install it with 'pip install icalendar' or use project venv.")

        cal = Calendar()
        cal.add("prodid", "-//LectureScribe AI LMS//Calendar//EN")
        cal.add("version", "2.0")
        cal.add("x-wr-calname", f"LectureScribe Calendar{f' ({course_slug})' if course_slug else ''}")
        cal.add("x-wr-timezone", "Asia/Kolkata")

        events = self.get_merged_events(refresh=False, course_slug=course_slug, user_email=user_email)
        for ev in events:
            vevent = Event()
            vevent.add("uid", str(ev.get("id") or f"ls_{int(time.time())}"))
            vevent.add("summary", str(ev.get("title") or "Academic Event"))
            desc = str(ev.get("description") or "")
            meta = ev.get("source_metadata") or {}
            if meta.get("cue_text"):
                desc = f"{desc}\n\n[Transcript Quote @ {meta.get('cue_time', '00:00')}]: \"{meta.get('cue_text')}\"".strip()
            if desc:
                vevent.add("description", desc)
            if ev.get("location"):
                vevent.add("location", str(ev["location"]))
            if ev.get("course_name"):
                vevent.add("categories", [str(ev["course_name"])])

            try:
                dt_start = datetime.datetime.fromisoformat(ev["start"]).astimezone(IST)
                dt_end = datetime.datetime.fromisoformat(ev["end"]).astimezone(IST)
                if ev.get("is_all_day"):
                    vevent.add("dtstart", dt_start.date())
                    vevent.add("dtend", dt_end.date())
                else:
                    vevent.add("dtstart", dt_start)
                    vevent.add("dtend", dt_end)
            except Exception:
                continue

            cal.add_component(vevent)

        return cal.to_ical().decode("utf-8")


# Global singleton instance
calendar_service = MoodleCalendarService()
