// Photo storage abstraction — same pattern as store.js:
//   - Vercel Blob  (production: BLOB_READ_WRITE_TOKEN present) — public URLs
//   - Local disk   (development: data/photos/, served via GET /api/photos?key=)
//
// A "key" is either a full blob URL (production) or a local filename (dev).
// Callers never branch on which is live.

import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const LOCAL_DIR = process.env.FARM_PHOTOS_DIR || path.join(process.cwd(), 'data', 'photos');

export function isRemoteStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Store JPEG bytes; returns the photo key. */
export async function putPhoto(buffer) {
  if (isRemoteStorage()) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`photos/${randomUUID()}.jpg`, buffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
    });
    return blob.url; // key IS the public URL in production
  }
  await mkdir(LOCAL_DIR, { recursive: true });
  const key = `${randomUUID()}.jpg`;
  await writeFile(path.join(LOCAL_DIR, key), buffer);
  return key;
}

/** Read photo bytes (local backend only — production serves from the URL). */
export async function getPhotoBuffer(key) {
  // Path-traversal guard: keys are plain filenames.
  if (key.includes('/') || key.includes('\\') || key.includes('..')) return null;
  try {
    return await readFile(path.join(LOCAL_DIR, key));
  } catch {
    return null;
  }
}

/** Permanently delete a photo (7-day purge, Phase 6). */
export async function deletePhoto(key) {
  if (isRemoteStorage()) {
    const { del } = await import('@vercel/blob');
    await del(key);
    return;
  }
  await unlink(path.join(LOCAL_DIR, key)).catch(() => {});
}
