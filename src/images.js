// Client-side image compression via the Canvas API.
// Every photo is compressed BEFORE upload or storage: max 1024×1024,
// JPEG quality 0.7 (CONFIG), EXIF orientation honoured.

import { CONFIG } from './config.js';

/**
 * Compress an image File/Blob.
 * Returns { blob, width, height, originalBytes, compressedBytes }.
 */
export async function compressImage(file) {
  const source = await loadImage(file);

  const max = CONFIG.IMAGE_MAX_DIMENSION;
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source.image, 0, 0, width, height);
  releaseImage(source);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', CONFIG.IMAGE_JPEG_QUALITY)
  );
  if (!blob) throw new Error('compression_failed');

  return {
    blob,
    width,
    height,
    originalBytes: file.size,
    compressedBytes: blob.size,
  };
}

/** createImageBitmap honours EXIF orientation with imageOrientation:'from-image';
 *  fall back to an <img> element (browsers auto-orient those too). */
async function loadImage(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, bitmap };
  } catch {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image_decode_failed'));
      el.src = url;
    });
    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      objectUrl: url,
    };
  }
}

function releaseImage(source) {
  if (source.bitmap) source.bitmap.close();
  if (source.objectUrl) URL.revokeObjectURL(source.objectUrl);
}

/** Blob → base64 string (for JSON upload). */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
}

/** Human-readable byte size: "842 KB", "2.1 MB". */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
