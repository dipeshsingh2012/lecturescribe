# LectureScribe ↔ aroadmap MCP and Agentic Fleet Integration

**Status:** Implementation specification  
**Scope:** Enable aroadmap to request Agentic Fleet work for LectureScribe through MCP, and return execution status to aroadmap.  
**Repositories:** `dipeshsingh2012/lecturescribe`, `dipeshsingh2012/aroadmap`, `dipeshsingh2012/agentic-fleet`

This document describes the implementation and deployment configuration. LectureScribe now has an authenticated MCP HTTP endpoint, a persisted fleet-run table, GitHub dispatch/status callbacks, and the corresponding aroadmap MCP trigger/status tools. The cross-repository production path still requires the manual secret configuration and deployment described below.

## 1. Goals and non-goals

### Goals

- Let aroadmap initiate a LectureScribe fleet run through a supported MCP tool.
- Have LectureScribe validate and dispatch the request to its own GitHub repository.
- Run the existing Agentic Fleet action in GitHub Actions on a `repository_dispatch` event.
- Return accepted, started, and completed/failed status to LectureScribe and synchronize the status to aroadmap.
- Preserve an auditable correlation between aroadmap initiative, dispatch request, GitHub Actions run, and final result.
- Keep credentials in GitHub Actions secrets or Cloud Run Secret Manager, never in source, MCP arguments, or client-visible responses.

### Non-goals

- Importing Agentic Fleet as a LectureScribe Python dependency.
- Letting an MCP caller choose an arbitrary GitHub repository or workflow.
- Replacing LectureScribe CI or deployment workflows.
- Making the backend an unauthenticated public GitHub dispatch proxy.
- Treating `workflow_dispatch` as the functional MCP test path. Fleet logs show it can execute the action while the orchestrator ignores that event when no agent trigger matches.

## 2. Current state and prior art

- LectureScribe's backend is a FastAPI application in `backend/main.py`, deployed as `lecturescribe-api` to Google Cloud Run by `.github/workflows/deploy-backend.yml`.
- LectureScribe's MCP implementation is in `backend/mcp_integration.py`; it exposes `POST /api/v1/mcp` and `POST /api/v1/mcp/fleet-callback`. Fleet run records are stored in `lecturescribe_fleet_runs` by `backend/database.py`.
- LectureScribe's `.github/workflows/agentic-sdlc.yml` listens for `repository_dispatch` types `mcp_initiative`, `mcp_start_dev`, and `fleet_trigger`, checks out `dipeshsingh2012/agentic-fleet`, executes its local action, and reports run start/final state back to the backend.
- The Fleet action accepts `gemini-api-key` and `github-token` among its inputs. The workflow must not pass unsupported inputs such as `skip-mcp-initiative` or `trigger-source`. It already supplies `GITHUB_EVENT_NAME` and `GITHUB_EVENT_PATH` through the action.
- aroadmap exposes a JSON-RPC POST handler at `https://aroadmap.dev/api/mcp`; `lib/mcp-server.ts` includes `trigger_lecturescribe_fleet` and `report_fleet_status`, and `lib/db/index.ts` persists status in `aroadmap.fleet_runs`.
- aroadmap's `/api/mcp` route requires separate bearer credentials for the trigger and status-reporting tools.
- RFPEngine's [ADR 0022](../../RFPEngine/docs/adr/0022-model-context-protocol-mcp-integration-for-ide-and-chat.md) is the MCP architecture reference. Its stated design separates local stdio clients from remote HTTP transport and calls for tenant-scoped access. The implementation plan below reuses the protocol and security principles, not RFPEngine-specific APIs or database assumptions.

**Important transport distinction:** aroadmap's current `/api/mcp` route is an HTTP POST JSON-RPC handler. Do not assume it provides the SSE transport described in RFPEngine's ADR. The first LectureScribe-to-aroadmap callback can use a server-to-server JSON-RPC POST to that endpoint; streaming can be considered separately if product requirements later need it.

## 3. Proposed architecture

```text
┌──────────────────────────┐
│ aroadmap UI / MCP client │
│ calls LectureScribe tool │
└────────────┬─────────────┘
             │ HTTPS + authenticated JSON-RPC
             ▼
┌───────────────────────────────────────────────┐
│ LectureScribe FastAPI on Cloud Run            │
│                                               │
│ MCP endpoint /api/v1/mcp                      │
│  - authenticate caller                        │
│  - validate tool arguments and target         │
│  - persist request/correlation state          │
│  - call GitHub repository_dispatch API        │
│  - accept workflow status callbacks           │
│  - call aroadmap MCP tool to synchronize      │
└────────────┬─────────────────────┬────────────┘
             │                     ▲
             │ GitHub REST API     │ authenticated callback
             ▼                     │
┌──────────────────────────┐       │
│ GitHub Actions           │───────┘
│ repository_dispatch      │
│ runs agentic-fleet action│
└──────────────────────────┘
             │
             │ MCP JSON-RPC POST (status synchronization)
             ▼
┌──────────────────────────┐
│ aroadmap /api/mcp        │
│ report_fleet_status tool │
└──────────────────────────┘
```

LectureScribe is the trusted dispatch gateway for its own repository. aroadmap is the product-control plane and MCP caller. GitHub Actions is the execution plane. aroadmap-to-LectureScribe MCP is the request direction; LectureScribe-to-aroadmap MCP is the status synchronization direction. The workflow callback to LectureScribe is a separate authenticated delivery mechanism because the GitHub runner must report its run ID and outcome.

## 4. End-to-end execution

### 4.1 Request from aroadmap

1. An operator approves the initiative by moving it to the `approved` stage. This does not dispatch the fleet.
2. When the operator moves the approved LectureScribe initiative to `development`, the board requires LectureScribe operator sign-in; aroadmap's server validates the operator session and calls LectureScribe's MCP endpoint over HTTPS using its registered service credential. The same stage-change request returns the fleet status and `request_id`; the caller does not need a second trigger call. Other tenants' stage transitions do not dispatch to LectureScribe.
3. An authorized aroadmap MCP client can cause the same transition by calling `transition_initiative_stage` with `tenant_id: "lecturescribe"` and `stage: "development"`; the request must include the `AROADMAP_FLEET_TRIGGER_TOKEN` bearer credential.
4. LectureScribe authenticates the caller, validates the request, applies an allowlist for supported fleet event types, and verifies that the destination is fixed to `dipeshsingh2012/lecturescribe`.
5. LectureScribe creates a unique `request_id`, records the request as `accepted` (idempotently), and calls GitHub's repository dispatch API:

   `POST https://api.github.com/repos/dipeshsingh2012/lecturescribe/dispatches`

   with `event_type` set to one of the workflow's supported event types and `client_payload` containing only validated, non-secret task metadata.
6. GitHub returns HTTP `204` when the dispatch is accepted. LectureScribe returns an MCP tool result containing `request_id`, `accepted`, and the target repository. It must not claim that the workflow has started yet.

Suggested aroadmap MCP stage-transition request:

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-unique-id",
  "method": "tools/call",
  "params": {
    "name": "transition_initiative_stage",
    "arguments": {
      "tenant_id": "lecturescribe",
      "item_id": "initiative-123",
      "stage": "development",
      "event_type": "mcp_start_dev",
      "request_id": "uuid"
    }
  }
}
```

The caller authenticates to aroadmap using `Authorization: Bearer <AROADMAP_FLEET_TRIGGER_TOKEN>`. The aroadmap server builds and sends the downstream LectureScribe `trigger_agentic_fleet` request; the service credential is never exposed to the MCP client.

Suggested GitHub dispatch body:

```json
{
  "event_type": "mcp_start_dev",
  "client_payload": {
    "request_id": "uuid",
    "source": "aroadmap",
    "initiative_id": "initiative-123",
    "target_repo": "dipeshsingh2012/lecturescribe",
    "title": "Add lecture export option",
    "task": "Implement the approved initiative in LectureScribe.",
    "acceptance_criteria": [
      "Given a lecture, when export is requested, then a downloadable bundle is produced."
    ]
  }
}
```

The payload schema is illustrative and should be formalized in Pydantic models before implementation. Enforce payload size limits, string limits, and an allowlist for event types. Never include API keys, access tokens, passwords, or unredacted secrets.

### 4.2 GitHub Actions execution

1. The existing `repository_dispatch` trigger starts `.github/workflows/agentic-sdlc.yml`.
2. The workflow checks out LectureScribe and Agentic Fleet, then invokes the local action with its supported inputs.
3. The action receives the GitHub event payload via its standard environment and `event-path` input handling.
4. The workflow sends a `started` callback to LectureScribe containing the `request_id`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, and `GITHUB_SERVER_URL`/repository/run URL.
5. The Fleet action runs against LectureScribe. Preserve the action's own exit code and conclusion; do not turn a failed run into a successful one just because callback delivery succeeded.
6. A final callback step runs with `if: always()` and reports the action outcome and workflow conclusion. Callback failure is logged and surfaced without exposing credentials.

Use the supported event names already configured in LectureScribe's workflow: `mcp_initiative`, `mcp_start_dev`, and `fleet_trigger`. Select the event type deliberately based on what the action currently supports. `workflow_dispatch` may remain available for manual workflow diagnostics, but it is not an end-to-end MCP/fleet trigger.

### 4.3 Status callback and aroadmap synchronization

1. The GitHub workflow posts a signed or bearer-authenticated status callback to a dedicated LectureScribe endpoint, proposed as `POST /api/v1/mcp/fleet-callback`.
2. LectureScribe validates the callback credential, verifies the `request_id` exists, checks that run IDs and state transitions are consistent, and stores the update.
3. LectureScribe's MCP client calls aroadmap's `report_fleet_status` tool at `https://aroadmap.dev/api/mcp`, including the aroadmap tenant and initiative identifiers.
4. aroadmap updates its initiative's fleet status/run link and, where appropriate, its workflow stage. It should not mark work as shipped solely because the workflow completed; shipment requires the appropriate human/product transition.
5. aroadmap can call LectureScribe's `get_fleet_run_status` MCP tool to query the latest persisted state if a callback is delayed or unavailable.

Recommended lifecycle:

`accepted → queued → running → succeeded | failed | cancelled`

Include an optional `blocked` state only when a policy gate or missing prerequisite is explicitly identified. Store timestamps and a concise, sanitized error summary for terminal failures.

Example status body:

```json
{
  "request_id": "uuid",
  "initiative_id": "initiative-123",
  "status": "running",
  "github_repository": "dipeshsingh2012/lecturescribe",
  "github_run_id": "123456789",
  "github_run_attempt": 1,
  "run_url": "https://github.com/dipeshsingh2012/lecturescribe/actions/runs/123456789",
  "updated_at": "2026-10-06T00:00:00Z"
}
```

The actual callback endpoint should reject unknown request IDs and invalid state transitions. Make callback processing idempotent so GitHub retries do not create duplicate status records or roadmap updates.

## 5. MCP interface to implement in LectureScribe

Proposed remote endpoint:

`POST https://lecturescribe-api-<deployment-host>/api/v1/mcp`

The exact Cloud Run URL should be confirmed from the deployed service and documented as an environment/config value. Keep normal application endpoints and existing `/health` behavior unchanged.

Minimum JSON-RPC methods:

- `initialize`: return protocol/server metadata and negotiated capabilities.
- `tools/list`: return the supported tool schemas.
- `tools/call`: validate and execute an allowlisted tool; return protocol-conformant errors for invalid or unauthorized calls.

Initial tools:

| Tool | Purpose | Required inputs |
|---|---|---|
| `trigger_agentic_fleet` | Validate and enqueue a dispatch for LectureScribe | `initiative_id`, `event_type`, `title`, `task`, optional acceptance criteria/source |
| `get_fleet_run_status` | Retrieve current state and GitHub run link | `request_id` or `initiative_id` |

Do not expose a generic `dispatch_repository_event` tool that accepts arbitrary owner/repo, event type, or raw GitHub API parameters.

Proposed implementation modules (adapt to the existing flat backend layout):

- `backend/mcp_server.py`: JSON-RPC parsing/dispatch and tool registry.
- `backend/mcp_models.py`: Pydantic request, argument, result, and callback schemas.
- `backend/mcp_service.py`: validation, idempotency, persistence, and orchestration.
- `backend/aroadmap_mcp_client.py`: authenticated JSON-RPC POST to aroadmap.
- `backend/main.py`: mount/register the MCP and callback routes.
- `.github/workflows/agentic-sdlc.yml`: start/completion callbacks and dispatch payload handling.
- Tests under `tests/`: protocol, auth, dispatch, callback, retry/idempotency, and integration contract tests.

The primary implementations are `backend/mcp_integration.py`, `backend/database.py`, and `backend/main.py`; keep the API cohesive and avoid unrelated backend restructuring.

## 6. aroadmap changes required

The existing aroadmap MCP route is a POST JSON-RPC handler, and its tool suite already supports initiative CRUD and stage transitions. Add a narrowly scoped `report_fleet_status` tool (or an equivalent existing tool if the implementation has since changed) that:

- requires a valid tenant and initiative;
- accepts only the defined lifecycle status values;
- stores request/run correlation and GitHub run URL;
- is idempotent by `request_id` plus update/event identity;
- rejects updates that do not belong to that tenant/initiative;
- does not expose or accept GitHub credentials.

The aroadmap-to-LectureScribe caller must be configured with the LectureScribe MCP URL and a machine credential. Do not rely on a tenant header alone as authentication. Authenticate the service-to-service call independently and continue to validate tenant/initiative ownership.

## 7. GitHub Actions workflow requirements

The existing `.github/workflows/agentic-sdlc.yml` already has the three `repository_dispatch` types and runs the Fleet action. For the implementation:

- Keep `repository_dispatch.types` aligned with the server's event allowlist.
- Keep the action inputs to those declared by the current Fleet action: `gemini-api-key` and `github-token` are used here. Do not add unsupported input names.
- Give `GITHUB_TOKEN` only the job permissions needed by the action (`contents`, `issues`, and `pull-requests` write as currently required); reassess each permission against actual Fleet behavior.
- Add a step before the Fleet action to report `running`, and an `if: always()` step after it to report the terminal result.
- Pass the workflow's GitHub run ID, attempt, URL, repository, and dispatch `request_id` to the callback.
- Ensure callback steps never echo secrets or raw authorization headers.
- Avoid printing full client payloads if they can contain confidential initiative material.
- Reassess the current PostgreSQL service container. Keep it only if the Agentic Fleet action or this workflow demonstrably uses it; do not treat it as LectureScribe's production database.

The deployment workflow `.github/workflows/deploy-backend.yml` already forwards `DATABASE_URL` and `EXTRA_ENV_VARS` to the shared Cloud Run deploy workflow. Add any new backend configuration through the approved secret/environment mechanism used by that deployment; do not hard-code it into YAML.

## 8. Manual configuration and secrets

### 8.1 GitHub repository: `dipeshsingh2012/lecturescribe`

In **Settings → Actions → General**:

- Enable GitHub Actions.
- Set workflow permissions to **Read and write permissions** only if required by the Fleet action.
- Ensure the workflow's explicit job-level permissions remain least-privilege.
- If Fleet must create pull requests, enable the repository's PR-creation setting required by the action.

In **Settings → Secrets and variables → Actions → Secrets**:

- `GEMINI_API_KEY`: required by the Fleet action.
- `LECTURESCRIBE_CALLBACK_TOKEN` or the chosen callback signing secret: available only to the workflow for authenticating status callbacks.

In **Settings → Secrets and variables → Actions → Variables**:

- `LECTURESCRIBE_CALLBACK_URL`: the deployed LectureScribe callback URL ending in `/api/v1/mcp/fleet-callback`.

`GITHUB_TOKEN` is GitHub's automatically generated workflow token. Do not create a repository secret with that name. Its available scopes come from workflow/job permissions.

### 8.2 LectureScribe Cloud Run service

Store runtime credentials in Google Secret Manager and grant access only to the `lecturescribe-api` runtime service account:

- `LECTURESCRIBE_MCP_TOKEN`: shared secret accepted by the LectureScribe MCP endpoint; configure the same value in aroadmap as its outbound credential.
- `LECTURESCRIBE_GITHUB_DISPATCH_TOKEN`: GitHub App installation token preferred; a fine-grained PAT is an alternative. Scope it to the LectureScribe repository and the minimum GitHub API permission that permits repository dispatch (typically repository Contents: write). Rotate it and never return it through MCP.
- `AROADMAP_MCP_URL`: `https://aroadmap.dev/api/mcp`.
- `AROADMAP_MCP_TOKEN`: credential for LectureScribe's server-to-server status call to aroadmap; aroadmap must validate it.
- `LECTURESCRIBE_CALLBACK_TOKEN` or callback HMAC key: same secret value as the corresponding GitHub Actions secret, if using a bearer token. Prefer a timestamped HMAC signature with replay protection if feasible.

Add these through the repository's current Cloud Run secret configuration (`EXTRA_ENV_VARS`/Secret Manager integration) after confirming how `shared-workflows` maps secrets to runtime environment. Do not put raw values in `deploy-backend.yml`, checked-in `.env` files, issue comments, or logs.

### 8.3 aroadmap deployment

Configure aroadmap's server-side environment with:

- `LECTURESCRIBE_MCP_URL`: LectureScribe's MCP URL, ending in `/api/v1/mcp`.
- `LECTURESCRIBE_MCP_TOKEN`: same value as LectureScribe's `LECTURESCRIBE_MCP_TOKEN`.
- `AROADMAP_FLEET_TRIGGER_TOKEN`: required bearer token for callers invoking aroadmap's privileged trigger tool.
- `LECTURESCRIBE_STATUS_SYNC_TOKEN`: shared with LectureScribe's `AROADMAP_MCP_TOKEN` and required to report workflow status.
- `AROADMAP_LECTURESCRIBE_OPERATOR_PASSWORD`: a unique random value of at least 32 bytes for signing into the LectureScribe roadmap before moving an approved card to development.
- `AROADMAP_LECTURESCRIBE_SESSION_SECRET`: an independent random value of at least 32 bytes used to sign the eight-hour HttpOnly operator session cookie.
- Create/configure a `lecturescribe` aroadmap tenant and approved initiative before dispatching. The trigger tool is deliberately limited to this tenant and does not transition the initiative to shipped.
- Apply the updated aroadmap Drizzle schema using the project's normal database migration procedure (`npm run db:push`) before enabling status reporting. Review the proposed schema changes against the deployed database first; do not run this command against production without the expected approval/change process.

Use the project's hosting secret manager for credentials. The browser must never receive service tokens. The deployed aroadmap endpoint requires `AROADMAP_FLEET_TRIGGER_TOKEN` as a bearer credential for both the explicit trigger tool and MCP transitions to development for the LectureScribe tenant. The public roadmap board uses a separate operator password and a server-signed, HttpOnly, eight-hour cookie for development-stage moves; never expose the signing secret to browser JavaScript.

### 8.4 Local development

- Use a local `.env` file excluded from version control for development credentials.
- Use test/stub credentials and a fake dispatch client for unit tests.
- Do not use production GitHub or LLM credentials in CI tests.
- Do not expose local FastAPI endpoints publicly without TLS and authentication.

## 9. Authentication, authorization, and operational safeguards

- Require service authentication on LectureScribe's remote MCP endpoint; validate the caller before processing JSON-RPC methods.
- Authorize only the intended aroadmap service/client for fleet-trigger tools. MCP protocol negotiation is not authentication.
- Bind each request to a validated initiative/tenant mapping. Do not trust caller-supplied repository names.
- Restrict dispatch event types to `mcp_initiative`, `mcp_start_dev`, and `fleet_trigger`, and restrict the repository to LectureScribe.
- Use a separate credential for GitHub dispatch and for callback authentication; give each only its necessary scope.
- Verify callback authenticity, timestamp/nonce or idempotency key, request existence, and valid state transitions.
- Add rate limits and request/payload size limits to public endpoints.
- Redact credentials and sensitive task data from logs; log IDs and event/status metadata for auditability.
- Use HTTPS for all service-to-service connections and set explicit timeouts.
- Retry transient network/5xx failures with bounded exponential backoff and jitter. Do not retry validation/authentication failures.
- If the GitHub dispatch request times out after submission, treat delivery as indeterminate and reconcile by `request_id` before resubmitting; otherwise duplicate fleet runs may be created.
- Keep the backend status record as the callback/idempotency source of truth; treat aroadmap as the product-facing synchronized view.

## 10. Persistence and correlation

Persist at minimum:

- `request_id` (unique UUID/idempotency key);
- `initiative_id` and validated tenant/project identity;
- source and event type;
- normalized task title/summary or a privacy-safe reference;
- status and created/updated timestamps;
- GitHub repository, run ID, run attempt, and run URL when known;
- terminal conclusion and sanitized error summary.

Use the existing configured PostgreSQL database only after reviewing its schema and migration conventions. Do not add a new database service just for the integration. If there is no safe existing persistence facility, decide and document the migration before implementation; process memory is not sufficient for Cloud Run restarts, retries, or concurrent instances.

## 11. Testing and rollout plan

### Unit/contract tests

- `initialize`, `tools/list`, and `tools/call` JSON-RPC happy/error paths.
- Missing/invalid credentials, unauthorized caller, invalid tenant or initiative, unsupported event, malformed/oversized payload.
- GitHub dispatch `204`, non-2xx, timeout/indeterminate result, and bounded retry behavior.
- Idempotent duplicate MCP requests and duplicate/reordered callbacks.
- Valid and invalid fleet lifecycle transitions.
- aroadmap status tool contract, tenant isolation, and failed synchronization retries.
- Workflow YAML/action inputs against the current Agentic Fleet action contract.

### Staged end-to-end test

1. Deploy the LectureScribe backend with test/non-production credentials and callback authentication configured.
2. Confirm `initialize` and `tools/list` through the deployed MCP endpoint.
3. Approve the low-risk initiative, then sign in to the LectureScribe board and move its card from Approved to In Development. Alternatively, use an authenticated aroadmap MCP client to call `transition_initiative_stage` with `tenant_id: "lecturescribe"`, the initiative ID, and `stage: "development"`. Capture the returned `request_id`.
4. Confirm the backend records `accepted` and GitHub receives the matching `repository_dispatch` event.
5. Confirm the correct Agentic Fleet workflow run starts and reads the event payload.
6. Confirm LectureScribe receives `running` and terminal callbacks, including the run URL.
7. Confirm aroadmap's `report_fleet_status` stores the same correlation and status without incorrectly moving the initiative to `shipped`.
8. Repeat the same request/callback to verify idempotency; then test a deliberate failure and ensure it is reported as failed.

For a functional test, trigger through the aroadmap MCP tool. Running the workflow manually via `workflow_dispatch` is only a workflow diagnostic and does not prove that the MCP → dispatch → fleet → callback path works.

### Rollout

- Deploy with fleet-trigger tools disabled or restricted to an allowlisted test initiative.
- Validate auth, logs, and callback synchronization.
- Enable authorized aroadmap users/service callers.
- Monitor dispatch acceptance, callback failures, duplicate suppression, and status synchronization lag.
- Keep a kill switch to disable new dispatches without disabling read-only status queries.

## 12. Acceptance criteria

- An authenticated aroadmap MCP call can request work for LectureScribe without exposing GitHub credentials.
- Invalid or unauthorized requests cannot dispatch events or target another repository.
- A successful GitHub dispatch returns `accepted` with a stable correlation ID; it is not misreported as a started run.
- The supported GitHub Actions workflow starts on an allowed `repository_dispatch` event and runs Fleet with valid inputs.
- Workflow start and final status are authenticated, persisted, idempotent, and visible through LectureScribe's status MCP tool.
- LectureScribe synchronizes status and a GitHub run link back to the correct aroadmap initiative.
- Transient failures are retryable/reconcilable; permanent failures are reported clearly and do not produce success-shaped responses.
- No secrets are committed, returned in MCP output, or written to logs.
- Existing LectureScribe CI, deployment, and application behavior remain intact.

## 13. Implementation handoff checklist

1. Confirm the deployed LectureScribe Cloud Run URL and current `EXTRA_ENV_VARS` secret-to-environment mapping.
2. Agree with aroadmap on MCP caller authentication, tenant/initiative identity, and the `report_fleet_status` tool schema.
3. Confirm the chosen GitHub App/PAT permissions for the dispatch endpoint.
4. Add persistent request/run status storage and migration/tests.
5. Implement the LectureScribe JSON-RPC MCP endpoint, tools, GitHub dispatch client, callback route, and aroadmap MCP client.
6. Update aroadmap's status tool and server-to-server authorization.
7. Add workflow start/final callback steps and test action inputs/event payload end-to-end.
8. Run tests and execute the staged MCP-triggered test before enabling general access.

## References

- [LectureScribe Agentic Fleet workflow](../.github/workflows/agentic-sdlc.yml)
- [LectureScribe Cloud Run deployment workflow](../.github/workflows/deploy-backend.yml)
- [RFPEngine MCP ADR 0022](../../RFPEngine/docs/adr/0022-model-context-protocol-mcp-integration-for-ide-and-chat.md)
- [RFPEngine bidirectional communication design](../../RFPEngine/docs/design/DESIGN-bidirectional-aroadmap-rfpengine-communication.md)
- aroadmap MCP endpoint: `app/api/mcp/route.ts`
- aroadmap MCP tools: `lib/mcp-server.ts`
