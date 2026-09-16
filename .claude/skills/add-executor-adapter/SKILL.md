---
name: add-executor-adapter
description: Add a new coding-CLI executor (like Claude Code, Codex, Copilot CLI) to agent-kanban. Use when the task is to integrate another agent CLI as an executor option.
---

# Adding an executor adapter

agent-kanban drives coding CLIs through `ExecutorAdapter` implementations in `packages/core/src/executors/`.
Existing adapters to use as reference: `claude/adapter.ts`, `codex/adapter.ts`, `copilot/adapter.ts` —
compare them for how differently the three real CLIs behave (stdin vs argv prompt, JSON vs JSONL streaming,
resume support, structured-output support).

## Steps

1. Create `packages/core/src/executors/<id>/adapter.ts` implementing `ExecutorAdapter`
   (`packages/core/src/executors/types.ts`): `check`, `buildCommand`, `parseLine`, `supportsResume`,
   `supportsStructuredOutput`, `instructionFiles`.
2. Register the adapter in `packages/core/src/executors/registry.ts` (`createDefaultRegistry()`), and add the
   new id to `EXECUTOR_IDS` in `packages/shared/src/enums.ts` (`ExecutorId` is derived from this array via zod).
3. If the CLI cannot enforce a JSON schema for structured output, set `supportsStructuredOutput = false` —
   the refinement prompt then asks for a bare JSON object, parsed by `extractJsonObject` from the final text
   instead of a schema-validated field.
4. If the CLI cannot resume a prior session, set `supportsResume = false` — followup/chat runs will instead
   receive the task description, a truncated diff and feedback inlined into a fresh prompt (no `--resume`).
5. Capture a **real** stream fixture from the actual CLI under `executors/__fixtures__/` and add a test that
   feeds it through `parseLine` line by line — do not hand-write fixture JSON from documentation alone; CLI
   output formats have historically diverged from `--help`/docs (see `docs/executor-notes.md` for the
   Claude/Codex/Copilot deviations already found this way).
6. Before writing the adapter, verify actual CLI flags/behaviour yourself (`<cli> --help`, a manual run if you
   have credentials) rather than trusting a spec — update `docs/executor-notes.md` with what you found,
   following its existing per-executor table format.

## Verify

- `pnpm --filter @agent-kanban/core test` — adapter unit tests + fixture parsing.
- `pnpm --filter @agent-kanban/core typecheck`.
- If credentials for the new CLI are available, a manual end-to-end run is worth doing once; otherwise say so
  explicitly (as `docs/executor-notes.md` does for Codex/Copilot) rather than claiming it was verified.
