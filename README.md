# bookmaker

複数プロジェクトを束ねるモノレポ。TypeScript は **pnpm workspaces**、Python は **uv workspace** で管理し、生成物である SQLite データベース（`data/books.sqlite`）を各プロジェクトが共有する。`apps/*` は実行可能なアプリケーション、`packages/*` はアプリ間で共有するライブラリを置く。

## アプリ一覧

| パッケージ | 場所 | 説明 |
|---|---|---|
| `@bookmaker/bookmeter` | [`apps/bookmeter`](apps/bookmeter/README.md) | 読書メーターの読みたい本・積読リストをスクレイピングし、書誌情報・図書館所蔵で補強して `data/books.sqlite` と CSV に出力する CLI（共有 SQLite の**生成元**）。TypeScript のみのため uv workspace からは除外している |
| `@bookmaker/reading-recommender` | [`apps/reading-recommender`](apps/reading-recommender/README.md) | 共有 SQLite を read-only で読み、今週のおすすめ本の提示・関連本の表示・読みたい本と積読本の検索を行うローカル SPA + Fastify アプリ。派生状態は共有 DB ではなく `data/reading-recommender.sqlite` に保存する |

各アプリのモード・フラグ・API・アーキテクチャは、それぞれの README を参照する。

## ワークスペース構成

```
bookmaker/
├── pnpm-workspace.yaml      # packages: ["apps/*", "packages/*"]、allowBuilds
├── package.json             # private なルート（横断スクリプト・共有 devDeps・packageManager）
├── tsconfig.base.json       # 共通の compilerOptions
├── eslint.config.mjs        # 共通の ESLint 設定（リポジトリ全体に適用）
├── .prettierrc.json         # 共通の Prettier 設定
├── pyproject.toml           # uv workspace ルート（[tool.uv.workspace]）
├── rules/                   # コーディング規約（coding.md / typescript.md）
├── run_tasks.sh             # cron のエントリポイント（後述）
├── data/
│   ├── books.sqlite                 # 共有 SQLite（bookmeter が生成・更新）
│   └── reading-recommender.sqlite   # reading-recommender の派生状態
├── apps/                    # 実行可能なアプリケーション
│   ├── bookmeter/           # @bookmaker/bookmeter
│   └── reading-recommender/ # @bookmaker/reading-recommender
└── packages/                # 複数アプリで共有するライブラリ（任意）
```

## セットアップ

ツールチェーンは Volta と `packageManager` で固定している（Node 25.8.2、pnpm 11.9.0）。

```bash
pnpm install   # TypeScript ワークスペースの依存を解決（ルートで実行）
uv sync        # Python ワークスペースの依存を解決（Python プロジェクト追加時）
```

- ネイティブモジュール（`better-sqlite3`）や `puppeteer` の postinstall ビルドは、pnpm がデフォルトでブロックするため `pnpm-workspace.yaml` の `allowBuilds` で許可している。新しいネイティブ依存を追加した際は同所に追記する。追記を忘れるとビルドが黙ってスキップされる。
- API キー等の認証情報は、各アプリの `.env` に設定する。スクレイパー・アップデータは `apps/bookmeter/.env`、ローカル Web アプリは `apps/reading-recommender/.env` を読む（各アプリの README と `.env.example` を参照）。

### 横断スクリプト（ルート）

| コマンド | 内容 |
|---|---|
| `pnpm -r type-check` | 全ワークスペースの型チェック（`tsc --noEmit`） |
| `pnpm lint` / `pnpm lint:fix` | ルートの共有 ESLint 設定（`eslint.config.mjs`）でリポジトリ全体を lint |
| `pnpm -r test` | 全ワークスペースのテスト |
| `pnpm format` | Prettier でリポジトリ全体を整形 |

単一ワークスペースを対象にするには `pnpm --filter @bookmaker/<name> run <script>`（Python は `uv run --package <name> <cmd>`）を使う。例: `pnpm --filter @bookmaker/reading-recommender run build`。各アプリ固有の run / test コマンドは、そのアプリの README と `package.json` を参照する。

### 定期実行（`run_tasks.sh`）

`run_tasks.sh` は cron のエントリポイントで、bookmeter の `wish` と `stacked` スクリプトを順に実行し、結果をコミット・プッシュする（履歴の `auto-updated: …` コミット）。失敗時は Discord に通知する。

## コーディング規約

リポジトリ全体の TypeScript に適用する規約は `rules/coding.md` と `rules/typescript.md` にまとめ、`eslint.config.mjs` で機械的に検査している。要点は Result 型による期待されるエラーの表現、依存性注入による層分離、イミュータブルな更新、`any` の禁止と明示的な戻り値型、Vitest による colocated テストである。

## モノレポへのプロジェクト追加

各アプリは `apps/<name>/` に置くワークスペースメンバーで、言語に対応するパッケージマネージャに登録する。pnpm と uv のワークスペースは独立しており、アプリは片方にも両方にも参加できる。

### 共有 SQLite の扱い

`data/books.sqlite` がアプリ間で唯一の共有物であり、アプリ同士の統合境界となる。

- **生成元（writer）は `bookmeter` のみ**。他プロジェクトは現在・将来を問わず **read-only** で開き、生成物を破壊しない。
  - TypeScript: `new Database(dbPath, { readonly: true, fileMustExist: true })`
  - Python: `sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)`
- 読み手が持つ派生状態（キャッシュ、FTS インデックス、設定、埋め込みなど）は自前の DB に保存する。`reading-recommender` は `data/reading-recommender.sqlite` を使い、`data/books.sqlite` にはテーブル・カラム・行を一切追加しない。
- DB は WAL モードで運用しているため、「1 writer + 複数 reader」の同時アクセスは安全。
- パスはワークスペースルートからの相対（`data/books.sqlite`）で解決し、環境変数 `BOOKS_DB_PATH` で上書き可能にする。絶対パスを決め打ちしない。
- スキーマの正は `apps/bookmeter/src/db/schema.ts` とする。言語間でスキーマ定義を共有しようとせず、各読み手が read-only 前提の独自モデルを持つ。

### 新しい TypeScript プロジェクトを追加する

1. `apps/<name>/` を作成し、`package.json` を置く（`name` は `@bookmaker/<name>`、`private: true`）。実行スクリプトは `scripts` に書く。CLI アプリは `tsx` でソースを直接実行してよく、ブラウザ／サーバアプリは `reading-recommender` のように Vite と `tsc` による明示的なビルドを持ってもよい。
2. `tsconfig.json` で共通設定を継承する:
   ```jsonc
   { "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist" } }
   ```
3. ルートで `pnpm install` を実行し、ワークスペースに認識させる。依存追加は `pnpm --filter @bookmaker/<name> add <pkg>`。
4. 他プロジェクトのパッケージを使う場合は `dependencies` に `"@bookmaker/<pkg>": "workspace:*"` を追加する。
5. SQLite を読むなら上記の **read-only** 接続で `data/books.sqlite` を開く。

> ESLint / Prettier はルートで共有している（`eslint.config.mjs` / `.prettierrc.json`）。新しいパッケージ配下の TS ファイルもルートの `pnpm lint` / `pnpm format` で自動的に対象になるため、アプリ側に lint 設定を置く必要はない。

### 新しい Python プロジェクトを追加する

1. `apps/<name>/` に `pyproject.toml` を置く（`[project]` に `name` / `dependencies` を定義）。
2. ルートの `pyproject.toml` の `[tool.uv.workspace] members` が `apps/*` を含むことを確認する（デフォルトで含む。TypeScript のみのアプリは `exclude` に列挙する）。
3. ルートで `uv sync` を実行する（仮想環境はルートの `.venv` に集約される）。依存追加は `uv add --package <name> <pkg>`。
4. 実行は `uv run --package <name> <cmd>`。SQLite は上記の **read-only** 接続で開く。

### TypeScript と Python が混在するプロジェクト

同一の `apps/<name>/` 配下に両方のマニフェストを置き、ソースをサブディレクトリで分ける:

```
apps/<name>/
├── package.json      # TS パート（pnpm workspace member）
├── tsconfig.json
├── pyproject.toml    # Python パート（uv workspace member）
├── ts/
└── python/
```

TS 側・Python 側それぞれを上記「TypeScript/Python プロジェクトを追加する」手順どおりにワークスペースへ登録する。両者の連携は共有 SQLite（`data/books.sqlite`）を介して行い、言語境界をまたいで型を共有しない。

### チェックリスト

- [ ] `apps/<name>/` を作成し、該当する manifest（`package.json` / `pyproject.toml`）を配置した
- [ ] ルートで `pnpm install` / `uv sync` を実行し、ワークスペースに認識させた
- [ ] ネイティブ依存を追加した場合、`pnpm-workspace.yaml` の `allowBuilds` に追記した
- [ ] SQLite を読む場合、**read-only** 接続にした
- [ ] ルートの横断スクリプト（`pnpm lint` / `pnpm -r type-check` / `pnpm -r test`）が新プロジェクトを拾うか確認した
