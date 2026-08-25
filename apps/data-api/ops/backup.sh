#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${MINIO_ALIAS:?MINIO_ALIAS is required}"
: "${MINIO_DRAFT_BUCKET:=tonewow-draft}"
: "${MINIO_PUBLIC_BUCKET:=tonewow-published}"
: "${BACKUP_ROOT:=/var/backups/tonewow-data}"
: "${BACKUP_GPG_RECIPIENT:?BACKUP_GPG_RECIPIENT is required}"
: "${OFFSITE_MC_TARGET:?OFFSITE_MC_TARGET is required}"
case "$BACKUP_ROOT" in /var/backups/tonewow-data|/root/.codex/backups/tonewow-data) ;; *) echo "Unsafe BACKUP_ROOT" >&2; exit 2;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d "$BACKUP_ROOT/.working-$stamp-XXXXXX")"
archive="$BACKUP_ROOT/tonewow-data-$stamp.tar.gz.gpg"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/minio"
pg_dump "$DATABASE_URL" --format=custom --file="$work/postgres.dump"
mc mirror --overwrite "$MINIO_ALIAS/$MINIO_DRAFT_BUCKET" "$work/minio/$MINIO_DRAFT_BUCKET"
mc mirror --overwrite "$MINIO_ALIAS/$MINIO_PUBLIC_BUCKET" "$work/minio/$MINIO_PUBLIC_BUCKET"
tar -C "$work" -czf - postgres.dump minio | gpg --batch --yes --trust-model always --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$archive"
sha256sum "$archive" > "$archive.sha256"
mc cp "$archive" "$archive.sha256" "$OFFSITE_MC_TARGET/"
gpg --batch --decrypt "$archive" | tar -tzf - >/dev/null
echo "$archive"
