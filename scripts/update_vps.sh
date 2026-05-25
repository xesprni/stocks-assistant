#!/usr/bin/env bash
set -Eeuo pipefail

# One-command update for an existing Stocks Assistant VPS deployment.
#
# Usage:
#   sudo bash scripts/update_vps.sh
#   sudo stocks-assistant-update
#
# Optional overrides:
#   REPO_REF=main
#   APP_DIR=/opt/stocks-assistant
#   APP_USER=stocks
#   BACKEND_PORT=8000
#   DATA_DIR=/var/lib/stocks-assistant
#   DB_PATH=/var/lib/stocks-assistant/stocks-assistant.db
#   SERVICE_NAME=stocks-assistant.service
#   LOG_DIR=/var/log/stocks-assistant-deploy
#   DEPLOY_DEBUG=1
#   SKIP_DB_BACKUP=1
#   FORCE=1

REPO_REF="${REPO_REF:-main}"
APP_DIR="${APP_DIR:-/opt/stocks-assistant}"
APP_USER="${APP_USER:-stocks}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
DATA_DIR="${DATA_DIR:-/var/lib/stocks-assistant}"
DB_PATH="${DB_PATH:-$DATA_DIR/stocks-assistant.db}"
SERVICE_NAME="${SERVICE_NAME:-stocks-assistant.service}"
LOG_DIR="${LOG_DIR:-/var/log/stocks-assistant-deploy}"
LOG_FILE="${LOG_FILE:-}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
SKIP_DB_BACKUP="${SKIP_DB_BACKUP:-0}"
FORCE="${FORCE:-0}"
TOTAL_STEPS=9
STEP=0
CURRENT_STEP="startup"
PREVIOUS_REF=""
TARGET_REF=""
DB_BACKUP_PATH=""

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

init_logging() {
  if [[ -z "$LOG_FILE" ]]; then
    install -d -m 755 "$LOG_DIR"
    LOG_FILE="$LOG_DIR/update-$(date '+%Y%m%d-%H%M%S').log"
  else
    install -d -m 755 "$(dirname "$LOG_FILE")"
  fi
  touch "$LOG_FILE"
  chmod 640 "$LOG_FILE" || true
  exec > >(tee -a "$LOG_FILE") 2>&1

  if [[ "${DEPLOY_DEBUG:-0}" == "1" ]]; then
    export PS4='+ ${BASH_SOURCE}:${LINENO}: '
    set -x
  fi
}

log() {
  printf '\n\033[1;32m==>\033[0m [%s] %s\n' "$(timestamp)" "$*"
}

warn() {
  printf '\n\033[1;33mWARN:\033[0m [%s] %s\n' "$(timestamp)" "$*" >&2
}

die() {
  printf '\n\033[1;31mERROR:\033[0m [%s] %s\n' "$(timestamp)" "$*" >&2
  if [[ -n "${LOG_FILE:-}" ]]; then
    printf 'Log file: %s\n' "$LOG_FILE" >&2
  fi
  exit 1
}

print_progress() {
  local label="$1"
  local percent=$((STEP * 100 / TOTAL_STEPS))
  printf '\n\033[1;36m[%02d/%02d %3d%%]\033[0m %s\n' "$STEP" "$TOTAL_STEPS" "$percent" "$label"
}

run_step() {
  CURRENT_STEP="$1"
  shift
  local started_at=$SECONDS
  STEP=$((STEP + 1))
  print_progress "$CURRENT_STEP"
  "$@"
  log "Completed: $CURRENT_STEP ($((SECONDS - started_at))s)"
}

on_error() {
  local exit_code=$?
  local line_no="${1:-unknown}"
  local command="${2:-unknown}"

  set +x
  printf '\n\033[1;31mUPDATE FAILED\033[0m\n' >&2
  printf 'Step: %s/%s - %s\n' "$STEP" "$TOTAL_STEPS" "$CURRENT_STEP" >&2
  printf 'Exit code: %s\n' "$exit_code" >&2
  printf 'Line: %s\n' "$line_no" >&2
  printf 'Command: %s\n' "$command" >&2
  if [[ -n "$PREVIOUS_REF" ]]; then
    printf 'Previous commit: %s\n' "$PREVIOUS_REF" >&2
  fi
  if [[ -n "$TARGET_REF" ]]; then
    printf 'Target commit: %s\n' "$TARGET_REF" >&2
  fi
  if [[ -n "$DB_BACKUP_PATH" ]]; then
    printf 'Database backup: %s\n' "$DB_BACKUP_PATH" >&2
  fi
  if [[ -n "${LOG_FILE:-}" ]]; then
    printf 'Log file: %s\n' "$LOG_FILE" >&2
    printf '\nLast 40 log lines:\n' >&2
    tail -n 40 "$LOG_FILE" >&2 || true
  fi
  exit "$exit_code"
}

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run this script as root, for example: sudo bash $0"
  fi
}

ensure_git_safe_directory() {
  if [[ ! -d "$APP_DIR/.git" ]]; then
    return
  fi

  local configured=""
  configured="$(git config --global --get-all safe.directory 2>/dev/null || true)"
  if printf '%s\n' "$configured" | grep -Fxq "$APP_DIR"; then
    return
  fi
  if printf '%s\n' "$configured" | grep -Fxq "*"; then
    return
  fi

  log "Registering $APP_DIR as a safe Git directory for root"
  git config --global --add safe.directory "$APP_DIR"
}

validate_deployment() {
  [[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout. Run deploy_vps.sh first or set APP_DIR."
  [[ -f "$APP_DIR/pyproject.toml" ]] || die "$APP_DIR does not look like the Stocks Assistant repository."
  command -v git >/dev/null 2>&1 || die "git is required."
  ensure_git_safe_directory
  command -v curl >/dev/null 2>&1 || die "curl is required."
  command -v python3 >/dev/null 2>&1 || die "python3 is required."
  command -v npm >/dev/null 2>&1 || die "npm is required."
  command -v systemctl >/dev/null 2>&1 || die "systemctl is required."
  if ! systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
    die "Systemd service $SERVICE_NAME was not found."
  fi
}

print_plan() {
  PREVIOUS_REF="$(git -C "$APP_DIR" rev-parse --short HEAD)"
  log "Starting Stocks Assistant update"
  cat <<EOF
Branch/tag:      $REPO_REF
App dir:         $APP_DIR
Data dir:        $DATA_DIR
DB path:         $DB_PATH
Service:         $SERVICE_NAME
Backend health:  http://127.0.0.1:$BACKEND_PORT/api/v1/health
Current commit:  $PREVIOUS_REF
Log file:        $LOG_FILE
EOF
}

backup_database() {
  if [[ "$SKIP_DB_BACKUP" == "1" ]]; then
    warn "Skipping database backup because SKIP_DB_BACKUP=1."
    return
  fi

  if [[ ! -f "$DB_PATH" ]]; then
    warn "Database file does not exist yet: $DB_PATH"
    return
  fi

  install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$BACKUP_DIR"
  DB_BACKUP_PATH="$BACKUP_DIR/stocks-assistant-$(date '+%Y%m%d-%H%M%S').db"

  log "Backing up SQLite database to $DB_BACKUP_PATH"
  python3 - "$DB_PATH" "$DB_BACKUP_PATH" <<'PY'
import sqlite3
import sys

source_path, backup_path = sys.argv[1], sys.argv[2]
with sqlite3.connect(source_path) as source:
    with sqlite3.connect(backup_path) as backup:
        source.backup(backup)
PY
  chown "$APP_USER:$APP_USER" "$DB_BACKUP_PATH"
  chmod 640 "$DB_BACKUP_PATH"
}

update_source() {
  local dirty=""

  log "Fetching $REPO_REF from origin"
  git -C "$APP_DIR" fetch --depth 1 origin "$REPO_REF"
  TARGET_REF="$(git -C "$APP_DIR" rev-parse --short "origin/$REPO_REF")"

  if [[ "$PREVIOUS_REF" == "$TARGET_REF" ]]; then
    log "Source is already up to date at $TARGET_REF"
    return
  fi

  dirty="$(git -C "$APP_DIR" status --short | grep -vE '^[ MADRCU?!]{2} scripts/update_vps\.sh$' || true)"
  if [[ -n "$dirty" && "$FORCE" != "1" ]]; then
    printf '%s\n' "$dirty"
    die "$APP_DIR has local changes. Commit/remove them or rerun with FORCE=1 to reset to origin/$REPO_REF."
  fi
  if [[ -n "$dirty" ]]; then
    warn "Local changes detected; FORCE=1 allows resetting them."
  fi

  log "Updating source from $PREVIOUS_REF to $TARGET_REF"
  git -C "$APP_DIR" reset --hard "origin/$REPO_REF"
}

install_backend_dependencies() {
  log "Installing backend dependencies"
  if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then
    python3 -m venv "$APP_DIR/.venv"
  fi
  "$APP_DIR/.venv/bin/python" -m pip install --upgrade pip setuptools wheel
  "$APP_DIR/.venv/bin/python" -m pip install -e "$APP_DIR"
}

build_frontend() {
  log "Building frontend"
  npm --prefix "$APP_DIR/frontend" ci
  npm --prefix "$APP_DIR/frontend" run build
}

fix_permissions() {
  log "Fixing file ownership"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
  chmod 750 "$DATA_DIR"
}

install_update_command() {
  log "Installing stocks-assistant-update command"
  install -m 755 "$APP_DIR/scripts/update_vps.sh" /usr/local/bin/stocks-assistant-update
}

restart_service() {
  log "Restarting $SERVICE_NAME"
  systemctl daemon-reload
  systemctl restart "$SERVICE_NAME"
  systemctl --no-pager --full status "$SERVICE_NAME"
}

health_check() {
  local url="http://127.0.0.1:$BACKEND_PORT/api/v1/health"
  local attempt=1

  log "Checking backend health at $url"
  while [[ "$attempt" -le 20 ]]; do
    if curl -fsS "$url" >/dev/null; then
      log "Backend health check passed"
      return
    fi
    printf 'Waiting for backend... attempt %s/20\n' "$attempt"
    sleep 2
    attempt=$((attempt + 1))
  done

  journalctl -u "$SERVICE_NAME" -n 80 --no-pager || true
  die "Backend health check failed after restart."
}

print_summary() {
  local current_ref
  current_ref="$(git -C "$APP_DIR" rev-parse --short HEAD)"

  log "Update complete"
  cat <<EOF

Updated:
  $PREVIOUS_REF -> $current_ref

Service:
  systemctl status $SERVICE_NAME
  journalctl -u $SERVICE_NAME -f

Next update:
  sudo stocks-assistant-update

Database backup:
  ${DB_BACKUP_PATH:-not created}

Log file:
  $LOG_FILE
EOF
}

main() {
  need_root
  init_logging
  trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

  run_step "Validate existing deployment" validate_deployment
  print_plan
  run_step "Backup SQLite database" backup_database
  run_step "Update source code" update_source
  run_step "Install backend dependencies" install_backend_dependencies
  run_step "Build frontend" build_frontend
  run_step "Fix file ownership" fix_permissions
  run_step "Install update command" install_update_command
  run_step "Restart backend service" restart_service
  run_step "Run backend health check" health_check
  print_summary
}

main "$@"
