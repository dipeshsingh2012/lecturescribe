"""
Google Drive Cloud Export Service for LectureScribe
---------------------------------------------------
Provides seamless cloud packaging and asynchronous upload of the Full Lecture Bundle:
1. summary.md - Full Executive AI summary with thematic breakdown
2. transcript.md - Chronological verbatim lecture transcript with timestamps
3. captions.vtt - WebVTT subtitle track
4. metadata.json - Machine-readable metadata (title, video ID, stream URLs)
5. download_guide.txt - Terminal CLI commands (yt-dlp, ffmpeg) for offline video capture
6. {title}.mp4 - Full lecture video recording

Authenticated directly via user Google OAuth 2.0 Access Token (1-click Sign in with Google).
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

# Optional Google API client library imports
try:
    from google.oauth2 import credentials as oauth_credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseUpload
    HAS_GOOGLE_DRIVE_LIBS = True
except ImportError:
    HAS_GOOGLE_DRIVE_LIBS = False

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
]


class GoogleDriveService:
    """Manages asynchronous background uploads and job tracking for Google Drive."""

    def __init__(self):
        self._jobs: Dict[str, Dict[str, Any]] = {}

    def get_auth_status(self) -> Dict[str, Any]:
        """Diagnostic helper returning Google OAuth configuration status."""
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
            "has_libraries": HAS_GOOGLE_DRIVE_LIBS,
            "client_id": client_id,
            "configured": bool(client_id),
            "auth_type": "google_sign_in",
            "message": "Sign in with Google to export to your personal Google Drive."
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
            "created_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": None,
        }
        return job_id

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves current progress and details for a given job."""
        return self._jobs.get(job_id)

    def _get_drive_client(self, access_token: Optional[str] = None):
        """Builds an authorized Google Drive API client using the user's bearer token."""
        if not HAS_GOOGLE_DRIVE_LIBS:
            raise RuntimeError("google-api-python-client is not installed in the environment.")

        if not access_token or not access_token.strip():
            raise RuntimeError("Google OAuth access token is required. Please sign in with Google.")

        creds = oauth_credentials.Credentials(token=access_token.strip())
        return build("drive", "v3", credentials=creds, cache_discovery=False)

    def _get_bearer_token(self, access_token: Optional[str] = None) -> str:
        """Returns the user's active OAuth2 Bearer token."""
        if access_token and access_token.strip():
            return access_token.strip()

        raise RuntimeError("Google OAuth access token is required. Please sign in with Google.")

    def _upload_file_resumable(
        self,
        file_path: Path,
        folder_id: str,
        mime_type: str = "video/mp4",
        access_token: Optional[str] = None,
        job: Optional[Dict[str, Any]] = None,
        start_pct: int = 55,
        end_pct: int = 85,
    ) -> Dict[str, Any]:
        """
        Uploads a large file to Google Drive using the direct HTTP Resumable Upload protocol.
        Chunks are sent directly to the upload session URL via requests.put without relying
        on googleapiclient AuthorizedSession, preventing token-refresh crashes and providing
        smooth, resilient, and non-blocking chunk progress.
        """
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        file_size = file_path.stat().st_size
        bearer_token = self._get_bearer_token(access_token)

        # 1. Initiate Resumable Upload Session
        init_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size"
        init_headers = {
            "Authorization": f"Bearer {bearer_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": mime_type,
            "X-Upload-Content-Length": str(file_size),
        }
        init_body = {
            "name": file_path.name,
            "parents": [folder_id],
        }

        init_resp = requests.post(init_url, headers=init_headers, json=init_body, timeout=60)
        if init_resp.status_code == 401:
            raise RuntimeError(
                "Google Drive access token expired (HTTP 401). Please sign in with Google again to refresh your session."
            )
        if init_resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Failed to start Google Drive resumable upload (HTTP {init_resp.status_code}): {init_resp.text}"
            )

        session_url = init_resp.headers.get("Location")
        if not session_url:
            raise RuntimeError("Google Drive did not provide a resumable session Location URL.")

        # 2. Upload file in 10 MB chunks
        chunk_size = 10 * 1024 * 1024  # 10 MB chunks (multiple of 256 KB)
        uploaded_bytes = 0
        final_meta = None

        with open(file_path, "rb") as f:
            while uploaded_bytes < file_size:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                start_byte = uploaded_bytes
                end_byte = uploaded_bytes + len(chunk) - 1

                chunk_headers = {
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {start_byte}-{end_byte}/{file_size}",
                }

                # Note: Session URL is self-authenticating for the chunk uploads
                chunk_resp = requests.put(session_url, headers=chunk_headers, data=chunk, timeout=180)

                if chunk_resp.status_code in (200, 201):
                    final_meta = chunk_resp.json()
                    uploaded_bytes = file_size
                    if job:
                        job["progress"] = end_pct
                        job["current_step"] = f"Video upload complete: 100% ({round(file_size / (1024*1024), 1)} MB)"
                    break
                elif chunk_resp.status_code == 308:
                    # 308 Resume Incomplete indicates chunk was received successfully
                    uploaded_bytes += len(chunk)
                    if job and file_size > 0:
                        frac = min(1.0, uploaded_bytes / file_size)
                        job["progress"] = start_pct + int(frac * (end_pct - start_pct))
                        pct = int(frac * 100)
                        u_mb = round(uploaded_bytes / (1024 * 1024), 1)
                        t_mb = round(file_size / (1024 * 1024), 1)
                        job["current_step"] = f"Uploading video: {pct}% ({u_mb}/{t_mb} MB)..."
                elif chunk_resp.status_code == 401:
                    raise RuntimeError("Google Drive authorization expired during upload (HTTP 401). Please sign in again.")
                else:
                    raise RuntimeError(f"Chunk upload failed (HTTP {chunk_resp.status_code}): {chunk_resp.text}")

        if not final_meta:
            raise RuntimeError("Resumable upload completed without receiving file metadata.")

        return final_meta

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

        # If already downloaded in a previous attempt and valid, reuse it immediately!
        if target_mp4.exists() and target_mp4.stat().st_size > 1024 * 1024:
            if job:
                job["progress"] = 40
                job["current_step"] = f"Reusing downloaded lecture video ({round(target_mp4.stat().st_size / (1024*1024), 1)} MB)..."
            return target_mp4

        # 1. Progressive MP4 streams (direct download)
        progressive_streams = (streams_info or {}).get("progressive_streams", [])
        if progressive_streams and isinstance(progressive_streams, list):
            # Prefer 720p or highest available <= 720p to maintain quality and fast download
            chosen = None
            for ps in progressive_streams:
                h = ps.get("height") or 0
                if h <= 720:
                    chosen = ps
                    break
            if not chosen and progressive_streams:
                chosen = progressive_streams[0]

            url = chosen.get("url") if chosen else None
            if url:
                try:
                    if job:
                        job["current_step"] = f"Downloading video MP4 stream ({chosen.get('quality', '720p')})..."
                    with requests.get(url, stream=True, timeout=300) as r:
                        r.raise_for_status()
                        total_size = int(r.headers.get("content-length", 0))
                        downloaded = 0
                        with open(target_mp4, "wb") as f:
                            for chunk in r.iter_content(chunk_size=2 * 1024 * 1024):
                                if chunk:
                                    f.write(chunk)
                                    downloaded += len(chunk)
                                    if total_size and job:
                                        pct = int((downloaded / total_size) * 100)
                                        job["progress"] = 5 + int(pct * 0.35)
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
                job["progress"] = 10

            # Determine best source URL for yt-dlp:
            # Prefer direct CDN master playlist URL (hls_url) to avoid Vimeo webpage bot blocks!
            hls_url = (streams_info or {}).get("hls_url")
            source_url = hls_url if hls_url else f"https://player.vimeo.com/video/{video_id}"

            ydl_opts = {
                "outtmpl": str(temp_dir / f"{safe_title}.%(ext)s"),
                "format": "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
                "merge_output_format": "mp4",
                "nocheckcertificate": True,
                "quiet": True,
                "no_warnings": True,
                "concurrent_fragment_downloads": 4,
                "retries": 5,
                "fragment_retries": 5,
            }

            def yt_progress_hook(d):
                if d.get("status") == "downloading" and job:
                    total = d.get("total_bytes") or d.get("total_bytes_estimate")
                    downloaded = d.get("downloaded_bytes", 0)
                    if total:
                        pct = int((downloaded / total) * 100)
                        job["progress"] = 5 + int(pct * 0.35)
                        job["current_step"] = f"Downloading lecture stream: {pct}%..."

            ydl_opts["progress_hooks"] = [yt_progress_hook]

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([source_url])

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
        user_email: Optional[str] = None,
    ):
        """
        Executes background Google Drive bundle upload:
        1. Captures and encodes the lecture video (.mp4) FIRST.
        2. Creates dedicated Google Drive folder.
        3. Uploads the lecture video via direct chunked resumable upload.
        4. Uploads all 5 documentation, transcript, subtitle, and metadata files.
        5. Syncs Google Drive folder URL to user's LMS library.
        """
        job = self._jobs.get(job_id)
        if not job:
            return

        try:
            # STEP 1: Download lecture video (.mp4) FIRST so drive session is fresh
            job["progress"] = 5
            job["current_step"] = f"Downloading lecture video ({title})..."
            video_file = None
            try:
                video_file = self._download_lecture_video(
                    video_id=video_id,
                    title=title,
                    streams_info=streams_info,
                    job=job
                )
            except Exception as ve:
                print(f"[Google Drive Export] Video download error: {ve}")
                job["video_warning"] = f"Video capture failed ({ve})"

            # STEP 2: Connect to Google Drive API & Create Dedicated Folder
            job["progress"] = 45
            job["current_step"] = "Connecting to Google Drive API..."

            service = self._get_drive_client(access_token=access_token)

            folder_name = f"LectureScribe - {title} ({video_id})"
            folder_metadata: Dict[str, Any] = {
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder"
            }
            if parent_folder_id:
                folder_metadata["parents"] = [parent_folder_id]

            job["progress"] = 50
            job["current_step"] = f"Creating dedicated folder '{folder_name}'..."

            folder = service.files().create(
                body=folder_metadata,
                fields="id, webViewLink"
            ).execute()

            folder_id = folder.get("id")
            folder_url = folder.get("webViewLink") or f"https://drive.google.com/drive/folders/{folder_id}"

            job["folder_id"] = folder_id
            job["folder_url"] = folder_url

            if user_email and user_email.strip():
                try:
                    from backend.database import db_manager
                    db_manager.record_user_lecture(
                        user_email=user_email,
                        video_id=video_id,
                        title=title,
                        drive_folder_url=folder_url
                    )
                except Exception as de:
                    print(f"[User Library Sync Notice]: {de}")

            uploaded_files = []

            # STEP 3: Upload the Video File (.mp4) into the Folder
            if video_file and video_file.exists():
                v_size_mb = round(video_file.stat().st_size / (1024 * 1024), 1)
                job["current_step"] = f"Uploading '{video_file.name}' ({v_size_mb} MB) to Google Drive..."
                job["progress"] = 55

                try:
                    v_resp = self._upload_file_resumable(
                        file_path=video_file,
                        folder_id=folder_id,
                        mime_type="video/mp4",
                        access_token=access_token,
                        job=job,
                        start_pct=55,
                        end_pct=85,
                    )
                    uploaded_files.append({
                        "id": v_resp.get("id"),
                        "name": v_resp.get("name"),
                        "url": v_resp.get("webViewLink") or f"https://drive.google.com/file/d/{v_resp.get('id')}/view",
                        "size": v_resp.get("size") or str(video_file.stat().st_size),
                        "is_video": True,
                    })
                    print(f"[Google Drive Export] Video '{video_file.name}' ({v_size_mb} MB) successfully uploaded.")
                except Exception as vue:
                    print(f"[Google Drive Export Warning] Video upload error: {vue}")
                    job["video_warning"] = str(vue)
                finally:
                    try:
                        video_file.unlink()
                    except Exception:
                        pass
            else:
                if not job.get("video_warning"):
                    job["video_warning"] = "Video stream could not be captured. Uploading documents and download guide."

            # STEP 4: Format & Upload the 5 Documentation & Subtitle Bundle Assets
            job["progress"] = 85
            job["current_step"] = "Uploading documentation, transcripts, and subtitles..."

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
                f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
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
                "exported_at": datetime.now(timezone.utc).isoformat(),
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
                f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
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

            total_doc_files = len(files_to_upload)
            for idx, item in enumerate(files_to_upload):
                job["progress"] = 85 + int((idx / total_doc_files) * 12)
                job["current_step"] = f"Uploading '{item['name']}' ({idx + 1}/{total_doc_files})..."

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
                    "is_video": False,
                })

            job["files"] = uploaded_files
            job["progress"] = 100
            if job.get("video_warning"):
                job["current_step"] = f"Bundle documents uploaded to Google Drive. (Notice: {job.get('video_warning')})"
            else:
                job["current_step"] = "Full bundle (including video) successfully uploaded to Google Drive!"
            job["status"] = "COMPLETED"
            job["completed_at"] = datetime.now(timezone.utc).isoformat()
            print(f"[Google Drive Export] Successfully completed job '{job_id}' for '{video_id}' at {folder_url}")

        except Exception as e:
            print(f"[Google Drive Export Error] Failed upload for job {job_id}: {e}")
            job["status"] = "FAILED"
            job["error"] = str(e)
            job["current_step"] = f"Upload failed: {str(e)}"
            job["completed_at"] = datetime.now(timezone.utc).isoformat()


# Export singleton instance
google_drive_service = GoogleDriveService()
