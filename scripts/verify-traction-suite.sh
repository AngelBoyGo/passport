#!/usr/bin/env sh
# Closed-loop verification for passport/sdk + passport/mcp traction suite.
# POSIX shell — run via Git Bash or WSL on Windows.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.verify.yml"
HEALTH_URL="${PASSPORT_BASE_URL:-http://localhost:3000}/api/health"
MAX_WAIT="${VERIFY_MAX_WAIT:-90}"
STARTED_COMPOSE=0

cd "$ROOT_DIR"

cleanup() {
  if [ "$STARTED_COMPOSE" -eq 1 ]; then
    echo "[verify-traction] Tearing down compose stack..."
    docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[verify-traction] Building SDK..."
npm --prefix "$ROOT_DIR/sdk" run build

echo "[verify-traction] Installing and building MCP..."
npm --prefix "$ROOT_DIR/mcp" install
npm --prefix "$ROOT_DIR/mcp" run build

wait_for_health() {
  i=0
  while [ "$i" -lt "$MAX_WAIT" ]; do
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  echo "[verify-traction] App already healthy at $HEALTH_URL"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "[verify-traction] Docker CLI not found and app not reachable at $HEALTH_URL"
    echo "[verify-traction] Skipping integration rig — package-level tests only"
    exit 0
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "[verify-traction] Docker daemon not running and app not reachable at $HEALTH_URL"
    echo "[verify-traction] Skipping integration rig — package-level tests only"
    exit 0
  fi

  echo "[verify-traction] Starting docker compose stack..."
  STARTED_COMPOSE=1

  if ! docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "(healthy)"; then
    docker compose -f "$COMPOSE_FILE" up -d postgres
    i=0
    while [ "$i" -lt "$MAX_WAIT" ]; do
      if docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "(healthy)"; then
        break
      fi
      i=$((i + 1))
      sleep 2
    done
  fi

  if ! docker compose -f "$COMPOSE_FILE" ps app 2>/dev/null | grep -q "Up"; then
    if ! docker image inspect passport:verify >/dev/null 2>&1; then
      echo "[verify-traction] Building passport:verify image..."
      docker build -t passport:verify "$ROOT_DIR"
    fi
    docker compose -f "$COMPOSE_FILE" up -d app
  fi

  if ! wait_for_health; then
    echo "[verify-traction] Health check timed out at $HEALTH_URL"
    docker compose -f "$COMPOSE_FILE" logs app 2>/dev/null || true
    exit 1
  fi
  echo "[verify-traction] App healthy at $HEALTH_URL"
fi

export PASSPORT_BASE_URL="${PASSPORT_BASE_URL:-http://localhost:3000}"
export DATABASE_URL="${DATABASE_URL:-postgresql://passport:passport@localhost:5433/passport?schema=public}"
export SIGNING_PRIVATE_KEY="${SIGNING_PRIVATE_KEY:-000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f}"

echo "[verify-traction] Provisioning dev operator..."
PROVISION_JSON="$(npx tsx "$ROOT_DIR/scripts/provision-dev-operator.ts")"
export PASSPORT_API_KEY="$(printf '%s' "$PROVISION_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).apiKey)")"
export PASSPORT_OPERATOR_ID="$(printf '%s' "$PROVISION_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).operatorId)")"
export PASSPORT_OPERATOR_DB_ID="$(printf '%s' "$PROVISION_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).operatorDbId)")"

echo "[verify-traction] Operator: $PASSPORT_OPERATOR_ID"
echo "[verify-traction] Running traction harness..."

npx tsx "$ROOT_DIR/scripts/traction-harness.ts"

echo "[verify-traction] All traction checks passed"
