/**
 * Shrinks large product photos in the browser before upload.
 *
 * Vercel rejects serverless request bodies over 4.5 MB before the route runs,
 * so photos larger than ~3.5 MB or wider/taller than 2000 px are redrawn to a
 * 2000 px longest side and re-encoded as WebP. Small images, non-raster types
 * and any failure (decode, canvas, toBlob) return the original file unchanged.
 * This function never throws.
 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

const COMPRESS_ABOVE_BYTES = 3.5 * 1024 * 1024;
const TARGET_MAX_BYTES = 3.8 * 1024 * 1024;
const MAX_SIDE_PX = 2000;
const QUALITIES = [0.85, 0.75, 0.65];
const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch { /* fall back to <img> */ }
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

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', quality);
    } catch {
      resolve(null);
    }
  });
}

export async function compressImageForUpload(file: File): Promise<File> {
  try {
    if (!RASTER_TYPES.has(file.type) || typeof document === 'undefined') return file;
    const decoded = await decode(file);
    if (!decoded) return file;
    try {
      const { width, height } = decoded;
      if (!width || !height) return file;
      const longest = Math.max(width, height);
      if (file.size <= COMPRESS_ABOVE_BYTES && longest <= MAX_SIDE_PX) return file;

      const scale = Math.min(1, MAX_SIDE_PX / longest);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) return file;
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

      let blob: Blob | null = null;
      for (const quality of QUALITIES) {
        blob = await toBlob(canvas, quality);
        // Browsers without WebP encoding silently return PNG; treat that as unsupported.
        if (!blob || blob.type !== 'image/webp') return file;
        if (blob.size <= TARGET_MAX_BYTES) break;
      }
      if (!blob || blob.size >= file.size) return file;
      const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.webp`;
      return new File([blob], name, { type: 'image/webp', lastModified: file.lastModified });
    } finally {
      decoded.release();
    }
  } catch {
    return file;
  }
}
