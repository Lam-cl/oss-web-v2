# Merchandise round 2 — 2026-09-06

## Checkout fix
An empty state was classified as Peninsular Malaysia by the shipping calculator. The UI labelled a total containing that estimated shipping fee as "Total before shipping". For the reported RM20 cart, that produced RM30.

The final total is now absent until shipping is resolved, on the desktop sidebar, mobile sheet and mobile payment bar. Merchandise subtotal remains visible. Pickup uses RM0 shipping. Unresolved totals cannot be submitted. Shipping errors retain an explicit explanation.

## Stock investigation — unresolved
Read-only Bundle order/product API audit:
- Order 220: DELIVER, PAID, transaction 215 COMPLETED; product 138 / variant 452, quantity 30.
- Order 221: DELIVER, CANCELLED, transaction 216 FAILED; product 138 / variant 452, quantity 2; delivery-fee product 41 / variant 108, quantity 2.
- Order 222: DELIVER, CANCELLED, transaction 217 FAILED; same item identities and quantities as 221.
- inventoryDeductedAt and inventoryRestockedAt are null for all three orders, including the successful order.
- Variant 452 stock readback: 9970, updated 2026-09-05T19:56:22.267Z. Tester screenshot: 9968. Tester text: initial 1000. These are separate observations, not a proven order-specific before/after delta.
- Product 41 tracksInventory=false. Its line quantity represents RM10 shipping units, not SIM stock.
- No customer orders, inventory, payment status or callbacks were mutated during this audit.

The website reads inventory from Bundle with no-store requests. Payment failure display does not itself restore stock. The Bundle implementation and inventory ledger for its payment callbacks are not in the local OSS backend; that backend delegates to Bundle. Public OpenAPI lists signed GKash callbacks but no documented failure-injection test endpoint.

## Required Bundle evidence / test support
Please trace order 221 / transaction 216 and order 222 / transaction 217 against variant 452: exact deduction and release amounts, timestamps, callback/return handling, and any subsequent manual correction. Explain why both stock markers are null on these orders and successful order 220.

Provide a supported GKash sandbox workflow usable without GUI to generate signed FAILED and COMPLETED events for isolated fixtures. Never replay a captured real callback, forge a success/failure signature or substitute manual order cancellation for the failed-payment test.

Acceptance: failed/cancelled payment leaves no net deduction; successful payment deducts exactly once; duplicate/reordered notifications do not double-deduct or double-release; completion works when the customer closes the browser. Inventory mutation and its marker must be atomic in Bundle.

## Outstanding end-to-end matrix
For each SIM and ordinary merchandise fixture, run DELIVER and PICKUP independently:
1. Back up the isolated fixture and record stock immediately before checkout.
2. Record stock after order creation.
3. Resolve the payment through the supported sandbox flow.
4. Record transaction/order states and authoritative stock after resolution.
5. Repeat notification/reconciliation checks with gateway-supported tooling.

All four stock cases remain NOT RUN pending a supported gateway test flow. Mock tests and historical order reads do not count as end-to-end stock verification. Do not mark the stock issue fixed or manually credit old orders without ledger evidence.

## Rollout
Checkout total readiness, shipping presentation, live shipping settings and pickup regression checks pass. Production-worktree payment polling and return bridge checks pass. Staging's older payment scripts still assert the old component syntax (params.get and reason-based processing); they fail on existing source that uses searchParams and an explicit processing prop. Payment implementation was not changed in this patch.

Checkout-only changes go to staging then production main after tests/build. Production merchandise remains Coming Soon. Staging source/build rollback backup: /root/.codex/backups/tonewow/20260906-round2/.
