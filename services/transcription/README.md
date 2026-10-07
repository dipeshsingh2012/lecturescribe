# LectureScribe Transcription Service

Standalone FastAPI service intended for Google Cloud Run. It accepts media uploads or public HTTPS media URLs, extracts 16 kHz mono MP3 audio with ffmpeg, and transcribes it using Groq `whisper-large-v3`.

## Endpoints

- `GET /health` — Cloud Run health check.
- `POST /transcribe` — `multipart/form-data` with a `file` field containing audio or video.
- `POST /transcribe/url` — JSON body such as `{"url":"https://example.com/lecture.mp4"}` or `{"url":"https://vimeo.com/123456789"}`.

Successful responses contain `text`, timed `segments` when returned by Whisper, `model`, and `chunks`. Direct media URL inputs must use HTTPS on port 443, resolve only to public IP addresses, and must not redirect. Vimeo video-page URLs are resolved through yt-dlp and must start from a validated public Vimeo host.

Audio at or below 25 MB is sent to Groq as one request. Larger extracted MP3 files are split into 30-minute chunks, each checked against Groq's 25 MB request limit. Rate limits and transient upstream failures are retried with bounded exponential backoff.

## Local run

```sh
export GROQ_API_KEY="..."
uvicorn services.transcription.app:app --host 0.0.0.0 --port 8080
```

The API key is read only from the `GROQ_API_KEY` environment variable. Configure it in Cloud Run Secret Manager; do not put it in the image, source, or request body.

## Cloud Run deployment

The [deploy-transcription workflow](../../.github/workflows/deploy-transcription.yml) uses the same reusable Cloud Run deployment workflow as the parent LectureScribe API. Push changes to `services/transcription/**` on `main`, or run it manually with `workflow_dispatch`.

Before the first deployment, configure the GitHub Actions repository secret `TRANSCRIPTION_EXTRA_ENV_VARS` with the runtime environment pair `GROQ_API_KEY=<Groq key>`. The shared deployment workflow passes this secret to Cloud Run as an environment variable; never put the key in source, workflow YAML, or container image. The service deploys to `lecturescribe-509611` in `us-central1`, using the `services` Artifact Registry repository, 4 GiB memory, 2 CPUs, and `/health` for the post-deploy smoke check.

To enable the lecture-player button, configure the LectureScribe API's existing `EXTRA_ENV_VARS` deployment secret with `TRANSCRIPTION_SERVICE_URL=https://<transcription-service-url>`. For local development, set the same variable in `.env`.

Cloud Run's request-size limit applies to direct uploads. Use `/transcribe/url` for larger source videos.
