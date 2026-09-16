---
name: real-cli-smoke
description: Run agent-kanban's real-Claude-Code smoke tests (not the fake agent) to verify end-to-end behaviour against the actual CLI. Costs real API money — use deliberately, not as part of routine iteration.
---

# Real CLI smoke tests

Most tests use the fake agent (see the `e2e-fake-agent` skill) and cost nothing. Two scripts instead drive the
**real** `claude` CLI end to end, on a throwaway git repo, and therefore cost real money (~$1–2 per run each).
Only run these when you specifically need to verify behaviour against the actual CLI (e.g. after upgrading
`claude`, or before shipping a change to prompt building / stream parsing / executor flags) — not routinely.

## Prerequisites

- `claude` CLI installed and logged in (`claude auth status`).
- Willingness to spend ~$1–2 per invocation.

## Commands

- `pnpm --filter @agent-kanban/core smoke` — full task lifecycle against the real CLI: TODO → DOING → REVIEW
  on a throwaway repo.
- `pnpm --filter @agent-kanban/core smoke:refine` — real refinement loop: clarifying questions → answers → plan.

## When flags/output seem off

If the real CLI's flags or stream events don't match what the adapter expects, capture the actual behaviour
and cross-check it against `docs/executor-notes.md` (the existing table of verified Claude Code / Codex /
Copilot deviations from their documented `--help` output) before changing adapter code — CLI vendors have
changed flag sets and event shapes between versions before, so re-verify against `claude --help` and update
`docs/executor-notes.md` alongside any adapter fix rather than trusting stale notes.
