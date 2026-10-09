# LectureScribe Cloud Deployment Guide: GCS Lecture Bundle & Video Pipeline

> **Document Version:** 1.0.0  
> **Target Environment:** Google Cloud Platform (Cloud Run vs. Cloud Functions Gen 2)  
> **Related Components:** `backend/gcs_storage.py`, `backend/main.py`, `extension/`, `Dockerfile`

---

## 1. Overview & Context

LectureScribe allows capturing Vimeo lectures (transcripts, AI summaries, captions, metadata) and the video file itself directly to Google Cloud Storage (`gs://lecturescribe-resources`).

While running the FastAPI backend locally (`http://localhost:8000`) works seamlessly, running this workload entirely in the cloud eliminates the need to keep a local server active on your machine.

This document details the trade-offs, constraints, and exact deployment steps for migrating the pipeline to **Google Cloud Run** (Recommended) or **Google Cloud Functions (Gen 2)**.

---

## 2. Technical Comparison: Cloud Run vs. Cloud Functions

Private and LMS-embedded Vimeo lectures are delivered via **Adaptive Fragmented MP4 HLS (`.m3u8` with `sf=fmp4`)**, requiring downloading fragments, audio/video demuxing via FFmpeg, and chunked streaming into GCS.

| Dimension | Local Host | Google Cloud Run (Recommended) | Google Cloud Functions (Gen 2) | Google Cloud Functions (Gen 1) |
| :--- | :--- | :--- | :--- | :--- |
| **Max Request Timeout** | Unlimited | **60 minutes** (`--timeout=3600`) | **60 minutes** (`--timeout=3600`) | **9 minutes** (Strict limit) |
| **Default Timeout** | Unlimited | 5 minutes (300s) | 1 minute (60s) | 1 minute (60s) |
| **Storage / Temp Space** | Physical Hard Drive (GBs) | Standard filesystem / container storage | **In-Memory only** (`/tmp` consumes RAM) | In-Memory only |
| **Memory Defaults** | System RAM | 512 MiB (Configurable up to 32 GiB) | 256 MiB (Configurable up to 32 GiB) | 256 MiB (Max 8 GiB) |
| **FFmpeg Availability** | `.venv/bin/ffmpeg` or host package | **Pre-installed in `Dockerfile`** (`apt-get install ffmpeg`) | Must use `imageio-ffmpeg` static wheel | Must use static wheel |
| **FastAPI Compatibility** | Native | **Native** (Run standard Uvicorn container) | Requires wrapper adapter | Requires WSGI/ASGI wrapper |
| **Concurrency** | Single/Multi-worker | Up to 80 concurrent requests per instance | 1 request per function instance | 1 request per instance |

---

## 3. Path A: Deploying to Google Cloud Run (Recommended)

Cloud Run is the optimal architecture because your repository already contains a battle-tested [`Dockerfile`](../Dockerfile) with `ffmpeg`, `libpq5`, and `python 3.11`.

### Step 1: Deploy with `gcloud`
Run this command from the root of the repository (`/home/dipes/projects/lecturescribe`):

```bash
gcloud run deploy lecturescribe-api \
  --project=lecturescribe-509611 \
  --region=us-central1 \
  --source=. \
  --memory=2Gi \
  --cpu=2 \
  --timeout=1800 \
  --concurrency=20 \
  --min-instances=0 \
  --max-instances=5 \
  --allow-unauthenticated \
  --set-env-vars="GCS_RESOURCES_BUCKET=lecturescribe-resources,GOOGLE_CLOUD_PROJECT=lecturescribe-509611"
```

### Parameter Breakdown
- `--source=.`: Uploads and builds the existing multi-stage [`Dockerfile`](../Dockerfile) in Google Cloud Build.
- `--memory=2Gi`: Allocates sufficient memory for video segment buffers and FFmpeg muxing.
- `--cpu=2`: Provides dedicated compute for fast video fragment processing.
- `--timeout=1800`: Sets a **30-minute HTTP timeout**, ensuring full 1- to 2-hour lectures can be downloaded and uploaded without disconnection.
- `--allow-unauthenticated`: Allows the browser extension to trigger API calls from any webpage.

### Step 2: Grant Cloud Storage IAM Permissions
Ensure the service account used by Cloud Run has full write permissions to your target bucket:

```bash
# Get the Cloud Run default service account
PROJECT_NUMBER=$(gcloud projects describe lecturescribe-509611 --format="value(projectNumber)")
SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant Storage Object Admin role on bucket
gcloud storage buckets add-iam-policy-binding gs://lecturescribe-resources \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"
```

### Step 3: Configure the Browser Extension
1. When Cloud Run finishes deploying, copy the Service URL:
   ```text
   https://lecturescribe-api-xxxxxxxx-uc.a.run.app
   ```
2. Open the LectureScribe extension **Options page** (`options/options.html` or right-click extension icon ➔ **Options**).
3. Set **Backend API URL** to:
   ```text
   https://lecturescribe-api-xxxxxxxx-uc.a.run.app
   ```
4. Click **Save Settings**. The extension is now completely decoupled from your local server.

---

## 4. Path B: Deploying to Google Cloud Functions (Gen 2)

If you strictly require a function-only architecture rather than a full container:

### Step 1: Create the Cloud Function Adapter
Cloud Functions HTTP triggers use the Functions Framework (`functions_framework.http`). Create `functions_entrypoint.py` in the root:

```python
"""
functions_entrypoint.py
Google Cloud Functions (Gen 2) HTTP entrypoint adapter for LectureScribe GCS upload.
"""
import functions_framework
from starlette.testclient import TestClient
from backend.main import app

_client = TestClient(app)

@functions_framework.http
def upload_bundle_entrypoint(request):
    """Handles POST /api/cloud/gcs/upload-bundle requests in Cloud Functions."""
    # Forward incoming request into FastAPI ASGI application
    headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}
    
    response = _client.post(
        "/api/cloud/gcs/upload-bundle",
        json=request.get_json(silent=True) or {},
        headers=headers
    )
    
    return (
        response.content,
        response.status_code,
        dict(response.headers)
    )
```

### Step 2: Deploy Cloud Function Gen 2
```bash
gcloud functions deploy upload-lecture-bundle \
  --project=lecturescribe-509611 \
  --region=us-central1 \
  --gen2 \
  --runtime=python311 \
  --source=. \
  --entry-point=upload_bundle_entrypoint \
  --trigger-http \
  --allow-unauthenticated \
  --memory=2GiB \
  --cpu=2 \
  --timeout=900s \
  --set-env-vars="GCS_RESOURCES_BUCKET=lecturescribe-resources,GOOGLE_CLOUD_PROJECT=lecturescribe-509611"
```

> **Critical Notice for Cloud Functions:**
> - In Cloud Functions, `/tmp` is mounted on **tmpfs** (which consumes the function's RAM).
> - Never set memory below **2 GiB**; otherwise, assembling an `.mp4` video will trigger an Out Of Memory (OOM) error.

---

## 5. Secret & Environment Variable Management

In production, avoid storing sensitive keys directly in plain environment strings. You can use Google Secret Manager or inject them via `.env`:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `GCS_RESOURCES_BUCKET` | Destination GCS Bucket | `lecturescribe-resources` |
| `GOOGLE_CLOUD_PROJECT` | GCP Project ID | `lecturescribe-509611` |
| `DATABASE_URL` | Neon PostgreSQL DB connection string | `postgresql://...` |
| `REDIS_URL` | Hosted Redis Cloud instance | `redis://...` |
| `GROQ_API_KEY` | Fast LLM summaries | `gsk_...` |

To pass secrets to Cloud Run from Secret Manager:
```bash
gcloud run services update lecturescribe-api \
  --project=lecturescribe-509611 \
  --region=us-central1 \
  --update-secrets=DATABASE_URL=DATABASE_URL:latest,GROQ_API_KEY=GROQ_API_KEY:latest
```

---

## 6. Verification & Monitoring

### 1. View Live Cloud Logs
To follow live logs during a video upload (monitoring fragment downloads and GCS transfer):
```bash
gcloud run services logs tail lecturescribe-api \
  --project=lecturescribe-509611 \
  --region=us-central1
```

### 2. Verify Uploaded Files in Cloud Storage
```bash
gcloud storage ls gs://lecturescribe-resources/lectures/1234158181/
```
Expected output:
```text
gs://lecturescribe-resources/lectures/1234158181/captions.vtt
gs://lecturescribe-resources/lectures/1234158181/download_guide.txt
gs://lecturescribe-resources/lectures/1234158181/lecture_1234158181.mp4
gs://lecturescribe-resources/lectures/1234158181/metadata.json
gs://lecturescribe-resources/lectures/1234158181/summary.md
gs://lecturescribe-resources/lectures/1234158181/transcript.md
```

