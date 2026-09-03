# Merchandise tester feedback triage — 3 September 2026

Target: `tonewow.xifuhalim.com`

## Decisions

- Stock is counted in sellable bundles. Buying one Flyers bundle decrements inventory by one.
- 3-Fold Flyers contains 20 pieces per bundle.
- Stock-only saves are live immediately and do not create a publication change.
- Collection-date edits must be reflected in both admin and the Ready for Collection email.

## Findings and resolution

1. **Publish changes after stock save:** expected behaviour, clarified with a stock-specific success message. Content/media changes still become dirty and require publication.
2. **Flyers pack label:** storefront enrichment depended on an exact legacy title or slug. The label is now derived from the published Product details line `Pack size: 20 pcs`.
3. **One purchase deducted one:** confirmed correct because provider inventory represents bundles, not individual flyer sheets.
4. **Pickup collection date:** website support is capability-gated pending the Bundle API contract below.
5. **SIM timeout:** the validator tried ten suffixes sequentially and then unrelated prefix IDs. Validation now uses only the selected prefix, bounded concurrency, per-call timeout and an overall deadline.
6. **Variant binding:** inventory save now preflights authoritative stock and resolves a variant by its exact option tuple. A genuine concurrent sale still blocks overwrite.

## Bundle API handoff

Please extend `PATCH /api/orders/{id}` with optional `collectionDate` and `expectedCollectionDate` fields in `YYYY-MM-DD` format. Only `PICKUP` orders may update the date, and a stale `expectedCollectionDate` must return `409`. `GET /api/orders/{id}` must return the effective `collectionDate`. `POST /api/orders/{id}/resend-ready-email` must use it in Collection Date/Time, with the legacy `Self Pick Up | Collection date: YYYY-MM-DD` address marker as fallback for existing orders. Record the old/new date and admin actor in the audit log, update OpenAPI, and deploy to staging first. The change must not alter payment status, order status or inventory.

Website feature flags after the Bundle staging contract is verified:

```env
BUNDLE_COLLECTION_DATE_ENABLED=true
NEXT_PUBLIC_BUNDLE_COLLECTION_DATE_ENABLED=true
```
