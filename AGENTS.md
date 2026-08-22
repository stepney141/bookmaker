# bookmaker - AI Assistant Instructions

This file covers the monorepo as a whole and contains only guidance that is not already documented for developers. Read `README.md` first for the repository layout, app list, toolchain, setup, root commands, the shared SQLite contract, and the procedure for adding a new app. For how any individual app works, read that app's own README; do not duplicate per-app detail here.

## Hard constraints

- `data/books.sqlite` is the only cross-app artifact, and `bookmeter` is its **only writer**. Every other app opens it read-only and keeps derived state in its own DB (`reading-recommender` uses `data/reading-recommender.sqlite`). Never add tables, columns, or rows to the shared DB from anywhere but `bookmeter`. The schema of record is `apps/bookmeter/src/db/schema.ts`; readers keep their own read-only model instead of sharing schema definitions across languages. See "共有 SQLite の扱い" in `README.md` for the connection snippets.
- When adding an app, follow "モノレポへのプロジェクト追加" in `README.md`, including its checklist.

## Conventions

These apply to all TypeScript in the repo and are codified in `rules/coding.md`, `rules/typescript.md`, and `eslint.config.mjs`. Match the existing code; the load-bearing points:

- **Result type, not exceptions, for expected failures.** Use `Ok`/`Err` and `Result<T, E extends Error>` from `apps/bookmeter/src/libs/lib.ts`. Errors are classes extending `BaseError`, discriminated by a `context: { type: ... }` union, with the original cause preserved via the ES2022 `Error.cause` option. Branch on `instanceof` for the layer and `context.type` for the case. `eslint-plugin-functional` warns on `throw`.
- **Layered, dependency-injected design.** Keep a pure domain core (no imports from IO layers), push side effects to the edges, and abstract external dependencies behind interfaces (adapter pattern) so tests can substitute in-memory implementations. Prefer functions over classes unless a unit holds state or a lifecycle.
- **Immutability.** Prefer immutable updates (`{ ...obj, ... }`); `functional/immutable-data` is on (Maps/Sets exempted) and `no-param-reassign` is an error.
- **Types.** `any` is an error (use `unknown`, then narrow). Explicit function return types are required. `import type` and ordered/grouped imports are enforced. `no-floating-promises` is an error (IIFEs exempted).
- **Tests** are colocated `*.test.ts` run by Vitest, written assert-first; favor unit-testing pure functions and testing repositories against in-memory adapters.

## 作業全般の共通ポリシー

- 実装や調査などのタスクを実行する際、subagentsを積極的に使ってください。
- あなたがClaudeの場合、以下のタスクでは積極的にcodex subagentを積極的に使ってください。
  1. プログラムの具体的な実装に関わるタスクでは、積極的にcodex subagentsに作業を移譲する。
  2. 計画書を作成したら、codex subagentsを起動してレビューを求める。

## コーディング時のポリシー

- 早すぎる最適化、測定なしの最適化は禁止する。ボトルネック議論では実測データか再現手順をセットで提示すること。
- KISS（簡潔かつ単純にする）原則に従う。同じことをもっと簡潔なやり方・最小限のコード量で実装できないか考える。
- YAGNI（必要になるまで書かない）原則に従う。将来用のフィールド/フラグ追加、未使用コードの温存は禁止。
- Do not write overly defensive code. Always prefer simplicity over pathological complexity.

