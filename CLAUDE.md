# CLAUDE.md

Guidance for Claude Code (and other coding agents) working in this repository.

## What this is

KanbanPilot (`kanban-pilot` on npm) is a local-first kanban board that drives coding-agent CLIs
(Claude Code, Codex, Copilot CLI) in git worktrees. pnpm + turbo monorepo, TypeScript, Node ≥ 22.13
(`node:sqlite`, no native builds). Read `README.md` for behaviour and `ARCHITECTURE.md` for the data flow
before changing the state machine, runner or executors.

## Packages

| Package | Role |
|---|---|
| `packages/core` (`@agent-kanban/core`) | Domain: state machine, job runner, executors, git worktrees, Drizzle store. No HTTP/UI imports. |
| `packages/server` (`@agent-kanban/server`) | Thin Hono API: validation, error mapping, `/api/events` (WebSocket + SSE), auth. |
| `packages/web` (`@agent-kanban/web`) | React 19 + TanStack Query + Tailwind 4 UI, built by Vite. |
| `packages/shared` | Zod schemas and types shared by server and web. |
| `packages/cli` (`kanban-pilot`) | The only published package: esbuild bundles core/server/shared into `dist/bin.js`, copies the web build. |

The npm/product name is **kanban-pilot / KanbanPilot**; internal identifiers deliberately keep the old name
`agent-kanban` (workspace scope, `~/.config/agent-kanban`, `.agent-kanban.json`, `ak/` branch prefix). Do not
rename those: existing databases and worktrees depend on them.

## Commands

```sh
pnpm install
pnpm dev                 # server (tsx, source conditions) + web (vite) in watch mode
pnpm lint / lint:fix     # biome (formatter + linter); CI expects a clean run
pnpm typecheck
pnpm test                # vitest in every package (fake agent, no API cost)
pnpm --filter @agent-kanban/web e2e   # Playwright against a real server on :3799
pnpm build               # turbo: shared → core → server → web → cli bundle
pnpm db:generate         # after editing packages/core/src/db/schema.ts (drizzle-kit + embedded migrations)
pnpm bump patch|minor|major && pnpm release && git push --follow-tags   # see docs/publishing.md
```

Dev runs report version `dev`; the real version and package name are injected by `packages/cli/scripts/build.ts`.

## Conventions

- Keep the layering: core never imports server/web; server never reaches into the database directly.
- Every mutation goes through the store and emits on the `EventBus`; the UI relies on those events.
- Agents never move cards. Column changes come from `decide()` in `packages/core/src/state/machine.ts`
  applied by `TaskService.transition()`. Add new transitions there, with a test in `machine.test.ts`.
- Errors: throw `CoreError(code, message, details)`; the server maps codes to HTTP statuses.
- Strings shown in the UI live in `packages/web/src/lib/i18n.tsx` (English + Vietnamese, both required).
- Comment the *why*, keep files focused, no default exports, `biome` formatting (2 spaces, single quotes, 110 cols).
- Pin dependency versions exactly (no `^`).

## Testing

- Unit/integration tests use `FakeClaudeAdapter` and `fake-agent.mjs` (`@agent-kanban/core/testing`). Prompt markers
  steer it: `FAKE:ask`, `FAKE:nochange`, `FAKE:sleep=N`, `FAKE:fail`, `FAKE:crash`, `FAKE:nosession`.
- `AK_FAKE=1` makes the dev server use the fake executor.
- `pnpm --filter @agent-kanban/core smoke` / `smoke:refine` call the real Claude CLI and cost money; run them only
  when an executor adapter changes.
- Executor CLI flags and quirks are recorded in `docs/executor-notes.md`; re-verify on CLI upgrades.

## Things that bite

- Drizzle uses the `sqlite-proxy` driver over `node:sqlite`; migrations are embedded, so a schema change
  without `pnpm db:generate` fails at startup.
- Agent processes are detached (own process group, output in `~/.cache/agent-kanban/logs/<run>/`) and re-attached
  on restart; do not assume the server outlives a run.
- `/api/events` must stay reachable over WebSocket: proxies such as Cloudflare quick tunnels buffer chunked HTTP
  responses (SSE) up to 256 KB. The client only falls back to SSE if the socket never receives `ready`.
- `/api/health` and `/api/auth/*` are the only unauthenticated routes when a token or password is set.
- Publishing needs the npm 2FA security key; `pnpm release` prints a login link to open in the browser.
