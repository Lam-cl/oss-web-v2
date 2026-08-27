import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { readConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { createObjectStore } from './objectStore.js';
import { createRepository, NAMESPACES } from './repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA = /^[a-f0-9]{64}$/;
const CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ARCHIVE_ID = /^\d{8}T\d{9}Z$/;
const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value;
const config = readConfig();
const pool = createPool(config.databaseUrl);
const repository = createRepository(pool);
const objects = createObjectStore(config.minio);
const app = express();
const sessionKey = Buffer.from(config.sessionEncryptionKey, 'hex');
if (!/^[a-fA-F0-9]{64}$/.test(config.sessionEncryptionKey) || sessionKey.length !== 32) {
  throw new Error('SESSION_ENCRYPTION_KEY must be 64 hexadecimal characters.');
}

function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey, iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

function decryptToken(value: string) {
  const [iv, tag, body, extra] = value.split('.');
  if (!iv || !tag || !body || extra) throw new Error('Invalid encrypted session.');
  const decipher = createDecipheriv('aes-256-gcm', sessionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

declare global { namespace Express { interface Request { requestId: string } } }

app.disable('x-powered-by');
app.use((request, response, next) => {
  request.requestId = request.header('x-request-id') || randomUUID();
  response.setHeader('x-request-id', request.requestId);
  response.setHeader('cache-control', 'no-store');
  const origin = request.header('origin');
  if (origin && config.corsOrigins.has(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
    response.setHeader('access-control-allow-headers', 'authorization,content-type,x-content-sha256,x-expected-revision,x-request-id');
    response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (request.method === 'OPTIONS') return response.sendStatus(origin && config.corsOrigins.has(origin) ? 204 : 403);
  next();
});

const serviceAuth = (request: Request, _response: Response, next: NextFunction) => {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const expected = Buffer.from(config.serviceToken);
  const actual = Buffer.from(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return next(new ApiError(401, 'UNAUTHORIZED', 'Service authentication failed.'));
  next();
};

app.get('/health/live', (_request, response) => response.json({ ok: true }));
app.get('/health/ready', async (_request, response, next) => {
  try { await pool.query('SELECT 1'); await objects.ensureBuckets(); response.json({ ok: true }); }
  catch (error) { next(new ApiError(503, 'NOT_READY', error instanceof Error ? error.message : 'Data service is not ready.')); }
});

app.use('/v1/state', serviceAuth, express.json({ limit: '2mb', strict: true }));
app.get('/v1/state/:namespace', async (request, response, next) => {
  try {
    const namespace = param(request.params.namespace);
    if (!NAMESPACES.has(namespace)) throw new ApiError(404, 'NAMESPACE_NOT_FOUND', 'State namespace was not found.');
    response.json({ data: await repository.list(namespace) });
  } catch (error) { next(error); }
});
app.get('/v1/state/:namespace/:key', async (request, response, next) => {
  try {
    const namespace = param(request.params.namespace); const key = param(request.params.key);
    if (!NAMESPACES.has(namespace) || !SAFE_KEY.test(key)) throw new ApiError(400, 'INVALID_KEY', 'State namespace or key is invalid.');
    const document = await repository.get(namespace, key);
    if (!document) throw new ApiError(404, 'NOT_FOUND', 'State document was not found.');
    response.json({ data: document });
  } catch (error) { next(error); }
});

function documentInput(request: Request) {
  const namespace = param(request.params.namespace); const key = param(request.params.key);
  const body = request.body as Record<string, unknown>;
  if (!NAMESPACES.has(namespace) || !SAFE_KEY.test(key) || !body || typeof body !== 'object' || Array.isArray(body)
    || !Number.isSafeInteger(body.revision) || Number(body.revision) <= 0 || body.value === undefined
    || typeof body.createdAt !== 'string' || typeof body.updatedAt !== 'string') {
    throw new ApiError(400, 'INVALID_DOCUMENT', 'State document is invalid.');
  }
  return { namespace, key, revision: Number(body.revision), value: body.value, createdAt: body.createdAt, updatedAt: body.updatedAt };
}

app.post('/v1/state/:namespace/:key', async (request, response, next) => {
  try { response.status(201).json({ data: await repository.create(documentInput(request)) }); }
  catch (error: any) { next(error?.code === '23505' ? new ApiError(409, 'ALREADY_EXISTS', 'State document already exists.') : error); }
});
app.put('/v1/state/:namespace/:key', async (request, response, next) => {
  try {
    const expected = Number(request.header('x-expected-revision'));
    if (!Number.isSafeInteger(expected) || expected <= 0) throw new ApiError(400, 'INVALID_REVISION', 'A positive expected revision is required.');
    const document = await repository.replace(documentInput(request), expected);
    if (!document) throw new ApiError(409, 'REVISION_CONFLICT', 'State document revision conflict.');
    response.json({ data: document });
  } catch (error) { next(error); }
});
app.delete('/v1/state/:namespace/:key', async (request, response, next) => {
  try {
    const namespace = param(request.params.namespace); const key = param(request.params.key);
    const expected = Number(request.header('x-expected-revision'));
    if (!NAMESPACES.has(namespace) || !SAFE_KEY.test(key) || !Number.isSafeInteger(expected) || expected <= 0) {
      throw new ApiError(400, 'INVALID_REVISION', 'A valid state key and positive expected revision are required.');
    }
    const document = await repository.remove(namespace, key, expected);
    if (!document) throw new ApiError(409, 'REVISION_CONFLICT', 'State document revision conflict.');
    response.json({ data: document });
  } catch (error) { next(error); }
});

app.use('/v1/locks', serviceAuth, express.json({ limit: '4kb', strict: true }));
app.post('/v1/locks/:key', async (request, response, next) => {
  try {
    const key = param(request.params.key); const ttl = Number((request.body as { ttlSeconds?: unknown })?.ttlSeconds || 300); const token = randomUUID();
    if (!SAFE_KEY.test(key) || !Number.isSafeInteger(ttl) || ttl < 30 || ttl > 600) throw new ApiError(400, 'INVALID_LEASE', 'Lease key or duration is invalid.');
    const row = (await pool.query(`INSERT INTO service_leases(lease_key,lease_token,expires_at) VALUES($1,$2,now()+($3||' seconds')::interval)
      ON CONFLICT(lease_key) DO UPDATE SET lease_token=EXCLUDED.lease_token,expires_at=EXCLUDED.expires_at,created_at=now()
      WHERE service_leases.expires_at<=now() RETURNING lease_key AS key,lease_token AS token,expires_at AS "expiresAt"`, [key, token, String(ttl)])).rows[0];
    if (!row) throw new ApiError(409, 'LEASE_HELD', 'The operation lease is already held.');
    response.status(201).json({ data: row });
  } catch (error) { next(error); }
});
app.delete('/v1/locks/:key', async (request, response, next) => {
  try {
    const key = param(request.params.key); const token = request.header('x-lease-token') || '';
    if (!SAFE_KEY.test(key) || !UUID.test(token)) throw new ApiError(400, 'INVALID_LEASE', 'Lease key or token is invalid.');
    const row = (await pool.query('DELETE FROM service_leases WHERE lease_key=$1 AND lease_token=$2 RETURNING lease_key AS key', [key, token])).rows[0];
    if (!row) throw new ApiError(409, 'LEASE_LOST', 'The operation lease is no longer owned.');
    response.json({ data: row });
  } catch (error) { next(error); }
});

app.use('/v1/admin-sessions', serviceAuth, express.json({ limit: '16kb', strict: true }));
app.post('/v1/admin-sessions', async (request, response, next) => {
  try {
    const body = request.body as Record<string, any>; const sessionId = String(body?.sessionId || '');
    const bundleToken = String(body?.bundleToken || ''); const actor = body?.actor; const expiresAt = String(body?.expiresAt || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId) || !bundleToken || bundleToken.length > 16_384 || !actor
      || typeof actor.email !== 'string' || !['ADMIN', 'STAFF'].includes(actor.role)
      || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
      throw new ApiError(400, 'INVALID_SESSION', 'Admin session is invalid.');
    }
    const hash = createHash('sha256').update(sessionId).digest('hex');
    await pool.query('DELETE FROM admin_sessions WHERE expires_at<=now()');
    await pool.query('INSERT INTO admin_sessions(session_hash,actor,encrypted_bundle_token,expires_at) VALUES($1,$2,$3,$4)',
      [hash, JSON.stringify(actor), encryptToken(bundleToken), expiresAt]);
    response.status(201).json({ data: { sessionId, actor, expiresAt } });
  } catch (error: any) { next(error?.code === '23505' ? new ApiError(409, 'SESSION_EXISTS', 'Admin session already exists.') : error); }
});
app.get('/v1/admin-sessions/:sessionId', async (request, response, next) => {
  try {
    const sessionId = param(request.params.sessionId);
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) throw new ApiError(400, 'INVALID_SESSION', 'Admin session is invalid.');
    const hash = createHash('sha256').update(sessionId).digest('hex');
    const row = (await pool.query('SELECT actor,encrypted_bundle_token AS token,expires_at AS "expiresAt" FROM admin_sessions WHERE session_hash=$1 AND expires_at>now()', [hash])).rows[0];
    if (!row) throw new ApiError(404, 'SESSION_NOT_FOUND', 'Admin session was not found.');
    response.json({ data: { actor: row.actor, bundleToken: decryptToken(row.token), expiresAt: row.expiresAt } });
  } catch (error) { next(error); }
});
app.delete('/v1/admin-sessions/:sessionId', async (request, response, next) => {
  try {
    const sessionId = param(request.params.sessionId);
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) throw new ApiError(400, 'INVALID_SESSION', 'Admin session is invalid.');
    const hash = createHash('sha256').update(sessionId).digest('hex');
    await pool.query('DELETE FROM admin_sessions WHERE session_hash=$1', [hash]);
    response.json({ data: { revoked: true } });
  } catch (error) { next(error); }
});

type ArchivedDocument = {
  namespace: string; key: string; revision: number; value: unknown;
  sourceSha256: string | null; createdAt: string; updatedAt: string;
};

const archiveDocument = (row: Record<string, any>): ArchivedDocument => ({
  namespace: row.namespace,
  key: row.key,
  revision: row.revision,
  value: row.value,
  sourceSha256: row.sourceSha256,
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString(),
});

function archiveFile(source: string, archived: string, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  return { source, archived, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
}

app.post('/v1/catalogue-archives/:catalogueId', serviceAuth, express.json({ limit: '8kb', strict: true }), async (request, response, next) => {
  const client = await pool.connect();
  try {
    const catalogueId = param(request.params.catalogueId); const expectedRevision = Number((request.body as any)?.expectedRevision);
    if (!UUID.test(catalogueId) || !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
      throw new ApiError(400, 'INVALID_ARCHIVE', 'A valid catalogue ID and exact positive revision are required.');
    }
    await client.query('BEGIN');
    const existing = (await client.query(
      `SELECT revision,value FROM catalogue_documents WHERE namespace='catalogue-archives' AND document_key=$1 FOR UPDATE`, [catalogueId],
    )).rows[0];
    const productRow = (await client.query(
      `SELECT namespace,document_key AS key,revision,value,source_sha256 AS "sourceSha256",created_at AS "createdAt",updated_at AS "updatedAt"
       FROM catalogue_documents WHERE namespace='catalogue-products' AND document_key=$1 FOR UPDATE`, [catalogueId],
    )).rows[0];
    if (!productRow) {
      if (existing?.value?.revision === expectedRevision) {
        await client.query('ROLLBACK');
        return response.json({ data: { manifest: existing.value, idempotent: true } });
      }
      throw new ApiError(existing ? 409 : 404, existing ? 'ARCHIVE_CONFLICT' : 'CATALOGUE_NOT_FOUND',
        existing ? 'Catalogue product archive revision conflict.' : 'Catalogue product was not found.');
    }
    if (existing) throw new ApiError(409, 'ARCHIVE_CONFLICT', 'Catalogue product already has a different archive.');
    if (productRow.revision !== expectedRevision) throw new ApiError(409, 'REVISION_CONFLICT', 'Catalogue product revision conflict.');
    const product = productRow.value as Record<string, any>;
    const hasActiveVersion = Array.isArray(product.bundleVersions) && product.bundleVersions.some((item: any) => item?.retiredAt === null);
    if (product.status !== 'draft' || product.currentBundleProductId !== null || hasActiveVersion) {
      throw new ApiError(409, 'CATALOGUE_STILL_PUBLISHED', 'Unpublish this Catalogue product and confirm its Bundle version is retired before archiving.');
    }
    const relatedRows = (await client.query(
      `SELECT namespace,document_key AS key,revision,value,source_sha256 AS "sourceSha256",created_at AS "createdAt",updated_at AS "updatedAt"
       FROM catalogue_documents
       WHERE namespace IN ('catalogue-publications','catalogue-published','catalogue-adoptions')
       AND jsonb_path_exists(value,'$.**.catalogueId ? (@ == $id)',jsonb_build_object('id',to_jsonb($1::text)))
       FOR UPDATE`, [catalogueId],
    )).rows;
    const media = (await client.query('SELECT * FROM catalogue_media WHERE catalogue_id=$1 FOR UPDATE', [catalogueId])).rows;
    const documents = [productRow, ...relatedRows].map(archiveDocument);
    const archivedAt = new Date().toISOString(); const archiveId = archivedAt.replace(/[-:.]/g, '');
    if (!ARCHIVE_ID.test(archiveId)) throw new ApiError(500, 'ARCHIVE_ID_ERROR', 'Catalogue archive timestamp is invalid.');
    const files = [
      ...documents.map((document) => archiveFile(`${document.namespace}/${document.key}.json`, `documents/${document.namespace}/${document.key}.json`, document)),
      ...media.map((item: any) => archiveFile(`catalogue-media/${catalogueId}/${item.media_id}.json`, `media/${item.media_id}.json`, item)),
    ];
    const manifest = {
      version: 1, state: 'archived', catalogueId, revision: expectedRevision, archivedAt, archiveId, files,
      rollback: { destinations: files.map(({ source, archived }) => ({ source, archived })) }, documents, media,
    };
    await client.query(
      `INSERT INTO catalogue_documents(namespace,document_key,revision,value,created_at,updated_at)
       VALUES('catalogue-archives',$1,1,$2,$3,$3)`, [catalogueId, JSON.stringify(manifest), archivedAt],
    );
    for (const document of documents) {
      await client.query('DELETE FROM catalogue_documents WHERE namespace=$1 AND document_key=$2 AND revision=$3',
        [document.namespace, document.key, document.revision]);
    }
    await client.query('DELETE FROM catalogue_media WHERE catalogue_id=$1', [catalogueId]);
    await client.query('COMMIT');
    response.status(201).json({ data: { manifest, idempotent: false } });
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
  finally { client.release(); }
});

app.post('/v1/catalogue-archives/:catalogueId/restore', serviceAuth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const catalogueId = param(request.params.catalogueId);
    if (!UUID.test(catalogueId)) throw new ApiError(400, 'INVALID_ARCHIVE', 'A valid catalogue ID is required.');
    await client.query('BEGIN');
    const archiveRow = (await client.query(
      `SELECT revision,value FROM catalogue_documents WHERE namespace='catalogue-archives' AND document_key=$1 FOR UPDATE`, [catalogueId],
    )).rows[0];
    if (!archiveRow) throw new ApiError(404, 'ARCHIVE_NOT_FOUND', 'Catalogue archive was not found.');
    const archive = archiveRow.value as { documents?: ArchivedDocument[]; media?: Array<Record<string, any>> };
    if (!Array.isArray(archive.documents) || !Array.isArray(archive.media)) throw new ApiError(500, 'ARCHIVE_CORRUPT', 'Catalogue archive is corrupt.');
    for (const document of archive.documents) {
      await client.query(
        `INSERT INTO catalogue_documents(namespace,document_key,revision,value,source_sha256,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [document.namespace, document.key, document.revision, JSON.stringify(document.value), document.sourceSha256, document.createdAt, document.updatedAt],
      );
    }
    for (const item of archive.media) {
      await client.query(
        `INSERT INTO catalogue_media(media_id,catalogue_id,object_key,original_name,content_type,bytes,sha256,display_order,assignment,visibility,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [item.media_id, item.catalogue_id, item.object_key, item.original_name, item.content_type, item.bytes, item.sha256,
          item.display_order, item.assignment, item.visibility, item.created_at],
      );
    }
    await client.query(`DELETE FROM catalogue_documents WHERE namespace='catalogue-archives' AND document_key=$1 AND revision=$2`, [catalogueId, archiveRow.revision]);
    await client.query('COMMIT');
    response.json({ data: { restored: true, catalogueId } });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    next(error?.code === '23505' ? new ApiError(409, 'RESTORE_CONFLICT', 'Catalogue archive restore conflicts with active data.') : error);
  } finally { client.release(); }
});

app.post('/v1/sim-projections/:productId', serviceAuth, express.json({ limit: '2mb', strict: true }), async (request, response, next) => {
  const client = await pool.connect();
  try {
    const productId = Number(param(request.params.productId)); const body = request.body as Record<string, any>;
    const catalogueId = String(body?.catalogueId || ''); const mode = body?.mode;
    const expectedAdoptionRevision = Number(body?.expectedAdoptionRevision); const expectedProductRevision = Number(body?.expectedProductRevision);
    if (![39, 40].includes(productId) || !UUID.test(catalogueId) || !['activate', 'restore'].includes(mode)
      || !Number.isSafeInteger(expectedAdoptionRevision) || expectedAdoptionRevision <= 0
      || !Number.isSafeInteger(expectedProductRevision) || expectedProductRevision <= 0) {
      throw new ApiError(400, 'INVALID_SIM_PROJECTION', 'Exact SIM projection transaction fields are required.');
    }
    await client.query('BEGIN');
    const adoption = (await client.query(
      `SELECT revision,value,created_at AS "createdAt" FROM catalogue_documents
       WHERE namespace='catalogue-adoptions' AND document_key=$1 FOR UPDATE`, [String(productId)],
    )).rows[0];
    const product = (await client.query(
      `SELECT revision,value,created_at AS "createdAt" FROM catalogue_documents
       WHERE namespace='catalogue-products' AND document_key=$1 FOR UPDATE`, [catalogueId],
    )).rows[0];
    if (!adoption || !product) throw new ApiError(404, 'SIM_PROJECTION_NOT_FOUND', 'SIM projection records were not found.');
    if (adoption.revision !== expectedAdoptionRevision || product.revision !== expectedProductRevision) {
      throw new ApiError(409, 'REVISION_CONFLICT', 'SIM projection revision conflict.');
    }
    const currentAdoption = adoption.value as Record<string, any>; const currentProduct = product.value as Record<string, any>;
    if (currentAdoption.bundleProductId !== productId || currentAdoption.catalogueId !== catalogueId
      || currentAdoption.status !== 'active' || currentAdoption.managementProfile?.domain !== 'SIM'
      || currentProduct.catalogueId !== catalogueId || currentProduct.currentBundleProductId !== productId) {
      throw new ApiError(409, 'SIM_PROJECTION_IDENTITY', 'SIM projection identity is invalid.');
    }
    let nextAdoption: Record<string, any>; let nextProduct: Record<string, any>;
    if (mode === 'activate') {
      nextAdoption = body.nextAdoption; nextProduct = body.nextProduct;
      if (!nextAdoption || !nextProduct || nextAdoption.bundleProductId !== productId || nextAdoption.catalogueId !== catalogueId
        || nextAdoption.status !== 'active' || nextAdoption.managementProfile?.domain !== 'SIM'
        || nextProduct.catalogueId !== catalogueId || nextProduct.currentBundleProductId !== productId
        || nextProduct.revision !== currentProduct.revision + 1) {
        throw new ApiError(400, 'INVALID_SIM_PROJECTION', 'The next SIM projection is invalid.');
      }
      const backup = { version: 1, adoption: currentAdoption, product: currentProduct };
      const existingBackup = (await client.query(
        `SELECT revision,created_at AS "createdAt" FROM catalogue_documents
         WHERE namespace='sim-projection-backups' AND document_key=$1 FOR UPDATE`, [String(productId)],
      )).rows[0];
      if (existingBackup) {
        await client.query(
          `UPDATE catalogue_documents SET revision=$2,value=$3,updated_at=now()
           WHERE namespace='sim-projection-backups' AND document_key=$1`,
          [String(productId), existingBackup.revision + 1, JSON.stringify(backup)],
        );
      } else {
        await client.query(
          `INSERT INTO catalogue_documents(namespace,document_key,revision,value,created_at,updated_at)
           VALUES('sim-projection-backups',$1,1,$2,now(),now())`, [String(productId), JSON.stringify(backup)],
        );
      }
    } else {
      const backup = (await client.query(
        `SELECT value FROM catalogue_documents WHERE namespace='sim-projection-backups' AND document_key=$1 FOR UPDATE`, [String(productId)],
      )).rows[0]?.value;
      if (!backup?.adoption || !backup?.product || backup.adoption.bundleProductId !== productId
        || backup.adoption.catalogueId !== catalogueId || backup.product.catalogueId !== catalogueId) {
        throw new ApiError(409, 'SIM_BACKUP_UNAVAILABLE', 'SIM projection compensation backup is unavailable.');
      }
      nextAdoption = backup.adoption;
      nextProduct = { ...backup.product, revision: currentProduct.revision + 1, updatedAt: new Date().toISOString() };
    }
    const now = new Date().toISOString();
    const updatedAdoption = (await client.query(
      `UPDATE catalogue_documents SET revision=revision+1,value=$3,updated_at=$4
       WHERE namespace='catalogue-adoptions' AND document_key=$1 AND revision=$2
       RETURNING revision,value`, [String(productId), expectedAdoptionRevision, JSON.stringify(nextAdoption), now],
    )).rows[0];
    const updatedProduct = (await client.query(
      `UPDATE catalogue_documents SET revision=revision+1,value=$3,updated_at=$4
       WHERE namespace='catalogue-products' AND document_key=$1 AND revision=$2
       RETURNING revision,value`, [catalogueId, expectedProductRevision, JSON.stringify(nextProduct), now],
    )).rows[0];
    if (!updatedAdoption || !updatedProduct) throw new ApiError(409, 'REVISION_CONFLICT', 'SIM projection revision conflict.');
    await client.query('COMMIT');
    response.json({ data: { adoption: updatedAdoption, product: updatedProduct, mode } });
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error); }
  finally { client.release(); }
});

app.post('/v1/media/:catalogueId/:mediaId', serviceAuth, express.raw({ type: Array.from(CONTENT_TYPES), limit: '10mb' }), async (request, response, next) => {
  let uploaded: { objectKey: string; bucket: string; sha256: string } | null = null;
  try {
    const catalogueId = param(request.params.catalogueId); const mediaId = param(request.params.mediaId);
    const contentType = request.header('content-type') || '';
    const expectedSha = request.header('x-content-sha256') || '';
    const encodedMetadata = request.header('x-media-metadata') || '';
    const metadata = JSON.parse(Buffer.from(encodedMetadata, 'base64url').toString('utf8') || '{}');
    if (!UUID.test(catalogueId) || !UUID.test(mediaId) || !CONTENT_TYPES.has(contentType) || !SHA.test(expectedSha)
      || !Buffer.isBuffer(request.body) || request.body.length === 0) throw new ApiError(400, 'INVALID_MEDIA', 'Media upload is invalid.');
    const actualSha = createHash('sha256').update(request.body).digest('hex');
    if (actualSha !== expectedSha) throw new ApiError(422, 'HASH_MISMATCH', 'Media hash does not match its body.');
    const visibility = metadata.visibility === 'published' ? 'published' : 'draft';
    uploaded = await objects.put(visibility, catalogueId, request.body, contentType);
    const row = (await pool.query(
      `INSERT INTO catalogue_media(media_id,catalogue_id,object_key,original_name,content_type,bytes,sha256,display_order,assignment,visibility,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(media_id) DO UPDATE SET object_key=EXCLUDED.object_key,visibility=EXCLUDED.visibility
       WHERE catalogue_media.catalogue_id=EXCLUDED.catalogue_id AND catalogue_media.sha256=EXCLUDED.sha256 RETURNING *`,
      [mediaId, catalogueId, uploaded.objectKey, String(metadata.originalName || mediaId), contentType, request.body.length,
        actualSha, Number(metadata.order || 0), String(metadata.assignment || 'all'), visibility, metadata.createdAt || new Date().toISOString()],
    )).rows[0];
    if (!row) throw new ApiError(409, 'MEDIA_EXISTS', 'Media ID already exists.');
    response.status(201).json({ data: row });
  } catch (error) {
    if (uploaded) await objects.remove(uploaded.bucket === config.minio.publicBucket ? 'published' : 'draft', uploaded.objectKey).catch(() => undefined);
    next(error);
  }
});

app.get('/v1/media/:catalogueId', serviceAuth, async (request, response, next) => {
  try {
    const catalogueId = param(request.params.catalogueId);
    if (!UUID.test(catalogueId)) throw new ApiError(400, 'INVALID_CATALOGUE_ID', 'Catalogue ID is invalid.');
    const rows = (await pool.query('SELECT * FROM catalogue_media WHERE catalogue_id=$1 ORDER BY display_order,media_id', [catalogueId])).rows;
    response.json({ data: rows });
  } catch (error) { next(error); }
});

app.patch('/v1/media/:catalogueId/:mediaId', serviceAuth, express.json({ limit: '8kb' }), async (request, response, next) => {
  try {
    const catalogueId=param(request.params.catalogueId),mediaId=param(request.params.mediaId),body=request.body as Record<string,unknown>;
    if(!UUID.test(catalogueId)||!UUID.test(mediaId)||!body||typeof body!=='object'||Array.isArray(body)
      ||Object.keys(body).some(key=>!['order','assignment'].includes(key))||Object.keys(body).length===0)throw new ApiError(400,'INVALID_MEDIA_PATCH','Media patch is invalid.');
    const order=body.order===undefined?null:Number(body.order),assignment=body.assignment===undefined?null:String(body.assignment);
    if(order!==null&&(!Number.isSafeInteger(order)||order<0)||assignment!==null&&(!assignment||assignment.length>128))throw new ApiError(400,'INVALID_MEDIA_PATCH','Media patch is invalid.');
    const row=(await pool.query(`UPDATE catalogue_media SET display_order=COALESCE($3,display_order),assignment=COALESCE($4,assignment)
      WHERE catalogue_id=$1 AND media_id=$2 RETURNING *`,[catalogueId,mediaId,order,assignment])).rows[0];
    if(!row)throw new ApiError(404,'MEDIA_NOT_FOUND','Media was not found.');response.json({data:row});
  } catch(error:any){next(error?.code==='23505'?new ApiError(409,'ORDER_CONFLICT','Media order conflicts with another item.'):error);}
});

app.delete('/v1/media/:catalogueId/:mediaId', serviceAuth, async (request,response,next)=>{
  try{const catalogueId=param(request.params.catalogueId),mediaId=param(request.params.mediaId);
    const row=(await pool.query('DELETE FROM catalogue_media WHERE catalogue_id=$1 AND media_id=$2 RETURNING *',[catalogueId,mediaId])).rows[0];
    if(!row)throw new ApiError(404,'MEDIA_NOT_FOUND','Media was not found.');await objects.remove(row.visibility,row.object_key).catch(()=>undefined);response.json({data:row});
  }catch(error){next(error);}
});

app.get('/v1/media/:catalogueId/removals/:operationId',serviceAuth,async(request,response,next)=>{
  try{const row=(await pool.query('SELECT * FROM catalogue_media_removals WHERE catalogue_id=$1 AND operation_id=$2',[param(request.params.catalogueId),param(request.params.operationId)])).rows[0];
    if(!row)throw new ApiError(404,'REMOVAL_NOT_FOUND','Media removal was not found.');response.json({data:row});}catch(error){next(error);}
});
app.post('/v1/media/:catalogueId/removals/:operationId',serviceAuth,express.json({limit:'16kb'}),async(request,response,next)=>{
  const client=await pool.connect();
  try{const catalogueId=param(request.params.catalogueId),operationId=param(request.params.operationId),mediaIds=(request.body as any)?.mediaIds;
    if(!UUID.test(catalogueId)||!UUID.test(operationId)||!Array.isArray(mediaIds)||!mediaIds.length||mediaIds.some(id=>typeof id!=='string'||!UUID.test(id))||new Set(mediaIds).size!==mediaIds.length)throw new ApiError(400,'INVALID_REMOVAL','Media removal is invalid.');
    await client.query('BEGIN');const existing=(await client.query('SELECT * FROM catalogue_media_removals WHERE operation_id=$1 FOR UPDATE',[operationId])).rows[0];
    if(existing){if(JSON.stringify([...existing.media_ids].sort())!==JSON.stringify([...mediaIds].sort()))throw new ApiError(409,'REMOVAL_CONFLICT','Media removal payload conflicts with its durable record.');await client.query('ROLLBACK');return response.json({data:existing});}
    const removed=(await client.query('SELECT * FROM catalogue_media WHERE catalogue_id=$1 AND media_id=ANY($2::uuid[]) FOR UPDATE',[catalogueId,mediaIds])).rows;
    if(removed.length!==mediaIds.length)throw new ApiError(404,'MEDIA_NOT_FOUND','One or more media items were not found.');const now=new Date().toISOString();
    await client.query(`INSERT INTO catalogue_media_removals(operation_id,catalogue_id,media_ids,removed,status,created_at,updated_at)VALUES($1,$2,$3,$4,'prepared',$5,$5)`,[operationId,catalogueId,mediaIds,JSON.stringify(removed),now]);
    await client.query('DELETE FROM catalogue_media WHERE catalogue_id=$1 AND media_id=ANY($2::uuid[])',[catalogueId,mediaIds]);await client.query('COMMIT');
    await Promise.all(removed.map(row=>objects.remove(row.visibility,row.object_key).catch(()=>undefined)));const committed=(await pool.query(`UPDATE catalogue_media_removals SET status='committed',updated_at=now() WHERE operation_id=$1 RETURNING *`,[operationId])).rows[0];response.json({data:committed});
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);next(error);}finally{client.release();}
});

app.get('/v1/media/:catalogueId/:mediaId', serviceAuth, async (request, response, next) => {
  try {
    const row = (await pool.query('SELECT * FROM catalogue_media WHERE catalogue_id=$1 AND media_id=$2', [param(request.params.catalogueId), param(request.params.mediaId)])).rows[0];
    if (!row) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Media was not found.');
    const body = await objects.read(row.visibility, row.object_key);
    if (body.length !== row.bytes || createHash('sha256').update(body).digest('hex') !== row.sha256) throw new ApiError(503, 'MEDIA_CORRUPT', 'Stored media integrity check failed.');
    response.setHeader('content-type', row.content_type);
    response.setHeader('content-length', body.length);
    response.send(body);
  } catch (error) { next(error); }
});

app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  const known = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'The data service could not complete the request.');
  if (known.status >= 500) console.error(JSON.stringify({ requestId: request.requestId, error: error instanceof Error ? error.message : String(error) }));
  response.status(known.status).json({ error: { code: known.code, message: known.message, requestId: request.requestId } });
});

export async function start() {
  await migrate(pool);
  await objects.ensureBuckets();
  return app.listen(config.port, '127.0.0.1', () => console.log(`ToneWow Data API listening on 127.0.0.1:${config.port}`));
}

if (process.env.NODE_ENV !== 'test') start().catch((error) => { console.error(error); process.exit(1); });

export { app, pool, repository, objects };
