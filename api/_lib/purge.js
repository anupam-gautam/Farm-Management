// Shared 7-day photo purge logic (PLAN §2.3).
//
// Finds completion logs whose stored photo is older than PHOTO_TTL_HOURS
// (168h), permanently deletes the image data, and flips the log to
// photo_status='purged'. The log itself — title, timestamps, worker, note —
// is NEVER touched.

import { deletePhoto } from './blob.js';

const TTL_MS = 168 * 60 * 60 * 1000; // 7 days

/**
 * @returns {{ purged: number, errors: number, cutoffIso: string }}
 */
export async function purgeExpiredPhotos(store) {
  const cutoffIso = new Date(Date.now() - TTL_MS).toISOString();
  const logs = await store.listCompletionLogs();
  const expired = logs.filter(
    (l) => l.photo_status === 'stored' && l.photo_blob_key && l.completed_at < cutoffIso
  );

  let purged = 0;
  let errors = 0;
  for (const log of expired) {
    try {
      await deletePhoto(log.photo_blob_key);
      await store.updateCompletionLog(log.id, {
        photo_blob_key: null,
        photo_status: 'purged',
        photo_purged_at: new Date().toISOString(),
      });
      purged++;
    } catch (err) {
      console.error(`purge failed for log ${log.id}:`, err);
      errors++; // leave it 'stored' — retried on the next run
    }
  }
  return { purged, errors, cutoffIso };
}
