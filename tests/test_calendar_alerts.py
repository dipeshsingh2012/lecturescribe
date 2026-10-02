import os
import unittest
import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.calendar_parser import (
    parse_ical_content,
    categorize_event,
    calendar_service,
    IST
)
from backend.whatsapp_service import (
    format_whatsapp_message,
    whatsapp_service
)

SAMPLE_ICS_CONTENT = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Moodle Pty Ltd//NONSGML Moodle 2026//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:moodle_101
SUMMARY:Linear Algebra Quiz 3
DESCRIPTION:Covers Vector Spaces and Linear Transformations.
LOCATION:LH-201
DTSTART:20261002T060000Z
DTEND:20261002T073000Z
CATEGORIES:Quiz
END:VEVENT
BEGIN:VEVENT
UID:moodle_102
SUMMARY:Machine Learning Assignment 2 Due
DESCRIPTION:Submit GitHub repo link for k-means and PCA implementation.
DTSTART:20261002T130000Z
DTEND:20261002T182900Z
CATEGORIES:Assignment
END:VEVENT
BEGIN:VEVENT
UID:moodle_103
SUMMARY:Operating Systems Midsem Exam
DESCRIPTION:All units up to concurrency and semaphores.
LOCATION:Auditorium
DTSTART:20261003T040000Z
DTEND:20261003T070000Z
CATEGORIES:Exam
END:VEVENT
BEGIN:VEVENT
UID:moodle_104
SUMMARY:Institute Holiday - Gandhi Jayanti
DTSTART;VALUE=DATE:20261002
DTEND;VALUE=DATE:20261003
END:VEVENT
END:VCALENDAR
"""


class TestCalendarAlerts(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_categorize_event(self):
        self.assertEqual(categorize_event("Operating Systems Midsem Exam"), "exam")
        self.assertEqual(categorize_event("Discrete Math Quiz 1"), "quiz")
        self.assertEqual(categorize_event("Homework 3 submission"), "assignment")
        self.assertEqual(categorize_event("Computer Networks Lab 4"), "lab")
        self.assertEqual(categorize_event("Applied AI Lecture Session"), "lecture")
        self.assertEqual(categorize_event("General Orientation"), "general")

    def test_parse_ical_content(self):
        events = parse_ical_content(SAMPLE_ICS_CONTENT)
        self.assertEqual(len(events), 4)

        # Event 1: Quiz at 06:00 UTC = 11:30 AM IST
        q_evt = next(e for e in events if e["id"] == "moodle_101")
        self.assertEqual(q_evt["title"], "Linear Algebra Quiz 3")
        self.assertEqual(q_evt["category"], "quiz")
        self.assertEqual(q_evt["location"], "LH-201")
        self.assertFalse(q_evt["is_all_day"])
        self.assertEqual(q_evt["start_time_formatted"], "11:30 AM")
        self.assertEqual(q_evt["end_time_formatted"], "01:00 PM")

        # Event 2: Assignment due at 18:29 UTC = 11:59 PM IST
        a_evt = next(e for e in events if e["id"] == "moodle_102")
        self.assertEqual(a_evt["category"], "assignment")
        self.assertEqual(a_evt["end_time_formatted"], "11:59 PM")

        # Event 4: All-day holiday
        h_evt = next(e for e in events if e["id"] == "moodle_104")
        self.assertTrue(h_evt["is_all_day"])

    def test_slot_filtering(self):
        # Anchor test time to 2026-10-02
        ref_time = datetime.datetime(2026, 10, 2, 10, 0, 0, tzinfo=IST)

        with patch.object(calendar_service, "fetch_raw_feed", return_value=SAMPLE_ICS_CONTENT.decode("utf-8")):
            # Reset cache
            calendar_service._memory_cache = None

            # 1. 11am slot (11:00 AM - 3:30 PM): should match Quiz (11:30 AM - 1:00 PM) and All-Day event
            events_11am, label_11am, _ = calendar_service.filter_events_for_slot("11am", now=ref_time)
            self.assertIn("11:00 AM", label_11am)
            titles_11am = [e["title"] for e in events_11am]
            self.assertIn("Linear Algebra Quiz 3", titles_11am)

            # 2. 6pm slot (6:00 PM - 11:59 PM): should match Assignment due at 11:59 PM
            # and tomorrow morning preview (8:00 AM - 11:00 AM) should match Midsem Exam at 04:00 UTC = 09:30 AM IST
            events_6pm, label_6pm, preview = calendar_service.filter_events_for_slot("6pm", now=ref_time)
            self.assertIn("6:00 PM", label_6pm)
            titles_6pm = [e["title"] for e in events_6pm]
            self.assertIn("Machine Learning Assignment 2 Due", titles_6pm)
            self.assertIsNotNone(preview)
            self.assertTrue(any("Midsem Exam" in p["title"] for p in preview))

    def test_format_whatsapp_message(self):
        events = [
            {
                "title": "Machine Learning Assignment 2",
                "category": "assignment",
                "start_time_formatted": "06:30 PM",
                "end_time_formatted": "11:59 PM",
                "is_all_day": False,
                "location": "Moodle Portal",
                "description": "Submit Python code and report."
            }
        ]
        msg = format_whatsapp_message(events, slot_label="6:00 PM Evening Deadlines")
        self.assertIn("LectureScribe Academic Alert", msg)
        self.assertIn("ASSIGNMENT DUE", msg)
        self.assertIn("Machine Learning Assignment 2", msg)
        self.assertIn("06:30 PM", msg)
        self.assertIn("Moodle Portal", msg)

    def test_twilio_simulation_when_no_credentials(self):
        # When unconfigured, should return simulated status and print preview
        with patch.dict(os.environ, {"TWILIO_ACCOUNT_SID": "", "TWILIO_AUTH_TOKEN": "", "TWILIO_WHATSAPP_TO": ""}), \
             patch.object(whatsapp_service, "_refresh_env"):
            whatsapp_service.account_sid = ""
            whatsapp_service.auth_token = ""
            whatsapp_service.to_number = ""
            res = whatsapp_service.send_whatsapp_message("Test message", recipient="")
            self.assertEqual(res["status"], "simulated")
            self.assertIn("Twilio credentials not configured", res["message"])

    @patch("requests.post")
    def test_twilio_live_dispatch(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"sid": "SM_TEST_123"}
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {
            "TWILIO_ACCOUNT_SID": "AC12345",
            "TWILIO_AUTH_TOKEN": "token123",
            "TWILIO_WHATSAPP_FROM": "whatsapp:+14155238886",
            "TWILIO_WHATSAPP_TO": "whatsapp:+919876543210"
        }):
            from backend.whatsapp_service import TwilioWhatsAppService
            svc = TwilioWhatsAppService()
            res = svc.send_whatsapp_message("Live test message")
            self.assertEqual(res["status"], "sent")
            self.assertEqual(res["sid"], "SM_TEST_123")
            mock_post.assert_called_once()

    def test_api_calendar_events_endpoint(self):
        with patch.object(calendar_service, "fetch_raw_feed", return_value=SAMPLE_ICS_CONTENT.decode("utf-8")):
            res = self.client.get("/api/calendar/events?refresh=true")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "success")
            self.assertIn("today", data)
            self.assertIn("counts", data)
            self.assertIn("upcoming", data)

    def test_api_calendar_test_alert_endpoint(self):
        with patch.object(calendar_service, "fetch_raw_feed", return_value=SAMPLE_ICS_CONTENT.decode("utf-8")):
            res = self.client.post("/api/calendar/test-alert")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "success")
            self.assertIn("dispatch_result", data)

    def test_api_cron_trigger_endpoint_security(self):
        with patch.dict(os.environ, {"CRON_SECRET": "my_super_secret_cron_key"}):
            # 1. No auth header -> 401
            res_no_auth = self.client.post("/api/cron/trigger-alert?slot=11am")
            self.assertEqual(res_no_auth.status_code, 401)

            # 2. Invalid auth header -> 401
            res_bad_auth = self.client.post(
                "/api/cron/trigger-alert?slot=11am",
                headers={"Authorization": "Bearer wrong_token"}
            )
            self.assertEqual(res_bad_auth.status_code, 401)

            # 3. Invalid slot -> 400
            res_bad_slot = self.client.post(
                "/api/cron/trigger-alert?slot=invalid_slot",
                headers={"Authorization": "Bearer my_super_secret_cron_key"}
            )
            self.assertEqual(res_bad_slot.status_code, 400)

            # 4. Valid token and slot -> 200
            with patch.object(calendar_service, "fetch_raw_feed", return_value=SAMPLE_ICS_CONTENT.decode("utf-8")):
                res_ok = self.client.post(
                    "/api/cron/trigger-alert?slot=11am",
                    headers={"Authorization": "Bearer my_super_secret_cron_key"}
                )
                self.assertEqual(res_ok.status_code, 200)
                data = res_ok.json()
                self.assertEqual(data["status"], "success")
                self.assertEqual(data["slot"], "11am")


if __name__ == "__main__":
    unittest.main()
