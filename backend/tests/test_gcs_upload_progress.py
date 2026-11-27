import os
import tempfile
from unittest.mock import MagicMock, patch
import pytest

from backend.gcs_storage import GCSStorageService


def test_download_and_upload_hls_to_gcs_progress_callback():
    """Verify that download_and_upload_hls_to_gcs chunks local file and reports live progress."""
    service = GCSStorageService()

    # Create dummy video file to simulate muxed MP4
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        # Write 10 MB of dummy data
        f.write(b"0" * (10 * 1024 * 1024))
        temp_file_path = f.name

    progress_messages = []

    def mock_progress_callback(msg: str):
        progress_messages.append(msg)

    # Mock client and blob
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_blob = MagicMock()

    mock_client.bucket.return_value = mock_bucket
    mock_bucket.blob.return_value = mock_blob

    # Mock BlobWriter context manager
    mock_blob_writer = MagicMock()
    mock_blob.open.return_value.__enter__.return_value = mock_blob_writer

    try:
        with patch.object(service, "_get_client", return_value=mock_client), \
             patch("yt_dlp.YoutubeDL") as mock_ydl, \
             patch("tempfile.mkdtemp", return_value=os.path.dirname(temp_file_path)):

            # Mock ydl.download to simulate writing to the temp mp4
            def fake_download(*args, **kwargs):
                return 0
            mock_ydl.return_value.__enter__.return_value.download.side_effect = fake_download

            result = service.download_and_upload_hls_to_gcs(
                hls_url="https://example.com/playlist.m3u8",
                blob_name="courses/test-course/lectures/123/video.mp4",
                progress_callback=mock_progress_callback
            )

            assert result["status"] == "success"
            assert result["blob_name"] == "courses/test-course/lectures/123/video.mp4"
            assert result["size_mb"] == 10.0

            # Verify chunked writes occurred
            assert mock_blob_writer.write.call_count >= 2

            # Verify progress callback was triggered
            assert any("Uploading" in m for m in progress_messages)
            assert any("Uploaded successfully" in m for m in progress_messages)

    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


def test_download_and_upload_hls_to_gcs_fallback_on_stream_error():
    """Verify fallback to upload_from_filename if blob.open streaming write raises error."""
    service = GCSStorageService()

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(b"0" * (5 * 1024 * 1024))
        temp_file_path = f.name

    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_blob = MagicMock()
    mock_client.bucket.return_value = mock_bucket
    mock_bucket.blob.return_value = mock_blob

    # Simulate blob.open failing
    mock_blob.open.side_effect = RuntimeError("Simulated blob.open failure")

    try:
        with patch.object(service, "_get_client", return_value=mock_client), \
             patch("yt_dlp.YoutubeDL") as mock_ydl, \
             patch("tempfile.mkdtemp", return_value=os.path.dirname(temp_file_path)):

            result = service.download_and_upload_hls_to_gcs(
                hls_url="https://example.com/playlist.m3u8",
                blob_name="courses/test-course/lectures/123/video.mp4"
            )

            assert result["status"] == "success"
            # Fallback upload_from_filename must have been called
            mock_blob.upload_from_filename.assert_called_once()

    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
