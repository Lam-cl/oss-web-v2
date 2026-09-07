# Merchandise loading improvements

Based on production commit 666b96434630736b63f9129ccac460e4d9ccfb45. Payment configuration, API wire contracts, order creation and inventory mutation logic are unchanged.

Bundle and Catalogue reads now start concurrently. The home section no longer fetches the projection a second time. Only the home Merchandise tab opts into a browser-memory display cache (30 seconds fresh; five minutes maximum retained display). In-flight prefetch/consumer requests are shared. Prefetch runs on idle or tab intent; Save-Data disables idle prefetch. No localStorage or server cache is introduced.

Visible cached cards survive background refresh. Errors expose Retry and block Add to Cart. The click handler checks freshness again to cover expiry between timer ticks. Cart/checkout/default hook consumers still read fresh data and use the original server validation. Unmounted consumers cannot update React state or reconcile carts. Open product dialogs track refreshed product/choice identities.

Verification: 121 regression checks passed, zero failed, two historical/campaign exclusions. Production build including TypeScript passed. Local catalogue/admin/shipping/open-checkout smoke passed.

Controlled Chromium comparison of two local production builds used the same public fixtures and injected 400 ms Bundle / 800 ms Catalogue delays. First-card DOM appearance after the first request: baseline 3695 ms, candidate 1105 ms. Tab click to remounted cards: 1749 ms versus 145 ms. Total data requests for initial entry plus re-entry: six versus two. These are one-sample controlled measurements, not production latency guarantees. The earlier mixed production/local run included popup/automation delays and is not used as performance evidence.

Evidence: `/root/.codex/backups/tonewow/20260907-merch-loading-DssncF/browser-local-comparison.json`. Production automated reads began receiving Vercel 403 Security Checkpoint during verification; do not bypass that protection or interpret it as a tested application failure.

Separate reported checkout styling issue: production lacks the `.merch-checkout-promo`, `.merch-checkout-payment` and sidebar pay styling present in staging globals.css. All three production stylesheets loaded during the read-only browser inspection. That CSS issue predates this change and is not fixed by this performance commit.
