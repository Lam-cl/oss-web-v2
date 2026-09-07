# Independent fulfilment loading

Order 12 was read-only verified as PAID/DELIVER with no courier/tracking assigned. Production couriers returned eight choices in about 1.3s; SIM assignments returned zero units after 21.5s, beyond the admin client's 20s deadline. The drawer previously awaited metadata, SIM, courier and catalogue together before populating any of them.

The drawer now settles each resource independently with section-specific loading/error/retry. Courier can load before SIM/catalogue. Saving courier requires ready metadata and courier data. SHIPPED requires completed SIM checking and complete assignments; existing server validation remains unchanged. Pickup still hides courier. No provider contract or shipping rate changes.

Load generations, resource request versions and abort-on-close/order-change ignore stale responses. User-edited courier, tracking and expected-date fields are preserved against delayed defaults. Order-level failures have a retry. Existing metadata still locks expected delivery date. SIM upstream latency itself remains outside this fix.

Regression coverage includes controlled pending/rejected requests, independent retries, metadata save guards, dirty input preservation, generation/version cancellation and shipping guards. A local-only built browser fixture intercepts all admin/catalogue calls and rejects writes; it simulates a 25s SIM response and checks the real 20s timeout, courier readiness, retry, metadata error and pickup. No real status/tracking changes or order creation are performed.

Baseline: 7357d8bdad5ee99848bdca4a759bbf8e5f207ebd. Release separately to main/Vercel with an additive baseline-tree rollback. Evidence: /root/.codex/backups/tonewow/20260907-courier-loading-PEv8ND/.

Pre-deploy verification passed: 62 relevant admin/fulfilment/SIM/order/checkout/shipping/payment regression checks across the run and one rerun after updating the expected-date fixture for new metadata readiness state; standalone TypeScript, Next production build, ten local read-only release smoke checks and the built browser fixture. Browser selectors account for option text in wrapping select labels. The browser observed usable courier choices during the actual 20s SIM timeout, successful isolated retry, guarded shipping/metadata actions, preserved edits and pickup without courier. No live order writes.
