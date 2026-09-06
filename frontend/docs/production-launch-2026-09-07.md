# Admin and merchandise release — 7 September 2026

## Status: prepared locally, NOT deployed or scheduled

Update: the 12 regression findings below have been addressed/classified. See
`regression-hardening-2026-09-07.md` for the 118-pass result and discovered application fixes.
The user has no Vercel access; use GitHub auto-deploy and an additive Git rollback rather than
requiring dashboard access. Protected preview smoke/environment overrides remain explicitly unverified.

Target repository: `Lam-cl/oss-web-v2`, production branch `main`.
Release branch: `release/merchandise-launch-20260907`.
Baseline: `bb18a9341c00b8c5a49d70e1dbe15080a89ec9c4` (remote main verified before preparation).
GitHub's last successful Production deployment inspected: `6286415084`, same baseline SHA,
`https://oss-web-v2-9mtb2b0r1-tonewow.vercel.app`. This is a recorded rollback candidate,
NOT proof that this session can promote/roll back deployments in Vercel.

The user selected push at **10:30 MYT / 02:30 UTC**, 7 September, with an 11:00 target.
The backend team will only switch Bundle checkout to real GKash at **11:00 MYT**.
Therefore 10:30 is a catalogue/admin deployment with public merchandise checkout CLOSED.
An 11:00 backend switch cannot also guarantee an already verified live payment at 11:00.
The real-payment tester is the user's team, not an automated real-money payment by this agent.

## Implemented

- Production catalogue build flag is true. `/api/settings` derives `showMerchandise` from this flag.
- Server-side checkout gate executes before body processing, Bundle order creation, or stock mutation.
- `GET /bundle/checkout` and `GET /api/bundle/checkout` expose only `{enabled,message}`, private/no-store.
- Closed POST returns 503 with `MERCHANDISE_CHECKOUT_PAUSED`; both POST aliases use the same gate.
- Checkout UI starts disabled, refreshes availability every 30 seconds/on focus, retains the cart,
  displays an English explanation, and disables desktop/mobile payment controls when unavailable.
- Exact configured HTTPS origin validation replaces the staging-only payment-host check.
  Payment signatures/parameters, totals, shipping, callback/return handling and ADX token flow are unchanged.
- TypeScript excludes backup, test-report, snapshot and local data directories from source discovery.
- Fail-closed pinned-SHA release script and readiness tests are provided. The script does not install a timer.

## Vercel configuration / cutover

Production project root must be `frontend`, with the existing Next.js build and server routes.
Verify actual project configuration and Production overrides before pushing; Vercel variables override `.env.production`.
Use existing server-side data API/session credentials. Do not copy secrets, backup files, `.data`,
node_modules or local PM2 configuration into the release. Persistent data/media remain in the existing
`https://tonewow.xifuhalim.com/bundleapi` service, not Vercel's filesystem.

| Variable | 10:30 release | After backend switch confirmed | After tester payment/stock verified |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_ENABLE_MERCHANDISE` | `true` | `true` | `true` |
| `GKASH_ENVIRONMENT` | `production` | `production` | `production` |
| `GKASH_PRODUCTION_PAYMENT_ORIGIN` | unset or confirmed exact origin | exact HTTPS origin confirmed by backend | same |
| `MERCHANDISE_CHECKOUT_MODE` | `closed` | `qa` | `open` |

Environment updates require a **new Vercel deployment**; they are not an instant runtime toggle.
`qa` accepts only a verified ADMIN/STAFF session, using the existing session validator, never the
navigation gate cookie, query parameter, clock, or user-supplied checkout fields.
Keep `closed` until the backend confirms the new origin and real gateway mode. An origin mismatch
is rejected, but Bundle may already have created that order: do not blindly retry or auto-credit stock.
Missing/invalid gateway settings or invalid checkout mode fail closed. Explicit staging configuration
works only outside `VERCEL_ENV=production`; do not copy production release env settings into staging.

## Verification performed

- `npm ci --ignore-scripts --no-audit --no-fund`: completed; Node 24.18.1, Next 14.2.35.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run build`: passed, including Next type checking and 57 static pages.
- `git diff --check`: passed before commit.
- New policy tests: closed/QA/open, missing and invalid config, production rejecting sandbox,
  exact origin / lookalike / credentials / protocol / port checks, verified-session QA, closed POST
  making zero upstream calls and reading no checkout body, no-store GET and origin validation: passed.
- Release readiness tests: pinned SHA format, required readiness gates, approved time window,
  expired/missing evidence, mandatory closed checkout: passed. No real push executed in these tests.
- Suite: initially 104/118 scripts passed. Two release-affected fixtures were updated and rerun successfully
  (SIM checkout module imports and shipping payment-button behavior). With the new release-script test,
  107/119 checks passed, with the 12 baseline failures below remaining unresolved.
- Historical live-export script excluded: it writes a report and asserts the 23 August catalogue IDs;
  it is not a regression fixture for the current catalogue.
- Built app served temporarily on loopback port 3267. HTTP smoke: homepage/checkout/settings 200,
  `showMerchandise=true`, checkout availability false on both aliases, unauthenticated admin navigation
  redirects to login, admin catalogue API 401, merchandise/catalogue/shipping GET 200, both checkout POSTs 503.
- Public catalogue returned 11 products; a catalogue media proxy returned 200 `image/png` (2,624,847 bytes).
- No customer orders or inventory mutated. No new real or sandbox payment performed in this release task.

### Baseline failures (reproduced on unchanged bb18a934 source)

- `check-admin-courier-dropdown`: old source-string assertion for courier loading.
- `check-admin-expected-delivery-date`: old local state assertion.
- `check-admin-fulfilment-fields`: old NRIC presentation assertion.
- `check-admin-sim-ui`: old TWE/TWP selection assertion.
- `check-balam-provider`, `check-mobile-cart-chat`: missing legacy Balam asset paths on this branch.
- `check-catalogue-adoption-integration`, `check-catalogue-unpublish`: test harness cannot resolve
  `./catalogueVariantBindings` (the application itself builds).
- `check-merchandise-catalog-19-aug`: historical product ID 23 is absent from the current catalogue.
- `check-merdeka-promo-19-aug`: Merdeka page is not on this production branch.
- `check-sim-tone-variants`: old internal variable-name assertion for checkout variant validation.
- `check-voucher-and-payment-methods`: quotation-sensitive payment allowlist assertion.

These are not counted as passing. Classify/repair these fixtures and rerun the release suite before marking
the all-tests readiness gate true; do not disable assertions merely to arm the release.

## Outstanding gates and scheduler handoff

1. Obtain Vercel project management access securely. No local Vercel CLI credential/token was found.
   Verify production branch/root/env, preview smoke and the rollback mechanism before scheduling anything.
2. Finish baseline test hardening; verify authenticated admin/Turnstile on Vercel preview. Local build
   success and unauthenticated HTTP smoke do not establish deployment compatibility or login success.
3. Re-test the backend's reported restock fix with isolated fixtures and retained before/after evidence.
   Include cancelled/failed and paid orders for SIM/ordinary merchandise and delivery/pickup. Supported
   repeated notification/reconciliation checks must not double-credit. Do not forge payment callbacks.
4. After 11:00, backend confirms real gateway origin; deploy QA mode, have the user's authenticated
   tester complete real payment, verify amount/shipping/return/status/stock, then deploy open mode.
   Otherwise retain catalogue live with checkout closed. No automatic time-based enabling.

`at` is installed and `atd` was active; no job was installed. Once all pre-push gates are verified,
store a protected readiness manifest and wrapper/log outside Git under
`/root/.codex/backups/tonewow/<timestamp>/`. The wrapper must use the absolute Node executable,
`cd` to this clean worktree's `frontend`, and invoke `scripts/merchandise-release.cjs --execute`
with the absolute manifest path. Install exactly once for `TZ=Asia/Kuala_Lumpur`, `202609071030`.
The script rejects execution before 10:30 or at/after 11:00, unreviewed worktree changes, changed main,
and missing readiness. It pushes only the pinned commit, without force or merge. Inspect `atq` and
record the job ID; do not claim scheduling on the basis of this document.

Manifest fields are documented by `scripts/check-merchandise-release.cjs`; its sample SHA/domain values
are unit fixtures, not release evidence. Set gates only from actual verification tied to the release SHA.
Monitor the resulting Vercel deployment and production HTTP smoke separately; a successful Git push
is not deployment success. Roll back through verified Vercel access to the recorded deployment on a
failed post-deploy smoke; a build failure must leave the previous deployment live.

No live source/config was replaced, and no pre-existing user changes were included. Existing edited
tracked files are recoverable from the baseline Git SHA; no external live backup was needed yet.
