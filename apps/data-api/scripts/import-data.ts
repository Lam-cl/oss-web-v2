import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

type Candidate = { namespace: string; key: string; sourcePath: string; body: Buffer; value: any };
const commit = process.argv.includes('--commit');
const rootArg = process.env.TONEWOW_DATA_DIR || process.argv.find((item) => item.startsWith('--data-root='))?.slice(12);
if (!rootArg) throw new Error('Set TONEWOW_DATA_DIR or pass --data-root=/absolute/path.');
const root = path.resolve(rootArg);
if (!path.isAbsolute(rootArg) || await realpath(root) !== root || !(await stat(root)).isDirectory()) throw new Error('Data root must be an existing canonical absolute directory.');

const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const json = (body: Buffer, sourcePath: string) => { try { return JSON.parse(body.toString('utf8')); } catch { throw new Error(`Invalid JSON: ${sourcePath}`); } };
const candidates: Candidate[] = [];

async function addDirectory(namespace: string, relative: string, keyPattern: RegExp) {
  const directory = path.join(root, relative);
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error: any) { if (error?.code === 'ENOENT') return; throw error; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !keyPattern.test(entry.name)) continue;
    const sourcePath = path.join(directory, entry.name);
    const body = await readFile(sourcePath);
    candidates.push({ namespace, key: entry.name.replace(/\.json$/, ''), sourcePath, body, value: json(body, sourcePath) });
  }
}

await addDirectory('catalogue-products', 'catalogue-products', /^[0-9a-f-]{36}\.json$/);
await addDirectory('catalogue-publications', 'catalogue-publications', /^[a-f0-9]{64}\.json$/);
await addDirectory('sim-product-updates', 'sim-product-updates', /^[a-f0-9]{64}\.json$/);
await addDirectory('sim-tone-variant-migrations', 'sim-tone-variant-migrations', /^[a-f0-9]{64}\.json$/);
await addDirectory('ready-collection-email', 'ready-collection-email', /^[0-9]+\.json$/);
await addDirectory('catalogue-adoptions', 'catalogue-imports/by-bundle', /^[0-9]+\.json$/);

for (const [namespace, filename] of [['order-metadata', 'order-metadata.json'], ['shipping-settings', 'shipping-settings.json'],
  ['sim-assignments', 'sim-assignments.json'], ['product-image-colors', 'product-image-colors.json']] as const) {
  const sourcePath = path.join(root, filename);
  try { const body = await readFile(sourcePath); candidates.push({ namespace, key: 'singleton', sourcePath, body, value: json(body, sourcePath) }); }
  catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
}

const publishedMedia = new Set<string>();
const snapshotRoot = path.join(root, 'catalogue-published');
let snapshotEntries: Dirent[] = [];
try { snapshotEntries = await readdir(snapshotRoot, { withFileTypes: true }); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
for (const entry of snapshotEntries) {
  if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
  const sourcePath = path.join(snapshotRoot, entry.name, 'manifest.json');
  const body = await readFile(sourcePath); const value = json(body, sourcePath);
  for (const item of value.media || []) if (typeof item.mediaId === 'string') publishedMedia.add(item.mediaId);
  candidates.push({ namespace: 'catalogue-published', key: entry.name, sourcePath, body, value });
}

const media: Array<{ sourcePath: string; metadata: any; body: Buffer; visibility: 'draft' | 'published' }> = [];
const mediaRoot = path.join(root, 'catalogue-media');
let mediaEntries: Dirent[] = [];
try { mediaEntries = await readdir(mediaRoot, { withFileTypes: true }); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
for (const entry of mediaEntries) {
  if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
  const manifestPath = path.join(mediaRoot, entry.name, 'manifest.json');
  const manifest = json(await readFile(manifestPath), manifestPath);
  for (const metadata of manifest.media || []) {
    const sourcePath = path.join(mediaRoot, entry.name, `${metadata.mediaId}.bin`);
    const body = await readFile(sourcePath);
    if (body.length !== metadata.bytes || sha(body) !== metadata.sha256) throw new Error(`Media integrity mismatch: ${sourcePath}`);
    media.push({ sourcePath, metadata, body, visibility: publishedMedia.has(metadata.mediaId) ? 'published' : 'draft' });
  }
}

const summary = { mode: commit ? 'commit' : 'dry-run', documents: candidates.length, media: media.length, bytes: media.reduce((sum, item) => sum + item.body.length, 0) };
console.log(JSON.stringify(summary, null, 2));
if (!commit) process.exit(0);

const [{ readConfig }, { createPool, migrate }, { createRepository }, { createObjectStore }] = await Promise.all([
  import('../src/config.js'), import('../src/db.js'), import('../src/repository.js'), import('../src/objectStore.js'),
]);
const config = readConfig(); const pool = createPool(config.databaseUrl); const repository = createRepository(pool); const objects = createObjectStore(config.minio);
try {
  await migrate(pool); await objects.ensureBuckets();
  for (const item of candidates) {
    const createdAt = typeof item.value.createdAt === 'string' ? item.value.createdAt : new Date((await stat(item.sourcePath)).birthtimeMs).toISOString();
    const updatedAt = typeof item.value.updatedAt === 'string' ? item.value.updatedAt : createdAt;
    await repository.importDocument({ namespace: item.namespace, key: item.key, revision: Number(item.value.revision) || 1,
      value: item.value, sourceSha256: sha(item.body), createdAt, updatedAt }, path.relative(root, item.sourcePath));
  }
  for (const item of media) {
    const upload = await objects.put(item.visibility, item.metadata.catalogueId, item.body, item.metadata.contentType);
    await pool.query(
      `INSERT INTO catalogue_media(media_id,catalogue_id,object_key,original_name,content_type,bytes,sha256,display_order,assignment,visibility,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(media_id) DO UPDATE SET object_key=EXCLUDED.object_key,visibility=EXCLUDED.visibility
       WHERE catalogue_media.sha256=EXCLUDED.sha256`,
      [item.metadata.mediaId, item.metadata.catalogueId, upload.objectKey, item.metadata.originalName, item.metadata.contentType,
        item.metadata.bytes, item.metadata.sha256, item.metadata.order, item.metadata.assignment, item.visibility, item.metadata.createdAt],
    );
  }
  console.log(JSON.stringify({ ...summary, committed: true }, null, 2));
} finally { await pool.end(); }
