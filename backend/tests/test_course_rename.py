import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import db_manager, to_course_slug

client = TestClient(app)


def test_rename_course_validation():
    # Empty course name
    with pytest.raises(ValueError, match="Course name cannot be empty"):
        db_manager.rename_course("some-course", "   ")

    # Name too short
    with pytest.raises(ValueError, match="Course name must be at least 2 characters"):
        db_manager.rename_course("some-course", "a")


def test_rename_course_flow():
    # Create a unique test course in memory / DB
    init_name = "Test Course Architecture"
    course = db_manager.get_or_create_course(init_name, course_name=init_name)
    assert course is not None
    orig_slug = course["slug"]

    # No-op rename
    res_noop = db_manager.rename_course(orig_slug, init_name)
    assert res_noop["status"] == "no_change"
    assert res_noop["course_name"] == init_name

    # Successful rename
    renamed_name = "Test Course Modern Architecture"
    res = db_manager.rename_course(orig_slug, renamed_name)
    assert res["status"] == "success"
    assert res["course_name"] == renamed_name
    assert res["new_name"] == renamed_name
    assert res["old_name"] == init_name
    assert orig_slug in res["aliases"]

    # Verify lookup by new slug
    new_slug = res["new_slug"]
    found_by_new = db_manager.get_course(new_slug)
    assert found_by_new is not None
    assert found_by_new["name"] == renamed_name

    # Verify lookup by old slug (via aliases!)
    found_by_old = db_manager.get_course(orig_slug)
    assert found_by_old is not None
    assert found_by_old["name"] == renamed_name
    assert found_by_old["id"] == found_by_new["id"]


def test_rename_course_collision():
    # Create two distinct courses
    c1 = db_manager.get_or_create_course("Course Alpha Unique", course_name="Course Alpha Unique")
    c2 = db_manager.get_or_create_course("Course Beta Unique", course_name="Course Beta Unique")

    # Renaming c2 to c1's name should raise collision
    with pytest.raises(ValueError, match="already exists"):
        db_manager.rename_course(c2["slug"], "Course Alpha Unique")


def test_rename_course_api_endpoint():
    c = db_manager.get_or_create_course("API Renameable Course", course_name="API Renameable Course")
    slug = c["slug"]

    # Call endpoint with empty name -> 400
    res = client.patch(f"/api/course/{slug}", json={"new_name": "  "})
    assert res.status_code == 400

    # Call endpoint with valid name
    new_name = "API Renamed Successfully"
    res = client.patch(f"/api/course/{slug}", json={"new_name": new_name})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["course_name"] == new_name
    assert data["new_slug"] == to_course_slug(new_name)


def test_rename_video_validation_and_flow():
    # Empty title
    with pytest.raises(ValueError, match="Lecture title cannot be empty"):
        db_manager.rename_video("test-vid-1", "   ")

    # Save a mock video in memory/DB
    db_manager._memory_cache["test-rename-vid-1"] = {
        "title": "Original Lecture Title",
        "course_name": "Test Course",
        "cues": []
    }

    # Rename video
    res = db_manager.rename_video("test-rename-vid-1", "Updated Lecture Title")
    assert res["status"] == "success"
    assert res["video_id"] == "test-rename-vid-1"
    assert res["title"] == "Updated Lecture Title"

    saved = db_manager.get_saved_video("test-rename-vid-1")
    assert saved is not None
    assert saved["title"] == "Updated Lecture Title"


def test_rename_video_api_endpoint():
    db_manager._memory_cache["test-api-vid-1"] = {
        "title": "Initial API Title",
        "course_name": "API Course",
        "cues": []
    }

    # Call endpoint with empty title -> 400
    res = client.patch("/api/videos/test-api-vid-1", json={"title": "  "})
    assert res.status_code == 400

    # Call endpoint with valid title
    new_title = "Modern Clustered Algorithms Session"
    res = client.patch("/api/videos/test-api-vid-1", json={"title": new_title})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["title"] == new_title


