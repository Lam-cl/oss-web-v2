# Legacy Bundle adoption: exact approved spec contract

Run only from the application root, with a server-side Bundle token that is permitted to read the admin product endpoint:

```bash
BUNDLE_ADMIN_TOKEN='…' node scripts/import-legacy-catalogue-adoption.cjs \
  --spec /root/approved-legacy-adoption-23.json \
  --data-dir /www/wwwroot/tonewow.xifuhalim.com/.data \
  --bundle-base-url https://bundleapi.tonewow.com/api/
```

The importer wraps the Bundle adapter in a GET-only fetch guard. It performs no Bundle write. A retry with the byte-equivalent semantic spec is idempotent. The only permitted Bundle IDs are `23-29,32-36`.

## JSON object (unknown or missing keys fail)

```json
{
  "schemaVersion": 1,
  "approval": {
    "approved": true,
    "approvedBy": "<non-empty owner identity>",
    "approvedAt": "<canonical ISO-8601 timestamp>"
  },
  "bundleProductId": 23,
  "catalogueId": "<pre-approved UUIDv4>",
  "slug": "<lowercase-kebab-slug>",
  "expectedSourceFingerprint": "<sha256 of normalized verified Bundle admin read>",
  "model": {
    "details": { "title": "…", "price": 3, "description": "…", "category": "Apparel" },
    "choices": [{
      "key": "style", "optionId": 27, "name": "Style",
      "values": [{ "key": "standard", "valueId": 41, "label": "Standard", "retired": false }]
    }],
    "combinations": [{
      "valueKeys": ["standard"], "variantId": 39,
      "price": 3, "inventory": 0, "sku": "TONE -STANDARD-2"
    }],
    "existingImages": [{ "imageId": 110, "order": 0, "assignment": "all", "remove": false }]
  },
  "providerBindings": {
    "optionIds": [27],
    "valueBindings": [{ "valueKey": "standard", "valueId": 41 }],
    "variantBindings": [{ "valueKeys": ["standard"], "variantId": 39 }],
    "imageBindings": [{
      "mediaId": "<pre-approved UUIDv4>",
      "imageId": 110,
      "url": "https://…",
      "sha256": "<audited media sha256>",
      "bytes": 536235,
      "contentType": "image/png",
      "order": 0,
      "assignment": "all"
    }]
  },
  "exclusions": {
    "hiddenValueIds": [],
    "orphanVariantIds": []
  },
  "evidence": {
    "auditFiles": [
      { "path": "/root/legacy-merchandise-23-36-migration-audit-2026-08-24.json", "sha256": "<file sha256>" },
      { "path": "/root/legacy-merchandise-23-36-migration-table-2026-08-24.csv", "sha256": "<file sha256>" },
      { "path": "/root/legacy-merchandise-relationship-audit-2026-08-24.json", "sha256": "<file sha256>" },
      { "path": "/root/legacy-merchandise-import-mapping.json", "sha256": "<file sha256>" }
    ],
    "relationshipEvidence": [{
      "valueKeys": ["standard"],
      "kind": "candidate-order-pattern",
      "reason": "<non-empty owner-approved reason>"
    }]
  }
}
```

Every provider option/value/variant/image ID must be accounted for exactly once by a binding or explicit exclusion. Ambiguous evidence is forbidden. Source fingerprint, source IDs/order/URLs, audit hashes, downloaded byte count/content type/signature/SHA-256, and normalized model bindings are all checked before activation.

Activation order is staged verified media → active immutable adoption → Catalogue product last. The public projector emits only the immutable adopted projection while adoption is active, so local editor changes do not leak before a normal publish. The first normal publish uses the legacy ID as `previousBundleProductId`, version ordinal `2`, then marks adoption superseded. Before replacement, admin archive performs a local rollback archive and never deletes the Bundle product.

## Safest pilot

Use **Bundle product 23 (tone wow Lanyard)**. Among 23/29/32/33 it has the same simple one-option/one-value/one-variant, no-missing/no-orphan relationship shape as 29 and 32, but ID 23 is the lowest scoped canary and has only one audited image (unlike 33's two). Its relationship remains owner-approved `candidate-order-pattern`, not native provider evidence, so approval must explicitly acknowledge that limitation.
