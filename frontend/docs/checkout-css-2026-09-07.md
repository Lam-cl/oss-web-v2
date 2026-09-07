# Restore checkout stylesheet parity

User approved fixing and deploying this alongside the merchandise-loading commit, with tester-assisted production verification if Vercel Security Checkpoint still blocks automated checks.

The production checkout used promo/payment/sidebar-pay class names without the corresponding rules present in staging. Restore only those scoped rules into merchandise-parity.css; do not merge the whole staging stylesheet. Payment API, amount calculations, credentials, orders and stock are unchanged.

Verification includes computed-style tests for desktop payment cards, promo inputs/buttons, disabled states and mobile summary, plus the built checkout page with an isolated browser-local cart. Browser verification explicitly blocks checkout POSTs and never submits payment. Keep this separate from the preceding performance commit so the styling change can be reverted independently.

Deployment baseline: 666b96434630736b63f9129ccac460e4d9ccfb45 (checkout remains open). Preserve any later developer main changes and use only additive rollback if necessary. Prior evidence and screenshots: /root/.codex/backups/tonewow/20260907-merch-loading-DssncF/.

Completed before push: new computed-style regression, existing mobile-summary and voucher/payment-method checks, production build with TypeScript, actual built checkout desktop/mobile browser verification and local open-checkout/catalogue/admin/shipping smoke. Screenshots checkout-desktop-fixed.png and checkout-mobile-fixed.png were inspected. No order was submitted. The preceding performance commit separately passed its full 121-check regression suite.
