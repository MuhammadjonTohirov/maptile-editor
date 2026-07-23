#!/usr/bin/env bash
# One-command deploy to a VPS over SSH.
#
#   scripts/deploy.sh <ssh-target> [public-url]
#   scripts/deploy.sh root@203.0.113.10
#   scripts/deploy.sh deploy@maps.example.com https://maps.example.com
#
# It syncs the repo to the server, writes production secrets, builds the stack,
# and — only when needed — builds the basemap tiles and bulk-loads the full
# Uzbekistan OSM extract. Re-runs skip the heavy steps that are already done.
#
# The VPS needs: Docker + Docker Compose, ~20 GB free disk, and SSH access for
# the given target. Admin password and JWT secret are generated unless you pass
# ADMIN_PASSWORD=... (and/or JWT_SECRET=...) in the environment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VPS="${1:-}"
if [ -z "$VPS" ]; then
  echo "usage: scripts/deploy.sh <ssh-target> [public-url]" >&2
  echo "   e.g. scripts/deploy.sh root@203.0.113.10" >&2
  exit 1
fi
HOST="${VPS#*@}"
PUBLIC_URL="${2:-http://$HOST}"
REMOTE_DIR="${REMOTE_DIR:-maptile-editor}"

# --- secrets ---------------------------------------------------------------
gen_secret() { openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
JWT_SECRET="${JWT_SECRET:-$(gen_secret)}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(gen_secret | cut -c1-16)}"
# The session cookie may only carry the Secure flag over HTTPS, or logins break.
# An https:// URL also switches on the Caddy auto-TLS proxy (compose `tls`
# profile): Caddy takes 80/443 and the frontend moves to a loopback bind so the
# two don't clash. DOMAIN is the hostname Caddy requests a certificate for.
case "$PUBLIC_URL" in
  https://*) COOKIE_SECURE=true;  TLS=true;  DOMAIN="$HOST"; FRONTEND_PORT="127.0.0.1:8080" ;;
  *)         COOKIE_SECURE=false; TLS=false; DOMAIN="";      FRONTEND_PORT="80" ;;
esac

echo "→ deploying to $VPS  (public: $PUBLIC_URL)"

# --- 1. sync the repo (code + prebuilt tiles; not data/artifacts) ----------
echo "→ syncing files…"
rsync -az --delete \
  --exclude '.git' --exclude 'db/data' --exclude 'backups' --exclude 'node_modules' \
  --exclude '__pycache__' --exclude '*.pyc' --exclude '.venv' \
  ./ "$VPS:$REMOTE_DIR/"

# --- 2. write the production environment -----------------------------------
echo "→ writing production .env…"
ssh "$VPS" "cat > '$REMOTE_DIR/.env'" <<ENV
JWT_SECRET=$JWT_SECRET
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
AUTH_COOKIE_SECURE=$COOKIE_SECURE
FRONTEND_HOST_PORT=$FRONTEND_PORT
DOMAIN=$DOMAIN
CORS_ORIGINS=$PUBLIC_URL
ENV

# --- 3. remote bootstrap: tiles (if missing) → stack → OSM load (if empty) --
echo "→ building the stack on the server (tiles + OSM load run only if needed)…"
ssh "$VPS" "REMOTE_DIR='$REMOTE_DIR' TLS='$TLS' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

command -v docker >/dev/null 2>&1 || { echo "Docker is not installed on the VPS."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running on the VPS."; exit 1; }

# An https:// deploy adds the Caddy auto-TLS proxy (compose `tls` profile).
PROFILE=""
[ "${TLS:-false}" = "true" ] && PROFILE="--profile tls"

# Basemap tiles: transferred if built locally; otherwise built here (heavy).
if [ ! -f tiles/osm_uzbekistan.mbtiles ]; then
  echo "  basemap tiles missing — building them (downloads the extract, ~20 min)…"
  ./scripts/build-uzbekistan-tiles.sh
fi

# Build immutable production images, run migrations, and start everything.
# Supplying the base file explicitly excludes docker-compose.override.yml,
# which contains local source mounts and uvicorn auto-reload.
docker compose -f docker-compose.yml $PROFILE up -d --build

# Health-check the backend directly on loopback (:8000, un-prefixed routes) so
# the probe is the same whether the front door is the frontend or Caddy.
echo "  waiting for the stack to come up…"
for _ in $(seq 1 40); do
  curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 3
done

# Load the full country only when the database is (nearly) empty. The
# FULL_BASE_THRESHOLD is 50000; below it, run the one-time bulk load.
COUNT=$(curl -s http://127.0.0.1:8000/meta \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("feature_count",0))' 2>/dev/null || echo 0)
if [ "${COUNT:-0}" -lt 50000 ]; then
  echo "  only ${COUNT:-0} features — bulk-loading the full Uzbekistan OSM extract (heavy)…"
  ./scripts/load-uzbekistan-osm.sh
else
  echo "  $COUNT features already loaded — skipping the OSM bulk load."
fi

docker compose -f docker-compose.yml $PROFILE ps
REMOTE

echo
echo "✓ deployed → $PUBLIC_URL"
echo "  admin login: $ADMIN_USERNAME / $ADMIN_PASSWORD"
echo
if [ "$TLS" = true ]; then
  echo "HTTPS: Caddy is fetching a Let's Encrypt cert for $DOMAIN."
  echo "  • Point $DOMAIN's DNS A record at this VPS and open ports 80 + 443 in its firewall."
  echo "  • The first request may take a few seconds while the cert is issued."
else
  echo "Currently HTTP only. For automatic HTTPS:"
  echo "  • Point a domain's DNS A record at this VPS and open ports 80 + 443."
  echo "  • Redeploy with an https:// URL, e.g. scripts/deploy.sh $VPS https://maps.example.com"
  echo "    — that turns on the built-in Caddy auto-TLS proxy and the Secure session cookie."
fi
echo "  The DB and API stay on loopback; only the front door is public."
