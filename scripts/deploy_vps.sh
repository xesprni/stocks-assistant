#!/usr/bin/env bash
set -Eeuo pipefail

# One-command Ubuntu/Debian deployment for Stocks Assistant.
# Defaults assume you created the subdomain stocks.sgsedggs.xyz in Namecheap.
#
# Usage:
#   sudo DOMAIN=stocks.sgsedggs.xyz EMAIL=you@example.com bash scripts/deploy_vps.sh
#
# Optional overrides:
#   DOMAIN=stocks.sgsedggs.xyz
#   REPO_URL=https://github.com/xesprni/stocks-assistant.git
#   REPO_REF=dev-1.1.0
#   APP_DIR=/opt/stocks-assistant
#   APP_USER=stocks
#   BACKEND_PORT=8000

DOMAIN="${DOMAIN:-stocks.sgsedggs.xyz}"
REPO_URL="${REPO_URL:-https://github.com/xesprni/stocks-assistant.git}"
REPO_REF="${REPO_REF:-dev-1.1.0}"
APP_DIR="${APP_DIR:-/opt/stocks-assistant}"
APP_USER="${APP_USER:-stocks}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
DATA_DIR="${DATA_DIR:-/var/lib/stocks-assistant}"
DB_PATH="${DB_PATH:-$DATA_DIR/stocks-assistant.db}"
WEBROOT="${WEBROOT:-/var/www/stocks-assistant-certbot}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/stocks-assistant.conf}"
EMAIL="${EMAIL:-}"
NODE_MAJOR_REQUIRED="${NODE_MAJOR_REQUIRED:-20}"

log() {
  printf '\n\033[1;32m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\n\033[1;33mWARN:\033[0m %s\n' "$*" >&2
}

die() {
  printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run this script as root, for example: sudo DOMAIN=$DOMAIN bash $0"
  fi
}

detect_os() {
  if [[ ! -r /etc/os-release ]]; then
    die "Cannot detect OS. This script supports Ubuntu/Debian."
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) die "Unsupported OS '${ID:-unknown}'. This script supports Ubuntu/Debian." ;;
  esac
}

apt_install_base() {
  log "Installing system packages"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    certbot \
    curl \
    git \
    nginx \
    python3 \
    python3-pip \
    python3-venv \
    build-essential
}

ensure_python() {
  log "Checking Python version"
  python3 - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("Python 3.10+ is required")
PY
}

ensure_node() {
  local major=""
  if command -v node >/dev/null 2>&1; then
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
  fi
  if [[ -n "$major" && "$major" -ge "$NODE_MAJOR_REQUIRED" ]]; then
    log "Node.js $(node --version) is already installed"
    return
  fi

  log "Installing Node.js ${NODE_MAJOR_REQUIRED}.x from NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_REQUIRED}.x" | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  node --version
  npm --version
}

ensure_user_and_dirs() {
  log "Preparing service user and directories"
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --home "$DATA_DIR" --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$DATA_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_DIR"
  install -d -m 755 "$WEBROOT"
}

deploy_source() {
  log "Deploying source from $REPO_URL ($REPO_REF)"
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch --depth 1 origin "$REPO_REF"
    git -C "$APP_DIR" reset --hard "origin/$REPO_REF"
  elif [[ -e "$APP_DIR" && -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
    die "$APP_DIR exists and is not a git checkout. Move it away or set APP_DIR to a new path."
  else
    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$APP_DIR"
  fi
}

build_backend() {
  log "Installing backend dependencies"
  python3 -m venv "$APP_DIR/.venv"
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

write_systemd_service() {
  log "Writing systemd service"
  cat >/etc/systemd/system/stocks-assistant.service <<EOF
[Unit]
Description=Stocks Assistant FastAPI backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=STOCKS_ASSISTANT_DB_PATH=$DB_PATH
Environment=PYTHONUNBUFFERED=1
ExecStart=$APP_DIR/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $BACKEND_PORT
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now stocks-assistant.service
}

write_temporary_nginx() {
  log "Writing temporary Nginx config for ACME challenge"
  cat >"$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    root $WEBROOT;

    location /.well-known/acme-challenge/ {
        root $WEBROOT;
    }

    location / {
        return 200 "stocks-assistant certificate challenge endpoint\\n";
        add_header Content-Type text/plain;
    }
}
EOF
  nginx -t
  systemctl reload nginx
}

issue_certificate() {
  log "Issuing Let's Encrypt certificate for $DOMAIN"
  local cert_args=(certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --agree-tos --non-interactive)
  if [[ -n "$EMAIL" ]]; then
    cert_args+=(--email "$EMAIL")
  else
    warn "EMAIL is empty; registering Let's Encrypt account without email."
    cert_args+=(--register-unsafely-without-email)
  fi
  certbot "${cert_args[@]}"
}

write_final_nginx() {
  log "Writing final Nginx config"
  cat >"$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root $WEBROOT;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    root $APP_DIR/frontend/dist;
    index index.html;
    client_max_body_size 100m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_buffering off;
        add_header X-Accel-Buffering no;
    }

    location /docs {
        return 404;
    }

    location /redoc {
        return 404;
    }

    location /openapi.json {
        return 404;
    }

    location / {
        try_files \$uri /index.html;
    }
}
EOF
  nginx -t
  systemctl reload nginx
}

print_summary() {
  log "Deployment complete"
  cat <<EOF

URL:
  https://$DOMAIN/dashboard

Backend:
  systemctl status stocks-assistant.service
  journalctl -u stocks-assistant.service -f

Database:
  $DB_PATH

Nginx config:
  $NGINX_CONF

Next step:
  Open https://$DOMAIN/dashboard and create the first administrator account.
EOF
}

main() {
  need_root
  detect_os
  apt_install_base
  ensure_python
  ensure_node
  ensure_user_and_dirs
  deploy_source
  build_backend
  build_frontend
  fix_permissions
  write_systemd_service
  write_temporary_nginx
  issue_certificate
  write_final_nginx
  print_summary
}

main "$@"
