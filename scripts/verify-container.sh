#!/usr/bin/env sh
# Container verification for Passport Coolify artifact.
# POSIX shell — run via Git Bash or WSL on Windows.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.verify.yml"
IMAGE_TAG="passport:verify"
HEALTH_URL="${VERIFY_HEALTH_URL:-http://localhost:3000/api/health}"
MAX_WAIT="${VERIFY_MAX_WAIT:-90}"

cd "$ROOT_DIR"

cleanup() {
  echo "[verify-container] Tearing down compose stack..."
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "[verify-container] Building image $IMAGE_TAG..."
docker build -t "$IMAGE_TAG" .

echo "[verify-container] Starting Postgres..."
docker compose -f "$COMPOSE_FILE" up -d postgres

echo "[verify-container] Waiting for Postgres health..."
i=0
while [ "$i" -lt "$MAX_WAIT" ]; do
  if docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "(healthy)"; then
    echo "[verify-container] Postgres is healthy"
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$i" -ge "$MAX_WAIT" ]; then
  echo "[verify-container] Postgres failed to become healthy"
  exit 1
fi

echo "[verify-container] Starting app container..."
docker compose -f "$COMPOSE_FILE" up -d app

echo "[verify-container] Polling $HEALTH_URL ..."
i=0
while [ "$i" -lt "$MAX_WAIT" ]; do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[verify-container] Health check passed"
    break
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$i" -ge "$MAX_WAIT" ]; then
  echo "[verify-container] Health check timed out"
  docker compose -f "$COMPOSE_FILE" logs app || true
  exit 1
fi

echo "[verify-container] Running mock Stripe injector..."
export DATABASE_URL="${VERIFY_DATABASE_URL:-postgresql://passport:passport@localhost:5433/passport?schema=public}"
export STRIPE_WEBHOOK_SECRET="${VERIFY_STRIPE_WEBHOOK_SECRET:-whsec_verify_test_secret}"
export VERIFY_APP_URL="${VERIFY_APP_URL:-http://localhost:3000}"
export VERIFY_EVENT_ID="${VERIFY_EVENT_ID:-evt_verify_container_001}"

npx tsx "$ROOT_DIR/scripts/inject-mock-stripe-event.ts"

echo "[verify-container] Seeding gate receipts and verifying domain isolation..."
npx tsx "$ROOT_DIR/scripts/seed-gate-receipts.ts"

echo "[verify-container] All checks passed"
