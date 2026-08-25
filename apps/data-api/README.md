# ToneWow Data API

Persistent control plane for the ToneWow storefront and admin panel. PostgreSQL stores versioned state and publication evidence; MinIO stores verified media. Bundle remains the commerce/provider authority.

## Safety model

- The service binds to `127.0.0.1` and is exposed only through an HTTPS reverse proxy.
- All `/v1/state` and `/v1/media` routes require a 32-byte service bearer token.
- Document updates require an exact expected revision.
- Media uploads require a caller-supplied SHA-256 that is verified before storage.
- `.data` import is dry-run unless `--commit` is present and is idempotent by source path and hash.

## Commands

```bash
npm run build:data-api
TONEWOW_DATA_DIR=/absolute/path/.data npm run migrate:data-api
TONEWOW_DATA_DIR=/absolute/path/.data npm run migrate:data-api -- -- --commit
```

Run `migrations/001_initial.sql`, provision private `tonewow-draft` and published `tonewow-published` MinIO buckets, then configure the variables in `.env.example`. Do not use the legacy `/opt/tonewow-shop-api` database fallback credentials.

The web remains on filesystem storage unless both `TONEWOW_DATA_API_URL` and `TONEWOW_DATA_API_TOKEN` are set. This is the rollback switch for dual-read and cutover. The staging HTTPS base URL is `https://tonewow.xifuhalim.com/bundleapi`; this ToneWow-owned service supplements Bundle API evidence and storage, while the upstream Bundle API remains the commerce authority.
