# KanbanPilot

Local-first kanban board that drives coding agents. Create a task, drag the card across
**Backlog → To do → Doing → Review → Done**, and KanbanPilot runs the coding CLI
(v1: **Claude Code**; Codex and GitHub Copilot CLI adapters are skeletons) in its own **git worktree**,
streams the agent's log to the UI, commits the result, runs your tests, and moves the card to Review.
Leave feedback on the diff and send the card back: the agent resumes the same session and fixes it.

```
npx kanban-pilot            # start on http://127.0.0.1:3737 (next free port) and open the browser
npx kanban-pilot add .      # register the current git repo as a project
npx kanban-pilot doctor     # check node, git, node:sqlite and the executor CLIs (--json for machine-readable output)
npx kanban-pilot --port 4000 --no-open
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
- Messages typed while the agent runs are queued and delivered as feedback right after the run ends; the agent's
  latest text streams into the conversation meanwhile.
- **Images both ways.** Paste, drop or attach screenshots (png/jpeg/gif/webp, ≤10 MB, 6 per message). They are
  stored under `~/.config/agent-kanban/attachments/` and handed to the CLI (Claude reads them with its Read tool and
  gets `--add-dir` for the folder; Codex gets `-i <file>`). Images the agent writes into the worktree and references
  in its reply (`![](screenshot.png)`) are rendered inline.

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
  project is created (`kanban-pilot add --accept-scripts` for automation).
- **Update from base.** Merge the base branch into an attempt from Review; conflicts are handed to the agent as a
  followup and the merge is committed by the system.
- **Queued chat.** Messages typed while the agent works are delivered as feedback right after the run ends.
- **Browser access.** Project option (per-task override) that runs Claude Code with `--chrome`, so the agent can
  drive your Chrome through the Claude in Chrome extension: open the dev server, click through the UI, read console
  errors, and save screenshots into the worktree (rendered in the Chat tab).
- **Auto-start.** Project option: every task that reaches To do starts immediately; `max_concurrent_runs` bounds the
  parallelism and the rest wait in Doing as *queued*. Turning it on also starts tasks already waiting in To do.
- **Retention.** Event streams of DONE runs older than 30 days are pruned (`--retention-days`, 0 = never); run
  metadata (cost, summary) stays. Merged attempts remain diffable via `base..branch`.
- **Clear a board.** "Clear" on the board (or *Delete all tasks* in Settings → Danger zone) removes every task of a
  project whatever its origin, after typing DELETE; running agents are skipped unless you tick the force switch.
  `DELETE /api/projects/:id/tasks?force=1` does the same from scripts.
- **Notifications.** The bell in the header enables browser notifications for Review / error / planner questions.
- **Issue trackers — GitHub, GitLab (self-hosted too), Jira Server/DC 8 (basic auth).** One connection per
  project, configured on the *Integration* screen (plug icon). Each tracker is a `ProviderModule` that declares its
  own form fields, so adding one is a single file. Credentials are stored locally in the SQLite database (GitHub/GitLab
  tokens may also come from `GITHUB_TOKEN`/`GH_TOKEN`/`GITLAB_TOKEN`). New issues matching the import filter (labels,
  or JQL for Jira — Jira imports are limited to `assignee = currentUser()` unless your JQL says otherwise; Jira wiki
  markup is converted to markdown) are pulled every 30 s (configurable), and a **status map** decides both where imported issues land
  (which column each remote status means) and what is written back when a task moves (Jira transition or label swap,
  plus an optional comment; Done closes GitHub/GitLab issues).
- **Guided tour.** The first visit to the projects page and to a board opens a short spotlight tour (English, or
  Vietnamese when the browser prefers it). Replay it any time from the ⋯ menu → *Show the tour*.
- **Two-way sync with the tracker.** Title/description edits on a linked task are pushed to the issue; edits and new
  human comments made on the tracker are pulled on the next poll (comments appear in the task's Chat, marked as
  coming from the tracker). Jira user-picker and cascading-select fields are supported in the push form.
- **Push local tasks to the tracker.** A task created on the board can be sent the other way with *Push to
  <tracker>* in its Overview (or automatically the first time it reaches *To do* — *Auto-push* on the Integration
  screen). The tracker's create metadata is read first (Jira `createmeta`, labels for GitHub/GitLab); *Push
  defaults* on the Integration screen fix the issue type per task kind, the priority names and values for required
  custom fields, and whatever is still missing is asked in a small form before the issue is created. The task is
  then linked like an imported one, so status write-back and comments work from that point on.
- **Type & priority.** Tasks carry a kind (task/bug/feature/chore) and a priority (low…urgent). Leave them on
  *auto* and the planner fills them during refinement; imported issues get them from labels (`bug`, `enhancement`,
  `priority::high`, `P0`…). Urgent/high tasks run first when `max_concurrent_runs` is saturated; the board has
  "Bugs" and "Urgent" quick filters.

- **Undo for "Clear all tasks".** Cleared tasks are only hidden for 10 minutes; the toast offers *Undo*. Worktrees of
  running attempts are still discarded immediately (a restored task lands back in *To do*).
- **Spending caps, cost chart, disk cleanup.** Each project can cap spend per day and per week (new runs are refused
  once reached); Settings shows a 14-day cost chart and the disk footprint of worktrees and logs, with a one-click
  cleanup of what finished work left behind.
- **Backup.** The projects page exports the whole database as one JSON file and merges such a file back in (ids
  already present are skipped). Attachments and worktrees are not included; tracker credentials are.
- **Remote access with a token.** Binding to a non-loopback host (`--host 0.0.0.0`) turns on bearer-token
  authentication; the CLI prints the URL with the token (or set `--token` / `AK_TOKEN`). The UI stores it on the
  first visit and asks for it after a 401.
- **Live updates through tunnels.** The board subscribes to `/api/events` over a WebSocket and falls back to
  server-sent events when the socket cannot be opened. Cloudflare quick tunnels (`cloudflared tunnel --url …`) and
  similar proxies buffer plain HTTP streams, so the WebSocket is what keeps the *live* badge green through them.
- **Password.** `kanban-pilot --password` (prompted on the terminal, or `--password P` / `AK_PASSWORD`) makes the
  UI ask for a password before anything loads; a correct one is exchanged for a session token that lasts until the
  server restarts or you *Sign out* from the ⋯ menu. Five wrong passwords in a row stop the server (exit code 3):
  a guesser gets five tries, then has to reach the terminal. A password replaces the generated token when binding
  to a non-loopback host.
- **Command palette, keyboard drag & drop, UI language.** Ctrl/⌘+K jumps to any task, project or action. Cards can be
  moved with the keyboard (focus a card, Space, arrows, Space). The ⋯ menu switches the interface between English and
  Vietnamese and shows a notice when a newer version is on npm.

## Project settings

Executor, model, max budget per run, base branch (auto-detected from `origin/HEAD`), setup script (runs in the
worktree before the agent, e.g. `pnpm install`), test script, `auto_done` (complete automatically when tests pass —
off by default), `done_action` (merge locally or open a PR), refinement on/off, max concurrent runs, run timeout,
`auto_start`, prompt language (vi/en) and custom prompt templates (refine / execute / followup).
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
cd packages/cli && npm pack                 # tarball you can `npx ./kanban-pilot-x.y.z.tgz`
```

Packages: `shared` (zod schemas/types), `core` (domain, publishable as `@agent-kanban/core`), `server` (Hono API + SSE),
`web` (React), `cli` (published on npm as `kanban-pilot`, bundles everything). See [ARCHITECTURE.md](ARCHITECTURE.md) and
[docs/executor-notes.md](docs/executor-notes.md) for CLI flag/format findings.

## Non-goals (v1)

Multi-user/auth/cloud, Docker sandboxes, two-way issue status sync, a separate runner daemon (agents already
survive restarts), dev-server preview. Codex/Copilot adapters follow their current `--help` but are not verified
end-to-end (see docs/executor-notes.md).
