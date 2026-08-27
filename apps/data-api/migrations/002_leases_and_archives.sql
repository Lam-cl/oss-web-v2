BEGIN;

ALTER TABLE catalogue_documents DROP CONSTRAINT IF EXISTS catalogue_documents_namespace_check;
ALTER TABLE catalogue_documents ADD CONSTRAINT catalogue_documents_namespace_check CHECK (namespace IN (
  'catalogue-products', 'catalogue-publications', 'catalogue-published', 'catalogue-adoptions',
  'catalogue-archives', 'product-control', 'order-metadata', 'shipping-settings', 'sim-assignments',
  'product-image-colors', 'sim-product-updates', 'sim-tone-variant-migrations', 'ready-collection-email'
));

CREATE TABLE IF NOT EXISTS service_leases (
  lease_key text PRIMARY KEY,
  lease_token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_leases_expiry ON service_leases (expires_at);

COMMIT;
