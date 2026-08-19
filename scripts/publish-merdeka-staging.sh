#!/usr/bin/env bash
set -euo pipefail

LIVE_DIR="${LIVE_DIR:-/www/wwwroot/tonewow.xifuhalim.com}"
WORKTREE_DIR="${WORKTREE_DIR:-/www/wwwroot/.worktrees/tonewow-merdeka-promo}"
BRANCH="staging/merdeka-promo"
MESSAGE="${1:-Update Merdeka Promo staging}"

PROMO_PATHS=(
  "public/images/merdeka-promo"
  "src/app/api/merdeka-promo"
  "src/app/merdeka-promo-api"
  "src/app/merdeka-promo"
  "src/lib/merdekaPromo.ts"
)

git -C "$LIVE_DIR" rev-parse --git-dir >/dev/null 2>&1 || { echo "Missing live repository: $LIVE_DIR" >&2; exit 1; }
git -C "$WORKTREE_DIR" rev-parse --git-dir >/dev/null 2>&1 || { echo "Missing promo worktree: $WORKTREE_DIR" >&2; exit 1; }

if [[ -n "$(git -C "$WORKTREE_DIR" status --porcelain)" ]]; then
  echo "Promo worktree has uncommitted changes; publish or resolve them first" >&2
  exit 1
fi

git -C "$WORKTREE_DIR" pull --ff-only origin "$BRANCH"

for path in "${PROMO_PATHS[@]}"; do
  rm -rf -- "$WORKTREE_DIR/$path"
  if [[ -e "$LIVE_DIR/$path" ]]; then
    mkdir -p "$(dirname "$WORKTREE_DIR/$path")"
    cp -a -- "$LIVE_DIR/$path" "$WORKTREE_DIR/$path"
  fi
done

git -C "$WORKTREE_DIR" add -A -- "${PROMO_PATHS[@]}"
git -C "$WORKTREE_DIR" diff --cached --check

if git -C "$WORKTREE_DIR" diff --cached --quiet; then
  echo "No Merdeka Promo changes to publish"
  exit 0
fi

git -C "$WORKTREE_DIR" commit -m "$MESSAGE"
git -C "$WORKTREE_DIR" push origin "$BRANCH"
