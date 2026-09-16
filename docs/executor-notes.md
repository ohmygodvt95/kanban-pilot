# Executor notes — deviations between the spec and the real CLIs

Verified on **Claude Code 2.1.260** (`claude --help`, plus captured stream-json fixtures in
`packages/core/src/executors/__fixtures__/`). Re-verify when upgrading the CLI.

## Claude Code

| Spec | Actual / decision |
|---|---|
| `execute`: `claude -p <prompt> --output-format stream-json --verbose --permission-mode bypassPermissions [--resume id] [--max-turns N]` | Same, except the prompt is **always passed on stdin** (works: `echo prompt \| claude -p …`) and `--max-turns` is **omitted**: it is not listed by `claude --help` on 2.1.x (only `--max-budget-usd` exists). `ExecutorInput.maxTurns` is therefore ignored by this adapter. |
| `refine`: `--output-format json --permission-mode plan --allowedTools "Read,Grep,Glob" --json-schema <schema>` | We use `--output-format stream-json --verbose` for refine runs too. The final `result` event of stream-json carries the same `structured_output` field as the `json` format, and streaming lets the Activity tab show refinement progress. `--json-schema` + `structured_output` confirmed working. |
| Event `type:"system", subtype:"init"` has `session_id` | Confirmed. Other `system` subtypes exist (e.g. `thinking_tokens`) and are stored as `raw`. |
| `result` event: `subtype`, `session_id`, `total_cost_usd`, `num_turns`, `structured_output` | Confirmed. Also `is_error`, `result` (final text). A run is `succeeded` only when `is_error=false` and `subtype="success"`. |
| — | `rate_limit_event` lines appear in the stream; stored as `raw` events. |
| — | One `assistant` line may contain several content blocks (text + tool_use). `parseLine` therefore returns `NormalizedEvent \| NormalizedEvent[]`. |
| — | In `plan` permission mode the model may still call `Bash` for read-only commands even with `--allowedTools Read,Grep,Glob`; plan mode blocks writes, which is what matters for refinement. |
| — | Resuming a refinement session (`plan` mode, cwd = repo) into an execute run (`bypassPermissions`, cwd = worktree) works, but the model remembers absolute paths of the main repo. The execute prompt therefore states the new worktree path and forbids touching the original repo path. |
| — | Auth check: `claude auth status` is used when available; if it is missing the adapter only verifies the binary runs. |

Env forwarded to the child: every `CLAUDE_CODE_*` and `ANTHROPIC_*` variable from the server's environment,
plus `CLAUDE_CODE_ENTRYPOINT=agent-kanban`. No key is stored by agent-kanban.

## Codex CLI (skeleton, not verified end-to-end)

`codex` was not installed on the development machine. The adapter follows the public docs:
`codex exec --json --sandbox danger-full-access -` (prompt on stdin), resume via `codex exec resume --json <id> -`.
Event mapping (`thread.started`, `item.completed`, `turn.completed`) is best-effort. Structured output is
prompt-based (`supportsStructuredOutput=false`): the refinement prompt asks for a single JSON object which is
extracted from the last assistant text. Verify with `codex exec --help` before relying on it.

## GitHub Copilot CLI (skeleton, not verified end-to-end)

`copilot` was not installed. Command: `copilot -p <prompt> --output-format json --autopilot --allow-all`.
`supportsResume=false`, so followups send description + current `git diff` (truncated to 20k chars) + feedback.
Verify with `copilot --help`.
