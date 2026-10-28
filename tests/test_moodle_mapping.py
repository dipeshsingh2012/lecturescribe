from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from backend.main import app, db_manager


@pytest.fixture
def client():
    return TestClient(app)


def test_map_moodle_video_validation(client):
    # Missing video_id
    resp = client.post("/api/moodle/map-video", json={
        "video_id": "",
        "moodle_url": "https://learning.iiitdwd.ac.in/mod/page/view.php?id=3111"
    })
    assert resp.status_code in (400, 422)

    # Invalid URL scheme
    resp = client.post("/api/moodle/map-video", json={
        "video_id": "123456789",
        "moodle_url": "ftp://not-a-web-url"
    })
    assert resp.status_code == 400


def test_map_moodle_video_success(client):
    video_id = "test_moodle_sync_123"
    test_email = "student@test.com"
    moodle_page = "https://learning.iiitdwd.ac.in/mod/page/view.php?id=4999"

    with patch.object(db_manager, "update_video_source_url", return_value=True) as mock_update:
        resp = client.post("/api/moodle/map-video", json={
            "video_id": video_id,
            "moodle_url": moodle_page,
            "course_name": "1.2 Machine Learning Paradigms",
            "user_email": test_email
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert data["video_id"] == video_id
        assert data["source_url"] == moodle_page
        assert data["updated"] is True

        mock_update.assert_called_once_with(
            video_id=video_id,
            source_url=moodle_page,
            user_email=test_email,
            course_name="1.2 Machine Learning Paradigms"
        )


def test_database_update_video_source_url_memory_fallback():
    video_id = "test_local_cache_vid"
    moodle_page = "https://learning.iiitdwd.ac.in/mod/page/view.php?id=8888"

    # Pre-seed memory cache
    db_manager._memory_cache[video_id] = {
        "videoId": video_id,
        "title": "Local Lecture",
        "sourceUrl": "https://video.lecturescribe.local/test_local_cache_vid"
    }

    # Calling update_video_source_url updates the memory cache even if DB connection fails
    with patch.object(db_manager, "_get_connection", side_effect=Exception("DB Down")):
        res = db_manager.update_video_source_url(video_id, moodle_page)
        assert res is False
        # If DB connection failed, exception is logged safely and returns False

    # When DB is mocked to succeed:
    from unittest.mock import MagicMock
    mock_conn = MagicMock()
    with patch.object(db_manager, "_get_connection", return_value=mock_conn):
        res = db_manager.update_video_source_url(video_id, moodle_page)
        assert res is True
        assert db_manager._memory_cache[video_id]["sourceUrl"] == moodle_page
