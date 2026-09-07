# Vercel checkout metadata fix

Root cause: order metadata required ENABLE_LOCAL_ORDER_METADATA before checking the configured remote adapter. Production had the remote adapter but not the local flag. The checkout route created the Bundle order before the failing metadata write.

Remote metadata now works independently of the local flag. Vercel must use remote storage and can never fall back to filesystem storage. Billing address and payment reference are saved in one existing remote CAS mutation, preserving other order metadata.

Checkout reads/validates metadata storage before order creation. Readiness failure returns 503 / ORDER_METADATA_UNAVAILABLE with no order created by that attempt. This read-only preflight is not a guarantee of subsequent write success. If saving fails after order creation, the route returns 502 / ORDER_METADATA_SAVE_FAILED and orderId, without returning payment parameters or raw storage errors. The client preserves those fields, displays the order-specific support instruction, and blocks another submission on that mounted page. It is not durable server-side checkout idempotency and does not claim to prevent retries after reload or from another browser.

Verification includes the real website checkout handler with mocked Bundle and remote storage: successful JSON checkout through metadata persistence and return URL generation; missing/unreachable/corrupt preflight produces zero order POSTs; post-create write failure creates exactly one order and preserves existing metadata. Actual submit-handler testing verifies the second submission is blocked. Real configured remote storage passed a read-only preflight with the local flag unset and Vercel mode enabled. No live order, payment or metadata mutation was performed by these tests.

Deploy as a separate commit based on 96a80cdbd4b17b444d436ae7f981157e9ed94172. Existing CSS/loading/GKash settings remain unchanged. Before any rollback to the known-broken baseline, pause checkout to avoid recreating the original post-order failure. Historical failed orders require separate read-only identification before any cancellation/restock action; do not automatically retry or alter them.

Evidence directory: /root/.codex/backups/tonewow/20260907-metadata-fix-EZe0h2/.

Verification completed before push: 123 regression checks passed across the suite and targeted reruns. Two catalogue checks exceeded the suite timeout and passed unchanged when rerun individually; the shipping presentation fixture was updated to include the new blocked-order state and passed. Next production build, including TypeScript validation, passed. The built checkout browser test passed for desktop/mobile failure recovery with exactly one intercepted/mock POST and no upstream order creation. All ten read-only local release smoke checks passed with checkout open. Production availability was also confirmed enabled before deployment.
