# Reading Recommender

`data/books.sqlite` に保存された読書メーターの読みたい本リスト・積読リストから、今週読む本を推薦し、関連書籍と検索結果を表示するローカル常駐 Web アプリケーション。

このアプリは [bookmaker モノレポ](../../README.md) のワークスペース `@bookmaker/reading-recommender`（`apps/reading-recommender`）である。`bookmeter` が生成した共有 SQLite を読み取り専用で参照し、推薦状態や検索 index は別 SQLite に保存する。

## 主な機能

1. **今週読む本の推薦** — 主推薦 1 冊と副推薦 2 冊を表示する
2. **推薦の継続判定** — 主推薦が最新の `wish ∪ stacked` に残っている限り、次回更新でも主推薦を維持する
3. **読了判定** — 主推薦が最新の共有 SQLite から消えた場合、読了済みとして新しい推薦を作る
4. **関連書籍の表示** — 主推薦と近い内容の本を関連書籍として表示する
5. **書籍検索** — キーワードや自然文 query に対して、FTS5、metadata、任意の embedding を使って関連書籍を検索する
6. **rowid 診断** — `wish` と `stacked` の rowid 先頭・末尾を表示し、読書メーター上の表示順を確認する
7. **設定管理** — 推薦曜日、推薦時刻、件数、`remote_rank` の解釈を app DB に保存する

現在の実装は、実装計画の第 1-5 段階の一部を含む MVP である。OpenAI embedding は環境変数がある場合だけ検索 ranking と関連書籍 ranking に加わり、未設定または失敗時は FTS5、metadata、語彙一致に戻る。週次 scheduler と file watcher は app process 内で動作し、Android push 通知と認証は後続段階で追加する。

## 使い方

ワークスペースルートで `pnpm install` を済ませてから実行する。

```bash
# 開発サーバ
pnpm --filter @bookmaker/reading-recommender run dev

# 本番 build
pnpm --filter @bookmaker/reading-recommender run build

# 本番サーバ
PORT=4174 pnpm --filter @bookmaker/reading-recommender run start
```

開発時は Vite が `http://localhost:5173/` を配信し、API は `http://127.0.0.1:4174/api/*` で動く。本番時は Fastify が `dist/client` を静的配信し、同じ origin で `/api/*` を提供する。

```text
開発: http://localhost:5173/
本番: http://localhost:4174/
```

> 共有 SQLite はモノレポルートの `data/books.sqlite` に置かれる。`bookmeter` が唯一の writer で、このアプリは `new Database(path, { readonly: true, fileMustExist: true })` で読み取り専用に開く。パスは `BOOKS_DB_PATH` で上書きできる。

### Docker Compose 本番運用

Docker Compose で常駐させる場合は、モノレポルートの `compose.yaml` を使う。compose service は source DB を `/source/books.sqlite` として読み取り専用で参照し、app DB を `/state/reading-recommender.sqlite` に保存する。これにより、`bookmeter` が生成する `data/books.sqlite` と、推薦履歴を保存する app DB の書き込み権限を分離できる。初回だけ既存の app DB を state directory に移すと、現在の推薦履歴と設定を引き継げる。

```bash
mkdir -p data/reading-recommender backups/reading-recommender
if [ -f data/reading-recommender.sqlite ] && [ ! -f data/reading-recommender/reading-recommender.sqlite ]; then
  cp data/reading-recommender.sqlite data/reading-recommender/reading-recommender.sqlite
fi

docker compose build reading-recommender
docker compose up -d reading-recommender
curl http://127.0.0.1:4174/api/health
```

既定では host 側の `127.0.0.1:4174` だけに公開する。LAN へ直接公開する場合は `READING_RECOMMENDER_BIND_ADDRESS=0.0.0.0` を指定するが、現時点では更新系 API に認証がないため、インターネットには直接公開しない。Tailscale Serve、Caddy、Nginx などを前段に置く場合も、backend は `127.0.0.1:4174` に閉じる構成を基本にする。

```bash
READING_RECOMMENDER_BIND_ADDRESS=0.0.0.0 docker compose up -d reading-recommender
```

Docker Compose は `apps/reading-recommender/.env` を `env_file` として読む。container 内では `WORKSPACE_ROOT=/app`、`BOOKS_DB_PATH=/source/books.sqlite`、`READING_RECOMMENDER_DB_PATH=/state/reading-recommender.sqlite` が固定される。

```bash
cp apps/reading-recommender/.env.example apps/reading-recommender/.env
$EDITOR apps/reading-recommender/.env
docker compose up -d reading-recommender
```

### SQLite バックアップ

SQLite backup は app service とは別の one-shot service として実行する。`sqlite-backup` service は SQLite の `.backup` を使って、稼働中の app DB から一貫した snapshot を `backups/reading-recommender/` に作る。既定では `books.sqlite` も同じ時刻の backup に含めるため、推薦状態と source DB を同じ世代で復旧できる。source DB は WAL mode なので、backup service だけは SQLite の lock file 処理を許可するために `data/` を書き込み可能で mount する。

```bash
docker compose --profile backup build sqlite-backup
docker compose --profile backup run --rm sqlite-backup
ls -lh backups/reading-recommender/
```

定期実行は host 側の cron または systemd timer から Compose service を起動する。cron で毎日 03:20 に実行する場合は、次の 1 行を crontab に入れる。保持期間は既定で 30 日であり、`BACKUP_RETENTION_DAYS=90` のように変更できる。1 つの DB backup は既定で 300 秒を上限とし、`SQLITE_BACKUP_TIMEOUT_SECONDS=600` のように変更できる。

```cron
20 3 * * * cd /home/stepney141/bookmaker && docker compose --profile backup run --rm sqlite-backup >> logs/reading-recommender-backup.log 2>&1
```

復旧するときは、app service を止めてから backup file を state directory に戻す。source DB も同時に戻す場合は、`books-*.sqlite` を `data/books.sqlite` に戻してから app service を起動する。source DB を戻さない場合でも app DB は復旧できるが、推薦履歴が参照していた source snapshot と現在の `books.sqlite` がずれる可能性がある。

```bash
docker compose stop reading-recommender
cp data/reading-recommender/reading-recommender.sqlite data/reading-recommender/reading-recommender.sqlite.before-restore
cp backups/reading-recommender/reading-recommender-YYYYmmddTHHMMSSZ.sqlite data/reading-recommender/reading-recommender.sqlite
docker compose up -d reading-recommender
```

### API

| Endpoint | 説明 |
|---|---|
| `GET /api/health` | API の疎通確認 |
| `GET /api/recommendations/current` | 現在の主推薦、副推薦、関連書籍を返す |
| `POST /api/recommendations/run` | source sync と推薦更新を手動実行する |
| `POST /api/recommendations/skip` | 現在の主推薦を skip し、新しい推薦を作る |
| `POST /api/recommendations/promote` | 副推薦または任意の現行書籍を主推薦に昇格する |
| `GET /api/search?q=...` | 書籍を検索する |
| `GET /api/books/diagnostics/row-order` | `wish` と `stacked` の rowid 診断を返す |
| `GET /api/settings` | 設定を返す |
| `PATCH /api/settings` | 設定を更新する |

`POST /api/recommendations/promote` は次の JSON body を受け取る。

```json
{
  "bookmeterUrl": "https://bookmeter.com/books/..."
}
```

## 推薦ロジック

推薦は bundle policy と scoring engine に分けている。bundle policy は、現在の推薦を継続するか、新しい推薦 bundle を作るかを決める。scoring engine は、新しい bundle が必要な場合に候補本を順位付けする。

主推薦が最新の `wish ∪ stacked` に残っている場合、週次更新や手動更新でも主推薦を維持する。主推薦が消えた場合は、最新 SQLite にその本が存在しないという事実に基づいて読了済みと判定し、新しい主推薦と副推薦を選ぶ。この判定は score より優先される。

初期 score は、積読本の優先、読書メーター上の表示順、書誌 metadata の充実度を使う。`rowid` は履歴的な登録順ではなく、最後の `bookmeter` 同期時の読書メーター表示順を反映するため、app setting の `remoteOrderAgeDirection` で解釈を切り替える。

## データベース

このアプリは 2 つの SQLite を使う。

| DB | 既定パス | 役割 |
|---|---|---|
| source DB | `data/books.sqlite` | `bookmeter` が生成する共有 SQLite。このアプリは読み取り専用で参照する |
| app DB | `data/reading-recommender.sqlite` | 推薦状態、検索 index、設定、イベント履歴を保存する |

app DB は初回起動時に migration を実行する。現在の主な table は次のとおりである。

| Table | 用途 |
|---|---|
| `scan_run` | source sync の実行履歴と `source_hash` |
| `book_snapshot` | 現行および過去に見た書籍 snapshot |
| `book_fts` | FTS5 検索 index |
| `book_embedding` | provider ごとの embedding cache |
| `recommendation_cycle` | 推薦 bundle の cycle |
| `recommendation_item` | 主推薦・副推薦の item |
| `recommendation_event` | skip、promote、読了判定などの event |
| `push_target` | 後続段階の push 通知登録先 |
| `app_setting` | 推薦時刻、件数、rowid 解釈などの設定 |

`data/reading-recommender.sqlite` は派生状態なので git 管理しない。削除すると推薦履歴と設定は失われるが、`data/books.sqlite` から再同期して最低限の推薦状態は再生成できる。

## 自動推薦

server 起動時に scheduler と file watcher が開始する。scheduler は `app_setting` の `recommendationDayOfWeek`、`recommendationTime`、`timezone` を読み、指定 timezone の週次予定時刻を `temporal-polyfill-lite` 経由の Temporal API で計算する。native `Temporal` が利用できる環境では native 実装を優先し、未対応環境では ponyfill を使う。

予定実行では `recommendation_cycle.scheduled_for` に UTC ISO 時刻を保存する。同じ `scheduled_for` の `scheduled` cycle が既にあれば、process 再起動後も同じ週次枠は重複実行しない。起動時に未実行の週次枠が過去にあれば、直後に予定実行を行う。

file watcher は `data/books.sqlite`、`data/books.sqlite-wal`、`data/books.sqlite-shm` を `chokidar` で監視する。変更検知後は debounce と read retry を挟み、最終的には `source_hash` が変わった場合だけ `source_changed` の推薦 cycle を作る。これにより、同一内容の再生成や一時的な WAL 書き込みでは推薦を前倒ししない。

## プロジェクト構成

```
apps/reading-recommender/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
└── src/
    ├── client/                 # React SPA
    │   ├── App.tsx             # 推薦・検索・設定・診断の画面
    │   ├── api.ts              # Browser API client
    │   ├── main.tsx            # React entry point
    │   └── styles.css          # 画面スタイル
    ├── db/                     # SQLite 境界
    │   ├── appDb.ts            # app DB 接続・settings・snapshot 読み込み
    │   ├── hash.ts             # SHA-256 helper
    │   ├── migrations.ts       # app DB migration SQL
    │   ├── sourceBooks.ts      # source DB read-only repository
    │   └── sync.ts             # source sync
    ├── embedding/              # embedding provider と cache
    ├── recommendation/         # 推薦ロジック
    │   ├── engine.ts           # bundle policy と状態遷移
    │   ├── relatedBooks.ts     # 関連書籍の算出
    │   ├── scoring.ts          # score component
    │   └── store.ts            # 推薦 cycle の永続化
    ├── retrieval/
    │   └── search.ts           # FTS5 + metadata + embedding 検索
    ├── server/                 # Fastify server
    │   ├── api.ts              # API route 定義
    │   ├── dev.ts              # 開発起動
    │   ├── index.ts            # 本番起動
    │   ├── paths.ts            # workspace path 解決
    │   └── service.ts          # API から呼ぶ application service
    └── shared/
        ├── settings.ts         # 既定設定
        └── types.ts            # client/server 共有型
```

## 主要な依存関係

- **Vite** / **React** — SPA の開発・build
- **Fastify** — API server と本番 static 配信
- **better-sqlite3** — source DB と app DB の SQLite 接続
- **zod** — API request body と settings の検証
- **Vitest** — source sync と推薦ロジックのテスト

## 環境変数

`apps/reading-recommender/.env` に必要な環境変数を置く。書式は `apps/reading-recommender/.env.example` を参照する。現在使う環境変数は次のとおりである。

| 変数 | 必須 | 説明 |
|---|---:|---|
| `BOOKS_DB_PATH` | 任意 | source DB のパス。既定は `data/books.sqlite` |
| `READING_RECOMMENDER_DB_PATH` | 任意 | app DB のパス。既定は `data/reading-recommender.sqlite` |
| `PORT` | 任意 | 本番 Fastify server の port。既定は `4174` |
| `WORKSPACE_ROOT` | 任意 | workspace root の明示指定。通常は自動検出する |
| `OPENAI_API_KEY` | 任意 | 設定すると OpenAI embedding を検索 ranking と関連書籍 ranking に使う |
| `OPENAI_EMBEDDING_MODEL` | 任意 | embedding model。既定は `text-embedding-3-large` |
| `OPENAI_EMBEDDING_DIMENSIONS` | 任意 | embedding 次元数。既定は `1024` |

後続段階で Firebase Cloud Messaging と認証を追加する場合は、Firebase service account、`APP_AUTH_TOKEN` などを追加する。

## テスト

```bash
pnpm --filter @bookmaker/reading-recommender run type-check
pnpm --filter @bookmaker/reading-recommender run test
pnpm --filter @bookmaker/reading-recommender run build
```

現在のテストは、source DB の read-only 同期、`wish ∪ stacked` の統合、rowid 由来の rank、主推薦の継続、主推薦消失時の読了判定、積読本優先の scoring を検証する。

## 運用上の注意

現時点では更新系 API に認証がないため、インターネットへ直接公開しない。LAN 内で使うか、Tailscale などの private network に閉じる。外部公開が必要な場合は、reverse proxy 側で認証を付ける。

Android push 通知を実装する段階では、Service Worker と FCM Web Push のために HTTPS origin が必要になる。単なる `http://192.168.x.x:4174/` では push 通知は成立しないため、Cloudflare Tunnel、Tailscale Funnel、ngrok、LAN 内 HTTPS 証明書のいずれかを用意する。
