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
    extract_meeting_info,
    detect_meeting_platform,
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

            events_8am, label_8am, preview_8am = calendar_service.filter_events_for_slot("8am", now=ref_time)
            events_4pm, label_4pm, preview_4pm = calendar_service.filter_events_for_slot("4pm", now=ref_time)

            self.assertIn("8:00 AM", label_8am)
            self.assertIn("4:00 PM", label_4pm)

            # Both slots cover the entire day: quiz (11:30 AM), assignment (6:30 PM) and all-day holiday
            for evts in (events_8am, events_4pm):
                titles = [e["title"] for e in evts]
                self.assertIn("Linear Algebra Quiz 3", titles)
                self.assertIn("Machine Learning Assignment 2 Due", titles)
                self.assertIn("Institute Holiday - Gandhi Jayanti", titles)

            # Tomorrow preview (Midsem Exam at 09:30 AM IST on Oct 3) present for both slots
            for preview in (preview_8am, preview_4pm):
                self.assertTrue(any("Midsem Exam" in p["title"] for p in preview))

            # Removed legacy slots are rejected
            with self.assertRaises(ValueError):
                calendar_service.filter_events_for_slot("11am", now=ref_time)

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
        msg = format_whatsapp_message(events, slot_label="4:00 PM Daily Reminder")
        self.assertIn("Schedule for Today", msg)
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

    def test_api_calendar_test_alert_endpoint_is_removed(self):
        res = self.client.post("/api/calendar/test-alert")
        self.assertIn(res.status_code, (404, 405))

    def test_api_cron_trigger_endpoint_security(self):
        with patch.dict(os.environ, {"CRON_SECRET": "my_super_secret_cron_key"}):
            # 1. No auth header -> 401
            res_no_auth = self.client.post("/api/cron/trigger-alert?slot=8am")
            self.assertEqual(res_no_auth.status_code, 401)

            # 2. Invalid auth header -> 401
            res_bad_auth = self.client.post(
                "/api/cron/trigger-alert?slot=8am",
                headers={"Authorization": "Bearer wrong_token"}
            )
            self.assertEqual(res_bad_auth.status_code, 401)

            # 3. Invalid slot -> 400
            res_bad_slot = self.client.post(
                "/api/cron/trigger-alert?slot=invalid_slot",
                headers={"Authorization": "Bearer my_super_secret_cron_key"}
            )
            self.assertEqual(res_bad_slot.status_code, 400)

            # 4. Valid token and slot -> 200 (test 8am and 4pm)
            with patch.object(calendar_service, "fetch_raw_feed", return_value=SAMPLE_ICS_CONTENT.decode("utf-8")):
                res_8am = self.client.post(
                    "/api/cron/trigger-alert?slot=8am",
                    headers={"Authorization": "Bearer my_super_secret_cron_key"}
                )
                self.assertEqual(res_8am.status_code, 200)
                data_8am = res_8am.json()
                self.assertEqual(data_8am["status"], "success")
                self.assertEqual(data_8am["slot"], "8am")

                res_4pm = self.client.post(
                    "/api/cron/trigger-alert?slot=4pm",
                    headers={"Authorization": "Bearer my_super_secret_cron_key"}
                )
                self.assertEqual(res_4pm.status_code, 200)
                data_4pm = res_4pm.json()
                self.assertEqual(data_4pm["status"], "success")
                self.assertEqual(data_4pm["slot"], "4pm")

    def test_extract_meeting_info(self):
        # 1. Zoom link in description with passcodes and credentials
        desc = "Join Zoom Meeting\nhttps://us02web.zoom.us/j/884920192?pwd=abcd\nMeeting ID: 884 920 192\nPasscode: 12345"
        url, platform = extract_meeting_info(description=desc)
        self.assertEqual(url, "https://us02web.zoom.us/j/884920192?pwd=abcd")
        self.assertEqual(platform, "zoom")

        # 2. Google Meet link in location
        loc = "https://meet.google.com/xyz-uvw-rst"
        url, platform = extract_meeting_info(location=loc)
        self.assertEqual(url, "https://meet.google.com/xyz-uvw-rst")
        self.assertEqual(platform, "meet")

        # 3. Microsoft Teams link in url_prop
        url_prop = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_xyz"
        url, platform = extract_meeting_info(url_prop=url_prop)
        self.assertEqual(url, url_prop)
        self.assertEqual(platform, "teams")

        # 4. Prioritizes video conference URL over moodle link when both exist
        url, platform = extract_meeting_info(
            url_prop="https://learning.iiitdwd.ac.in/mod/url/view.php?id=100",
            description="Live class at https://zoom.us/j/12345678"
        )
        self.assertEqual(url, "https://zoom.us/j/12345678")
        self.assertEqual(platform, "zoom")

        # 5. No URLs
        url, platform = extract_meeting_info(location="LH-201", description="In-person classroom session")
        self.assertIsNone(url)
        self.assertIsNone(platform)

    def test_parse_ical_with_meeting_links(self):
        sample_ics = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:meet_zoom_1
SUMMARY:Computer Networks Lecture
DESCRIPTION:Join Zoom Meeting: https://zoom.us/j/9988776655?pwd=pass\nMeeting ID: 9988776655
LOCATION:Online Zoom
DTSTART:20261005T040000Z
DTEND:20261005T050000Z
END:VEVENT
BEGIN:VEVENT
UID:meet_gmeet_2
SUMMARY:Cloud Computing Viva
LOCATION:https://meet.google.com/abc-defg-hij
DTSTART:20261005T060000Z
DTEND:20261005T070000Z
END:VEVENT
END:VCALENDAR
"""
        events = parse_ical_content(sample_ics)
        self.assertEqual(len(events), 2)

        zoom_evt = next(e for e in events if e["id"] == "meet_zoom_1")
        self.assertEqual(zoom_evt["meeting_url"], "https://zoom.us/j/9988776655?pwd=pass")
        self.assertEqual(zoom_evt["meeting_platform"], "zoom")

        meet_evt = next(e for e in events if e["id"] == "meet_gmeet_2")
        self.assertEqual(meet_evt["meeting_url"], "https://meet.google.com/abc-defg-hij")
        self.assertEqual(meet_evt["meeting_platform"], "meet")


if __name__ == "__main__":
    unittest.main()
