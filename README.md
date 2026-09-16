# agent-kanban

Local-first kanban board that drives coding agents. Create a task, drag the card across
**Backlog → To do → Doing → Review → Done**, and agent-kanban runs the coding CLI
(v1: **Claude Code**; Codex and GitHub Copilot CLI adapters are skeletons) in its own **git worktree**,
streams the agent's log to the UI, commits the result, runs your tests, and moves the card to Review.
Leave feedback on the diff and send the card back: the agent resumes the same session and fixes it.

```
npx agent-kanban            # start on http://127.0.0.1:3737 (next free port) and open the browser
npx agent-kanban add .      # register the current git repo as a project
npx agent-kanban doctor     # check node, git, node:sqlite and the executor CLIs (--json for machine-readable output)
npx agent-kanban --port 4000 --no-open
```

Requirements: Node ≥ 22.13 (built-in `node:sqlite`, no native build), git, and a logged-in `claude` CLI.
Everything is stored in one SQLite file (`~/.config/agent-kanban/db.sqlite`); worktrees live in
`~/.cache/agent-kanban/worktrees/<project>/<attempt>/`. `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` are honoured.

## How a task flows

| Column | What happens |
|---|---|
| **Backlog** | Draft. Dragging to *To do* starts **refinement** (if enabled): the agent reads the repo in read-only plan mode and answers with a JSON plan. If it needs answers, the card shows *needs answer* with a form; your answers are appended to the description and refinement resumes the same session (max 3 rounds). |
| **To do** | Ready with a plan. |
| **Doing** | An **attempt** is created: branch `ak/<slug>-<id>` + worktree. The agent runs there with full permissions (`--permission-mode bypassPermissions`), resuming the refinement session when possible. When it exits: no diff → *error*; otherwise the system commits, runs `test_script`, pushes best-effort and moves to Review. |
| **Review** | Inspect the diff, comment on lines, add general feedback. **Send feedback & re-run** resumes the session with the numbered feedback. **Merge → Done** merges `--no-ff` into the base branch (in your checkout if it is clean and on the base branch, otherwise in a temporary worktree). *Restart attempt* starts over with all feedback so far; *Discard* throws the worktree away. |
| **Done** | Immutable. Use *Clone task* to continue. |

**Chat tab.** Every task has a conversation view built from its runs and comments, plus a composer:

- In **Review** or **Doing (error)** a message is sent to the agent as feedback and the same session is resumed
  (`POST /tasks/:id/chat` → followup / retry run). The task goes back to Review when the agent finishes.
- In **Backlog** / **To do** the message goes to the *planner* (read-only refine session): it answers in the chat and
  may return an updated plan; the task does not move.
- While the agent is running the composer is disabled and the agent's latest text streams into the conversation.

Invariants: the agent never moves cards (the system does, from process exit codes + diff + tests);
every CLI invocation is a `run` with its full command, event stream, session id and cost;
the main working tree of your repo is never touched by an agent.

## Resilience & guard rails

- **Detached agents.** CLIs run in their own process group with stdout/stderr redirected to
  `~/.cache/agent-kanban/logs/<run>/`. Quitting agent-kanban leaves them working; the next start re-attaches to
  live pids and finalises runs that ended meanwhile (`--kill-agents` to terminate them on exit instead).
- **Session-lost fallback.** If the CLI cannot resume a session (`No conversation found with session ID`), the run
  is retried once automatically with a fresh session and enough context (description, diff, feedback).
- **Model & budget.** Per project (and per task) `model`; `max_budget_usd` caps each run (Claude `--max-budget-usd`).
- **Script confirmation.** Scripts from a repo's `.agent-kanban.json` are shown and must be accepted before the
  project is created (`agent-kanban add --accept-scripts` for automation).
- **Update from base.** Merge the base branch into an attempt from Review; conflicts are handed to the agent as a
  followup and the merge is committed by the system.
- **Queued chat.** Messages typed while the agent works are delivered as feedback right after the run ends.
- **Retention.** Event streams of DONE runs older than 30 days are pruned (`--retention-days`, 0 = never); run
  metadata (cost, summary) stays. Merged attempts remain diffable via `base..branch`.
- **Notifications.** The bell in the header enables browser notifications for Review / error / planner questions.
- **GitHub.** With `GITHUB_TOKEN` and an origin on github.com: import open issues as tasks, and set
  `done_action = pr` to push the branch and open a pull request instead of merging locally.

## Project settings

Executor, model, max budget per run, base branch (auto-detected from `origin/HEAD`), setup script (runs in the
worktree before the agent, e.g. `pnpm install`), test script, `auto_done` (complete automatically when tests pass —
off by default), `done_action` (merge locally or open a PR), refinement on/off, max concurrent runs, run timeout,
prompt language (vi/en) and custom prompt templates (refine / execute / followup).
A committed `<repo>/.agent-kanban.json` provides defaults when the project is added:

```json
{ "default_executor": "claude", "base_branch": "main", "setup_script": "pnpm install", "test_script": "pnpm test", "refinement_enabled": true }
```

Instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) are seeded into the worktree
from `~/.config/agent-kanban/templates/` (or the built-in templates) **only if the repo has none**, and they are
excluded from the commit so they never leak into your repository.

## Development

```
pnpm install
pnpm test                 # vitest: core (state machine, parser fixtures, git on temp repos, runner e2e with a fake agent) + server API
pnpm build                # turbo: shared → core → server → web → cli (esbuild bundle + web dist)
pnpm --filter @agent-kanban/core smoke          # real Claude Code: TODO→DOING→REVIEW on a throwaway repo (needs `claude` login)
pnpm --filter @agent-kanban/core smoke:refine   # real Claude Code: refinement questions → answers → plan
pnpm --filter @agent-kanban/web e2e             # Playwright against a real server + fake agent (chromium)
pnpm --filter @agent-kanban/server dev      # API on :3737   (AK_FAKE=1 uses the fake agent, no API cost)
pnpm --filter @agent-kanban/web dev         # Vite on :5173, proxies /api
cd packages/cli && npm pack                 # tarball you can `npx ./agent-kanban-x.y.z.tgz`
```

Packages: `shared` (zod schemas/types), `core` (domain, publishable as `@agent-kanban/core`), `server` (Hono API + SSE),
`web` (React), `cli` (published as `agent-kanban`, bundles everything). See [ARCHITECTURE.md](ARCHITECTURE.md) and
[docs/executor-notes.md](docs/executor-notes.md) for CLI flag/format findings.

## Non-goals (v1)

Multi-user/auth/cloud, Docker sandboxes, two-way issue status sync, a separate runner daemon (agents already
survive restarts), dev-server preview. Codex/Copilot adapters follow their current `--help` but are not verified
end-to-end (see docs/executor-notes.md).
