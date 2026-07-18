# Bookmeter

[読書メーター](https://bookmeter.com/)の読みたい本リスト・積読リストをスクレイピングし、複数の書誌情報APIで補強したうえでSQLiteデータベースとCSVに出力するCLIツール。

このアプリは [bookmaker モノレポ](../../README.md)のワークスペース `@bookmaker/bookmeter`（`apps/bookmeter`）である。

## 主な機能

1. **スクレイピング** — Puppeteerで読書メーターにログインし、読みたい本/積読リストからISBN/ASINを抽出
2. **書誌情報の補強** — OpenBD一括検索をベースに、NDL（国立国会図書館）・ISBNdb・Google Booksへのフォールバックチェーンで書誌データを取得
3. **図書館所蔵検索** — CiNii Booksで上智大学・東京大学の所蔵状況とOPACリンクを取得。数学図書室の蔵書リストとも照合
4. **書籍説明文の取得** — 紀伊國屋書店Webサイトから書籍の説明文をクロール
5. **永続化** — SQLite（better-sqlite3 + Drizzle ORM）に保存
6. **CSV出力** — wishリストはOPACリンク・所蔵フラグ付き、stackedリストは基本情報のみ
7. **リモートアップロード** — Firebase StorageへSQLiteファイルをバックアップ

## 使い方

ワークスペースルートで `pnpm install` を済ませてから実行する。

```bash
# ワークスペースルートから（フィルタ指定）
pnpm --filter @bookmaker/bookmeter run wish      # wish リスト（sync パイプライン）
pnpm --filter @bookmaker/bookmeter run stacked   # stacked リスト（sync パイプライン）

# このディレクトリ（apps/bookmeter）内から、任意のモード・オプションを指定
pnpm exec tsx src/index.ts sync wish
pnpm exec tsx src/index.ts scrape stacked --no-login   # スクレイピングのみ
pnpm exec tsx src/index.ts export wish                 # ローカルキャッシュから下流フェーズのみ
pnpm exec tsx src/index.ts enrich wish                 # ローカルキャッシュから書誌・所蔵・説明文を補完
pnpm exec tsx src/index.ts sync wish --refetch         # キャッシュを無視して書誌・所蔵・説明文を再取得
pnpm exec tsx src/index.ts sync wish --refetch biblio holdings  # 書誌・所蔵だけを再取得
pnpm exec tsx src/index.ts sync wish --user-id 42      # ユーザーID指定
```

> SQLite データベースは共有成果物としてモノレポルートの `data/books.sqlite` に置かれる。このアプリが生成元（writer）で、パスは `BOOKS_DB_PATH` 環境変数で上書きできる。`better-sqlite3` / `puppeteer` のネイティブビルドはルート `pnpm-workspace.yaml` の `allowBuilds` で許可している。

`--refetch` は複数のサービス名を引数に取るため、target は必ずサブコマンドの直後に書く。たとえば `sync wish --refetch biblio` は有効だが、`sync --refetch wish` は `wish` をサービス名として解釈してエラーになる。

### 実行モード

| モード | 説明 |
|--------|------|
| `sync` | スクレイピングから全フェーズを実行し、成果物を最新化 |
| `scrape` | スクレイピングのみ実行し、下流フェーズをスキップ |
| `export` | スクレイピングをスキップし、ローカルキャッシュからDB保存・CSV出力・アップロードを実行 |
| `enrich` | Bookmeterのスクレイピングをスキップし、ローカルキャッシュから書誌・所蔵・説明文を補完してDB保存・CSV出力・アップロードを実行 |

#### 各モードの有効フェーズ

| フェーズ | `sync` | `scrape` | `export` | `enrich` |
|---|:---:|:---:|:---:|:---:|
| scrape（データ取得元） | remote | remote | local-cache | local-cache |
| compare | o | - | - | - |
| fetchBiblio | o | - | - | o |
| crawlDescriptions | o | - | - | o |
| persist | o | - | o | o |
| exportCsv | o | - | o | o |
| uploadDb | o | - | o | o |

#### `--refetch` と `--ignore-diff`

キャッシュ制御は2つのフラグに分かれる。`--refetch [service ...]`（`sync` / `enrich` で使用可）は、指定したサービス群の SQLite キャッシュを使わずに再取得する。サービス名を省略した `--refetch` は3群すべてを対象とし、1群でも指定すれば compare は `--ignore-diff` なしでも打ち切りにならない。`--ignore-diff`（`sync` のみ）は、compare で前回スナップショットとの差分がなくても後続フェーズを実行する。他のモードではこれらのフラグは定義されておらず、指定するとエラーになる。

| サービス名 | 対象 |
|---|---|
| `biblio` | OpenBDからNDL・ISBNdb・Google Booksへ続く書誌情報API |
| `holdings` | CiNii OPACの上智大学・東京大学所蔵検索と数学図書館リスト照合 |
| `description` | 紀伊國屋書店の説明文スクレイピング |

| フェーズ | フラグなし | フラグあり |
|---|---|---|
| **compare** | 前回スナップショットと比較し、差分がなければ後続フェーズをスキップ | 任意の `--refetch` または `--ignore-diff` があれば、比較結果に関係なく後続フェーズを常に実行 |
| **fetchBiblio — 書誌情報** | `book_title`, `author`, `publisher`, `published_date` の4項目がすべて有効値ならスキップ（空文字・`Not_found_in_*`・`*_API_Error`・`INVALID_ISBN` は欠損扱い） | `--refetch biblio` で全書籍を無条件に再取得 |
| **fetchBiblio — 所蔵検索** | `cachedBookUrls`（DB上の wish+stacked を結合した URL セット）に含まれていればスキップ | `--refetch holdings` で全書籍を無条件に再検索 |
| **crawlDescriptions** | `sync` はDBに既存の説明文があれば再利用して新規書籍だけを取得し、`enrich` は説明文が空の書籍を補完 | `--refetch description` で既存の説明文があっても再取得 |
| **persist / exportCsv / uploadDb** | キャッシュ判定なし（常に実行） | 同左 |

#### `--refetch` を使う基準

URL 列の追加・削除・並び替えを検知するだけなら、`--refetch` は不要である。`sync` は毎回 Bookmeter の一覧をスクレイピングし、前回スナップショットと現在の `bookmeter_url` の集合および順序を比較するため、キャッシュを長期間使っていても URL 列の差分は検知できる。ただし、同じ URL 列に戻った途中経過や、同じ `bookmeter_url` のまま変わった書誌情報・所蔵情報・説明文は、URL 列の差分としては扱わない。この区別を前提に、`--refetch` は URL 列ではなく下流データを再取得したい時に使う。

`--refetch` を使う主な場面は、既存書籍の書誌情報を API から取り直したい時、CiNii 所蔵情報を再検索したい時、紀伊國屋の説明文を既存書籍も含めて更新したい時、またはキャッシュ済みデータに誤りがあると分かっている時である。通常の追加・削除・並び替えに対しては `sync` の通常実行で足りる。Bookmeter を再スクレイピングせずに特定群だけを再取得したい場合は、たとえば `enrich wish --refetch holdings` のように指定する。

素の `enrich` は、書誌キャッシュの欠落に加えて説明文が空の書籍も毎回補完する。そのため `enrich` は常にブラウザを起動し、紀伊國屋に商品ページがなく説明文を取得できない書籍は次回も再試行する。一方、`sync` の説明文取得は従来どおり新規書籍だけに限定し、定期実行で恒久的な再試行コストが生じることを避ける。次に、モードごとの具体的な挙動をまとめる。

#### モード別まとめ

| モード | `--refetch` なし | `--refetch` あり |
|---|---|---|
| **sync** | remote スクレイプ → 差分なしなら停止（`--ignore-diff` で続行可）。差分ありなら未取得分のみAPI・所蔵検索、新規書籍のみ説明文取得 → 保存・出力 | remote スクレイプ → 比較を無視して指定群を全書籍で再取得 → 保存・出力。サービス名省略時は全群が対象 |
| **scrape** | remote スクレイプのみ。後続フェーズなし | （フラグ定義なし） |
| **export** | 前回スナップショットをそのまま保存・CSV出力・アップロード | （フラグ定義なし） |
| **enrich** | 前回スナップショットに対し、未取得分のみ書誌・所蔵検索、説明文が空の書籍を補完 → 保存・CSV出力・アップロード | 前回スナップショットに対し、指定群を全書籍で再取得し、指定外の欠落分も通常どおり補完 → 保存・CSV出力・アップロード |

### ターゲット

| ターゲット | 説明 |
|------------|------|
| `wish` | 読みたい本リスト |
| `stacked` | 積読リスト |

## プロジェクト構成

`data/books.sqlite` はモノレポルートに置かれる共有成果物（[ルート README](../../README.md) を参照）。以下は本アプリ（`apps/bookmeter/`）内の構成。

```
apps/bookmeter/
├── src/
│   ├── index.ts                # エントリポイント・DIオーケストレーション
│   ├── application/            # アプリケーション層（CLI解析・パイプライン制御）
│   │   ├── executionMode.ts    # CLI引数の解析と実行計画の解決
│   │   └── pipeline.ts         # パイプラインフェーズのオーケストレーション
│   ├── domain/                 # ドメイン層（純粋関数・外部依存なし）
│   │   ├── book.ts             # Bookエンティティ・BookList型・差分検出
│   │   └── isbn.ts             # ISBN/ASINの検証・変換
│   ├── db/                     # 永続化層
│   │   ├── schema.ts           # Drizzle ORMスキーマ定義
│   │   ├── client.ts           # DB接続管理
│   │   ├── constants.ts        # DB_PATH（data/books.sqlite）・CSV定数
│   │   ├── bookRepository.ts   # リポジトリ（インターフェース + 実装）
│   │   ├── dataLoader.ts       # CSV/DBの読み込みユーティリティ
│   │   └── remoteUploader.ts   # Firebaseアップロードアダプタ
│   ├── fetchers/               # 外部API連携層
│   │   ├── index.ts            # フォールバックチェーン統合
│   │   ├── openbd.ts           # OpenBD一括ISBN検索
│   │   ├── ndl.ts              # 国立国会図書館API
│   │   ├── isbndb.ts           # ISBNdb API
│   │   ├── googlebooks.ts      # Google Books API
│   │   └── cinii.ts            # CiNii Books 所蔵検索
│   └── scrapers/               # Webスクレイピング層
│       ├── browser.ts          # ブラウザライフサイクル管理
│       ├── bookmaker.ts        # 読書メータースクレイパー
│       └── kinokuniya.ts       # 紀伊國屋書店 説明文スクレイパー
├── csv/                        # CSV出力先
├── mathlib_ja.txt              # 数学図書室の蔵書ISBNリスト
├── package.json
└── tsconfig.json               # ../../tsconfig.base.json を継承
```

## データソース

| ソース | 用途 |
|--------|------|
| [読書メーター](https://bookmeter.com/) | 読みたい本・積読リストのスクレイピング元 |
| [OpenBD](https://openbd.jp/) | ISBN一括検索による書誌情報の取得 |
| [国立国会図書館サーチ](https://iss.ndl.go.jp/) | 書誌情報のフォールバック取得 |
| [ISBNdb](https://isbndb.com/) | 書誌情報のフォールバック取得 |
| [Google Books](https://books.google.com/) | 書誌情報のフォールバック取得 |
| [CiNii Books](https://ci.nii.ac.jp/books/) | 大学図書館の所蔵検索・OPACリンク取得 |
| [紀伊國屋書店](https://www.kinokuniya.co.jp/) | 書籍説明文のクロール |

## 主要な依存関係

- **puppeteer** / **puppeteer-extra** — Webスクレイピング・ブラウザ自動操作
- **axios** — HTTPクライアント
- **better-sqlite3** / **drizzle-orm** — SQLiteデータベース・ORM
- **firebase** — リモートストレージ
- **papaparse** — CSV解析
- **yargs** — CLI引数解析

## 環境変数

`apps/bookmeter/.env` に以下の API キー・認証情報を設定する必要がある。書式は `apps/bookmeter/.env.example` を参照する。

- `BOOKMETER_ACCOUNT`, `BOOKMETER_PASSWORD` — 読書メーターのログイン情報
- `CINII_API_APPID` — CiNii Books APIのアプリケーションID
- `GOOGLE_BOOKS_API_KEY` — Google Books APIキー
- `ISBNDB_API_KEY` — ISBNdb APIキー
- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` — Firebase設定
- `DISCORD_WEBHOOK_URL`, `DISCORD_USER_ID_TO_MENTION`（任意） — `run_tasks.sh` 失敗時の通知先
- `BOOKS_DB_PATH`（任意） — 共有 SQLite のパス上書き（既定: モノレポルートの `data/books.sqlite`）
