# Agentic Fleet Integration Template for lecturescribe

This document captures the GitHub Actions runner setup for `dipeshsingh2012/agentic-fleet`. For the MCP-triggered, bidirectional aroadmap integration, implementation details and manual configuration are in [docs/agentic-fleet-mcp-integration.md](docs/agentic-fleet-mcp-integration.md).

## Objective

Enable GitHub Actions in this repository so the central agentic-fleet orchestration engine can monitor and act on issues, PRs, and review events in `lecturescribe`.

The primary intended cross-project entry point is now aroadmap calling LectureScribe's authenticated MCP endpoint. The workflow's `repository_dispatch` trigger executes the fleet; workflow callbacks synchronize execution status. `workflow_dispatch` is only a workflow diagnostic, not the end-to-end MCP test.

## Source of truth for the pattern

The integration is not a Python import. It is a GitHub Actions workflow-based integration:

- a target repo checks out itself
- it checks out the central `agentic-fleet` repository into `.agentic-fleet`
- it invokes the local action with `uses: ./.agentic-fleet`

This mirrors the pattern observed in RFPEngine:

```yaml
- name: Checkout Target Repository
  uses: actions/checkout@v4
  with:
    fetch-depth: 0

- name: Checkout Central Agent Fleet
  uses: actions/checkout@v4
  with:
    repository: dipeshsingh2012/agentic-fleet
    path: .agentic-fleet

- name: Run Agentic Fleet Action
  uses: ./.agentic-fleet
  with:
    gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Workflow file to create

File:

`.github/workflows/agentic-sdlc.yml`

## Required GitHub repository settings

In the target repository (`lecturescribe`), ensure the following:

1. GitHub Actions is enabled.
2. Repository secrets include:
   - `GEMINI_API_KEY`
3. Workflow permissions allow write access:
   - Contents: write
   - Pull requests: write
   - Issues: write
4. In GitHub Settings -> Actions -> General, enable:
   - "Read and write permissions"
   - "Allow GitHub Actions to create and approve pull requests"

## Recommended workflow contents

```yaml
name: Autonomous Agentic SDLC

run-name: >-
  ${{
    github.event_name == 'issue_comment' && format('💬 {0} on #{1} by @{2}', github.event.comment.body, github.event.issue.number, github.actor) ||
    github.event_name == 'pull_request_review_comment' && format('💬 PR Diff Comment: "{0}" by @{1}', github.event.comment.body, github.actor) ||
    github.event_name == 'pull_request_review' && format('💬 PR Review: "{0}" by @{1}', github.event.review.body, github.actor) ||
    github.event_name == 'issues' && format('🎯 Issue #{0}: {1}', github.event.issue.number, github.event.issue.title) ||
    github.event_name == 'pull_request' && format('🛡️ PR #{0} ({1}): {2}', github.event.pull_request.number, github.event.action, github.event.pull_request.title) ||
    format('🛸 Fleet Workflow: {0}', github.event_name)
  }}

on:
  issues:
    types: [opened, labeled]
  issue_comment:
    types: [created, edited]
  pull_request:
    types: [opened, synchronize, labeled]
  pull_request_review:
    types: [submitted, edited]
  pull_request_review_comment:
    types: [created, edited]
  repository_dispatch:
    types: [mcp_initiative, mcp_start_dev, fleet_trigger]
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  agentic-orchestrator:
    name: "Autonomous SDLC Fleet"
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout Target Repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Checkout Central Agent Fleet
        uses: actions/checkout@v4
        with:
          repository: dipeshsingh2012/agentic-fleet
          path: .agentic-fleet

      - name: Run Agentic Fleet Action
        uses: ./.agentic-fleet
        with:
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Why this is the correct pattern

This repository already uses GitHub Actions for CI and deployment. The `agentic-fleet` integration follows the same execution model: it is a reusable workflow runner attached to repository events, not a library package included via `pip` or a Python import.

The key distinction is:

- `lecturescribe` is the consumer repo
- `agentic-fleet` is the automation engine
- the relationship is established by GitHub Actions and repository event hooks

## Troubleshooting checklist

If the workflow does not trigger or fails:

1. Confirm `GEMINI_API_KEY` exists in GitHub secrets.
2. Confirm the repository is not in a private environment with blocked actions.
3. Confirm workflow file is in `.github/workflows/agentic-sdlc.yml`.
4. Confirm workflow permissions are enabled for contents/PR/issues writes.
5. Confirm the central repo is accessible: `dipeshsingh2012/agentic-fleet`.
6. Confirm the action entry point exists in the checked-out `agentic-fleet` repo (`action.yml`/equivalent).
7. Check logs for missing secrets, invalid event payloads, or permission errors.

## Immediate next step for a continuation agent

The next agent should:

- verify the workflow file exists in this repository
- verify GitHub secrets are configured in the repo settings
- trigger the workflow manually or by opening an issue/PR and check the logs
- if needed, adapt the action inputs to match `agentic-fleet`'s current contract

## Notes for this repo

This repository already has CI and deployment workflows in `.github/workflows/`:

- `ci.yml`
- `deploy-backend.yml`

The addition of `agentic-sdlc.yml` is meant to augment the repo with the autonomous fleet automation layer without replacing the existing CI/deploy workflows.

## Continuation reminder

If work is interrupted, continue from [docs/agentic-fleet-mcp-integration.md](docs/agentic-fleet-mcp-integration.md). The code implementation is present; configure the required GitHub/Cloud Run/aroadmap secrets and validate using an approved aroadmap initiative.
