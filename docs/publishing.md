# Publishing to npm

Only `packages/cli` (`kanban-pilot`) is published. `core`, `server`, `shared` and `web` are `private`
and are inlined into `dist/bin.js` / copied to `dist/web` by `packages/cli/scripts/build.ts`; third-party
dependencies stay external and are listed in the CLI's `dependencies`.

## Name

The package is published as **`kanban-pilot`** (binary `kanban-pilot`). The obvious name `agent-kanban` already
belongs to an unrelated project on npmjs.org (saltbo, 1.x), and npm also rejects names that differ from an existing
one only by punctuation (`agentkanban`, `agent-board` vs `agentboard`, `taskpilot` vs `task-pilot`, …).
`kanban-pilot`, `kanbanpilot` and `kanban_pilot` were all free on 2026-09-21.

Internal identifiers deliberately keep the old name for data compatibility: the workspace scope `@agent-kanban/*`,
`~/.config/agent-kanban` / `~/.cache/agent-kanban`, the per-repo `.agent-kanban.json`, the `ak/` branch prefix and
the `agentKanban` marker in `package.json` that the update check trusts.

Nothing else is hard-coded: the build injects `__PKG_NAME__` and `__VERSION__` from `package.json` into the bundle;
the server reports both on `/api/health` (`package_name`, `version`); the UI builds the install hint from them and
the daily update check queries `https://registry.npmjs.org/<name>/latest` (scoped names are URL-encoded). Renaming
again means changing `name`/`bin` in `packages/cli/package.json`, the `npx` lines in `README.md`, the help text in
`packages/cli/src/bin.ts` and the titles in `packages/web/index.html` / `src/lib/tour.ts`.

## Where the version shows

| Place | Source |
|---|---|
| `kanban-pilot --version` / `-v` | `__VERSION__` define |
| startup log line `kanban-pilot 0.1.0 listening at …` | same |
| `GET /api/health` → `version`, `package_name`, `latest_version` | passed from the CLI to `createApp` |
| web: overflow menu (⋮) row `kanban-pilot v0.1.0` (click copies `name@version`) | `/api/health` |
| web: `Update available: vX` row (click copies `npm install -g <name>@latest`) | daily npm lookup |

Dev runs (`tsx`, `pnpm dev`) report `dev` and never show an update notice.

## Release steps

```sh
npm login                       # once; `npm whoami` must print your user
pnpm bump patch                 # or minor | major | 1.2.3 — edits packages/cli/package.json, commits, tags vX.Y.Z
pnpm release                    # lint + typecheck + test + build + `pnpm publish` of packages/cli
git push --follow-tags
```

`pnpm release` runs `prepublishOnly`, which refuses to publish when `dist/bin.js`, `dist/web/index.html` or
`templates/` are missing. To inspect the tarball without publishing: `pnpm pack:cli` (writes
`packages/cli/<name>-<version>.tgz`), then `npm install -g ./packages/cli/<name>-<version>.tgz` and run
`kanban-pilot --version` / `kanban-pilot doctor`.
