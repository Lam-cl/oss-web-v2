import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { catalogueR2AssetKey, catalogueR2AssetUrl, type CatalogueAssetVariant } from '@/lib/catalogueR2AssetPaths';
export { catalogueR2AssetKey, catalogueR2AssetUrl } from '@/lib/catalogueR2AssetPaths';

const UPLOAD_ORIGIN = 'https://tonewow-r2-upload.xifuhalim.com';
const MAX_BYTES = 1_000_000;
const CARD_TARGET_BYTES = 100_000;

export type CatalogueAssetSource = { catalogueId: string; sha256: string; body: Uint8Array };
export async function compressCatalogueImage(body: Uint8Array, variant: CatalogueAssetVariant): Promise<Buffer> {
  const image = sharp(body, { failOn: 'error', limitInputPixels: 80_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Image dimensions could not be read.');
  const maximumWidth = variant === 'card' ? 480 : 1200;
  const target = variant === 'card' ? CARD_TARGET_BYTES : 100_000;
  let best: Buffer | null = null;
  for (const width of [maximumWidth, Math.round(maximumWidth * .8), Math.round(maximumWidth * .65), Math.round(maximumWidth * .5)]) {
    for (const quality of variant === 'card' ? [80, 68, 56, 44, 35] : [84, 74, 64, 54, 45]) {
      const encoded = await sharp(body, { failOn: 'error', limitInputPixels: 80_000_000 })
        .rotate().resize({ width, withoutEnlargement: true, fit: 'inside' })
        .webp({ quality, effort: 6 }).toBuffer();
      if (encoded.length < MAX_BYTES && (!best || encoded.length < best.length)) best = encoded;
      if (encoded.length < target) return encoded;
    }
    if (variant === 'gallery' && best) return best;
  }
  if (!best) throw new Error(`Optimized ${variant} image exceeds the 1,000,000-byte R2 limit.`);
  return best;
}

async function verifyPublicObject(url: string, expected?: Buffer) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/webp') {
    throw new Error(`R2 public image readback failed (${response.status}).`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length >= MAX_BYTES || body.toString('ascii', 0, 4) !== 'RIFF'
    || body.toString('ascii', 8, 12) !== 'WEBP' || expected && !body.equals(expected)) {
    throw new Error('R2 public image bytes are invalid or do not match the optimized source.');
  }
  const cacheControl = response.headers.get('cache-control') || '';
  if (!/max-age=31536000/.test(cacheControl) || !/immutable/.test(cacheControl)) {
    throw new Error('R2 public image cache headers are missing.');
  }
}

export async function ensureCatalogueR2Assets(source: CatalogueAssetSource) {
  const digest = createHash('sha256').update(source.body).digest('hex');
  if (digest !== source.sha256) throw new Error('Catalogue image source hash mismatch.');
  const token = process.env.TONEWOW_DATA_API_TOKEN?.trim();
  if (!token) throw new Error('R2 upload authorization is not configured. Publish was stopped.');
  for (const variant of ['card', 'gallery'] as const) {
    const key = catalogueR2AssetKey(source.catalogueId, source.sha256, variant);
    const existing = await fetch(`${UPLOAD_ORIGIN}/v1/${key}`, {
      method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}` },
    });
    if (existing.ok) {
      const bytes = Number(existing.headers.get('content-length'));
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes >= MAX_BYTES
        || existing.headers.get('content-type') !== 'image/webp') throw new Error(`Existing R2 ${variant} image is invalid.`);
      await verifyPublicObject(catalogueR2AssetUrl(source.catalogueId, source.sha256, variant));
      continue;
    }
    if (existing.status !== 404) throw new Error(`R2 ${variant} image check failed (${existing.status}).`);
    const optimized = await compressCatalogueImage(source.body, variant);
    const sha256 = createHash('sha256').update(optimized).digest('hex');
    const response = await fetch(`${UPLOAD_ORIGIN}/v1/${key}`, {
      method: 'PUT', cache: 'no-store', signal: AbortSignal.timeout(25_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'image/webp',
        'content-length': String(optimized.length), 'x-content-sha256': sha256 },
      body: new Uint8Array(optimized),
    });
    if (!response.ok) throw new Error(`R2 upload rejected ${variant} image (${response.status}).`);
    const result = await response.json() as { key?: string; bytes?: number; sha256?: string };
    if (result.key !== key || result.bytes !== optimized.length || result.sha256 !== sha256) {
      throw new Error(`R2 upload readback did not match ${variant} image.`);
    }
    await verifyPublicObject(catalogueR2AssetUrl(source.catalogueId, source.sha256, variant), optimized);
  }
}
