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
| — | `--model <alias>` and `--max-budget-usd <amount>` exist and are passed from project/task settings. `--effort` exists but is not exposed yet. |
| — | Images: there is no image flag in headless mode; the prompt lists attached files by absolute path and Claude opens them with its Read tool (which supports images). `--add-dir <dir>` is added per attachment directory so plan-mode runs may read outside the cwd. |
| — | Resuming an unknown session: exit 1, stderr `No conversation found with session ID: …`, a `result` event with `subtype: error_during_execution`, `num_turns: 0`. `classifyFailure()` maps this to `session_not_found` → automatic retry without `--resume`. |

Env forwarded to the child: every `CLAUDE_CODE_*` and `ANTHROPIC_*` variable from the server's environment,
plus `CLAUDE_CODE_ENTRYPOINT=agent-kanban`. No key is stored by agent-kanban.

## Codex CLI (flags verified against codex-cli 0.154.0, not run end-to-end)

Installed locally to read `codex exec --help`; no OpenAI account was available, so runs were not exercised.

| Spec | Actual / decision |
|---|---|
| `codex exec --json --sandbox danger-full-access <prompt>` | `codex exec --json --skip-git-repo-check --sandbox danger-full-access [-m model] -` — `-` reads the prompt from stdin. Refine runs use `--sandbox read-only`. |
| resume `codex exec resume <id>` | `codex exec resume --json <thread_id> -` (confirmed subcommand and `[PROMPT]` with `-` = stdin). |
| images | `-i, --image <FILE>...` attaches images to the initial prompt (used for chat attachments). |
| structured output | `--output-schema <FILE>` exists → `supportsStructuredOutput=true`; the runner writes the schema to `<logs>/<run>/output-schema.json` (`ExecutorInput.outputSchemaFile`). |
| events | JSONL: `thread.started{thread_id}` (session id), `turn.started`, `item.completed{item}`, `turn.completed{usage}`, `error{message}`. Rust log lines (`… ERROR codex_api …`) are not JSON and are stored as `raw`. |

## GitHub Copilot CLI (flags verified against GitHub Copilot CLI 1.0.85, not run end-to-end)

| Spec | Actual / decision |
|---|---|
| `copilot -p <prompt> --output-format json --autopilot --allow-all` | Confirmed. Refine runs use `--mode plan --allow-all-tools`. `--model <model>` and `-r <session>` (resume) exist → `supportsResume=true`. `--no-auto-update` is added. |
| events | `--output-format json` is "JSONL, one JSON object per line" but the event vocabulary is undocumented; `parseLine` maps a few plausible shapes and keeps the rest as `raw`. Without credentials the CLI prints a plain-text auth error. |
| structured output | No schema flag → prompt-based JSON extraction. |
