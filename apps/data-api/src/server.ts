import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { readConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { createObjectStore } from './objectStore.js';
import { createRepository, NAMESPACES } from './repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA = /^[a-f0-9]{64}$/;
const CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value;
const config = readConfig();
const pool = createPool(config.databaseUrl);
const repository = createRepository(pool);
const objects = createObjectStore(config.minio);
const app = express();

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
