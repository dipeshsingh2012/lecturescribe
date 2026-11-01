import io
import json
import os
import unittest
from unittest.mock import patch, MagicMock
from backend.video_client import (
    extract_video_id,
    fetch_player_config,
    format_timestamp,
    parse_vtt,
    parse_timestamp_to_seconds,
)

class TestVideoClient(unittest.TestCase):
    def test_extract_video_id_from_raw_id(self):
        self.assertEqual(extract_video_id("1229247139"), "1229247139")
        self.assertEqual(extract_video_id("  1229247139  "), "1229247139")
        self.assertEqual(extract_video_id("\t76979871\n"), "76979871")

    def test_extract_video_id_from_url(self):
        self.assertEqual(extract_video_id("https://video.local/1229247139"), "1229247139")
        self.assertEqual(extract_video_id("http://video.local/1229247139"), "1229247139")
        self.assertEqual(extract_video_id("https://www.video.local/1229247139"), "1229247139")
        self.assertEqual(extract_video_id("video.local/1229247139"), "1229247139")
        self.assertEqual(extract_video_id("https://player.video.local/video/1229247139"), "1229247139")
        self.assertEqual(extract_video_id("http://player.video.local/video/76979871"), "76979871")

    def test_extract_video_id_from_url_with_parameters_and_fragments(self):
        self.assertEqual(extract_video_id("https://video.local/1229247139?autoplay=1"), "1229247139")
        self.assertEqual(extract_video_id("https://video.local/1229247139?param1=val&param2=123"), "1229247139")
        self.assertEqual(extract_video_id("https://video.local/1229247139#t=30s"), "1229247139")
        self.assertEqual(extract_video_id("https://video.local/1229247139/?autoplay=1#t=1m"), "1229247139")
        self.assertEqual(extract_video_id("https://video.local/1229247139/"), "1229247139")

    def test_extract_video_id_from_special_formats(self):
        # Unlisted / private hash
        self.assertEqual(extract_video_id("https://video.local/1229247139/abc123def"), "1229247139")
        # Channels
        self.assertEqual(extract_video_id("https://video.local/channels/staffpicks/1229247139"), "1229247139")
        # Groups
        self.assertEqual(extract_video_id("https://video.local/groups/motion/videos/1229247139"), "1229247139")
        # Manage videos
        self.assertEqual(extract_video_id("https://video.local/manage/videos/1229247139"), "1229247139")

    def test_extract_video_id_invalid(self):
        with self.assertRaises(ValueError):
            extract_video_id("")
        with self.assertRaises(ValueError):
            extract_video_id("   ")
        with self.assertRaises(ValueError):
            extract_video_id("https://video.local/about")
        with self.assertRaises(ValueError):
            extract_video_id("https://youtube.com/watch?v=123456")

    def test_format_timestamp(self):
        self.assertEqual(format_timestamp("00:01:23.456"), "01:23")
        self.assertEqual(format_timestamp("01:05:30.000"), "1:05:30")
        self.assertEqual(format_timestamp("00:00:15.100"), "00:15")

    def test_parse_timestamp_to_seconds(self):
        self.assertEqual(parse_timestamp_to_seconds("00:00"), 0.0)
        self.assertEqual(parse_timestamp_to_seconds("01:30"), 90.0)
        self.assertEqual(parse_timestamp_to_seconds("1:05:30"), 3930.0)
        self.assertEqual(parse_timestamp_to_seconds("108:04"), 4084.0)
        self.assertEqual(parse_timestamp_to_seconds("00:01:23.456"), 83.0)
        self.assertEqual(parse_timestamp_to_seconds("[14:20]"), 860.0)
        self.assertEqual(parse_timestamp_to_seconds(120), 120.0)
        self.assertEqual(parse_timestamp_to_seconds(None), 0.0)
        self.assertEqual(parse_timestamp_to_seconds(""), 0.0)

    def test_parse_vtt(self):
        sample_vtt = """WEBVTT

1
00:00:01.000 --> 00:00:04.000
Welcome to the lecture.

2
00:00:05.000 --> 00:00:09.000
Today we discuss distributed systems.
"""
        segments = parse_vtt(sample_vtt)
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["text"], "Welcome to the lecture.")
        self.assertEqual(segments[0]["start"], "00:00:01.000")
        self.assertEqual(segments[1]["text"], "Today we discuss distributed systems.")

    def test_fetch_player_config_uses_lms_referer_fallback_and_ignores_local_placeholder(self):
        captured_requests = []

        def fake_urlopen(req, timeout=15):
            captured_requests.append(req)
            resp = MagicMock()
            resp.__enter__.return_value = io.BytesIO(json.dumps({"video": {"title": "GenAI 5"}}).encode("utf-8"))
            resp.__exit__.return_value = False
            return resp

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("VIDEO_PLAYER_CONFIG_BASE", None)
            os.environ.pop("DEFAULT_VIDEO_REFERER", None)
            os.environ.pop("LMS_REFERER", None)
            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                cfg = fetch_player_config("1235498967", referer="https://video.lecturescribe.local/1235498967")
                self.assertEqual(cfg["video"]["title"], "GenAI 5")
                self.assertEqual(len(captured_requests), 1)
                self.assertEqual(
                    captured_requests[0].full_url,
                    "https://player.vimeo.com/video/1235498967/config",
                )
                self.assertEqual(
                    captured_requests[0].headers.get("Referer"),
                    "https://learning.iiitdwd.ac.in/",
                )

if __name__ == "__main__":
    unittest.main()

