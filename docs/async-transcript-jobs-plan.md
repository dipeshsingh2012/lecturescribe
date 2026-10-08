# Async Transcript Generation Plan

Last updated: 2026-10-07 06:39 UTC

## Purpose

Replace the long-running synchronous lecture transcription request with a durable asynchronous job flow. The browser should return quickly after starting transcription, monitor job status separately, and refresh the saved lecture when the job completes.

On successful completion, the AI Tutor must also be auto-populated from the newly saved transcript, not merely enabled for later manual use.

This plan is now being implemented. Progress below is updated as changes land and validation completes.

## Progress

| Workstream | Status | Progress |
|---|---|---:|
| Existing synchronous Vimeo/Groq transcription pipeline | Implemented | 100% |
| Durable queue decision | Agreed: Google Cloud Tasks | 100% |
| Long-running execution approach | Recommended: Cloud Tasks launches Cloud Run Job | 100% planning decision; validate IAM/limits during implementation |
| Persistent job model, worker, and async API | Implemented & Hardened | 95% |
| Cloud Tasks and Cloud Run Job orchestration | Implemented & Resilient | 85% |
| Frontend polling and Tutor completion integration | Implemented & Tested | 90% |
| Tests, deployment configuration, rollout | In progress | 70% |
| Overall async implementation | Pre-deployment complete | 85% |

### Confirmed user requirements / decisions

- The browser POST must not wait for the full media download, audio conversion, Groq request(s), database save, and search indexing.
- Use a durable queue. User selected Cloud Tasks over an in-process background task because jobs should survive instance restarts and support retries.
- Once polling observes a successful transcription, update the lecture with fresh cues and trigger AI Tutor auto-population.
- Keep current synchronous behavior intact until the async path is tested and ready to replace it.
- Keep async mode disabled unless `ASYNC_TRANSCRIPTION_ENABLED=true`; the current sync endpoint remains the default.

## Current implementation facts

- `POST /api/lecture/{video_id}/transcribe` in `backend/main.py` remains synchronous by default. With `ASYNC_TRANSCRIPTION_ENABLED=true`, it creates/reuses a persistent job and returns `202`; the completed-transcript `200` response is unchanged.
- If cues already exist, this route currently returns the saved lecture data directly rather than starting another transcription.
- Frontend `handleGenerateTranscript` in `frontend/src/hooks/useLectureIngestion.js` supports both the legacy synchronous response and async job polling/resume, fetching canonical lecture data before Tutor initialization.
- Lecture player wiring is through `frontend/src/App.jsx`, `frontend/src/components/views/LectureWorkspace.jsx`, and `frontend/src/components/lecture/LecturePlayer.jsx`.
- AI Tutor behavior is in `frontend/src/hooks/useAITutor.js`.
  - `initChatMessages(title, videoId, cues)` calls `fetchChatHistory` and allows auto-population only when cues contain transcript text.
  - `fetchChatHistory` loads saved messages first; when none exist and cues are present, it calls `autopopulateChat`.
  - Its effect also rechecks when cue count changes. Async completion explicitly initializes with fresh cues and preserves a session-cleared Tutor chat.
- `RelationalDBManager._init_postgres_schema` in `backend/database.py` owns the idempotent PostgreSQL table/schema creation. Follow this established schema pattern for a persistent transcription-jobs table or migration.
- Backend deployment uses `.github/workflows/deploy-backend.yml`; the transcription service deployment uses `.github/workflows/deploy-transcription.yml`.
- The working Vimeo path is in `services/transcription/transcription.py`: fetch Vimeo public player config, validate public video metadata and CDN host/IP, then let ffmpeg consume HLS and extract audio. Do not revert to yt-dlp's default web or Android clients; Android requires cached OAuth tokens.
- Current repository at planning time: branch `main`, HEAD `ee1ae6a`; no worktree modifications were reported by `git status --short`.

## Implementation progress (2026-10-07)

### Completed in the current implementation pass

- Added `lecturescribe_transcription_jobs`, an active-job-per-video partial unique index, and PostgreSQL methods for create/reuse, lookup, update, atomic worker claim, and stale dispatch claim.
- Added an async branch to the existing transcription POST. New and active jobs return `202`; already-transcribed lectures retain the existing `200` response. Cloud Tasks enqueue failures are recorded and surfaced explicitly.
- Added a compact status GET, a dispatcher route that validates the Cloud Tasks OIDC identity, and a Cloud Run Jobs v2 launch request containing only `TRANSCRIPTION_JOB_ID`.
- Added `backend/transcription_worker.py` and a worker pipeline that saves cues, indexes Algolia/Pinecone, invalidates Redis, then marks the job completed. Duplicate worker starts are claimed atomically.
- Added frontend status polling with bounded network retries and increasing delay, localStorage resume, terminal-state handling, stage UI, fresh lecture fetch, and a Tutor initialization call only after the canonical lecture has transcript cues. Forwarded the `cues` argument through the App callback; it was previously discarded at that boundary.

### Work remaining / not yet verified

- Add remaining database state-transition, worker failure/partial-index, UI unmount/navigation, and end-to-end tests.
- Run a live PostgreSQL migration/schema check and validate complete Cloud Tasks/Run Job configuration in a nonproduction GCP project.
- Confirm the deployment image build installs the newly declared `google-cloud-tasks` dependency from `requirements.txt`.
- Add task/Cloud Run Job resource provisioning and least-privilege IAM. Backend workflow currently deploys only the API service; resource creation and runtime configuration are not yet automated.
- Validate that the deployed API service account can create tasks and run the Cloud Run Job, and that the task OIDC service account can invoke the API.
- Decide/verify queue retry limits, Cloud Run Job timeout/resources and retry count, stale-job recovery/retention, and the app's current email-based ownership limitations. Email is not cryptographic authentication; the status ID is a UUID capability, so use it only in the requesting user's app.
- Verify indexing-failure and user retry UX, and exercise an end-to-end job in a nonproduction project.

### Configuration assumed by the implementation

Async mode is opt-in. It requires `GOOGLE_CLOUD_PROJECT`, `TRANSCRIPTION_TASKS_QUEUE`, `TRANSCRIPTION_TASKS_DISPATCH_URL`, `TRANSCRIPTION_TASKS_INVOKER_SERVICE_ACCOUNT`, `TRANSCRIPTION_CLOUD_RUN_JOB`, and the existing `TRANSCRIPTION_SERVICE_URL`. Task and Job regions default to `us-central1`, consistent with the API deployment workflow. The API and Cloud Run Job must use images containing the same backend code and database configuration. The job command is `python -m backend.transcription_worker`; the launch override supplies `TRANSCRIPTION_JOB_ID`.

The dispatch claim allows a `starting` job with no recorded Cloud Run execution to be reclaimed after two minutes. This is crash recovery, not a substitute for configured Cloud Tasks retries or monitoring.

### Validation so far

- Backend focused suite: 17 tests passed (`test_api_transcript.py`, `test_transcription_jobs.py`), including async `202`, active-job reuse, status ownership hint, worker persistence/indexing, task payload, Cloud Run launch override, and OIDC identity checks.
- Frontend focused suites: 24 tests passed (`useLectureIngestion` and `useAITutor`), including async completion and preserving a user-cleared Tutor conversation.
- `LecturePlayer` component suite: 6 tests passed. One unrelated `LectureWorkspace` test fails because its fixture omits `activeData.cues` while expecting transcript cue text; the workspace correctly marks the transcript unavailable for that fixture. The async status-prop change is not involved.
- Frontend production build succeeded. Vite reported its existing large-chunk advisory (>500 kB); no build errors.
- Editor diagnostics reported no errors in changed implementation files.
- `git diff --check` passed. PostgreSQL behavior has not yet been exercised against a live/test database; schema, active-job race, and state-transition tests remain pending.
- A couple of test invocations were first run from the wrong directory or against stale test expectations; corrected focused commands now pass.

## Future steps and prioritized TODOs

Do these in order. Keep async mode disabled until the cloud prerequisites and staging validation are complete.

### P0 — Harden correctness before cloud provisioning

- [ ] Add database-backed tests for schema initialization, the active-job unique index under concurrent requests, idempotent job creation, valid/invalid state transitions, task/execution metadata updates, and deletion behavior when a lecture is removed.
- [x] Fix/verify the `starting` dispatch recovery contract: task retries must not become permanently stuck when an execution has launched but its name was not persisted; avoid launching concurrent duplicate Cloud Run executions after the two-minute stale threshold. Added `reset_transcription_dispatch` on launch failure.
- [x] Add worker tests for service/network errors, non-JSON responses, empty transcript output, already-present cues, save failure, indexing failure after transcript save, cache invalidation, and terminal-state updates.
- [x] Make worker retries recoverable after partial success. Indexing failure after cue persistence preserves cues in database; subsequent worker executions detect existing cues and proceed directly to indexing without calling transcription service.
- [x] Confirm that returned job status is refreshed after task enqueue and metadata updates, and that duplicate start responses always describe the persisted active job.
- [x] Ensure client polling handles terminal status lookup failures, reload/resume, lecture switching, unmount, repeated clicks, and stale/localStorage job records without endless spinners. Keep the active job visible when a transient polling failure occurs.
- [ ] Verify Tutor history lookup and auto-population happen only after fresh cues arrive, exactly once per job, without duplicating existing starter messages; ensure user-cleared chat remains cleared.
- [ ] Add an explicit user retry action/API only after retry semantics are defined. Do not silently create a new job for a failed job.

### P1 — Confirm operational contract and provision GCP

- [ ] Confirm the production GCP project, queue and Job regions, API runtime service account, Cloud Tasks OIDC service account, and Cloud Run Job runtime service account.
- [ ] Set maximum supported lecture duration, Cloud Run Job timeout, CPU/memory, task parallelism, max retries, Cloud Tasks retry/backoff, queue rate limits, job retention, and stale-job alert/reconciliation policy.
- [ ] Decide whether transcript persistence or successful Algolia/Pinecone indexing defines `completed`. If indexing is required, ensure indexing retries do not require another transcription.
- [ ] Provision the Cloud Tasks queue and Cloud Run Job. Configure the Job command as `python -m backend.transcription_worker`, pass only `TRANSCRIPTION_JOB_ID`, and provide the existing DB/transcription-service configuration securely.
- [ ] Grant least-privilege IAM: API service identity can create tasks and run the named Job; task identity can mint OIDC and invoke the protected API route; Job identity can access PostgreSQL and the transcription service. Do not add Groq credentials to the backend or task payload.
- [ ] Configure backend environment values: `ASYNC_TRANSCRIPTION_ENABLED`, `GOOGLE_CLOUD_PROJECT`, `TRANSCRIPTION_TASKS_LOCATION`, `TRANSCRIPTION_TASKS_QUEUE`, `TRANSCRIPTION_TASKS_DISPATCH_URL`, `TRANSCRIPTION_TASKS_INVOKER_SERVICE_ACCOUNT`, `TRANSCRIPTION_CLOUD_RUN_JOB`, `TRANSCRIPTION_CLOUD_RUN_JOB_REGION`, and existing `TRANSCRIPTION_SERVICE_URL`.
- [ ] Verify deploy ordering and image freshness: deploy compatible API/schema first, provision queue/Job/IAM, deploy the same backend image as a Cloud Run Job with the worker command, then deploy/enable the async frontend.
- [ ] Review authorization before production. Current ownership check compares a caller-provided email; it is not a verified identity boundary. Require the app's authenticated principal or another server-verified authorization mechanism before exposing private job status.

### P2 — Validate staging, enable gradually, and operate

- [ ] Run all focused backend/frontend tests and the full relevant suites; fix new regressions and separately track the known `LectureWorkspace` fixture mismatch.
- [ ] Apply/verify the PostgreSQL schema in a staging database, then test concurrent duplicate POSTs and job status transitions against the real database.
- [ ] In staging, test a known public Vimeo lecture plus short and long videos through enqueue → dispatch → Run Job → saved cues → indexing → completed poll → refreshed UI → Tutor history/autopopulation.
- [ ] Test retries and crash windows: duplicate Cloud Task delivery, dispatcher restart around Run Job launch, Job retry, API restart, transcription timeout, DB failure, indexing failure, and browser refresh/navigation.
- [ ] Add structured logs and metrics keyed by job ID/video ID (no signed media URLs or credentials), plus alerts for queue backlog, failed/stale jobs, job duration, and indexing/Tutor failures.
- [ ] Enable async mode for a controlled rollout, monitor completion/error/latency, and retain the synchronous feature-flag rollback path until stable.
- [ ] After production confidence, decide whether to remove the synchronous route behavior; do not remove it as part of the initial rollout.

## Recommended architecture

### Why Cloud Tasks plus Cloud Run Jobs

Cloud Tasks is the durable dispatch/retry layer, but the actual media transcription can outlast an HTTP task dispatch deadline. Some lectures are over an hour long. Do not make the queue delivery wait for media processing or rely on a short-lived FastAPI background task.

Recommended flow:

1. Browser POST starts/reuses a persistent job and returns `202 Accepted` quickly.
2. Backend inserts a job row in PostgreSQL and enqueues a Cloud Task containing only the job ID.
3. Cloud Task calls an authenticated, internal backend dispatch endpoint.
4. Dispatch endpoint validates/claims the job and starts a Cloud Run Job execution, then returns a 2xx response to Cloud Tasks promptly.
5. Cloud Run Job runs the transcription worker to completion. It loads the job row, obtains the Vimeo source from the saved lecture, calls the transcription service, persists transcript cues, indexes Algolia/Pinecone, clears caches, then marks the job completed.
6. Frontend polls a separate status GET endpoint. On `completed`, it fetches the canonical lecture GET response, updates active lecture and browser cache, and triggers Tutor auto-population once.

This separates queue delivery lifetime from potentially long transcription. During implementation verify current Google Cloud limits and exact client/API support for Cloud Tasks dispatch deadlines and Cloud Run Jobs execution.

### Components

#### 1. Persistent job record

Add a `lecturescribe_transcription_jobs` table using the project's existing PostgreSQL initialization/migration conventions. Suggested fields:

- `job_id`: UUID primary key.
- `video_id`: FK to `lecturescribe_videos.video_id`.
- `requested_by`: nullable normalized email, following current caller conventions.
- `status`: `queued`, `starting`, `processing`, `completed`, `failed`.
- `stage`: optional user-facing stage such as `queued`, `transcribing`, `saving`, `indexing`, `completed`.
- `error_message`: sanitized, user-safe terminal failure detail; never store credentials or signed stream URLs.
- `task_name`: Cloud Tasks name for traceability/deduplication.
- `run_execution_name`: Cloud Run Job execution identifier.
- `attempt_count`: worker/dispatch attempt counter as useful.
- `created_at`, `updated_at`, `started_at`, `completed_at`, `heartbeat_at`.

Use database constraints/indexes to support lookup by job ID, newest jobs by video, and at most one active (`queued`/`starting`/`processing`) transcript job per video. Create row and enqueue work with a recoverable sequence. If enqueue fails, persist a clear failed/enqueue-error state or otherwise ensure no permanently queued row is left without a task.

Avoid relying only on process memory for job state or deduplication.

#### 2. Start-job endpoint

Keep the existing user-facing POST path if possible to minimize UI/API churn:

- `POST /api/lecture/{video_id}/transcribe`
- Validate numeric Vimeo ID and that the lecture exists.
- If a transcript with usable cues already exists, return a completed/already-available response (not an error, and do not enqueue).
- If an active job for the video already exists, return that same job ID and status (no duplicate task).
- Otherwise create a job, enqueue a Cloud Task, and return quickly:

```json
{
  "job_id": "<uuid>",
  "video_id": "<id>",
  "status": "queued",
  "status_url": "/api/lecture/transcription-jobs/<uuid>"
}
```

Use HTTP `202 Accepted` for newly queued and existing active jobs; document whether an already-transcribed lecture returns `200` with `status: completed` and cues, or a completed job reference followed by a lecture GET. Be consistent across API and hook.

Keep the service URL/key server-side. The task body contains identifiers only.

#### 3. Job status endpoint

Add a separate GET, for example:

- `GET /api/lecture/transcription-jobs/{job_id}`

Return status, stage, timestamps, and sanitized error detail. Do not include signed Vimeo URLs, Groq keys, internal service credentials, or huge cue arrays here.

For authorization, follow the application's current identity model, but do not trust a caller-provided email as strong authentication. Ensure job lookup does not expose another user's private lecture/job data. Review whether the existing API has a usable authenticated principal before finalizing this contract.

#### 4. Cloud Tasks dispatcher and Cloud Run Job

- Add/configure a queue, likely in the existing region `us-central1`.
- Task target uses OIDC authentication with a dedicated service account; protect the dispatch route so public callers cannot start arbitrary jobs.
- Dispatch route claims a job atomically and starts the Cloud Run Job execution. A duplicate task must safely return success if the job is already running or terminal.
- Worker obtains `job_id` via an argument or job execution environment; avoid setting user-controlled arbitrary environment values.
- Make launch idempotent under retry/race conditions. Store execution name and use row locking/atomic transitions so a repeated task does not create duplicate simultaneous executions. Handle crash points:
  - Task created but API response lost.
  - Dispatcher starts a Job but crashes before recording the execution name/acknowledging the task.
  - Job starts but cannot update status.
  - Job exits/fails after task delivery already succeeded.
- Define stale-job recovery/reconciliation. At minimum, heartbeat and expose an operator procedure to retry/requeue stale/failed jobs. Consider a scheduled reconciler if needed.
- Decide Cloud Run Job task retry count, timeout (within platform maximum), parallelism, and resource limits based on maximum supported video duration and memory needs.
- Reuse the existing transcription service for media/audio/Groq work; the backend worker remains responsible for DB/search/index/cache orchestration.
- Validate deployment options: separate worker entry point/container command for Cloud Run Jobs, or a dedicated worker image. Do not accidentally start an HTTP server as the job's main process.

#### 5. Worker pipeline

Extract the body of the current synchronous endpoint into a reusable job processor, preferably in a dedicated module rather than making worker logic depend on an HTTP request handler:

1. Load job and lecture record.
2. Idempotency check: if transcript cues already exist and are usable, finish as completed without re-transcribing.
3. Mark processing/transcribing.
4. Call transcription service with canonical `https://vimeo.com/<video_id>`.
5. Validate transcription response and map Whisper segments to compact existing cue shape `{time, text}`. If no valid segments but nonempty full text exists, retain existing single-cue fallback at `00:00`.
6. Save cues and empty/appropriate summary data through `save_video_transcript`.
7. Index cues with Algolia and Pinecone.
8. Invalidate Redis lecture query/tool/quiz caches.
9. Mark job completed only after required persistence/index steps succeed; define whether index errors fail the job or are separately recorded/retryable. Avoid reporting success before transcript is saved.
10. On failure, save sanitized diagnostic/status, distinguish retryable from permanent failures, and let Cloud Run Job retry behavior or explicit user retry policy handle it.

Review partial failures: database save may succeed while indexing fails. Retries must not corrupt/reduplicate cues; re-running indexing should be safe. Ideally status/result distinguishes “transcript saved, index pending/failed” from “transcription failed,” or make index rebuild idempotent.

#### 6. Frontend lifecycle and polling

In `frontend/src/hooks/useLectureIngestion.js`:

- POST to start/reuse a job; set UI status to queued/processing and return without awaiting transcription.
- Poll the job status endpoint with a moderate interval (e.g. 2–4 seconds) and bounded backoff/cap to avoid excessive requests.
- Stop polling on completion, terminal failure, lecture change, component unmount, or explicit cancellation/navigation when appropriate. Use `AbortController` and clear timers.
- Keep polling state scoped to the job/lecture, not global or persisted as a stale active tab.
- Display status text on the button/card (`Queued`, `Transcribing`, `Saving transcript`, `Transcript ready`) and actionable retryable failure details. Do not leave a spinner indefinitely.
- On `completed`, GET `/api/lecture/{video_id}` (or existing course lecture GET path if course association needs to be retained) to obtain canonical persisted cues and metadata. Update `activeData` only if it still refers to the same video; update `lecturescribe_cached_videos` local cache.
- Handle browser reload/re-entry: if a lecture has a pending job, GET active job/status on load and resume polling; localStorage may remember job ID for UX, but PostgreSQL remains authoritative.
- Handle duplicate button presses by reusing the same active job.
- Do not treat one timeout/network error as the worker's terminal failure; retry status GET with backoff until the job's persisted state is terminal.

#### 7. Tutor auto-population after polling success (required)

When polling first observes `completed`:

1. Fetch the fresh lecture data and verify it contains at least one nonempty cue.
2. Update active lecture state and local cache.
3. Invoke existing `initChatMessages(title, videoId, cues)` (or a narrow explicit `autopopulateChat` API if warranted). Current `initChatMessages` fetches history first and auto-populates only if no history exists and usable transcript cues are supplied.
4. Trigger this once per completed `job_id` per browser lifecycle; keep a ref/set of handled job IDs so polling repeated terminal state cannot duplicate initialization.
5. Preserve user intent: if chat was explicitly cleared during the session, do not silently repopulate unless product requirements explicitly change. Existing `clearedInSessionRef` is relevant.
6. If chat history already exists, load it rather than create duplicate starter messages.
7. Make Tutor auto-population failure visible and retryable. Current `autopopulateChat` catches/logs failures and returns without a user-visible state; determine the smallest related API addition to expose an error/retry indicator. Transcript job must stay completed if only Tutor auto-population fails.
8. Race-proof against navigating to another lecture while polling completes: only mutate the active UI for the same video/job, but do not discard the persisted successful transcript.

Potential existing hook interaction: `useAITutor` effect observes video ID and cue count, and may fetch history when cues change. Ensure the explicit completion trigger and effect share the existing in-flight protections; add tests to prove exactly one autopopulate request.

#### 8. Deployment and configuration

Add only needed Python dependencies (likely `google-cloud-tasks`; evaluate Cloud Run Jobs client/auth method before choosing a package). Update root `requirements.txt` and backend container build if needed.

Configuration should be environment-based, no hardcoded project, queue, service account, service URL, or secrets. Likely config:

- `GOOGLE_CLOUD_PROJECT`
- `TRANSCRIPTION_TASKS_LOCATION`
- `TRANSCRIPTION_TASKS_QUEUE`
- `TRANSCRIPTION_TASKS_DISPATCH_URL` (base backend service URL if needed; ensure no invalid self-URL assumptions)
- `TRANSCRIPTION_TASKS_INVOKER_SERVICE_ACCOUNT`
- `TRANSCRIPTION_CLOUD_RUN_JOB`
- `TRANSCRIPTION_CLOUD_RUN_JOB_REGION`
- `TRANSCRIPTION_CLOUD_RUN_JOB_RUNTIME_SERVICE_ACCOUNT`
- Existing `TRANSCRIPTION_SERVICE_URL`
- Existing backend `DATABASE_URL`

Prefer sensible explicit names and document exact required subset after implementation.

Deployment steps must include:

- Create the Cloud Tasks queue.
- Create/configure the Cloud Run Job with the correct image/command, task timeout, CPU/memory, max retries, and environment.
- Grant least-privilege IAM to API service account (enqueue tasks, execute job, impersonate runtime SA only if required).
- Grant the Cloud Tasks service account permission to invoke the protected dispatcher endpoint using OIDC.
- Ensure the Job runtime service account has DB/network access and can call the transcription service.
- Keep Groq key only on the transcription service, not in job/task data or frontend.
- Update backend workflow deployment/config docs for the task service and required env vars.
- Consider rollout order: database schema/backward-compatible backend, job/queue/IAM, async backend deploy, then frontend deploy/enable. Include rollback to old synchronous flow or feature flag until stable.

## API response proposal

Start/reuse:

```http
POST /api/lecture/123/transcribe?email=...
202 Accepted
```

```json
{
  "job_id": "uuid",
  "video_id": "123",
  "status": "queued",
  "stage": "queued"
}
```

Poll:

```http
GET /api/lecture/transcription-jobs/uuid
200 OK
```

```json
{
  "job_id": "uuid",
  "video_id": "123",
  "status": "processing",
  "stage": "transcribing",
  "created_at": "...",
  "updated_at": "...",
  "error": null
}
```

On completion, GET the existing lecture endpoint to get cues. Keep polling response compact and avoid returning a duplicate transcript payload on every poll.

Status state machine proposal:

```text
queued -> starting -> processing -> completed
                    \-> failed
queued/starting may be re-dispatched after transient task-launch errors
failed -> queued only through an explicit retry operation/policy
```

`completed` is terminal and means transcript is durably saved. Whether search-indexing must also be complete before terminal completion must be made explicit in implementation.

## Work breakdown (execution checklist)

### Phase 0: Confirm design/constraints

- [ ] Confirm Cloud Tasks queue location/project and Cloud Run Job execution strategy.
- [ ] Confirm max supported video length and worker timeout/memory/retry policy.
- [ ] Confirm auth/ownership policy for start and status endpoints.
- [ ] Decide job retention period and manual/user retry semantics.
- [ ] Decide whether failed indexing blocks completed state or produces an index-pending state.

### Phase 1: Persistent job model and backend services

- [x] Add job schema, indexes, state-transition helpers, and row-level locking/atomic claim.
- [ ] Add job record tests including active-job dedupe and state transitions.
- [ ] Refactor the legacy synchronous handler to share the complete processor; cue normalization is now shared, while the worker currently owns the reusable async pipeline.
- [x] Preserve safe cue conversion, error detail sanitation, indexing, and invalidation behavior.
- [x] Add unit tests for worker success and duplicate execution.
- [x] Add worker failure/no-text/partial-index cases and database-backed schema/deduplication tests.

### Phase 2: Cloud Tasks and Cloud Run Job orchestration

- [x] Add Cloud Tasks client/enqueue adapter and deterministic task naming/idempotence.
- [x] Add authenticated dispatcher endpoint that launches the Cloud Run Job and acknowledges promptly.
- [x] Add Job entry point that accepts only a job ID and uses persisted lecture/job data.
- [x] Add retry/stale-job recovery handling (`reset_transcription_dispatch`) and structured logs with job ID/video ID only.
- [x] Add mocked tests for task payload, Cloud Run Job execution override, and task identity.
- [ ] Verify IAM and timeout config in a nonproduction deployment.

### Phase 3: Public API contract

- [x] Change POST to return `202` job ID for new or already-active work, with existing-transcript response kept as `200`.
- [x] Add status GET endpoint, sanitized error details, and a matching-email check for jobs with a recorded requester.
- [ ] Add explicit retry endpoint only if user-facing retry is in scope; do not silently duplicate failed jobs.
- [x] Add backend route tests for 202, dedupe, missing lecture, completed transcript, unauthorized job lookup, status progression, and enqueue failure.

### Phase 4: Frontend polling and transcript refresh

- [x] Change `handleGenerateTranscript` to start a job and poll independently.
- [x] Add backoff, abort/cleanup, job persistence/resume, lecture-switch safety, and terminal state handling.
- [x] Show queued/processing stage and failure details in the lecture player.
- [x] On completion, GET canonical lecture, update active data/cache, and stop poll.
- [x] Test async queued -> completed, canonical cue refresh, and Tutor initialization.
- [x] Add polling failure, unmount, video switch, reload-resume, and duplicate start tests.

### Phase 5: Tutor auto-population integration

- [x] On successful status poll and fresh cues, invoke Tutor initialization once from the ingestion hook.
- [ ] Verify existing chat history is loaded without duplicate Tutor starter messages.
- [x] Respect user-cleared chat state.
- [ ] Expose Tutor auto-population failure/retry independently from transcript-job status.
- [ ] Add hook tests asserting auto-population fires only after completion/fresh cues and never more than once, including polling duplicates and navigation races.

### Phase 6: Deployment, monitoring, rollout

- [ ] Add Cloud Tasks/Cloud Run Job dependency/configuration/documentation and workflow support.
- [ ] Configure queue, Job, service accounts, least-privilege IAM, and required environment variables.
- [ ] Deploy schema/backend compatibly, then Job/queue, then enable async client flow.
- [ ] Add structured logs and metrics for enqueue latency, queue retries, job duration, failures by stage, stale jobs, transcript cue counts, and Tutor auto-population failures.
- [ ] Test with the known public Vimeo lecture and at least one shorter/longer fixture/video.
- [ ] Confirm Search, AI Tutor, Quiz consume the newly persisted cues after completion.
- [ ] Verify rollback path and remove/deprecate synchronous long request only after production confidence.

## Acceptance criteria

- Start POST responds quickly with a durable job ID and does not wait for Vimeo/Groq transcription.
- Duplicate clicks for one lecture reuse a single active job.
- Cloud Run/API restarts do not lose the job; dispatch/worker retries do not create duplicate transcript rows or duplicate Tutor starter chat.
- UI accurately presents queue/processing/completed/failed state and stops polling when appropriate.
- On completion, canonical cues are fetched and available to Search, AI Tutor, and Quiz.
- AI Tutor auto-population is triggered after successful completion exactly once when no existing chat is present, and can be retried if that distinct step fails.
- Failure details are actionable but never expose credentials or signed stream URLs.
- Focused backend and frontend tests pass, builds/types pass, and deployment configuration is validated.

## Handoff notes for the next agent

1. Read this plan first and inspect the current branch/worktree before editing; retain unrelated user work.
2. Implementation is underway using the previously selected Cloud Tasks + Cloud Run Job design. Confirm provisioned IAM/resources before enabling async mode in production.
3. Preserve the working public Vimeo player-config/HLS method in the transcription service. The Android yt-dlp client failed because it requires cached OAuth tokens.
4. The current frontend `initChatMessages` path already checks history and only allows auto-population if cues exist. Reuse and test this behavior instead of introducing a second independent auto-populate flow without need.
5. Async implementation is approximately **60% complete**. Existing synchronous transcription remains the default; enable async only after Cloud Tasks, Cloud Run Job, IAM, environment, remaining tests, and nonproduction validation are complete.
