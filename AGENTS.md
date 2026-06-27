# bookmaker - AI Assistant Instructions

This file covers the monorepo as a whole. For how any individual app works, read that app's own README; do not duplicate per-app detail here.

## Repository layout

This is a monorepo. TypeScript packages are managed with **pnpm workspaces** (`apps/*`, `packages/*`); Python projects use a **uv workspace** rooted at `pyproject.toml`. `apps/*` holds runnable applications, `packages/*` holds libraries shared between them.

Apps:

- **`@bookmaker/bookmeter`** (`apps/bookmeter`) — CLI that scrapes Bookmeter wish/stacked lists, enriches them via bibliographic APIs and library-holding lookups, and writes `data/books.sqlite` plus CSVs. It is the **generator** of the shared SQLite. TypeScript-only, so it is excluded from the uv workspace. See `apps/bookmeter/README.md` for modes, flags, and architecture.
- **`@bookmaker/reading-recommender`** (`apps/reading-recommender`) — Local SPA + Fastify app that reads the shared SQLite read-only, recommends a weekly book, shows related books, and searches wish/stacked books. It stores derived app state in `data/reading-recommender.sqlite`, not in the shared DB. TypeScript-only for now. See `apps/reading-recommender/README.md` for run modes, API routes, and architecture.

Toolchain is pinned via Volta: Node 25.8.2, pnpm 11.9.0. `.env` lives at the monorepo root; both `run_tasks.sh` and the apps load it from there, so credentials are configured once for the whole repo.

## The shared SQLite contract

The one cross-app artifact is the SQLite database at `data/books.sqlite`. This is the integration boundary between apps:

- `bookmeter` is the **only writer**. Every other (current or future) project opens it **read-only**: `new Database(path, { readonly: true, fileMustExist: true })` in TypeScript, `sqlite3.connect("file:...?mode=ro", uri=True)` in Python.
- `reading-recommender` writes only its own derived state DB at `data/reading-recommender.sqlite` by default. It may cache recommendation cycles, FTS indexes, settings, embeddings, and push tokens there, but it must never add columns, tables, or rows to `data/books.sqlite`.
- The DB runs in WAL mode, so one writer plus many readers is safe.
- Resolve the path relative to the workspace root (`data/books.sqlite`) and allow `BOOKS_DB_PATH` to override it; do not hard-code absolute paths.
- The schema of record is `apps/bookmeter/src/db/schema.ts`. Do not try to share schema definitions across languages — integrate only through the DB, and have each reader keep its own read-only model.

## Commands

Run from the monorepo root.

```bash
pnpm install                 # resolve TS workspace deps
uv sync                      # resolve Python workspace deps (when a Python app exists)
pnpm -r type-check           # tsc --noEmit across all workspaces
pnpm lint                    # eslint over the whole repo (single shared config)
pnpm lint:fix
pnpm format                  # prettier --write .
pnpm -r test                 # tests across all workspaces
pnpm --filter @bookmaker/reading-recommender run build
```

Target a single workspace with `pnpm --filter @bookmaker/<name> run <script>` (or `uv run --package <name> <cmd>` for Python). Per-app run/test commands live in that app's README and `package.json`.

`run_tasks.sh` is the cron entry point: it runs the app's `wish` then `stacked` scripts sequentially, commits and pushes the results (the `auto-updated: …` commits in history), and posts to Discord on failure.

## Adding a new app

Each app is a workspace member living in `apps/<name>/`. Register it with the package manager that matches its language; the two workspaces are independent and an app can join one or both.

### TypeScript app (pnpm workspace)

1. Create `apps/<name>/package.json` with `"name": "@bookmaker/<name>"` and `"private": true`. Put run scripts under `scripts`. CLI apps may run sources directly via `tsx`; browser/server apps may also have an explicit build step, as `reading-recommender` does with Vite plus `tsc`.
2. Add `apps/<name>/tsconfig.json` that inherits the shared compiler options:
   ```jsonc
   { "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist" } }
   ```
3. Run `pnpm install` at the root so the workspace picks it up. Add dependencies with `pnpm --filter @bookmaker/<name> add <pkg>`.
4. To depend on a sibling workspace package, add `"@bookmaker/<pkg>": "workspace:*"` to `dependencies`.
5. If the app reads the shared DB, open `data/books.sqlite` **read-only** (see the SQLite contract above).

### Python app (uv workspace)

1. Create `apps/<name>/pyproject.toml` with a `[project]` table defining `name` and `dependencies`.
2. Ensure the root `pyproject.toml` `[tool.uv.workspace] members` covers `apps/*` (it does by default; TypeScript-only apps are listed under `exclude`).
3. Run `uv sync` at the root. The virtualenv is centralized at the root `.venv`. Add deps with `uv add --package <name> <pkg>`; run with `uv run --package <name> <cmd>`.
4. Read the shared DB read-only as above.

### Apps that mix TypeScript and Python

Place both manifests under the same `apps/<name>/` and split sources into subdirectories:

```
apps/<name>/
├── package.json      # TS part (pnpm member)
├── tsconfig.json
├── pyproject.toml    # Python part (uv member)
├── ts/
└── python/
```

Register each side per the steps above. The two sides communicate through the shared SQLite, not by sharing types across the language boundary.

### Cross-cutting setup

- **Native deps that need postinstall builds** (e.g. `better-sqlite3`, `puppeteer`) are blocked by pnpm by default. Allowlist each one in `pnpm-workspace.yaml` under `allowBuilds`, otherwise install silently skips the build.
- **Lint and format are configured once at the root** (`eslint.config.mjs`, `.prettierrc.json`) and apply repo-wide, so a new package needs no local lint/format config. After adding an app, confirm the root cross-cutting scripts (`pnpm lint`, `pnpm -r type-check`, `pnpm -r test`) discover it.

## Conventions

These apply to all TypeScript in the repo and are codified in `rules/coding.md`, `rules/typescript.md`, and `eslint.config.mjs`. Match the existing code; the load-bearing points:

- **Result type, not exceptions, for expected failures.** Use `Ok`/`Err` and `Result<T, E extends Error>` from `apps/bookmeter/src/libs/lib.ts`. Errors are classes extending `BaseError`, discriminated by a `context: { type: ... }` union, with the original cause preserved via the ES2022 `Error.cause` option. Branch on `instanceof` for the layer and `context.type` for the case. `eslint-plugin-functional` warns on `throw`.
- **Layered, dependency-injected design.** Keep a pure domain core (no imports from IO layers), push side effects to the edges, and abstract external dependencies behind interfaces (adapter pattern) so tests can substitute in-memory implementations. Prefer functions over classes unless a unit holds state or a lifecycle.
- **Immutability.** Prefer immutable updates (`{ ...obj, ... }`); `functional/immutable-data` is on (Maps/Sets exempted) and `no-param-reassign` is an error.
- **Types.** `any` is an error (use `unknown`, then narrow). Explicit function return types are required. `import type` and ordered/grouped imports are enforced. `no-floating-promises` is an error (IIFEs exempted).
- **Tests** are colocated `*.test.ts` run by Vitest, written assert-first; favor unit-testing pure functions and testing repositories against in-memory adapters.
