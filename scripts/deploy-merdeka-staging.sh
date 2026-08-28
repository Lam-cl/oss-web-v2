#!/usr/bin/env bash
set -euo pipefail

LIVE_DIR="${1:-/www/wwwroot/tonewow.xifuhalim.com}"
GIT_REF="${2:-origin/staging/merdeka-promo}"
EXPECTED_SHA="${3:-}"
PM2_APP="${PM2_APP:-tonewow}"
APP_URL="${APP_URL:-http://127.0.0.1:3002/merdeka-promo}"

PROMO_PATHS=(
  "public/images/merdeka-promo"
  "src/app/api/confirmation/route.ts"
  "src/app/api/merdeka-promo"
  "src/app/merdeka-promo-api"
  "src/app/merdeka-promo"
  "src/lib/merdekaPromo.ts"
)

test -d "$LIVE_DIR/.git" || { echo "Live directory is not a Git repository: $LIVE_DIR" >&2; exit 1; }
test -d "$LIVE_DIR/node_modules" || { echo "Missing node_modules in $LIVE_DIR" >&2; exit 1; }

ACTUAL_SHA="$(git -C "$LIVE_DIR" rev-parse "$GIT_REF^{commit}")"
if [[ -n "$EXPECTED_SHA" && "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Fetched SHA $ACTUAL_SHA does not match requested SHA $EXPECTED_SHA" >&2
  exit 1
fi

LOCK_FILE="$LIVE_DIR/.merdeka-promo-deploy.lock"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another Merdeka Promo deployment is running" >&2; exit 1; }

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ROLLBACK_DIR="$LIVE_DIR/.rollback/merdeka-promo/$TIMESTAMP-$ACTUAL_SHA"
TEMP_DIR="$(mktemp -d /www/wwwroot/.merdeka-promo-deploy.XXXXXX)"
SOURCE_DIR="$TEMP_DIR/source"
CANDIDATE_DIR="$TEMP_DIR/candidate"
DEPLOY_STARTED=0
OLD_NEXT=""

cleanup() {
  rm -rf -- "$TEMP_DIR"
}

restore_path() {
  local relative_path="$1"
  rm -rf -- "$LIVE_DIR/$relative_path"
  if [[ -e "$ROLLBACK_DIR/$relative_path" ]]; then
    mkdir -p "$(dirname "$LIVE_DIR/$relative_path")"
    cp -a -- "$ROLLBACK_DIR/$relative_path" "$LIVE_DIR/$relative_path"
  fi
}

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ "$DEPLOY_STARTED" -eq 1 ]]; then
    echo "Deployment failed; restoring $ROLLBACK_DIR" >&2
    for path in "${PROMO_PATHS[@]}"; do
      restore_path "$path"
    done
    rm -rf -- "$LIVE_DIR/.next"
    if [[ -n "$OLD_NEXT" && -d "$OLD_NEXT" ]]; then
      mv -- "$OLD_NEXT" "$LIVE_DIR/.next"
    fi
    pm2 restart "$PM2_APP" >/dev/null 2>&1 || true
  fi
  cleanup
  exit "$exit_code"
}

trap rollback ERR
trap cleanup EXIT

mkdir -p "$SOURCE_DIR" "$CANDIDATE_DIR" "$ROLLBACK_DIR"
git -C "$LIVE_DIR" archive "$GIT_REF" -- "${PROMO_PATHS[@]}" | tar -x -C "$SOURCE_DIR"

rsync -a \
  --exclude='.git/' \
  --exclude='.next/' \
  --exclude='node_modules/' \
  --exclude='.data/' \
  --exclude='.rollback/' \
  --exclude='.token-store/' \
  "$LIVE_DIR/" "$CANDIDATE_DIR/"

for path in "${PROMO_PATHS[@]}"; do
  rm -rf -- "$CANDIDATE_DIR/$path"
done
cp -a -- "$SOURCE_DIR/." "$CANDIDATE_DIR/"
ln -s "$LIVE_DIR/node_modules" "$CANDIDATE_DIR/node_modules"

echo "Building candidate $ACTUAL_SHA"
(cd "$CANDIDATE_DIR" && npm run build)

for path in "${PROMO_PATHS[@]}"; do
  if [[ -e "$LIVE_DIR/$path" ]]; then
    mkdir -p "$(dirname "$ROLLBACK_DIR/$path")"
    cp -a -- "$LIVE_DIR/$path" "$ROLLBACK_DIR/$path"
  fi
done

DEPLOY_STARTED=1
for path in "${PROMO_PATHS[@]}"; do
  rm -rf -- "$LIVE_DIR/$path"
done
cp -a -- "$SOURCE_DIR/." "$LIVE_DIR/"

if [[ -d "$LIVE_DIR/.next" ]]; then
  OLD_NEXT="$ROLLBACK_DIR/.next"
  mv -- "$LIVE_DIR/.next" "$OLD_NEXT"
fi
mv -- "$CANDIDATE_DIR/.next" "$LIVE_DIR/.next"

pm2 restart "$PM2_APP"

for attempt in $(seq 1 15); do
  if curl --fail --silent --show-error --max-time 10 "$APP_URL" >/dev/null; then
    echo "Merdeka Promo deployed successfully: $ACTUAL_SHA"
    DEPLOY_STARTED=0
    trap - ERR
    exit 0
  fi
  sleep 2
done

echo "Smoke test failed: $APP_URL" >&2
false
