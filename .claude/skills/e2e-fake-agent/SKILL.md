---
name: e2e-fake-agent
description: Run or write end-to-end tests for agent-kanban using the FakeClaudeAdapter/fake-agent instead of a real, billed CLI. Use for runner, server and Playwright web e2e tests.
---

# Testing with the fake agent

Real executor CLIs cost money and need login, so integration/e2e tests drive a fake executor instead:
`packages/core/src/testing/fake-executor.ts` (adapter) + `packages/core/src/testing/fake-agent.mjs`
(a Node script that speaks Claude Code's `stream-json` protocol over stdout, like a real `claude` process would).

## How the fake agent is controlled

Put a marker anywhere in the prompt (or in prior conversation history for a resumed run) to force a behaviour:

| Marker | Effect |
|---|---|
| `FAKE:ask` | (refine only) returns clarifying questions until an answer is present in history |
| `FAKE:nochange` | finishes without modifying any files |
| `FAKE:sleep=N` | sleeps N ms before finishing (test timing/cancellation) |
| `FAKE:fail` | exits 1 with an error result |
| `FAKE:crash` | exits 2 with no `result` event at all (abnormal termination) |
| `FAKE:nosession` | on `--resume`, mimics Claude's "session not found" failure (stderr + error result + exit 1) — used to test the session-lost fallback |
| "chat với planner" | (see `fake-agent.mjs` for chat-mode specific behaviour) |

Without any marker the fake agent behaves like a normal successful run and writes a small diff.

## Running tests

- `pnpm --filter @agent-kanban/core test` — runner e2e tests drive the fake adapter directly
  (`packages/core/src/runner/process.test.ts` and friends).
- `AK_FAKE=1 pnpm --filter @agent-kanban/server dev` — boots the API with the fake executor instead of a real
  CLI; use this for manual exploration or when writing new server tests, so nothing gets billed.
- `pnpm --filter @agent-kanban/web e2e` — Playwright, boots a real server (port 3799) with the fake agent
  wired in; use `e2e:headed` to watch it run.

## Adding a new e2e scenario

1. Prefer expressing the scenario via existing markers (table above) before adding a new one.
2. If a new behaviour is genuinely needed, add a new `FAKE:xxx` marker in `fake-agent.mjs`, following the
   existing `if (prompt.includes('FAKE:xxx'))` pattern, and document it in the table in this file.
3. Keep fake-agent behaviour a faithful (if simplified) model of the real CLI's stream-json protocol — it is
   what the runner's `parseLine` is actually exercised against in CI.
