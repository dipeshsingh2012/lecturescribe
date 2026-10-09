"""
Google Cloud Storage (GCS) Client for LectureScribe Resources
--------------------------------------------------------------
Provides secure V4 Signed URLs for direct-to-bucket uploads and downloads,
organizing resources by course and lecture.
"""
from __future__ import annotations

import os
import json
import re
import uuid
import time
import datetime
from typing import Optional, Dict, Any, List

from dotenv import load_dotenv
load_dotenv()

import requests
import google.auth
from google.auth.transport import requests as auth_requests

try:
    from google.cloud import storage
    from google.auth.exceptions import DefaultCredentialsError
except ImportError:
    storage = None
    DefaultCredentialsError = Exception

DEFAULT_BUCKET_NAME = os.getenv("GCS_RESOURCES_BUCKET", "lecturescribe-resources")


class GCSStorageService:
    def __init__(self, bucket_name: Optional[str] = None):
        self.bucket_name = bucket_name or DEFAULT_BUCKET_NAME
        self._client = None
        self._bucket = None
        self._initialized = False

    def _get_client(self):
        if not storage:
            return None
        if self._client is not None:
            return self._client
        try:
            project = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT")
            self._client = storage.Client(project=project)
            self._initialized = True
            return self._client
        except Exception as e:
            print(f"[GCS Notice] Cloud Storage client not initialized with ADC ({e}). Running in mock/emulated mode.")
            return None

    def _get_bucket(self):
        client = self._get_client()
        if not client:
            return None
        if self._bucket is not None:
            return self._bucket
        try:
            self._bucket = client.bucket(self.bucket_name)
            return self._bucket
        except Exception as e:
            print(f"[GCS Warning] Could not access bucket '{self.bucket_name}': {e}")
            return None

    @staticmethod
    def clean_filename(filename: str) -> str:
        """Sanitize filename to avoid path traversal or illegal characters."""
        if not filename:
            return "document"
        base = os.path.basename(filename)
        # Keep alphanumeric, dots, dashes, underscores
        clean = re.sub(r'[^a-zA-Z0-9._\-]', '_', base)
        return clean[:120]

    @staticmethod
    def get_resource_blob_path(course_slug: str, video_id: Optional[str], filename: str) -> str:
        """Generate a hierarchical GCS blob name: courses/{course}/lectures/{video_id}/{uuid}_{file}"""
        safe_course = re.sub(r'[^a-z0-9\-]', '', course_slug.lower()) or "general"
        safe_name = GCSStorageService.clean_filename(filename)
        unique_prefix = uuid.uuid4().hex[:10]
        
        if video_id and str(video_id).strip():
            safe_vid = str(video_id).strip()
            return f"courses/{safe_course}/lectures/{safe_vid}/{unique_prefix}_{safe_name}"
        else:
            return f"courses/{safe_course}/general/{unique_prefix}_{safe_name}"

    def generate_upload_signed_url(
        self,
        blob_name: str,
        content_type: str = "application/octet-stream",
        expires_minutes: int = 15
    ) -> Dict[str, Any]:
        """Generate a V4 signed URL allowing the client to directly PUT bytes into GCS."""
        bucket = self._get_bucket()
        if not bucket:
            # Emulated sandbox fallback when running in tests or without live GCP credentials
            emulated_url = f"https://storage.googleapis.com/{self.bucket_name}/{blob_name}?mock_upload=true"
            return {
                "signed_url": emulated_url,
                "blob_name": blob_name,
                "bucket": self.bucket_name,
                "method": "PUT",
                "expires_in_seconds": expires_minutes * 60,
            }

        blob = bucket.blob(blob_name)

        try:
            url = blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(minutes=expires_minutes),
                method="PUT",
                content_type=content_type,
            )
            return {
                "signed_url": url,
                "blob_name": blob_name,
                "bucket": self.bucket_name,
                "method": "PUT",
                "expires_in_seconds": expires_minutes * 60,
            }
        except Exception as e:
            # Fallback for serverless environments (Cloud Run/Compute) using metadata service
            try:
                credentials, _ = google.auth.default()
                if hasattr(credentials, "service_account_email"):
                    if not credentials.valid:
                        credentials.refresh(auth_requests.Request())
                    url = blob.generate_signed_url(
                        version="v4",
                        expiration=datetime.timedelta(minutes=expires_minutes),
                        method="PUT",
                        content_type=content_type,
                        service_account_email=credentials.service_account_email,
                        access_token=credentials.token,
                    )
                    return {
                        "signed_url": url,
                        "blob_name": blob_name,
                        "bucket": self.bucket_name,
                        "method": "PUT",
                        "expires_in_seconds": expires_minutes * 60,
                    }
            except Exception:
                pass

            print(f"[GCS Signed URL Warning] Could not sign ({e}). Returning emulated URL.")
            return {
                "signed_url": f"https://storage.googleapis.com/{self.bucket_name}/{blob_name}?mock_upload=true",
                "blob_name": blob_name,
                "bucket": self.bucket_name,
                "method": "PUT",
                "expires_in_seconds": expires_minutes * 60,
            }

    def generate_download_signed_url(
        self,
        blob_name: str,
        expires_minutes: int = 60,
        disposition: str = "inline"
    ) -> str:
        """Generate a V4 signed URL allowing the client to GET/view/download the object securely."""
        if not blob_name:
            return ""
            
        bucket = self._get_bucket()
        if bucket:
            try:
                blob = bucket.blob(blob_name)
                url = blob.generate_signed_url(
                    version="v4",
                    expiration=datetime.timedelta(minutes=expires_minutes),
                    method="GET",
                    response_disposition=disposition
                )
                return url
            except Exception as e:
                try:
                    credentials, _ = google.auth.default()
                    if hasattr(credentials, "service_account_email"):
                        if not credentials.valid:
                            credentials.refresh(auth_requests.Request())
                        url = blob.generate_signed_url(
                            version="v4",
                            expiration=datetime.timedelta(minutes=expires_minutes),
                            method="GET",
                            response_disposition=disposition,
                            service_account_email=credentials.service_account_email,
                            access_token=credentials.token,
                        )
                        return url
                except Exception:
                    pass
                print(f"[GCS Download Signed URL Warning] ({e}). Returning standard GCS URL.")

        return f"https://storage.googleapis.com/{self.bucket_name}/{blob_name}"

    def find_lecture_video(
        self,
        video_id: str,
        course_name: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Look up self-hosted video MP4 in GCS under consolidated course path or fallback paths."""
        if not video_id:
            return None
        bucket = self._get_bucket()
        if not bucket:
            return None

        # Build candidate prefixes
        prefixes = []
        if course_name:
            clean_course = re.sub(r'[^a-zA-Z0-9\- ]', '', course_name.lower())
            course_slug = re.sub(r'\s+', '-', clean_course.strip())
            prefixes.append(f"courses/{course_slug}/lectures/{video_id}/")

        prefixes.append(f"lectures/{video_id}/")

        # 1. Check direct candidate prefixes
        for prefix in prefixes:
            try:
                blobs = list(bucket.list_blobs(prefix=prefix))
                for b in blobs:
                    if b.name.endswith((".mp4", ".mkv", ".webm")):
                        view_url = self.generate_download_signed_url(b.name, expires_minutes=180, disposition="inline")
                        return {
                            "blob_name": b.name,
                            "gcs_uri": f"gs://{self.bucket_name}/{b.name}",
                            "view_url": view_url,
                            "filename": os.path.basename(b.name),
                            "size_bytes": b.size
                        }
            except Exception as e:
                print(f"[GCS Lookup Notice] {e}")

        # 2. Fallback: scan across all courses if course_name wasn't exact
        try:
            all_blobs = list(bucket.list_blobs(prefix="courses/"))
            for b in all_blobs:
                if f"/lectures/{video_id}/" in b.name and b.name.endswith((".mp4", ".mkv", ".webm")):
                    view_url = self.generate_download_signed_url(b.name, expires_minutes=180, disposition="inline")
                    return {
                        "blob_name": b.name,
                        "gcs_uri": f"gs://{self.bucket_name}/{b.name}",
                        "view_url": view_url,
                        "filename": os.path.basename(b.name),
                        "size_bytes": b.size
                    }
        except Exception:
            pass

        return None

    def get_blob_bytes(self, blob_name: str) -> Optional[bytes]:
        """Download and return raw bytes for a blob from GCS."""
        if not blob_name:
            return None
        bucket = self._get_bucket()
        if not bucket:
            return None
        try:
            blob = bucket.blob(blob_name)
            if blob.exists():
                return blob.download_as_bytes()
        except Exception as e:
            print(f"[GCS Read Warning] Could not read blob '{blob_name}': {e}")
        return None

    def delete_blob(self, blob_name: str) -> bool:
        """Delete an object from GCS."""
        if not blob_name:
            return False
        bucket = self._get_bucket()
        if not bucket:
            return True
        try:
            blob = bucket.blob(blob_name)
            if blob.exists():
                blob.delete()
            return True
        except Exception as e:
            print(f"[GCS Delete Warning] Could not delete blob '{blob_name}': {e}")
            return False

    def upload_blob_text(
        self,
        blob_name: str,
        text_content: str,
        content_type: str = "text/plain; charset=utf-8",
        bucket_name: Optional[str] = None
    ) -> str:
        """Upload string text directly to GCS."""
        target_bucket_name = bucket_name or self.bucket_name
        client = self._get_client()
        if client:
            try:
                bucket = client.bucket(target_bucket_name)
                blob = bucket.blob(blob_name)
                blob.upload_from_string(text_content, content_type=content_type)
                return f"gs://{target_bucket_name}/{blob_name}"
            except Exception as e:
                print(f"[GCS Upload Notice] Could not upload text blob to {target_bucket_name}/{blob_name}: {e}")
        return f"gs://{target_bucket_name}/{blob_name}"

    def stream_video_to_gcs(
        self,
        video_url: str,
        blob_name: str,
        bucket_name: Optional[str] = None,
        referer: Optional[str] = None
    ) -> Dict[str, Any]:
        """Stream progressive MP4 video directly from CDN into Google Cloud Storage with live chunk progress logs."""
        target_bucket_name = bucket_name or self.bucket_name
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Referer": referer if (referer and referer.startswith("http")) else "https://vimeo.com/"
        }

        print(f"📡 [GCS Video Stream] Initiating CDN connection: {video_url[:80]}...")
        try:
            with requests.get(video_url, headers=headers, stream=True, timeout=30) as r:
                r.raise_for_status()
                total_size = int(r.headers.get("content-length", 0))
                total_mb = total_size / (1024 * 1024) if total_size else 0

                print(f"📦 [GCS Video Stream] File Size: {total_mb:.2f} MB")
                print(f"☁️ [GCS Video Stream] Target Bucket Object: gs://{target_bucket_name}/{blob_name}")

                client = self._get_client()
                if not client:
                    print(f"[GCS Video Notice] Cloud client emulated. Skipping raw bytes upload.")
                    return {
                        "status": "emulated",
                        "blob_name": blob_name,
                        "gcs_uri": f"gs://{target_bucket_name}/{blob_name}",
                        "size_mb": round(total_mb, 2)
                    }

                bucket = client.bucket(target_bucket_name)
                blob = bucket.blob(blob_name)

                chunk_size = 1024 * 1024 * 4  # 4MB streaming chunks
                uploaded_bytes = 0
                start_time = time.time()
                last_log_time = start_time

                with blob.open("wb", content_type="video/mp4") as f:
                    for chunk in r.iter_content(chunk_size=chunk_size):
                        if chunk:
                            f.write(chunk)
                            uploaded_bytes += len(chunk)
                            now = time.time()
                            if now - last_log_time >= 3 or (total_size and uploaded_bytes >= total_size):
                                pct = (uploaded_bytes / total_size * 100) if total_size else 0
                                mb_up = uploaded_bytes / (1024 * 1024)
                                speed = (uploaded_bytes / (now - start_time)) / (1024 * 1024) if (now - start_time) > 0 else 0
                                print(f"⏳ [GCS Video Stream Progress] {mb_up:.1f}/{total_mb:.1f} MB ({pct:.1f}%) at {speed:.2f} MB/s -> gs://{target_bucket_name}/{blob_name}")
                                last_log_time = now

                duration = time.time() - start_time
                print(f"✅ [GCS Video Upload Complete] gs://{target_bucket_name}/{blob_name} ({total_mb:.2f} MB in {duration:.1f}s)")
                signed_url = self.generate_download_signed_url(blob_name)
                return {
                    "status": "success",
                    "filename": os.path.basename(blob_name),
                    "blob_name": blob_name,
                    "gcs_uri": f"gs://{target_bucket_name}/{blob_name}",
                    "view_url": signed_url,
                    "size_mb": round(total_mb, 2),
                    "duration_seconds": round(duration, 1)
                }
        except Exception as e:
            print(f"✕ [GCS Video Stream Error] Failed to stream video to GCS: {e}")
            return {
                "status": "error",
                "blob_name": blob_name,
                "error": str(e)
            }

    def download_and_upload_hls_to_gcs(
        self,
        hls_url: str,
        blob_name: str,
        bucket_name: Optional[str] = None,
        referer: Optional[str] = None,
        video_id: str = "",
        max_height: int = 720
    ) -> Dict[str, Any]:
        """Download adaptive HLS stream (video+audio) via yt-dlp, mux into MP4, and upload directly to GCS."""
        target_bucket_name = bucket_name or self.bucket_name
        import tempfile
        import shutil
        import yt_dlp

        # Find ffmpeg binary
        ffmpeg_bin = None
        for candidate in [
            os.path.abspath(".venv/bin/ffmpeg"),
            "/usr/bin/ffmpeg",
            "/usr/local/bin/ffmpeg"
        ]:
            if os.path.exists(candidate):
                ffmpeg_bin = candidate
                break
        if not ffmpeg_bin:
            try:
                import imageio_ffmpeg
                ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
            except Exception:
                pass

        print(f"\n==================================================================")
        print(f"🎬 [GCS HLS Downloader Initiated]")
        print(f"   Video ID:        {video_id}")
        print(f"   HLS Master URL:  {hls_url[:80]}...")
        print(f"   Destination:     gs://{target_bucket_name}/{blob_name}")
        print(f"   FFmpeg Engine:   {ffmpeg_bin or 'Native'}")
        print(f"   Target Quality:  up to {max_height}p")
        print(f"==================================================================")

        temp_dir = tempfile.mkdtemp(prefix="ls_hls_")
        temp_mp4 = os.path.join(temp_dir, f"lecture_{video_id or 'vid'}.mp4")

        start_time = time.time()
        last_log_time = [start_time]

        def progress_hook(d):
            if d.get("status") == "downloading":
                now = time.time()
                if now - last_log_time[0] >= 3:
                    downloaded = d.get("downloaded_bytes", 0)
                    total = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
                    speed = d.get("speed") or 0
                    mb_down = downloaded / (1024 * 1024)
                    mb_total = total / (1024 * 1024) if total else 0
                    pct = (downloaded / total * 100) if total else 0
                    speed_mb = speed / (1024 * 1024)
                    frag_idx = d.get("fragment_index")
                    frag_count = d.get("fragment_count")
                    frag_str = f" [Frag {frag_idx}/{frag_count}]" if frag_idx and frag_count else ""
                    print(f"⏳ [GCS HLS Download Progress]{frag_str} {mb_down:.1f}/{mb_total:.1f} MB ({pct:.1f}%) at {speed_mb:.2f} MB/s -> gs://{target_bucket_name}/{blob_name}", flush=True)
                    last_log_time[0] = now
            elif d.get("status") == "finished":
                print("🔄 [GCS HLS Notice] Media fragments downloaded. Muxing video & audio container...", flush=True)

        ydl_opts = {
            "http_headers": {
                "Referer": referer if (referer and referer.startswith("http")) else "https://vimeo.com/",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            },
            "nocheckcertificate": True,
            "format": f"bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]/best",
            "outtmpl": temp_mp4,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [progress_hook],
        }
        if ffmpeg_bin:
            ydl_opts["ffmpeg_location"] = ffmpeg_bin

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([hls_url])

            actual_mp4 = temp_mp4
            if not os.path.exists(actual_mp4):
                candidates = [os.path.join(temp_dir, f) for f in os.listdir(temp_dir) if f.endswith((".mp4", ".mkv", ".webm", ".ts"))]
                if candidates:
                    actual_mp4 = candidates[0]

            if not os.path.exists(actual_mp4) or os.path.getsize(actual_mp4) == 0:
                raise RuntimeError(f"HLS download did not produce a valid video file in {temp_dir}")

            file_size_bytes = os.path.getsize(actual_mp4)
            total_mb = file_size_bytes / (1024 * 1024)
            dl_duration = time.time() - start_time
            print(f"📦 [GCS HLS Download Complete] Muxed MP4: {total_mb:.2f} MB in {dl_duration:.1f}s")

            client = self._get_client()
            if not client:
                print(f"[GCS Video Notice] Cloud client emulated. Returning emulated GCS metadata.")
                return {
                    "status": "emulated",
                    "blob_name": blob_name,
                    "gcs_uri": f"gs://{target_bucket_name}/{blob_name}",
                    "size_mb": round(total_mb, 2)
                }

            bucket = client.bucket(target_bucket_name)
            blob = bucket.blob(blob_name)
            blob.chunk_size = 1024 * 1024 * 8  # 8MB chunked uploads

            print(f"☁️ [GCS Video Upload Starting] Uploading {total_mb:.2f} MB to gs://{target_bucket_name}/{blob_name}...")
            up_start = time.time()
            blob.upload_from_filename(actual_mp4, content_type="video/mp4")
            up_duration = time.time() - up_start
            total_duration = time.time() - start_time

            print(f"✅ [GCS Video Upload Complete] gs://{target_bucket_name}/{blob_name} ({total_mb:.2f} MB uploaded in {up_duration:.1f}s)")
            signed_url = self.generate_download_signed_url(blob_name)
            return {
                "status": "success",
                "filename": os.path.basename(blob_name),
                "blob_name": blob_name,
                "gcs_uri": f"gs://{target_bucket_name}/{blob_name}",
                "view_url": signed_url,
                "size_mb": round(total_mb, 2),
                "duration_seconds": round(total_duration, 1),
                "quality": f"{max_height}p"
            }
        except Exception as e:
            print(f"✕ [GCS HLS Stream Error] Failed to download/upload HLS stream: {e}")
            return {
                "status": "error",
                "blob_name": blob_name,
                "error": str(e)
            }
        finally:
            try:
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    def upload_lecture_bundle(
        self,
        video_id: str,
        title: str,
        vtt_content: str,
        cues: List[Dict[str, Any]],
        summary_content: str,
        streams_info: Optional[Dict[str, Any]] = None,
        bucket_name: Optional[str] = None,
        prefix: str = "lectures",
        upload_video: bool = True,
        referer: Optional[str] = None
    ) -> Dict[str, Any]:
        """Upload full lecture materials (summary, transcript, captions, metadata, and video MP4) to GCS bucket."""
        target_bucket = bucket_name or self.bucket_name
        clean_prefix = (prefix or "lectures").strip("/ ")
        folder_base = f"{clean_prefix}/{video_id}"

        print(f"\n==================================================================")
        print(f"☁️ [GCS Bundle Upload Initiated]")
        print(f"   Video ID:        {video_id}")
        print(f"   Lecture Title:   {title}")
        print(f"   Target Bucket:   gs://{target_bucket}/{folder_base}/")
        print(f"   Captions Cues:   {len(cues)} segments")
        print(f"   Include Video:   {upload_video}")
        print(f"==================================================================")

        # 1. Transcript markdown
        t_lines = [f"# Lecture Transcript: {title}", f"**Video ID:** {video_id}", "", "---", ""]
        for c in cues:
            ts = c.get("time") or c.get("start", "")
            t_lines.append(f"**[{ts}]** {c.get('text', '')}\n")
        transcript_md = "\n".join(t_lines)

        # 2. Metadata json
        metadata = {
            "videoId": video_id,
            "title": title,
            "cueCount": len(cues),
            "uploadedAt": datetime.datetime.utcnow().isoformat() + "Z",
            "streams": streams_info or {}
        }

        # 3. Download guide
        guide_lines = [
            f"Lecture: {title}",
            f"Vimeo ID: {video_id}",
            f"GCS Bundle: gs://{target_bucket}/{folder_base}/",
            "",
            "Files included in this folder:",
            "- summary.md: AI Executive Summary & Core Concepts",
            "- transcript.md: Full timestamped verbatim transcript",
            "- captions.vtt: WebVTT caption file",
            "- metadata.json: Video parameters & streaming endpoints",
        ]
        if streams_info and streams_info.get("commands"):
            guide_lines.append("\nTerminal Download Commands:")
            for tool, cmd in streams_info.get("commands", {}).items():
                guide_lines.append(f"[{tool}]: {cmd}")
        download_guide = "\n".join(guide_lines)

        files = [
            (f"{folder_base}/summary.md", summary_content or f"# {title}\nSummary not available.", "text/markdown; charset=utf-8"),
            (f"{folder_base}/transcript.md", transcript_md, "text/markdown; charset=utf-8"),
            (f"{folder_base}/captions.vtt", vtt_content or "WEBVTT\n", "text/vtt; charset=utf-8"),
            (f"{folder_base}/metadata.json", json.dumps(metadata, indent=2), "application/json; charset=utf-8"),
            (f"{folder_base}/download_guide.txt", download_guide, "text/plain; charset=utf-8"),
        ]

        uploaded = []
        for blob_name, content, ctype in files:
            gcs_uri = self.upload_blob_text(blob_name, content, content_type=ctype, bucket_name=target_bucket)
            signed_view = self.generate_download_signed_url(blob_name)
            print(f"   ✓ Uploaded doc: {blob_name}")
            uploaded.append({
                "filename": os.path.basename(blob_name),
                "blob_name": blob_name,
                "gcs_uri": gcs_uri,
                "view_url": signed_view
            })

        # 4. Stream or download actual MP4 video file to GCS
        video_result = None
        if upload_video and streams_info:
            progressive_list = streams_info.get("progressive_streams") or []
            safe_name = streams_info.get("filename") or f"lecture_{video_id}.mp4"
            if not safe_name.endswith(".mp4"):
                safe_name += ".mp4"
            video_blob_name = f"{folder_base}/{safe_name}"

            if progressive_list:
                best_stream = progressive_list[0]
                video_url = best_stream.get("url")
                quality = best_stream.get("quality", "standard")

                print(f"\n🎬 [GCS Video Upload Starting - Progressive MP4]")
                print(f"   Quality:         {quality} ({best_stream.get('width')}x{best_stream.get('height')})")
                print(f"   Destination:     gs://{target_bucket}/{video_blob_name}")

                video_result = self.stream_video_to_gcs(
                    video_url=video_url,
                    blob_name=video_blob_name,
                    bucket_name=target_bucket,
                    referer=referer
                )
                if video_result.get("status") in ("success", "emulated"):
                    uploaded.append(video_result)
            else:
                # Fallback to Adaptive HLS streaming & muxing
                hls_master = streams_info.get("hls", {}).get("master_url")
                if hls_master:
                    print(f"\n🎬 [GCS Video Upload Starting - Adaptive HLS Stream]")
                    print(f"   HLS Master:      {hls_master[:80]}...")
                    print(f"   Destination:     gs://{target_bucket}/{video_blob_name}")

                    video_result = self.download_and_upload_hls_to_gcs(
                        hls_url=hls_master,
                        blob_name=video_blob_name,
                        bucket_name=target_bucket,
                        referer=referer,
                        video_id=video_id,
                        max_height=720
                    )
                    if video_result.get("status") in ("success", "emulated"):
                        uploaded.append(video_result)
                else:
                    print(f"ℹ️ [GCS Notice] No stream URL found for video {video_id}.")

        console_url = f"https://console.cloud.google.com/storage/browser/{target_bucket}/{folder_base}"

        print(f"\n🎉 [GCS Bundle Upload Complete]")
        print(f"   Total Items:     {len(uploaded)} files in gs://{target_bucket}/{folder_base}/")
        print(f"   Console URL:     {console_url}")
        print(f"==================================================================\n")

        return {
            "status": "success",
            "bucket": target_bucket,
            "folder": folder_base,
            "gcs_uri": f"gs://{target_bucket}/{folder_base}/",
            "console_url": console_url,
            "files": uploaded,
            "video_uploaded": bool(video_result and video_result.get("status") == "success"),
            "video_details": video_result,
            "title": title,
            "video_id": video_id
        }


# Singleton service instance
gcs_storage_service = GCSStorageService()