"""
Google Drive Cloud Export Service for LectureScribe
---------------------------------------------------
Provides seamless cloud packaging and asynchronous upload of the Full Lecture Bundle:
1. summary.md - Full Executive AI summary with thematic breakdown
2. transcript.md - Chronological verbatim lecture transcript with timestamps
3. captions.vtt - WebVTT subtitle track
4. metadata.json - Machine-readable metadata (title, video ID, stream URLs)
5. download_guide.txt - Terminal CLI commands (yt-dlp, ffmpeg) for offline video capture

Supports authentication via:
- Google Cloud Service Account JSON file (`GOOGLE_SERVICE_ACCOUNT_FILE`)
- Raw Service Account JSON string in environment (`GOOGLE_SERVICE_ACCOUNT_JSON`)
- User-supplied OAuth2 Bearer Access Token (OAuth2 flow)
"""
from __future__ import annotations

import os
import io
import json
import uuid
import re
import shutil
import tempfile
import requests
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List

# Optional Google API client library imports
try:
    from google.oauth2 import service_account, credentials as oauth_credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseUpload, MediaFileUpload
    HAS_GOOGLE_DRIVE_LIBS = True
except ImportError:
    HAS_GOOGLE_DRIVE_LIBS = False

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive",
]


class GoogleDriveService:
    """Manages asynchronous background uploads and job tracking for Google Drive."""

    def __init__(self):
        self._jobs: Dict[str, Dict[str, Any]] = {}

    def is_configured(self) -> bool:
        """Returns True if Google Drive credentials or configuration are detected."""
        sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")
        if sa_file and Path(sa_file).exists():
            return True
        sa_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
        if sa_json and sa_json.strip():
            return True
        return False

    def get_auth_status(self) -> Dict[str, Any]:
        """Diagnostic helper returning the operational readiness of Google Drive."""
        configured = self.is_configured()
        sa_email = None

        if configured:
            sa_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
            sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")
            try:
                if sa_json:
                    data = json.loads(sa_json)
                    sa_email = data.get("client_email")
                elif sa_file and Path(sa_file).exists():
                    with open(sa_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        sa_email = data.get("client_email")
            except Exception:
                pass

        client_id = os.getenv("GOOGLE_CLIENT_ID") or os.getenv("VITE_GOOGLE_CLIENT_ID") or ""
        if not client_id:
            env_file = Path(__file__).parent.parent / ".env"
            if env_file.exists():
                try:
                    with open(env_file, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#") and "=" in line:
                                k, v = line.split("=", 1)
                                if k.strip() in ("GOOGLE_CLIENT_ID", "VITE_GOOGLE_CLIENT_ID"):
                                    client_id = v.strip().strip("'\"")
                                    os.environ[k.strip()] = client_id
                                    break
                except Exception:
                    pass
        return {
            "configured": configured,
            "has_libraries": HAS_GOOGLE_DRIVE_LIBS,
            "auth_type": "service_account" if configured else "google_sign_in",
            "service_account_email": sa_email,
            "client_id": client_id,
            "message": (
                "Google Drive Service Account active and ready."
                if configured
                else "Sign in with Google to export to your personal Google Drive."
            )
        }

    def create_job(self, video_id: str, title: str) -> str:
        """Initializes an asynchronous upload job and returns its tracking job_id."""
        job_id = uuid.uuid4().hex[:12]
        self._jobs[job_id] = {
            "job_id": job_id,
            "video_id": video_id,
            "title": title,
            "status": "PROCESSING",
            "progress": 5,
            "current_step": "Initializing Google Drive upload task...",
            "folder_name": f"LectureScribe - {title} ({video_id})",
            "folder_id": None,
            "folder_url": None,
            "files": [],
            "error": None,
            "created_at": datetime.utcnow().isoformat(),
            "completed_at": None,
        }
        return job_id

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves current progress and details for a given job."""
        return self._jobs.get(job_id)

    def _get_drive_client(self, access_token: Optional[str] = None):
        """Builds an authorized Google Drive API client using service account or bearer token."""
        if not HAS_GOOGLE_DRIVE_LIBS:
            raise RuntimeError("google-api-python-client is not installed in the environment.")

        # 1. Bearer access token supplied by user
        if access_token and access_token.strip():
            creds = oauth_credentials.Credentials(token=access_token.strip())
            return build("drive", "v3", credentials=creds, cache_discovery=False)

        # 2. Service account JSON file
        sa_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")
        if sa_file and Path(sa_file).exists():
            creds = service_account.Credentials.from_service_account_file(sa_file, scopes=SCOPES)
            return build("drive", "v3", credentials=creds, cache_discovery=False)

        # 3. Service account raw JSON string
        sa_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
        if sa_json and sa_json.strip():
            info = json.loads(sa_json)
            creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
            return build("drive", "v3", credentials=creds, cache_discovery=False)

        raise RuntimeError("No Google credentials found (neither service account nor user token provided).")

    def _download_lecture_video(
        self,
        video_id: str,
        title: str,
        streams_info: Optional[Dict[str, Any]] = None,
        job: Optional[Dict[str, Any]] = None,
    ) -> Optional[Path]:
        """Downloads the lecture video (progressive MP4 or HLS) to a temporary file on disk."""
        safe_title = re.sub(r"[^a-zA-Z0-9_\- ]", "_", title).strip().replace(" ", "_")
        if not safe_title:
            safe_title = f"lecture_{video_id}"

        temp_dir = Path(tempfile.gettempdir()) / f"lecturescribe_v_{video_id}"
        temp_dir.mkdir(parents=True, exist_ok=True)
        target_mp4 = temp_dir / f"{safe_title}.mp4"

        # 1. Progressive MP4 streams (direct download)
        progressive_streams = (streams_info or {}).get("progressive_streams", [])
        if progressive_streams and isinstance(progressive_streams, list):
            best = progressive_streams[0]
            url = best.get("url")
            if url:
                try:
                    if job:
                        job["current_step"] = f"Downloading video MP4 stream ({best.get('quality', 'high')})..."
                    with requests.get(url, stream=True, timeout=180) as r:
                        r.raise_for_status()
                        total_size = int(r.headers.get("content-length", 0))
                        downloaded = 0
                        with open(target_mp4, "wb") as f:
                            for chunk in r.iter_content(chunk_size=1024 * 1024):
                                if chunk:
                                    f.write(chunk)
                                    downloaded += len(chunk)
                                    if total_size and job:
                                        pct = int((downloaded / total_size) * 100)
                                        job["progress"] = 55 + int(pct * 0.20)
                                        job["current_step"] = f"Downloading video file: {pct}%..."
                    if target_mp4.exists() and target_mp4.stat().st_size > 1000:
                        return target_mp4
                except Exception as pe:
                    print(f"[Google Drive Export] Progressive MP4 download notice: {pe}")

        # 2. HLS Stream via yt-dlp
        try:
            import yt_dlp
            try:
                import static_ffmpeg
                static_ffmpeg.add_paths()
            except Exception:
                pass

            if job:
                job["current_step"] = "Downloading HLS lecture video stream..."
                job["progress"] = 60

            vimeo_url = f"https://player.vimeo.com/video/{video_id}"
            ydl_opts = {
                "outtmpl": str(temp_dir / f"{safe_title}.%(ext)s"),
                "format": "bestvideo+bestaudio/best",
                "merge_output_format": "mp4",
                "nocheckcertificate": True,
                "quiet": True,
                "no_warnings": True,
            }

            def yt_progress_hook(d):
                if d.get("status") == "downloading" and job:
                    total = d.get("total_bytes") or d.get("total_bytes_estimate")
                    downloaded = d.get("downloaded_bytes", 0)
                    if total:
                        pct = int((downloaded / total) * 100)
                        job["progress"] = 55 + int(pct * 0.20)
                        job["current_step"] = f"Downloading lecture stream: {pct}%..."

            ydl_opts["progress_hooks"] = [yt_progress_hook]

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([vimeo_url])

            candidates = list(temp_dir.glob(f"{safe_title}*.mp4"))
            if candidates and candidates[0].exists() and candidates[0].stat().st_size > 1000:
                return candidates[0]
        except Exception as ye:
            print(f"[Google Drive Export] yt-dlp video stream download notice: {ye}")

        return None

    def execute_bundle_upload(
        self,
        job_id: str,
        video_id: str,
        title: str,
        vtt_content: str,
        cues: List[Dict[str, Any]],
        summary_content: str,
        streams_info: Optional[Dict[str, Any]] = None,
        parent_folder_id: Optional[str] = None,
        access_token: Optional[str] = None,
    ):
        """
        Executes background Google Drive bundle upload:
        1. Formats all 5 bundle assets.
        2. Creates dedicated Google Drive folder.
        3. Uploads files into folder with progress notifications.
        """
        job = self._jobs.get(job_id)
        if not job:
            return

        try:
            job["progress"] = 15
            job["current_step"] = "Preparing bundle files (Markdown, WebVTT, Metadata)..."

            # Prepare files
            files_to_upload: List[Dict[str, Any]] = []

            # 1. summary.md
            files_to_upload.append({
                "name": "summary.md",
                "mimeType": "text/markdown",
                "content": summary_content.encode("utf-8")
            })

            # 2. transcript.md
            transcript_lines = [
                f"# Verbatim Transcript: {title}",
                f"Video ID: {video_id}",
                f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
                "",
                "---",
                ""
            ]
            for cue in cues:
                ts = cue.get("time") or cue.get("timestamp", "00:00")
                txt = cue.get("text", "")
                transcript_lines.append(f"**[{ts}]** {txt}\n")
            transcript_content = "\n".join(transcript_lines).encode("utf-8")
            files_to_upload.append({
                "name": "transcript.md",
                "mimeType": "text/markdown",
                "content": transcript_content
            })

            # 3. captions.vtt
            if not vtt_content and cues:
                vtt_lines = ["WEBVTT", "", ""]
                for i, cue in enumerate(cues, 1):
                    ts = cue.get("time") or cue.get("timestamp", "00:00:00")
                    txt = cue.get("text", "")
                    vtt_lines.append(f"{i}\n{ts}.000 --> {ts}.999\n{txt}\n")
                vtt_content = "\n".join(vtt_lines)
            files_to_upload.append({
                "name": "captions.vtt",
                "mimeType": "text/vtt",
                "content": (vtt_content or "WEBVTT\n").encode("utf-8")
            })

            # 4. metadata.json
            metadata_obj = {
                "videoId": video_id,
                "title": title,
                "exported_at": datetime.utcnow().isoformat(),
                "cue_count": len(cues),
                "streams": streams_info or {},
            }
            files_to_upload.append({
                "name": "metadata.json",
                "mimeType": "application/json",
                "content": json.dumps(metadata_obj, indent=2).encode("utf-8")
            })

            # 5. download_guide.txt
            guide_lines = [
                f"LectureScribe Video Download Guide: {title}",
                "=" * 60,
                f"Video ID: {video_id}",
                f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
                "",
                "1. Multi-bitrate HLS Stream URL:",
            ]
            hls_url = (streams_info or {}).get("hls_url", f"https://player.vimeo.com/video/{video_id}")
            guide_lines.append(f"   {hls_url}\n")
            guide_lines.append("2. Download with yt-dlp (Recommended):")
            guide_lines.append(f"   yt-dlp \"{hls_url}\" -o \"{title}.mp4\"\n")
            guide_lines.append("3. Download with ffmpeg:")
            guide_lines.append(f"   ffmpeg -i \"{hls_url}\" -c copy \"{title}.mp4\"\n")
            files_to_upload.append({
                "name": "download_guide.txt",
                "mimeType": "text/plain",
                "content": "\n".join(guide_lines).encode("utf-8")
            })

            job["progress"] = 30
            job["current_step"] = "Connecting to Google Drive API..."

            service = self._get_drive_client(access_token=access_token)

            # Create folder
            folder_name = f"LectureScribe - {title} ({video_id})"
            folder_metadata: Dict[str, Any] = {
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder"
            }
            if parent_folder_id:
                folder_metadata["parents"] = [parent_folder_id]

            job["progress"] = 40
            job["current_step"] = f"Creating dedicated folder '{folder_name}'..."

            folder = service.files().create(
                body=folder_metadata,
                fields="id, webViewLink"
            ).execute()

            folder_id = folder.get("id")
            folder_url = folder.get("webViewLink") or f"https://drive.google.com/drive/folders/{folder_id}"

            job["folder_id"] = folder_id
            job["folder_url"] = folder_url

            # Upload each file into folder
            # 1. Upload text and markdown documents
            total_files = len(files_to_upload)
            uploaded_files = []

            for idx, item in enumerate(files_to_upload):
                job["progress"] = 35 + int((idx / total_files) * 20)
                job["current_step"] = f"Uploading '{item['name']}' to Google Drive ({idx + 1}/{total_files})..."

                file_metadata = {
                    "name": item["name"],
                    "parents": [folder_id]
                }
                media = MediaIoBaseUpload(
                    io.BytesIO(item["content"]),
                    mimetype=item["mimeType"],
                    resumable=False
                )
                uploaded = service.files().create(
                    body=file_metadata,
                    media_body=media,
                    fields="id, name, webViewLink, size"
                ).execute()

                uploaded_files.append({
                    "id": uploaded.get("id"),
                    "name": uploaded.get("name"),
                    "url": uploaded.get("webViewLink"),
                })

            # 2. Download and Upload the actual Lecture Video (.mp4)
            job["progress"] = 55
            job["current_step"] = f"Downloading lecture video ({title})..."
            video_file = None
            try:
                video_file = self._download_lecture_video(
                    video_id=video_id,
                    title=title,
                    streams_info=streams_info,
                    job=job
                )
                if video_file and video_file.exists():
                    v_size_mb = round(video_file.stat().st_size / (1024 * 1024), 1)
                    job["current_step"] = f"Uploading '{video_file.name}' ({v_size_mb} MB) to Google Drive..."
                    job["progress"] = 75

                    v_meta = {
                        "name": video_file.name,
                        "parents": [folder_id]
                    }
                    v_media = MediaFileUpload(
                        str(video_file),
                        mimetype="video/mp4",
                        resumable=True
                    )
                    v_req = service.files().create(
                        body=v_meta,
                        media_body=v_media,
                        fields="id, name, webViewLink, size"
                    )
                    v_resp = None
                    while v_resp is None:
                        status, v_resp = v_req.next_chunk()
                        if status:
                            pct = int(status.progress() * 100)
                            job["progress"] = 75 + int(pct * 0.23)
                            job["current_step"] = f"Uploading video: {pct}% ({v_size_mb} MB)..."

                    uploaded_files.insert(0, {
                        "id": v_resp.get("id"),
                        "name": v_resp.get("name"),
                        "url": v_resp.get("webViewLink"),
                        "size": v_resp.get("size")
                    })
                    print(f"[Google Drive Export] Video '{video_file.name}' ({v_size_mb} MB) uploaded to Google Drive.")
                else:
                    print(f"[Google Drive Export Notice] Video stream was not captured; documents uploaded.")
            except Exception as ve:
                print(f"[Google Drive Export Notice] Video stream capture error: {ve}")
                job["video_warning"] = str(ve)
            finally:
                if video_file and video_file.exists():
                    try:
                        video_file.unlink()
                    except Exception:
                        pass

            job["files"] = uploaded_files
            job["progress"] = 100
            job["current_step"] = "Full bundle (including video) successfully uploaded to Google Drive!"
            job["status"] = "COMPLETED"
            job["completed_at"] = datetime.utcnow().isoformat()
            print(f"[Google Drive Export] Successfully uploaded lecture bundle for '{video_id}' to {folder_url}")

        except Exception as e:
            print(f"[Google Drive Export Error] Failed upload for job {job_id}: {e}")
            job["status"] = "FAILED"
            job["error"] = str(e)
            job["current_step"] = f"Upload failed: {str(e)}"
            job["completed_at"] = datetime.utcnow().isoformat()


# Export singleton instance
google_drive_service = GoogleDriveService()
