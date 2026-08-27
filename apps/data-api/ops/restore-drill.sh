#!/usr/bin/env bash
set -euo pipefail
: "${ALLOW_TONEWOW_RESTORE_DRILL:?Set ALLOW_TONEWOW_RESTORE_DRILL=yes}"
[[ "$ALLOW_TONEWOW_RESTORE_DRILL" == "yes" ]] || { echo "Restore drill not authorized" >&2; exit 2; }
: "${RESTORE_ARCHIVE:?RESTORE_ARCHIVE is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must target an empty drill database}"
: "${RESTORE_MINIO_ALIAS:?RESTORE_MINIO_ALIAS must target drill storage}"
: "${MINIO_DRAFT_BUCKET:=tonewow-draft}"
: "${MINIO_PUBLIC_BUCKET:=tonewow-published}"
sha256sum --check "$RESTORE_ARCHIVE.sha256"
work="$(mktemp -d /tmp/tonewow-restore-drill-XXXXXX)"
trap 'rm -rf -- "$work"' EXIT
gpg --batch --decrypt "$RESTORE_ARCHIVE" | tar -xzf - -C "$work"
pg_restore --exit-on-error --clean --if-exists --no-owner --dbname="$RESTORE_DATABASE_URL" "$work/postgres.dump"
mc mirror --overwrite "$work/minio/$MINIO_DRAFT_BUCKET" "$RESTORE_MINIO_ALIAS/$MINIO_DRAFT_BUCKET"
mc mirror --overwrite "$work/minio/$MINIO_PUBLIC_BUCKET" "$RESTORE_MINIO_ALIAS/$MINIO_PUBLIC_BUCKET"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT namespace,count(*) FROM catalogue_documents GROUP BY namespace ORDER BY namespace;"
echo "Restore drill completed."
