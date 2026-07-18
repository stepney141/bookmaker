#!/usr/bin/env bash

set -Euo pipefail

readonly ROOT="$(cd "$(dirname "$0")" && pwd)"
readonly ENV_FILE="$ROOT/apps/bookmeter/.env"
readonly LOG_DIR="$ROOT/logs"

usage() {
  echo "Usage: $0 <daily|weekly>" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

readonly MODE=$1
case "$MODE" in
  daily | weekly) ;;
  *)
    usage
    exit 2
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Required environment file not found: $ENV_FILE" >&2
  exit 1
fi

cd "$ROOT"
set -a
source "$ENV_FILE"
set +a

mkdir -p "$LOG_DIR"

readonly -a GENERATED_PATHS=(
  "data/books.sqlite"
  "apps/bookmeter/mathlib_ja.txt"
  "apps/bookmeter/csv/bookmeter_wish_books.csv"
  "apps/bookmeter/csv/bookmeter_stacked_books.csv"
  "apps/bookmeter/csv/not_in_Sophia.csv"
  "apps/bookmeter/csv/in_Sophia.csv"
  "apps/bookmeter/csv/not_in_UTokyo.csv"
  "apps/bookmeter/csv/in_UTokyo.csv"
  "apps/bookmeter/csv/in_Sophia_but_not_in_UTokyo.csv"
  "apps/bookmeter/csv/in_UTokyo_but_not_in_Sophia.csv"
  "apps/bookmeter/csv/not_in_Sophia_and_UTokyo.csv"
)

DISCORD_MENTION_STRING=""
if [[ -n "${DISCORD_USER_ID_TO_MENTION:-}" ]]; then
  DISCORD_MENTION_STRING="<@!${DISCORD_USER_ID_TO_MENTION}> "
fi

notify_discord_failure() {
  local task_name=$1
  local log_file=$2

  if [[ -z "${DISCORD_WEBHOOK_URL:-}" ]]; then
    return 0
  fi

  local content payload
  content="${DISCORD_MENTION_STRING}Bookmeter updater failed: $task_name. Log: $log_file"
  if ! payload=$(node -e 'console.log(JSON.stringify({ content: process.argv[1] }))' "$content"); then
    echo "Failed to create Discord notification payload." >&2
    return 1
  fi

  if ! curl -fSL -H "Content-Type: application/json" -d "$payload" "$DISCORD_WEBHOOK_URL"; then
    echo "Failed to send Discord notification." >&2
    return 1
  fi
}

commit_and_push() {
  local task_exit_status=$?
  local git_exit_status=0
  local git_diff_status
  local current_datetime
  local git_log="$LOG_DIR/git.log"

  trap - EXIT
  set +e
  : > "$git_log"

  if ! git add -- "${GENERATED_PATHS[@]}" &>> "$git_log"; then
    git_exit_status=1
  else
    git diff --cached --quiet -- "${GENERATED_PATHS[@]}"
    git_diff_status=$?

    case "$git_diff_status" in
      0)
        echo "No generated changes to commit." >> "$git_log"
        ;;
      1)
        current_datetime=$(TZ=Asia/Tokyo date --iso-8601=minutes)
        if ! git commit --only -m "auto-updated: $current_datetime" -- "${GENERATED_PATHS[@]}" &>> "$git_log"; then
          git_exit_status=1
        fi
        ;;
      *)
        echo "Failed to inspect generated changes." >> "$git_log"
        git_exit_status=1
        ;;
    esac
  fi

  if ! git push &>> "$git_log"; then
    git_exit_status=1
  fi

  if [[ "$git_exit_status" -ne 0 ]]; then
    echo "Git commit or push failed. Log: $git_log" >&2
    notify_discord_failure "git" "$git_log" || true
  fi

  if [[ "$task_exit_status" -ne 0 ]]; then
    exit "$task_exit_status"
  fi

  exit "$git_exit_status"
}
trap commit_and_push EXIT

run_logged_task() {
  local task_name=$1
  shift
  local log_file="$LOG_DIR/$task_name.log"

  echo "[$(date '+%F %T')] start  $task_name"
  if "$@" &> "$log_file"; then
    echo "[$(date '+%F %T')] done   $task_name"
    return 0
  fi

  echo "[$(date '+%F %T')] failed $task_name"
  echo "log: $log_file"
  notify_discord_failure "$task_name" "$log_file" || true
  return 1
}

run_daily_tasks() {
  local exit_status=0
  local task_name

  for task_name in wish stacked; do
    run_logged_task "$task_name" pnpm --filter @bookmaker/bookmeter run "$task_name" || exit_status=1
  done

  return "$exit_status"
}

run_weekly_tasks() {
  run_logged_task \
    "enrich-wish-refetch-holdings" \
    pnpm --filter @bookmaker/bookmeter exec tsx src/index.ts enrich wish --refetch holdings
}

case "$MODE" in
  daily)
    run_daily_tasks
    ;;
  weekly)
    run_weekly_tasks
    ;;
esac
