# Reading Recommender

`data/books.sqlite` に保存された読書メーターの読みたい本リスト・積読リストから、今週読む本を推薦し、関連書籍と検索結果を表示するローカル常駐 Web アプリケーション。

このアプリは [bookmaker モノレポ](../../README.md) のワークスペース `@bookmaker/reading-recommender`（`apps/reading-recommender`）である。`bookmeter` が生成した共有 SQLite を読み取り専用で参照し、推薦状態や検索 index は別 SQLite に保存する。

## 主な機能

1. **今週読む本の推薦** — 主推薦 1 冊と副推薦 2 冊を表示する
2. **推薦の継続判定** — 主推薦が最新の `wish ∪ stacked` に残っている限り、次回更新でも主推薦を維持する
3. **読了判定** — 主推薦が最新の共有 SQLite から消えた場合、読了済みとして新しい推薦を作る
4. **関連書籍の表示** — 主推薦と近い内容の本を関連書籍として表示する
5. **書籍検索** — キーワードや自然文 query に対して、FTS5 と metadata を使って関連書籍を検索する
6. **rowid 診断** — `wish` と `stacked` の rowid 先頭・末尾を表示し、読書メーター上の表示順を確認する
7. **設定管理** — 推薦曜日、推薦時刻、件数、`remote_rank` の解釈を app DB に保存する

現在の実装は、実装計画の第 1-2 段階を中心とする MVP である。embedding による意味検索、週次 scheduler、file watcher、Android push 通知、認証は後続段階で追加する。

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
| `recommendation_cycle` | 推薦 bundle の cycle |
| `recommendation_item` | 主推薦・副推薦の item |
| `recommendation_event` | skip、promote、読了判定などの event |
| `push_target` | 後続段階の push 通知登録先 |
| `app_setting` | 推薦時刻、件数、rowid 解釈などの設定 |

`data/reading-recommender.sqlite` は派生状態なので git 管理しない。削除すると推薦履歴と設定は失われるが、`data/books.sqlite` から再同期して最低限の推薦状態は再生成できる。

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
    ├── recommendation/         # 推薦ロジック
    │   ├── engine.ts           # bundle policy と状態遷移
    │   ├── relatedBooks.ts     # 関連書籍の算出
    │   ├── scoring.ts          # score component
    │   └── store.ts            # 推薦 cycle の永続化
    ├── retrieval/
    │   └── search.ts           # FTS5 + metadata 検索
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

`.env` はモノレポルートに置く。現在使う環境変数は次のとおりである。

| 変数 | 必須 | 説明 |
|---|---:|---|
| `BOOKS_DB_PATH` | 任意 | source DB のパス。既定は `data/books.sqlite` |
| `READING_RECOMMENDER_DB_PATH` | 任意 | app DB のパス。既定は `data/reading-recommender.sqlite` |
| `PORT` | 任意 | 本番 Fastify server の port。既定は `4174` |
| `WORKSPACE_ROOT` | 任意 | workspace root の明示指定。通常は自動検出する |

後続段階で OpenAI embedding、Firebase Cloud Messaging、認証を追加する場合は、`OPENAI_API_KEY`、Firebase service account、`APP_AUTH_TOKEN` などを追加する。

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
