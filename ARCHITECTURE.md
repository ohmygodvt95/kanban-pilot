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

Recovery on start: stale `running` jobs/runs from a dead process become `failed` (task → `DOING(error)`),
`git worktree prune` runs per project and attempts whose worktree vanished are marked `discarded`.

## Adding an executor

1. Create `packages/core/src/executors/<id>/adapter.ts` implementing `ExecutorAdapter`
   (`check`, `buildCommand`, `parseLine`, `supportsResume`, `supportsStructuredOutput`, `instructionFiles`).
2. Register it in `executors/registry.ts` and add the id to `EXECUTOR_IDS` in `packages/shared/src/enums.ts`.
3. If the CLI cannot enforce a JSON schema, set `supportsStructuredOutput=false`; the refinement prompt then
   asks for a bare JSON object which `extractJsonObject` parses from the final text.
4. If it cannot resume, set `supportsResume=false`; followups receive description + truncated diff + feedback.
5. Capture a real stream fixture under `executors/__fixtures__/` and test `parseLine` against it.

## Adding an issue provider (v2)

Implement `IssueProvider` (`providers/types.ts`) and register it in `providers/index.ts`. Tasks already carry
`source_provider`, `source_external_id`, `source_url`.

## Testing strategy

- Pure unit tests: transition table, prompt builders, stream parser (real CLI fixtures).
- Integration on temp git repos: git module, and the whole core with `FakeClaudeAdapter`
  (`core/src/testing/`), a Node script speaking Claude Code's stream-json protocol.
- Server tests hit the Hono app with the real core + fake agent, including SSE over a socket.
- `scripts/smoke.ts` exercises the real Claude Code CLI end to end.
