import sharp from 'sharp';

export type CatalogueUploadContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type CatalogueUploadImage = { name: string; type: CatalogueUploadContentType; body: Blob };

/**
 * The shop provider (Bundle) cannot publish WebP photos: the first WebP upload
 * in Nov 2026 left the PIXEL TAPIR publish stuck with a digest readback
 * mismatch. Convert WebP to JPEG on arrival so every stored catalogue photo is
 * JPEG or PNG. JPEG and PNG pass through untouched (their sha256 must stay
 * stable for already-published products).
 */
export async function normalizeCatalogueUploadImage(input: CatalogueUploadImage): Promise<CatalogueUploadImage> {
  if (input.type !== 'image/webp') return input;
  const source = Buffer.from(await input.body.arrayBuffer());
  let jpeg: Buffer;
  try {
    jpeg = await sharp(source, { failOn: 'error', limitInputPixels: 80_000_000 })
      .rotate()
      // Keep the JPEG well under the 10 MB media limit even for very large WebP sources.
      .resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
      // JPEG has no alpha; transparent WebP areas become white, not black.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new CatalogueUploadImageError(`Photo "${input.name}" could not be read as a WebP image. Save it as JPEG or PNG and upload again.`);
  }
  const base = input.name.replace(/\.[^.]+$/, '') || 'photo';
  return { name: `${base}.jpg`, type: 'image/jpeg', body: new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }) };
}

export class CatalogueUploadImageError extends Error {
  readonly status = 400;
  constructor(message: string) { super(message); this.name = 'CatalogueUploadImageError'; }
}
