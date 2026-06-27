export const APP_DB_MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migration (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS scan_run (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    books_db_path TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    wish_count INTEGER NOT NULL,
    stacked_count INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS book_snapshot (
    bookmeter_url TEXT PRIMARY KEY,
    isbn_or_asin TEXT,
    book_title TEXT NOT NULL,
    author TEXT NOT NULL,
    publisher TEXT NOT NULL,
    published_date TEXT NOT NULL,
    description TEXT NOT NULL,
    in_wish INTEGER NOT NULL,
    in_stacked INTEGER NOT NULL,
    wish_rowid INTEGER,
    stacked_rowid INTEGER,
    remote_rank INTEGER NOT NULL,
    remote_rank_source TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_scan_run_id INTEGER NOT NULL
  );`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS book_fts USING fts5(
    bookmeter_url UNINDEXED,
    book_title,
    author,
    publisher,
    description,
    tokenize = 'trigram'
  );`,
  `CREATE TABLE IF NOT EXISTS recommendation_cycle (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    scheduled_for TEXT,
    created_at TEXT NOT NULL,
    activated_at TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS recommendation_item (
    cycle_id INTEGER NOT NULL,
    slot TEXT NOT NULL,
    rank INTEGER NOT NULL,
    bookmeter_url TEXT NOT NULL,
    score REAL NOT NULL,
    score_breakdown_json TEXT NOT NULL,
    explanation_json TEXT NOT NULL,
    PRIMARY KEY (cycle_id, slot, rank)
  );`,
  `CREATE TABLE IF NOT EXISTS recommendation_event (
    id INTEGER PRIMARY KEY,
    event_type TEXT NOT NULL,
    bookmeter_url TEXT,
    cycle_id INTEGER,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS push_target (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    token_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    last_success_at TEXT,
    last_failure_at TEXT,
    disabled_at TEXT,
    UNIQUE (provider, token_type, target_id)
  );`,
  `CREATE TABLE IF NOT EXISTS app_setting (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`
];
