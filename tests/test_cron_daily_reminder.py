"""
Regression tests for the 8am / 4pm IST daily reminder cron slots.

Requirements:
1. Only two slots exist: '8am' and '4pm' IST. Everything else is rejected.
2. Both slots return IDENTICAL data: the full day's events (00:00 – 23:59:59 IST)
   plus a preview of tomorrow. Only the label differs.

Fixture mirrors the real Moodle feed on Mon 2026-10-05, where the only event
was an 18:30 lecture — which the old 08:00–16:30 window silently dropped.
"""
import os
import datetime
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app
from backend.calendar_parser import calendar_service, SLOT_LABELS, IST
from backend.whatsapp_service import whatsapp_service, format_whatsapp_message

# All times in UTC (IST = UTC+5:30)
DAY_ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Moodle Pty Ltd//NONSGML Moodle 2026//EN
BEGIN:VEVENT
UID:yesterday_deadline
SUMMARY:Elective Selection closes
DTSTART:20261004T182900Z
DTEND:20261004T182900Z
END:VEVENT
BEGIN:VEVENT
UID:yesterday_allday
SUMMARY:Yesterday Holiday
DTSTART;VALUE=DATE:20261004
DTEND;VALUE=DATE:20261005
END:VEVENT
BEGIN:VEVENT
UID:multi_day_fest
SUMMARY:Tech Fest Workshop
DTSTART:20261003T043000Z
DTEND:20261006T123000Z
END:VEVENT
BEGIN:VEVENT
UID:today_early
SUMMARY:Early Morning Lab
DTSTART:20261005T013000Z
DTEND:20261005T023000Z
END:VEVENT
BEGIN:VEVENT
UID:today_genai
SUMMARY:Introduction to Generative AI
DTSTART:20261005T130000Z
DTEND:20261005T140000Z
END:VEVENT
BEGIN:VEVENT
UID:today_deadline
SUMMARY:Assignment_2 is due
DTSTART:20261005T182900Z
DTEND:20261005T182900Z
END:VEVENT
BEGIN:VEVENT
UID:tomorrow_genai
SUMMARY:Introduction to Generative AI Part 2
DTSTART:20261006T130000Z
DTEND:20261006T140000Z
END:VEVENT
BEGIN:VEVENT
UID:tomorrow_quiz
SUMMARY:Quiz 2 closes
DTSTART:20261006T182900Z
DTEND:20261006T182900Z
END:VEVENT
BEGIN:VEVENT
UID:day_after
SUMMARY:Quiz 3 opens
DTSTART:20261007T130000Z
DTEND:20261007T130000Z
END:VEVENT
END:VCALENDAR
"""

EVENING_ONLY_ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:only_evening
SUMMARY:Introduction to Generative AI
DTSTART:20261005T130000Z
DTEND:20261005T140000Z
END:VEVENT
END:VCALENDAR
"""

AT_8AM = datetime.datetime(2026, 10, 5, 8, 0, 32, tzinfo=IST)
AT_4PM = datetime.datetime(2026, 10, 5, 16, 0, 15, tzinfo=IST)

TODAY_IDS = {"multi_day_fest", "today_early", "today_genai", "today_deadline"}
TOMORROW_IDS = {"tomorrow_genai", "tomorrow_quiz"}


def _ids(events):
    return {e["id"] for e in events}


class TestDailyReminderSlots(unittest.TestCase):
    def setUp(self):
        calendar_service._memory_cache = None
        calendar_service._cache_timestamp = 0
        self.client = TestClient(app, raise_server_exceptions=False)

    def _filter(self, slot, now, ics=DAY_ICS):
        with patch.object(calendar_service, "fetch_raw_feed", return_value=ics.decode("utf-8")):
            return calendar_service.filter_events_for_slot(slot, now=now)

    # ---- Requirement 1: only 8am / 4pm ----

    def test_only_two_slots_defined(self):
        self.assertEqual(set(SLOT_LABELS), {"8am", "4pm"})

    def test_legacy_and_unknown_slots_rejected(self):
        for bad in ("11am", "3pm", "6pm", "morning", "evening", "08:00", "16:00", "", "invalid"):
            with self.subTest(slot=bad), self.assertRaises(ValueError):
                self._filter(bad, AT_8AM)

    def test_slot_is_case_and_whitespace_insensitive(self):
        _, label, _ = self._filter("  8AM ", AT_8AM)
        self.assertEqual(label, SLOT_LABELS["8am"])

    # ---- Requirement 2: identical full-day data ----

    def test_8am_and_4pm_return_identical_data(self):
        events_8, label_8, preview_8 = self._filter("8am", AT_8AM)
        events_4, label_4, preview_4 = self._filter("4pm", AT_4PM)

        self.assertEqual(events_8, events_4)
        self.assertEqual(preview_8, preview_4)
        self.assertNotEqual(label_8, label_4)

    def test_today_covers_entire_day(self):
        events, _, _ = self._filter("8am", AT_8AM)
        self.assertEqual(_ids(events), TODAY_IDS)

    def test_4pm_still_includes_events_already_past(self):
        events, _, _ = self._filter("4pm", AT_4PM)
        self.assertIn("today_early", _ids(events))  # 07:00 IST, before both triggers

    def test_excludes_yesterday_including_all_day_and_midnight_boundary(self):
        events, _, _ = self._filter("8am", AT_8AM)
        self.assertNotIn("yesterday_deadline", _ids(events))
        self.assertNotIn("yesterday_allday", _ids(events))  # ends exactly at 00:00 today

    def test_multi_day_event_spanning_today_is_included(self):
        events, _, preview = self._filter("8am", AT_8AM)
        self.assertIn("multi_day_fest", _ids(events))
        self.assertNotIn("multi_day_fest", _ids(preview))

    def test_tomorrow_preview_covers_full_tomorrow_only(self):
        _, _, preview = self._filter("4pm", AT_4PM)
        self.assertEqual(_ids(preview), TOMORROW_IDS)
        self.assertNotIn("day_after", _ids(preview))

    def test_regression_evening_only_day_matches_at_8am(self):
        """Oct 5 2026: the only event was 18:30 IST and the 8am cron sent nothing."""
        events, _, _ = self._filter("8am", AT_8AM, ics=EVENING_ONLY_ICS)
        self.assertEqual([e["title"] for e in events], ["Introduction to Generative AI"])

    def test_today_all_day_event_included(self):
        ics = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:today_holiday
SUMMARY:Institute Holiday
DTSTART;VALUE=DATE:20261005
DTEND;VALUE=DATE:20261006
END:VEVENT
END:VCALENDAR
"""
        events, _, preview = self._filter("8am", AT_8AM, ics=ics)
        self.assertEqual(_ids(events), {"today_holiday"})
        self.assertEqual(preview, [])

    # ---- Message formatting ----

    def test_header_icons_per_slot(self):
        msg_8 = format_whatsapp_message([], slot_label=SLOT_LABELS["8am"])
        msg_4 = format_whatsapp_message([], slot_label=SLOT_LABELS["4pm"])
        self.assertIn("🌅 _8:00 AM Daily Reminder_", msg_8)
        self.assertIn("🌆 _4:00 PM Daily Reminder_", msg_4)

    # ---- Cron endpoint ----

    def test_cron_endpoint_rejects_legacy_slots(self):
        with patch.dict(os.environ, {"CRON_SECRET": "s3cret"}):
            for bad in ("11am", "3pm", "6pm", "morning"):
                with self.subTest(slot=bad):
                    res = self.client.post(
                        f"/api/cron/trigger-alert?slot={bad}",
                        headers={"Authorization": "Bearer s3cret"},
                    )
                    self.assertEqual(res.status_code, 400)

    def test_cron_endpoint_dispatches_same_events_for_both_slots(self):
        dispatched = {}

        def fake_dispatch(slot, events, slot_label, tomorrow_preview=None, force_send_empty=False):
            dispatched[slot] = (_ids(events), _ids(tomorrow_preview or []))
            return {"status": "simulated"}

        fixed_now = AT_8AM
        real_filter = calendar_service.filter_events_for_slot

        with patch.dict(os.environ, {"CRON_SECRET": "s3cret"}), \
             patch.object(calendar_service, "fetch_raw_feed", return_value=DAY_ICS.decode("utf-8")), \
             patch.object(calendar_service, "filter_events_for_slot",
                          side_effect=lambda slot: real_filter(slot, now=fixed_now)), \
             patch.object(whatsapp_service, "dispatch_slot_alert", side_effect=fake_dispatch):
            for slot in ("8am", "4pm"):
                res = self.client.post(
                    f"/api/cron/trigger-alert?slot={slot}",
                    headers={"Authorization": "Bearer s3cret"},
                )
                self.assertEqual(res.status_code, 200, res.text)
                self.assertEqual(res.json()["events_count"], len(TODAY_IDS))
                self.assertEqual(res.json()["tomorrow_preview_count"], len(TOMORROW_IDS))

        self.assertEqual(dispatched["8am"], dispatched["4pm"])
        self.assertEqual(dispatched["8am"], (TODAY_IDS, TOMORROW_IDS))


if __name__ == "__main__":
    unittest.main()
