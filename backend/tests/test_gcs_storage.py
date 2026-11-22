import sys
from types import SimpleNamespace

from backend import gcs_storage
from backend.gcs_storage import GCSStorageService


def test_hls_upload_uses_extended_resumable_upload_retry(monkeypatch):
    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def download(self, _urls):
            with open(self.options["outtmpl"], "wb") as output:
                output.write(b"muxed video")

    class FakeRetry:
        deadline = None

        def with_deadline(self, deadline):
            self.deadline = deadline
            return self

    class FakeBlob:
        chunk_size = None
        upload_options = None

        def upload_from_filename(self, _filename, **options):
            self.upload_options = options

    blob = FakeBlob()
    retry = FakeRetry()
    client = SimpleNamespace(
        bucket=lambda _bucket_name: SimpleNamespace(blob=lambda _blob_name: blob)
    )
    service = GCSStorageService("test-bucket")
    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=FakeYoutubeDL))
    monkeypatch.setattr(service, "_get_client", lambda: client)
    monkeypatch.setattr(service, "generate_download_signed_url", lambda _blob_name: "signed-url")
    monkeypatch.setattr(gcs_storage, "GCS_DEFAULT_RETRY", retry)

    result = service.download_and_upload_hls_to_gcs(
        hls_url="https://example.test/stream.m3u8",
        blob_name="lectures/video.mp4",
        video_id="video",
    )

    assert result["status"] == "success"
    assert retry.deadline == gcs_storage.GCS_VIDEO_UPLOAD_RETRY_DEADLINE_SECONDS
    assert blob.chunk_size == 4 * 1024 * 1024
    assert blob.upload_options["timeout"] == gcs_storage.GCS_VIDEO_UPLOAD_TIMEOUT
    assert blob.upload_options["retry"] is retry


def test_bundle_reports_video_failure_as_partial_success(monkeypatch, capsys):
    service = GCSStorageService("test-bucket")
    monkeypatch.setattr(service, "upload_blob_text", lambda *_args, **_kwargs: "gs://test-bucket/doc")
    monkeypatch.setattr(service, "generate_download_signed_url", lambda _blob_name: "signed-url")
    monkeypatch.setattr(
        service,
        "download_and_upload_hls_to_gcs",
        lambda **_kwargs: {
            "status": "error",
            "blob_name": "lectures/video.mp4",
            "error": "upload timed out",
        },
    )

    result = service.upload_lecture_bundle(
        video_id="video",
        title="Test lecture",
        cues=[],
        streams_info={"hls": {"master_url": "https://example.test/stream.m3u8"}},
    )

    output = capsys.readouterr().out
    assert result["status"] == "partial_success"
    assert result["video_uploaded"] is False
    assert result["video_details"]["error"] == "upload timed out"
    assert "[GCS Bundle Upload Partial]" in output
    assert "Video Upload:     error" in output
    assert "[GCS Bundle Upload Complete]" not in output
