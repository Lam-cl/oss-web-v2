BEGIN;

CREATE TABLE IF NOT EXISTS catalogue_documents (
  namespace text NOT NULL CHECK (namespace IN (
    'catalogue-products', 'catalogue-publications', 'catalogue-published',
    'catalogue-adoptions', 'product-control', 'order-metadata',
    'shipping-settings', 'sim-assignments', 'product-image-colors',
    'sim-product-updates', 'sim-tone-variant-migrations', 'ready-collection-email'
  )),
  document_key text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  value jsonb NOT NULL,
  source_sha256 char(64),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (namespace, document_key)
);

CREATE INDEX IF NOT EXISTS catalogue_documents_namespace_updated
  ON catalogue_documents (namespace, updated_at DESC, document_key);

CREATE TABLE IF NOT EXISTS catalogue_media (
  media_id uuid PRIMARY KEY,
  catalogue_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  sha256 char(64) NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  assignment text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('draft', 'published')),
  created_at timestamptz NOT NULL,
  UNIQUE (catalogue_id, display_order, media_id)
);

CREATE INDEX IF NOT EXISTS catalogue_media_catalogue_order
  ON catalogue_media (catalogue_id, display_order, media_id);

CREATE TABLE IF NOT EXISTS catalogue_media_removals (
  operation_id uuid PRIMARY KEY,
  catalogue_id uuid NOT NULL,
  media_ids uuid[] NOT NULL,
  removed jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('prepared', 'committed', 'rolled_back')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS data_imports (
  source_path text PRIMARY KEY,
  source_sha256 char(64) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_hash char(64) PRIMARY KEY,
  actor jsonb NOT NULL,
  encrypted_bundle_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
