# bookmaker

複数プロジェクトを束ねるモノレポ。TypeScript は **pnpm workspaces**、Python は **uv workspace** で管理し、生成物である SQLite データベース（`data/books.sqlite`）を各プロジェクトが共有する。

## アプリ一覧

| パッケージ | 場所 | 説明 |
|---|---|---|
| `@bookmaker/bookmeter` | [`apps/bookmeter`](apps/bookmeter/README.md) | 読書メーターの読みたい本・積読リストをスクレイピングし、書誌情報・図書館所蔵で補強して `data/books.sqlite` と CSV に出力する CLI（共有 SQLite の**生成元**） |

## ワークスペース構成

```
bookmaker/
├── pnpm-workspace.yaml      # packages: ["apps/*", "packages/*"]
├── package.json             # private なルート（横断スクリプト・共有 devDeps）
├── tsconfig.base.json       # 共通の compilerOptions
├── eslint.config.mjs        # 共通の ESLint 設定（リポジトリ全体に適用）
├── pyproject.toml           # uv workspace ルート（[tool.uv.workspace]）
├── data/
│   └── books.sqlite         # 共有 SQLite（bookmeter が生成・更新）
├── apps/                    # 実行可能なアプリケーション
│   └── bookmeter/           # @bookmaker/bookmeter（README は各ディレクトリ参照）
└── packages/                # 複数アプリで共有するライブラリ（任意）
```

## セットアップ

```bash
pnpm install   # TypeScript ワークスペースの依存を解決（ルートで実行）
uv sync        # Python ワークスペースの依存を解決（Python プロジェクト追加時）
```

- ネイティブモジュール（`better-sqlite3`）や `puppeteer` の postinstall ビルドは、pnpm がデフォルトでブロックするため `pnpm-workspace.yaml` の `allowBuilds` で許可している。新しいネイティブ依存を追加した際は同所に追記する。
- API キー等の認証情報は、モノレポルートの `.env` に設定する（各アプリの README を参照）。

### 横断スクリプト（ルート）

| コマンド | 内容 |
|---|---|
| `pnpm -r type-check` | 全ワークスペースの型チェック |
| `pnpm lint` | ルートの共有 ESLint 設定（`eslint.config.mjs`）でリポジトリ全体を lint |
| `pnpm -r test` | 全ワークスペースのテスト |
| `pnpm format` | Prettier でリポジトリ全体を整形 |

各アプリ固有の使い方は、それぞれの README を参照（例: [`apps/bookmeter`](apps/bookmeter/README.md)）。

## モノレポへのプロジェクト追加

TypeScript は **pnpm workspaces**、Python は **uv workspace** で管理し、生成物である SQLite（`data/books.sqlite`）を各プロジェクトが共有する。

### 共有 SQLite の扱い

- **生成元（writer）は `bookmeter` のみ**。他プロジェクトは **read-only** で開き、生成物を破壊しない。
  - TypeScript: `new Database(dbPath, { readonly: true, fileMustExist: true })`
  - Python: `sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)`
- DB は WAL モードで運用しているため、「1 writer + 複数 reader」の同時アクセスは安全。
- パスはワークスペースルートからの相対（`data/books.sqlite`）で解決する。決め打ちせず、環境変数 `BOOKS_DB_PATH` で上書き可能にしておくとよい。

### 新しい TypeScript プロジェクトを追加する

1. `apps/<name>/` を作成し、`package.json` を置く（`name` は `@bookmaker/<name>`、`private: true`）。
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
2. ルートの `pyproject.toml` の `[tool.uv.workspace] members` が `apps/*` を含むことを確認する。
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

TS 側・Python 側それぞれを上記「TypeScript/Python プロジェクトを追加する」手順どおりにワークスペースへ登録する。両者の連携は共有 SQLite（`data/books.sqlite`）を介して行うのが基本で、言語間でスキーマ定義を直接共有しようとしない。スキーマの正は `apps/bookmeter/src/db/schema.ts` とし、Python 側は read-only で読む前提の独自モデルを持つ。

### チェックリスト

- [ ] `apps/<name>/` を作成し、該当する manifest（`package.json` / `pyproject.toml`）を配置した
- [ ] ルートで `pnpm install` / `uv sync` を実行し、ワークスペースに認識させた
- [ ] SQLite を読む場合、**read-only** 接続にした
- [ ] ルート `package.json` の横断スクリプト（lint / type-check など）が新プロジェクトを拾うか確認した
