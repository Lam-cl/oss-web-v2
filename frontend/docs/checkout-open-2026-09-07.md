# Production checkout activation — 7 September 2026

User confirmed the backend production cutover and explicitly authorized an unpaid checkout probe. A single POST to the same Bundle `/api/products/checkout` endpoint returned HTTP 201, order 247 and payment origin `https://api.gkash.my`. No gateway form or payment was submitted. QA order 247 must not be fulfilled. Product 144 / variant 465 stock was 78 before creation and 77 afterwards; this is not evidence of a completed-payment or cancellation lifecycle test.

Enable production checkout with that exact origin; keep strict redirect validation, total validation and stock checks intact. No API contract changes. The prior closed configuration remains recoverable at commit b77ecdff22e1078bf1316f8d6c68886b435f16d1. Rollback must be additive and must preserve later developer commits.

Run production regressions, TypeScript/build, then push the reviewed change to main. Verify Vercel success, public availability `enabled: true`, catalogue/admin read-only smoke with `--open`, and the Balam widget. Actual payment settlement and cancellation/restock remain separate QA, not established by this probe.

Private request/response and before/after stock evidence: `/root/.codex/backups/tonewow/20260907-checkout-open-NO6Fka/`. Tokens are not included in this document.

Verification: production suite initially reported 119 passed and one media-store timeout at its 60-second limit while the production build ran concurrently. The unchanged media-store test passed when rerun without the build; all 120 checks therefore passed across these runs (two historical/campaign exclusions remain). Next production build, its TypeScript check, and local read-only open-checkout/catalogue/admin/shipping smoke passed. No test timeout or assertion was weakened.
