#!/usr/bin/env sh
# Cross-language verification for Mastra (TS SDK) + LangGraph (Python SDK) adapters.
# POSIX shell — run via Git Bash on Windows.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
PYTHON_DIR="$ROOT_DIR/python"
COMPOSE_FILE="$ROOT_DIR/docker-compose.verify.yml"
HEALTH_URL="${PASSPORT_BASE_URL:-http://localhost:3000}/api/health"
MAX_WAIT="${VERIFY_MAX_WAIT:-90}"
STARTED_COMPOSE=0
VENV_DIR="$PYTHON_DIR/.venv"

cd "$ROOT_DIR"

cleanup() {
  if [ -d "$VENV_DIR" ]; then
    echo "[verify-framework] Removing Python venv..."
    rm -rf "$VENV_DIR"
  fi
  if [ "$STARTED_COMPOSE" -eq 1 ]; then
    echo "[verify-framework] Tearing down compose stack..."
    docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[verify-framework] Building SDK..."
npm --prefix "$ROOT_DIR/sdk" run build

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
  echo "[verify-framework] App already healthy at $HEALTH_URL"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "[verify-framework] Docker CLI not found and app not reachable at $HEALTH_URL"
    echo "[verify-framework] Skipping integration rig — package-level tests only"
    exit 0
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "[verify-framework] Docker daemon not running and app not reachable at $HEALTH_URL"
    echo "[verify-framework] Skipping integration rig — package-level tests only"
    exit 0
  fi

  echo "[verify-framework] Starting docker compose stack..."
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
      echo "[verify-framework] Building passport:verify image..."
      docker build -t passport:verify "$ROOT_DIR"
    fi
    docker compose -f "$COMPOSE_FILE" up -d app
  fi

  if ! wait_for_health; then
    echo "[verify-framework] Health check timed out at $HEALTH_URL"
    docker compose -f "$COMPOSE_FILE" logs app 2>/dev/null || true
    exit 1
  fi
  echo "[verify-framework] App healthy at $HEALTH_URL"
fi

export PASSPORT_BASE_URL="${PASSPORT_BASE_URL:-http://localhost:3000}"
export DATABASE_URL="${DATABASE_URL:-postgresql://passport:passport@localhost:5433/passport?schema=public}"
export SIGNING_PRIVATE_KEY="${SIGNING_PRIVATE_KEY:-000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f}"

echo "[verify-framework] Provisioning dev operator..."
PROVISION_JSON="$(npx tsx "$ROOT_DIR/scripts/provision-dev-operator.ts")"
export PASSPORT_API_KEY="$(printf '%s' "$PROVISION_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).apiKey)")"
export PASSPORT_OPERATOR_ID="$(printf '%s' "$PROVISION_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).operatorId)")"
export PASSPORT_OPERATOR_DB_ID="$(printf '%s' "$PROVISION_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).operatorDbId)")"

echo "[verify-framework] Operator: $PASSPORT_OPERATOR_ID"

echo "[verify-framework] Seeding clean domain history..."
npx tsx "$ROOT_DIR/scripts/seed-clean-domain.ts"

echo "[verify-framework] Creating Python venv (no pip install)..."
python3 -m venv "$VENV_DIR"

if [ -x "$VENV_DIR/bin/python" ]; then
  VENV_PYTHON="$VENV_DIR/bin/python"
elif [ -x "$VENV_DIR/Scripts/python.exe" ]; then
  VENV_PYTHON="$VENV_DIR/Scripts/python.exe"
else
  echo "[verify-framework] Could not locate venv python"
  exit 1
fi

echo "[verify-framework] Running Python e2e mock..."
(
  cd "$PYTHON_DIR"
  export PYTHONPATH="$PYTHON_DIR"
  "$VENV_PYTHON" scripts/e2e_langgraph_mock.py
)

echo "[verify-framework] Asserting persisted tranche..."
npx tsx "$ROOT_DIR/scripts/assert-framework-tranche.ts"

echo "[verify-framework] All framework adapter checks passed"
