BEGIN;

ALTER TABLE catalogue_documents DROP CONSTRAINT IF EXISTS catalogue_documents_namespace_check;
ALTER TABLE catalogue_documents ADD CONSTRAINT catalogue_documents_namespace_check CHECK (namespace IN (
  'catalogue-products', 'catalogue-publications', 'catalogue-published', 'catalogue-adoptions',
  'catalogue-archives', 'product-control', 'order-metadata', 'shipping-settings', 'sim-assignments',
  'product-image-colors', 'sim-product-updates', 'sim-tone-variant-migrations', 'sim-projection-backups',
  'ready-collection-email'
));

COMMIT;
