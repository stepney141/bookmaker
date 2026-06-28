#!/bin/sh
set -eu

APP_DB_PATH="${APP_DB_PATH:-/state/reading-recommender.sqlite}"
SOURCE_DB_PATH="${SOURCE_DB_PATH:-/source/books.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_SOURCE_DB="${BACKUP_SOURCE_DB:-1}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
SQLITE_BACKUP_TIMEOUT_SECONDS="${SQLITE_BACKUP_TIMEOUT_SECONDS:-300}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

backup_sqlite() {
  source_path="$1"
  label="$2"

  if [ ! -f "$source_path" ]; then
    echo "missing ${label} database: ${source_path}" >&2
    exit 1
  fi

  output_path="${BACKUP_DIR}/${label}-${timestamp}.sqlite"
  temporary_path="${output_path}.tmp"

  rm -f "$temporary_path"
  if ! timeout "$SQLITE_BACKUP_TIMEOUT_SECONDS" sqlite3 -readonly "$source_path" ".timeout 5000" ".backup ${temporary_path}"; then
    echo "backup failed for ${label}: ${source_path}" >&2
    rm -f "$temporary_path" "${temporary_path}-journal"
    exit 1
  fi

  integrity_result="$(sqlite3 -readonly "$temporary_path" "PRAGMA integrity_check;")"
  if [ "$integrity_result" != "ok" ]; then
    echo "integrity check failed for ${label}: ${integrity_result}" >&2
    rm -f "$temporary_path"
    exit 1
  fi

  mv "$temporary_path" "$output_path"
  echo "created ${output_path}"
}

mkdir -p "$BACKUP_DIR"

backup_sqlite "$APP_DB_PATH" "reading-recommender"

if [ "$BACKUP_SOURCE_DB" = "1" ]; then
  backup_sqlite "$SOURCE_DB_PATH" "books"
fi

if [ "$BACKUP_RETENTION_DAYS" -ge 0 ] 2>/dev/null; then
  find "$BACKUP_DIR" -type f -name "reading-recommender-*.sqlite" -mtime +"$BACKUP_RETENTION_DAYS" -delete
  find "$BACKUP_DIR" -type f -name "books-*.sqlite" -mtime +"$BACKUP_RETENTION_DAYS" -delete
fi
