# LectureScribe Transcription Service

Standalone FastAPI service intended for Google Cloud Run. It accepts media uploads or public HTTPS media URLs, extracts 16 kHz mono MP3 audio with ffmpeg, and transcribes it using Groq `whisper-large-v3`.

## Endpoints

- `GET /health` — Cloud Run health check.
- `POST /transcribe` — `multipart/form-data` with a `file` field containing audio or video.
- `POST /transcribe/url` — JSON body such as `{"url":"https://example.com/lecture.mp4"}` or `{"url":"https://vimeo.com/123456789"}`.

Successful responses contain `text`, timed `segments` when returned by Whisper, `model`, and `chunks`. Direct media URL inputs must use HTTPS on port 443, resolve only to public IP addresses, and must not redirect. Vimeo page URLs are resolved through Vimeo's public player config and HLS CDN URLs. Only videos Vimeo identifies as public are accepted; account-restricted and embed-restricted videos are unsupported.

Audio at or below 25 MB is sent to Groq as one request. Larger extracted MP3 files are split into 30-minute chunks, each checked against Groq's 25 MB request limit. Rate limits and transient upstream failures are retried with bounded exponential backoff.

## How a Vimeo transcript is generated

For a public Vimeo lecture that has no captions, the flow is:

1. Import the lecture in LectureScribe as usual. The API stores its Vimeo ID and metadata even when the caption list is empty.
2. Select **Generate transcript** in the lecture player. The browser sends a request to the LectureScribe API; it does not send Vimeo URLs or Groq credentials directly to the transcription service.
3. The LectureScribe API calls this service's `POST /transcribe/url` endpoint with `https://vimeo.com/<video-id>`.
4. The service validates that the request is a public HTTPS Vimeo video URL, fetches `https://player.vimeo.com/video/<video-id>/config`, and checks that Vimeo's config identifies the same video as public (`privacy: anybody`).
5. From that config, the service selects a signed HLS playlist URL hosted on `vimeocdn.com`. It validates the CDN host and public DNS addresses, then gives the HLS stream to ffmpeg. ffmpeg reads the stream using HTTPS/TLS and extracts 16 kHz mono MP3 audio; it does not download the full video first.
6. The service sends the audio to Groq Whisper (`whisper-large-v3`). If the extracted audio exceeds 25 MB, it segments the audio and sends smaller chunks, then combines the returned transcript text and offsets segment timestamps.
7. The service returns text and timed segments. The LectureScribe API maps those segments to transcript cues, saves them with the lecture, indexes them for transcript search and AI Tutor, invalidates lecture caches, and returns the updated lecture to the player.

The Vimeo player config and its signed CDN URLs are obtained at request time because they expire. This path does not use yt-dlp or Vimeo login cookies/OAuth tokens. It cannot transcribe private videos, password-protected videos, or videos whose embed/access restrictions prevent the public player config from exposing a playable HLS stream. In those cases, Vimeo must make the video publicly playable for this service, or the service would need an authorized media-ingest mechanism.

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
