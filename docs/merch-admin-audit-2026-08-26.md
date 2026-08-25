# Merchandise and admin stabilization audit — 2026-08-26

## Scope and safety boundary

- Target: `tonewow.xifuhalim.com` (non-v2 staging) only.
- `shop.tonewow.com` was not accessed or changed.
- The Zara ZIP was treated as reference only; no archive-wide copy or merge was performed.
- Pending unpaid checkouts and inventory were not mutated.
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

Read-only audit of the current staging `.data` and live Bundle merchandise response:

| Result | Products |
| --- | --- |
| Clean | QA SIM (90), Button Badge (79), Lanyard (83), Water Bottle 500ml (84), Water Bottle 975ml (91) |
| Dirty | Topi (81) |
| Unknown | BIZ SIM (40), SUPERLITE SIM (39), 3-fold flyers (34), Bunting (28), Cap (24), Basics (36), Comix (35), Nonwoven (33), Pen (32), Tumbler (27) |

Twelve publication jobs were loaded once and indexed for sixteen catalogue records. Unknown products are deliberately fail-closed; this rollout does not invent missing history.

## Flow audit

| Flow | Finding / protection |
| --- | --- |
| Catalogue and gallery | Public projection remains snapshot/adoption based. Model and media differences are evaluated server-side. |
| Inventory and variants | Current combination inventory, price, tuple order, provider variant IDs and canonical SKU are compared. |
| MOQ | Existing staging MOQ structure and SIM minimum-order policy are unchanged. |
| Cart | No cart source or payload contract was changed. Colour swatch, explicit selection and zero-removal regressions pass. |
| Checkout and payment | No checkout/payment source was changed. Bundle JSON and multipart transport regressions pass. ADX token remains isolated. |
| Voucher and shipping | No live voucher, courier or shipping setting was mutated. |
| Orders | No order or pending-payment data was mutated. Core order metadata/payment regressions pass. |
| SIM fulfilment | Generic catalogue publish/unpublish/archive controls stay hidden for SIM-managed products. Product 90 remains on the dedicated workflow. |

## Verification

- TypeScript: passed (`tsc --noEmit`).
- Production Next.js build: passed (56 static pages generated).
- Publication lifecycle and evidence tests: 13/13 passed, covering generations 1, 2, 5 and 8; clean → save → dirty → republish → clean → save → dirty; model, slug, SKU, inventory, choices and media changes; missing/corrupt/duplicate evidence.
- Focused catalogue, gallery, inventory, cart, checkout, shipping, order and SIM regression set: passed.
- Before-rollout public response fingerprints were captured for `/bundle/merchandise` and `/catalogue-products-api` for post-rollout parity comparison.

The repository also contains historical source-string checks and dated 19-August campaign/catalogue checks. Failures in those baseline checks are tracked separately from this change when they assert obsolete literal formatting or superseded provider data; production behavior was not changed merely to satisfy them.

## Vercel readiness caveat

The Git commits are portable and contain no `/www/wwwroot` path dependency; the sibling worktree is only an isolated staging build location. However, the current `.data` control plane is not suitable for Vercel production persistence because serverless local files are ephemeral and not reliably shared between instances. Before a Vercel production rollout, catalogue records/jobs/snapshots should move to durable database storage and media to durable object storage, or be exposed through an equivalent persistent service. This stabilization preserves the current staging design and does not claim to solve that migration.
