/**
 * Shrinks large product photos in the browser before upload.
 *
 * Vercel rejects serverless request bodies over 4.5 MB before the route runs,
 * so photos larger than ~3.5 MB or wider/taller than 2000 px are redrawn to a
 * 2000 px longest side and re-encoded as WebP, or as JPEG where the browser
 * cannot encode WebP (Safari returns PNG from toBlob('image/webp')). Small
 * images, non-raster types and any failure (decode, canvas, toBlob) return the
 * original file unchanged. This function never throws.
 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

const COMPRESS_ABOVE_BYTES = 3.5 * 1024 * 1024;
const TARGET_MAX_BYTES = 3.8 * 1024 * 1024;
const MAX_SIDE_PX = 2000;
const QUALITIES = [0.85, 0.75, 0.65];
const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };
type OutputType = 'image/webp' | 'image/jpeg';

async function decodeBitmap(file: File): Promise<ImageBitmap> {
  try {
    // Pin EXIF orientation so rotated phone photos are drawn upright.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await decodeBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch { /* fall back to <img>, which applies EXIF orientation in modern browsers */ }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('decode failed'));
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: OutputType, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

function draw(canvas: HTMLCanvasElement, decoded: Decoded, whiteBackground: boolean): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (whiteBackground) {
    // JPEG has no alpha; without this, transparent PNG areas turn black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  return true;
}

/** Encodes at stepped-down quality until under the target; null if the browser cannot produce `type`. */
async function encode(canvas: HTMLCanvasElement, type: OutputType): Promise<Blob | null> {
  let blob: Blob | null = null;
  for (const quality of QUALITIES) {
    blob = await toBlob(canvas, type, quality);
    if (!blob || blob.type !== type) return null;
    if (blob.size <= TARGET_MAX_BYTES) break;
  }
  return blob;
}

export async function compressImageForUpload(file: File): Promise<File> {
  try {
    if (!RASTER_TYPES.has(file.type) || typeof document === 'undefined') return file;
    const decoded = await decode(file);
    if (!decoded) return file;
    let canvas: HTMLCanvasElement | null = null;
    try {
      const { width, height } = decoded;
      if (!width || !height) return file;
      const longest = Math.max(width, height);
      if (file.size <= COMPRESS_ABOVE_BYTES && longest <= MAX_SIDE_PX) return file;

      const scale = Math.min(1, MAX_SIDE_PX / longest);
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      if (!draw(canvas, decoded, false)) return file;

      let type: OutputType = 'image/webp';
      let blob = await encode(canvas, type);
      if (!blob) {
        // Safari cannot encode WebP; fall back to JPEG.
        type = 'image/jpeg';
        if (file.type === 'image/png' && !draw(canvas, decoded, true)) return file;
        blob = await encode(canvas, type);
      }
      if (!blob || blob.size >= file.size) return file;
      const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
      const name = `${base}${type === 'image/webp' ? '.webp' : '.jpg'}`;
      return new File([blob], name, { type, lastModified: file.lastModified });
    } finally {
      if (canvas) {
        // Free the backing store now; iOS caps total canvas memory per tab.
        canvas.width = 0;
        canvas.height = 0;
      }
      decoded.release();
    }
  } catch {
    return file;
  }
}
