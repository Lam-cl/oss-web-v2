# Merchandise All tab display order

Requested by Syaza: Comix Shirt, BASICS Shirt, TWE SuperLITE SIM, TWE BIZ SIM, Baseball Cap, then the remaining merchandise in its existing order. Apply only to the All category in the public merchandise grid.

Pure display ordering uses stable catalogue IDs so title/slug edits and Bundle republication do not change priority. Current provider IDs cover the existing Bundle fallback feed. Sorting copies the array and retains product objects, prices, inventory, variant bindings, MOQ and availability. Missing/archived priority products are not reintroduced. Individual category tabs and shared catalogue/cart data remain unchanged.

Tests cover explicit priority, stable remainder, absent products, renamed/republished products, fallback IDs, immutable input and the actual category selector. Read-only built browser verification compares desktop/mobile All order and each category against the live adapted feed. No product/order data writes. Production deployment stays on existing GitHub main to Vercel, not Sites.

Baseline a7e0a2e0e9bbf1c5c76373d4a113b388137d930d; release separately with additive baseline-tree rollback. Evidence: /root/.codex/backups/tonewow/20260908-merchandise-order-MXxEdI/.

Pre-deploy results: all 30 targeted regression checks passed; production build including TypeScript passed; ten read-only local HTTP smoke checks passed. Built browser verified 11 products with the requested first five on desktop/mobile and unchanged per-category order. Browser closes the existing SKMM notice normally before navigating category tabs. No writes.
