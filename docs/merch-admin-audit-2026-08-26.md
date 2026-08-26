# Merchandise and admin stabilization audit — 2026-08-26

## Scope and safety boundary

- Target: `tonewow.xifuhalim.com` (non-v2 staging) only.
- `shop.tonewow.com` was not accessed or changed.
- The Zara ZIP was treated as reference only; no archive-wide copy or merge was performed.
- Pending unpaid checkouts and existing customer inventory were not mutated. A temporary GUI lifecycle fixture changed its own stock from 2 to 3 and was then unpublished and archived.
- QA SIM Bundle product `90` remains published and visible. Archive/unpublish is intentionally outside this rollout.

## Architecture finding

The previous implementation makes the Bundle API appear more complete by keeping a local catalogue control plane under `.data`: editable models, media manifests, publication jobs, snapshots, adoption records and Bundle bindings. Bundle remains the provider for generated products, variants, stock and checkout, but it does not expose a publication-version or snapshot API capable of proving whether the local editor matches the active provider product.

This bridge is why revision numbers and the number of Bundle versions are not valid dirty-state evidence. A save increments a local revision, while an adoption or republish may already be clean. Conversely, a model or media change can be dirty even when the version count has not changed.

`DIRECT_CHECKOUT_TOKEN` is scoped to ADX proof/middleware and direct SIM checkout. The merchandise catalogue, cart and checkout paths do not use it. It can remain a deployment environment variable without coupling merchandise to ADX.

## Publication evidence audit

The admin list now derives `publicationChangeState` from one request-scoped index of publication jobs, the exact active Bundle version, one matching completed job, its published snapshot, current media metadata, and the active provider product/variants.

- `clean`: all exact evidence agrees; no publish button.
- `dirty`: valid evidence exists and the current model, slug, SKU, variants, inventory, media order/hash/assignment or colour/choice projection differs; `Publish changes` is available.
- `unknown`: evidence is missing, corrupt, duplicated or ambiguous; `Publish changes` is disabled with an explicit reason.

Raw `CV-*` values recorded in job bindings are treated as provider-generated metadata, not catalogue choice keys. Variant IDs anchor the job to the snapshot; stable catalogue value keys come from the snapshot/model.

Initial read-only audit of the staging source before evidence reconciliation:

| Result | Products |
| --- | --- |
| Clean | QA SIM (90), Button Badge (79), Lanyard (83), Water Bottle 500ml (84), Water Bottle 975ml (91) |
| Dirty | Topi (81) |
| Unknown | BIZ SIM (40), SUPERLITE SIM (39), 3-fold flyers (34), Bunting (28), Cap (24), Basics (36), Comix (35), Nonwoven (33), Pen (32), Tumbler (27) |

Publication evidence was then reconciled on staging. The current admin readiness check reports zero `unknown` records. Water Bottle 975ml, Topi and the two live SIM products are clean; QA SIM product 90 has a real dirty draft while remaining publicly visible.

## Flow audit

| Flow | Finding / protection |
| --- | --- |
| Catalogue and gallery | Public projection remains snapshot/adoption based. Model and media differences are evaluated server-side. |
| Inventory and variants | Current combination inventory, price, tuple order, provider variant IDs and canonical SKU are compared. |
| MOQ | MOQ is an ordinary editable catalogue field. Legacy SIM products start at MOQ 2 when first normalized to `SIM Card`. |
| Cart | No cart source or payload contract was changed. Colour swatch, explicit selection and zero-removal regressions pass. |
| Checkout and payment | Merchandise checkout now replaces only the browser-facing GKash return URL with a same-origin bridge. The bridge never renders the transient upstream error body and falls back to authoritative payment-status polling. Bundle JSON and multipart transport regressions pass. ADX token remains isolated. |
| Voucher and shipping | Courier rates remain the supplied Excel rates. Product assignment now uses stable catalogue UUID evidence, with active Bundle IDs retained as compatibility aliases. |
| Orders | No order or pending-payment data was mutated. Core order metadata/payment regressions pass. |
| SIM fulfilment | `SIM Card` uses the same create/edit/publish/unpublish/archive lifecycle as other merchandise. Its only special behavior is order fulfilment: `SIM Card`, legacy `SIM Cards`/`SIM`, known SIM slugs and SIM item types create per-unit SN assignments. Product 90 remains published but now exposes ordinary lifecycle controls. |

## Verification

The supplied shipping rate card (`6a8e3866e6c79_1787705446.xlsx`, SHA-256 `38c85fa13484d3bb5ffbe926587d953514a3bc9af9d7a9574a7cf90d3130424f`) was compared against staging. All five stored rate groups and tiers already match it exactly, so no rate mutation was required. The follow-up audit found that assignments keyed only by Bundle product ID were lost on republish (Topi moved from ID 103 to 105). Checkout and admin now resolve the stable catalogue UUID first, publication inherits the category atomically, and the current Bundle ID remains a compatibility alias. Delivery cannot be submitted while state or classification is unresolved, so an unconfigured item is never presented as free shipping.

- TypeScript: passed (`tsc --noEmit`).
- Production Next.js build: passed (57 static pages generated, including the local payment-processing fallback).
- Publication lifecycle and evidence tests: 13/13 passed, covering generations 1, 2, 5 and 8; clean → save → dirty → republish → clean → save → dirty; model, slug, SKU, inventory, choices and media changes; missing/corrupt/duplicate evidence.
- Focused catalogue, gallery, inventory, cart, checkout, shipping, order and SIM regression set: passed.
- Before-rollout public response fingerprints were captured for `/bundle/merchandise` and `/catalogue-products-api` for post-rollout parity comparison.
- Full historical `check-*.cjs` sweep: 92 passed, 11 baseline failures. The failures are the four old admin source-literal checks (`courier`, expected-delivery, fulfilment fields and SIM UI), fulfilment SKU source matching, two dated 19-August data/campaign checks, payment-page source matching, the pre-existing cross-catalogue SIM variant assertion, staging-export report-path handling, and voucher/payment allowlist source matching.
- Authenticated Chromium lifecycle: created a temporary `SIM Card` product, published it, edited stock 2 → 3, observed evidence-backed `Publish changes`, republished, then unpublished and archived it. No QA lifecycle fixture remains.

The repository also contains historical source-string checks and dated 19-August campaign/catalogue checks. Failures in those baseline checks are tracked separately from this change when they assert obsolete literal formatting or superseded provider data; production behavior was not changed merely to satisfy them.

## Persistent control plane and Vercel readiness

The Git commits are portable and contain no runtime dependency on the deployment directory. A ToneWow-owned Data API now persists catalogue documents and publication evidence in PostgreSQL and verified draft/published media in MinIO. Staging exposes the bearer-protected service at `https://tonewow.xifuhalim.com/bundleapi`; the name denotes a supplement to Bundle API, while upstream Bundle remains the commerce/provider authority. Removing `TONEWOW_DATA_API_URL` and `TONEWOW_DATA_API_TOKEN` returns the web adapter to its filesystem rollback path.

Catalogue products, publication jobs, published snapshots, media, adoption reads/supersession, shipping settings, order metadata, SIM assignments, product image-colour state, product-control checkpoints, SIM migration/update checkpoints and ready-collection email markers have remote adapters. Cross-process leases serialize specialist mutations. Normal catalogue archive is an atomic PostgreSQL operation with a durable restore manifest; referenced MinIO objects are retained. Admin cookies become opaque IDs when the data service is enabled, while Bundle tokens are encrypted at rest in PostgreSQL. The imported PostgreSQL/MinIO projection matches the pre-cutover `.data` source, and an isolated remote-enabled production build succeeds.

Production remains intentionally blocked. Publication evidence no longer has unknown records, but QA SIM product 90 has an unpublished change, and encrypted offsite backup credentials/target plus a restore drill are still required before a production-readiness decision. No unknown evidence was fabricated and no production DNS or `shop.tonewow.com` deployment was changed.
