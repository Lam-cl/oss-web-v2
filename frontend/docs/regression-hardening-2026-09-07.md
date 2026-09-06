# Production regression hardening — 7 September 2026

This supersedes the unresolved-regression section of `production-launch-2026-09-07.md`.
Base of this task: `ffa52401`, clean `release/merchandise-launch-20260907` worktree.

## Result

- **118 passed, 0 failed** using `npm run test:production`.
- Two explicit non-applicable checks: historical live catalogue export and campaign-only Merdeka page.
  Neither is counted as passing. Campaign assertions are preserved under `scripts/campaign/` and must
  run from a campaign frontend containing the page, not from this production branch.
- Next production build, standalone TypeScript and read-only built-app HTTP smoke passed.
- Machine-readable full test results: `/root/.codex/backups/tonewow/20260907-regression-478eV5/results.json`.

## The 12 former failures

1. Courier: AST checks for live loading/stable IDs plus execution of actual save handler. Tests trimmed
   tracking code, numeric provider ID, request method/status, missing inputs, failure and busy-state reset.
2. Expected date: date input, disabled existing metadata, actual metadata payload, blank date and no overwrite.
3. Fulfilment: read-only customer identity, delivery fields, pickup-only billing, save action and safe payload.
4. SIM UI: current TWE/TWP choices for legacy unbound lines, SN range controls, existing range API/core tests.
5. Balam provider: current DOM behavior and actual launcher asset, not removed legacy watchdog files.
6. Catalogue adoption: module-relative TS resolver; completed publication job/snapshot and provider inventory
   fixtures now satisfy the current fail-closed evidence contract. No application guard was bypassed.
7. Catalogue unpublish: same resolver fix; existing provider identity, retirement and failure assertions retained.
8. Catalogue August check: deterministic provider fixture replaces requests asserting old live IDs/stock.
   Tests hidden/draft/fee exclusion, inventory and variant price preservation, hidden option values, media
   assignments and upstream error propagation. No network needed.
9. Merdeka campaign: moved intact to campaign-only suite; explicitly not applicable here.
10. Mobile cart/chat: current stylesheet and actual theme behavior instead of missing legacy CSS.
11. SIM Tone variants: executes authoritative product/variant behavior test instead of checking variable names.
12. Vouchers/payment methods: parses the real allowlist and evaluates valid/invalid IDs independently of
    quotation/formatting, with checks for offered methods and voucher mutation methods.

## Application defects found and fixed

- The code referenced `/images/balam-tonewow-chat.svg`, but it was absent from this branch. Added the exact
  existing staging SVG (no redesign or archive merge).
- Balam's shadow observer remained attached to the previous shadow root after provider host replacement.
  It now disconnects/rebinds to the new root. DOM fixtures cover replacement, rerender, idempotence and cleanup.
- Mobile floating cart still used the chat-side 16px offset. Restored 97px separation and a DOM-based referral
  hide rule for the merchandise catalogue without hiding Freshworks. Cart/checkout offsets and modal hiding
  are covered by the theme fixture. These are DOM unit tests, not a real provider browser certification.

## Verification boundary / next deployment

Loopback production build smoke passed: homepage/settings, merchandise visible, checkout unavailable on
both aliases with no-store, admin login redirect/unauthenticated API protection, remote catalogue/shipping,
and Balam SVG 200. No payment, order, stock, credentials or live service was mutated.

GitHub main remains the existing production baseline `bb18a9341c00b8c5a49d70e1dbe15080a89ec9c4`.
Only the release branch is intended for the next preview push. The existing preview inspected returned
302 to Vercel SSO. Check the newly generated deployment's GitHub status and HTTP accessibility after push.
Build success is not an authenticated preview smoke or verification of Production environment overrides.

The user has no Vercel dashboard access. GitHub auto-deploy remains the deployment mechanism; rollback can
be an additive revert of only the release commits to main, with another Vercel build (not instant rollback).
Record an exact rollback SHA/tree and check main has not advanced before using it. No force push.

No timer has been armed by this regression task. If preview remains protected, retain that outstanding
verification explicitly; do not set the existing release script's preview/env readiness gates to true.
Public checkout remains CLOSED for the 10:30 catalogue release. The backend switches to real GKash at
11:00; QA/public checkout opening requires backend origin confirmation and the user's real-payment test.
Without dashboard access, non-secret cutover configuration can be changed via reviewed Git commits,
but Vercel environment overrides, if present, still require the project owner.

All initial tracked files were clean and recoverable in Git. No existing live files were replaced, so
the backup directory contains test evidence, not a new production database/build backup.
