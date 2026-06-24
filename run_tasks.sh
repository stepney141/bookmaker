#!/usr/bin/env bash

set -Euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

LOG_DIR="${LOG_DIR:-"$ROOT/logs"}"
mkdir -p "$LOG_DIR"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-jobs)
      shift
      echo "--max-jobs is no longer used; wish and stacked run sequentially." >&2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

DISCORD_MENTION_STRING=""
if [[ -n "${DISCORD_USER_ID_TO_MENTION:-}" ]]; then
  DISCORD_MENTION_STRING="<@!${DISCORD_USER_ID_TO_MENTION}> "
fi

notify_discord_failure() {
  local script_name=$1
  local log_file=$2

  if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]]; then
    return 0
  fi

  local content payload
  content="${DISCORD_MENTION_STRING}Bookmeter updater failed: $script_name. Log: $log_file"
  if payload=$(node -e 'console.log(JSON.stringify({ content: process.argv[1] }))' "$content"); then
    curl -fSL -H "Content-Type: application/json" -d "$payload" "$DISCORD_WEBHOOK_URL" || true
  fi
}

commit_and_push() {
  local exit_status=$?

  set +e
  local current_datetime
  current_datetime=$(TZ=Asia/Tokyo date --iso-8601=minutes)
  git add -A
  git commit -m "auto-updated: $current_datetime" 2>/dev/null || true
  git push || true

  exit "$exit_status"
}
trap commit_and_push EXIT

run_npm_script() {
  local script_name=$1
  local log_file="$LOG_DIR/$script_name.log"

  echo "[$(date '+%F %T')] start  pnpm run $script_name"
  if pnpm --filter @bookmaker/bookmeter run "$script_name" &> "$log_file"; then
    echo "[$(date '+%F %T')] done   pnpm run $script_name"
    return 0
  fi

  echo "[$(date '+%F %T')] failed pnpm run $script_name"
  echo "log: $log_file"
  notify_discord_failure "$script_name" "$log_file"
  return 1
}

main() {
  local exit_status=0
  local script_name

  for script_name in wish stacked; do
    run_npm_script "$script_name" || exit_status=1
  done

  return "$exit_status"
}

main
