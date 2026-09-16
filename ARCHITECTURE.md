# Architecture

```
 browser (React, TanStack Query)            packages/web
   │  REST  /api/*            SSE /api/events
   ▼
 Hono server                                 packages/server   (thin: validation, error mapping, SSE fan-out)
   │  calls
   ▼
 core  (no HTTP/UI imports)                  packages/core
   ├─ state/     decide() pure transition table  →  TaskService.transition() applies effects
   ├─ runner/    JobRunner polls `jobs`, spawns executor CLIs in a process group, streams stdout
   ├─ executors/ ExecutorAdapter: buildCommand() + parseLine()  (claude / codex / copilot)
   ├─ git/       worktree add/diff/commit/merge/remove via the git binary
   ├─ refinement/ BACKLOG→TODO planning loop (questions ⇄ answers, plan)
   ├─ postrun/   verify diff → commit → tests → push → REVIEW (→ DONE if auto_done)
   ├─ store/     Drizzle data access; every mutation emits on the EventBus
   └─ db/        schema + embedded migrations on node:sqlite (drizzle sqlite-proxy driver)
```

## Data flow of one task

1. `POST /tasks/:id/transition {target}` → `TaskService.transition(taskId, target, 'user', payload)`.
2. `decide()` (pure, `state/machine.ts`) validates against the current column/substate, active runs,
   unconsumed feedback and active attempt. Invalid → `CoreError(INVALID_TRANSITION)` → HTTP 409.
3. The decision is applied: e.g. `start_attempt` creates the worktree (`AttemptService`), inserts a `run`
   (`RunService`) and enqueues a `run_agent` job (or `setup_worktree` first). The task row is updated and
   `task.updated` is emitted → SSE → UI.
4. `JobRunner.tick()` (every 500 ms) claims queued jobs (`UPDATE … WHERE status='queued' AND locked_by IS NULL`),
   respecting `max_concurrent_runs` per project. `run_agent` builds the command with the adapter, spawns it
   (`detached`, prompt on stdin), parses every stdout line to a `NormalizedEvent`, persists it as `run_events`
   and emits `run.event`. On exit the run row gets status/exit code/session/cost and a `post_run` job is queued.
5. `PostRunPipeline` moves the task: failed/cancelled or empty diff → `DOING(error)`; otherwise commit, tests,
   push, `REVIEW(pending|tests_failed)`, optional auto-merge. Refine runs go to `RefinementService`.
6. Feedback: comments (`feedback` from the diff, `chat` from the Chat tab) with `consumed_by_run_id = NULL` gate
   `REVIEW → DOING`; the followup run resumes the last session id of the attempt and marks the comments consumed.
   `TaskService.chat()` routes a free-form message: REVIEW → followup, DOING(error) → retry (message appended),
   BACKLOG/TODO → a `chat` run in refine mode that resumes the refinement session and may update `tasks.plan`.
   `runs.result_text` (the CLI's final text) is what the Chat tab shows as the agent's reply.

Processes are detached (`runner/process.ts`): a `sh` wrapper redirects the CLI to
`<logs>/<run>/stdout.log|stderr.log` and writes `exit`; the runner tails the files. On start, `JobRunner.recover()`
re-attaches to live pids (skipping already persisted lines), finalises runs whose `exit` file exists, and fails the
rest. `git worktree prune` runs per project and attempts whose worktree vanished are marked `discarded`.

Session-lost fallback: when an adapter's `classifyFailure()` reports `session_not_found`, the runner calls
`TaskService.createFallbackRun()`, which creates a run without `--resume` (execute/followup: description + diff +
feedback; refine/chat: full context) and re-points consumed comments to it. `runs.fallback_of_run_id` links the two.

## Other flows

- **Update from base** (`TaskService.updateFromBase`): `git merge <base>` inside the worktree; `attempts.base_commit`
  moves to the base tip so diffs keep showing only the attempt's changes. Conflicts become a `chat` comment with the
  conflict prompt and a followup run; `commitAll` then commits the merge.
- **Queued chat**: `chat()` in DOING(queued|running) only inserts a `chat` comment; `PostRunPipeline` sends it as a
  followup right after REVIEW is reached.
- **Tests on demand**: job `run_tests` → `JobRunner.runTestsFor()`; `onTestsFinished` updates the REVIEW substate.
- **done_action = pr**: `AttemptService.openPullRequest()` pushes and calls `IssueProvider.createPullRequest()`.
- **Retention**: `Store.pruneRunEvents(days)` on start and daily.
- **Attachments**: `attachments` table + files under `paths.attachmentsRoot/<comment>/<id>-<name>`. `TaskService.chat()`
  stores them; prompts list them as `[image: <abs path>]`; the runner passes the paths to the adapter
  (`ExecutorInput.attachments`). `GET /api/attachments/:id` serves them, `GET /api/attempts/:id/file?path=` serves images
  the agent produced inside the worktree (path-confined, images only).
- **Auto-start**: `TaskService.transition()` calls `maybeAutoStart()` whenever a task enters TODO; the machine accepts
  `todo → doing` from the system only with `payload.auto_start`. `ProjectService.update()` starts pending tasks when the
  flag is switched on.

## Adding an executor

1. Create `packages/core/src/executors/<id>/adapter.ts` implementing `ExecutorAdapter`
   (`check`, `buildCommand`, `parseLine`, `supportsResume`, `supportsStructuredOutput`, `instructionFiles`).
2. Register it in `executors/registry.ts` and add the id to `EXECUTOR_IDS` in `packages/shared/src/enums.ts`.
3. If the CLI cannot enforce a JSON schema, set `supportsStructuredOutput=false`; the refinement prompt then
   asks for a bare JSON object which `extractJsonObject` parses from the final text.
4. If it cannot resume, set `supportsResume=false`; followups receive description + truncated diff + feedback.
5. Capture a real stream fixture under `executors/__fixtures__/` and test `parseLine` against it.

- **Trackers** (`providers/`, `integrations.ts`, `issues.ts`): a `ProviderModule` = `info` (id, form fields, default
  status map) + `create(config)` → `IssueProvider` (`check`, `listIssues`, `getIssue`, `listStatuses`, `setStatus`,
  `addComment`, optional `createPullRequest`). `IntegrationService` stores one row per project (`integrations`
  table, secrets kept locally, masked in the API) and builds the provider. `IssueService.syncTask()` runs after
  every column change: `statusForColumn(status_map)` → `setStatus` (+ comment); `pollDue()` runs from a 10 s ticker
  and imports issues whose integration interval elapsed, placing them via `columnForStatus()` (done skipped,
  doing/review → todo with refinement skipped).
- **Priority queue**: `jobs.priority` is derived from the task priority; `Store.queuedJobs()` orders by priority
  then age. The runner also counts locally claimed `run_agent` jobs so `max_concurrent_runs` cannot be
  over-subscribed between ticks.

## Adding an issue provider

Create `providers/<id>.ts` exporting a `ProviderModule`: fill `info` (display name, the fields the settings form
should show — base_url / project_ref / username / token / password / import_filter —, `statusModel`, a default
status map), implement `detectFromRemote()` (or return null) and `create(config)` returning an `IssueProvider`.
Register it in `createDefaultProviders()` and add the id to `providerIdSchema` in `packages/shared`. The
integration screen, polling and status sync need no changes. GitHub, GitLab and Jira (basic auth, REST v2) ship.

## Testing strategy

- Pure unit tests: transition table, prompt builders, stream parser (real CLI fixtures).
- Integration on temp git repos: git module, and the whole core with `FakeClaudeAdapter`
  (`core/src/testing/`), a Node script speaking Claude Code's stream-json protocol.
- Server tests hit the Hono app with the real core + fake agent, including SSE over a socket.
- `scripts/smoke.ts` exercises the real Claude Code CLI end to end.
