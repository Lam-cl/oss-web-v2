import type pg from 'pg';

export const NAMESPACES = new Set([
  'catalogue-products', 'catalogue-publications', 'catalogue-published', 'catalogue-adoptions',
  'product-control', 'order-metadata', 'shipping-settings', 'sim-assignments', 'product-image-colors',
  'sim-product-updates', 'sim-tone-variant-migrations', 'ready-collection-email',
]);

export type DocumentInput = {
  namespace: string;
  key: string;
  revision: number;
  value: unknown;
  sourceSha256?: string;
  createdAt: string;
  updatedAt: string;
};

export function createRepository(pool: pg.Pool) {
  const list = async (namespace: string) => (await pool.query(
    'SELECT document_key AS key, revision, value, created_at AS "createdAt", updated_at AS "updatedAt" FROM catalogue_documents WHERE namespace=$1 ORDER BY updated_at DESC, document_key',
    [namespace],
  )).rows;
  const get = async (namespace: string, key: string) => (await pool.query(
    'SELECT document_key AS key, revision, value, source_sha256 AS "sourceSha256", created_at AS "createdAt", updated_at AS "updatedAt" FROM catalogue_documents WHERE namespace=$1 AND document_key=$2',
    [namespace, key],
  )).rows[0] || null;
  const create = async (input: DocumentInput) => (await pool.query(
    `INSERT INTO catalogue_documents(namespace,document_key,revision,value,source_sha256,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING document_key AS key,revision,value,created_at AS "createdAt",updated_at AS "updatedAt"`,
    [input.namespace, input.key, input.revision, input.value, input.sourceSha256 || null, input.createdAt, input.updatedAt],
  )).rows[0];
  const replace = async (input: DocumentInput, expectedRevision: number) => (await pool.query(
    `UPDATE catalogue_documents SET revision=$4,value=$5,source_sha256=COALESCE($6,source_sha256),updated_at=$7
     WHERE namespace=$1 AND document_key=$2 AND revision=$3
     RETURNING document_key AS key,revision,value,created_at AS "createdAt",updated_at AS "updatedAt"`,
    [input.namespace, input.key, expectedRevision, input.revision, input.value, input.sourceSha256 || null, input.updatedAt],
  )).rows[0] || null;
  const importDocument = async (input: DocumentInput, sourcePath: string) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query('SELECT source_sha256 FROM data_imports WHERE source_path=$1 FOR UPDATE', [sourcePath]);
      if (prior.rows[0]) {
        if (prior.rows[0].source_sha256 !== input.sourceSha256) throw new Error(`Import source changed after import: ${sourcePath}`);
        await client.query('ROLLBACK');
        return { imported: false };
      }
      await client.query(
        `INSERT INTO catalogue_documents(namespace,document_key,revision,value,source_sha256,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(namespace,document_key) DO UPDATE SET value=EXCLUDED.value,revision=EXCLUDED.revision,source_sha256=EXCLUDED.source_sha256,updated_at=EXCLUDED.updated_at`,
        [input.namespace, input.key, input.revision, input.value, input.sourceSha256, input.createdAt, input.updatedAt],
      );
      await client.query('INSERT INTO data_imports(source_path,source_sha256) VALUES($1,$2)', [sourcePath, input.sourceSha256]);
      await client.query('COMMIT');
      return { imported: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  };
  return { pool, list, get, create, replace, importDocument };
}
