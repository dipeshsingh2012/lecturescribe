"""
Google Cloud Storage (GCS) Client for LectureScribe Resources
--------------------------------------------------------------
Provides secure V4 Signed URLs for direct-to-bucket uploads and downloads,
organizing resources by course and lecture.
"""
from __future__ import annotations

import os
import re
import uuid
import datetime
from typing import Optional, Dict, Any

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
            self._client = storage.Client()
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
        """
        Generate a V4 signed URL allowing the client to directly PUT bytes into GCS.
        """
        bucket = self._get_bucket()
        if bucket:
            try:
                blob = bucket.blob(blob_name)
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
                    "is_emulated": False
                }
            except Exception as e:
                print(f"[GCS Signed URL Warning] Signed URL generation failed ({e}). Returning emulated direct URL.")

        # Fallback / Emulated signed URL for environments without GCS private key credentials
        emulated_url = f"https://storage.googleapis.com/{self.bucket_name}/{blob_name}"
        return {
            "signed_url": emulated_url,
            "blob_name": blob_name,
            "bucket": self.bucket_name,
            "method": "PUT",
            "expires_in_seconds": expires_minutes * 60,
            "is_emulated": True
        }

    def generate_download_signed_url(
        self,
        blob_name: str,
        expires_minutes: int = 60
    ) -> str:
        """
        Generate a V4 signed URL allowing the client to GET/download the object securely.
        """
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
                )
                return url
            except Exception as e:
                print(f"[GCS Download Signed URL Warning] ({e}). Returning standard GCS URL.")

        return f"https://storage.googleapis.com/{self.bucket_name}/{blob_name}"

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


# Singleton service instance
gcs_storage_service = GCSStorageService()
