#!/usr/bin/env bash
set -euo pipefail
env_file=${TONEWOW_OSS_ENV_FILE:-/www/wwwroot/.worktrees/tonewow-balam-no-welcome-20260930/frontend/.env.production}
token=$(sed -n 's/^TONEWOW_DATA_API_TOKEN=//p' "$env_file" | tail -1 | tr -d '\r')
test -n "$token"
secret=$(printf 'tonewow-oss-journey:%s' "$token" | sha256sum | cut -d' ' -f1)
curl --fail --silent --show-error --max-time 55 --header "Authorization: Bearer $secret" 'https://shop.tonewow.com/api/cron/oss-journey'
