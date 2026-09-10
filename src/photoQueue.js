// Offline photo-completion queue.
//
// When a worker completes a task without connectivity, the compressed photo
// and the completion payload are stored in IndexedDB. On reconnect (or next
// app start) the queue replays: upload photo → complete occurrence → remove.

import { api } from './api.js';
import { blobToBase64 } from './images.js';
import { queuePendingPhoto, listPendingPhotos, removePendingPhoto } from './db.js';
import { requestQueueSync } from './pwa.js';

/** Upload a compressed photo blob; returns its storage key. */
export async function uploadPhoto(blob) {
  const base64 = await blobToBase64(blob);
  const data = await api('/api/photos', { method: 'POST', body: { image: base64 } });
  return data.key;
}

/** Queue a completion (with its compressed photo) for later replay. */
export async function queueCompletion({ occurrenceId, accountId, note, photoBlob }) {
  await queuePendingPhoto({
    id: `pq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    occurrenceId,
    accountId,
    note: note || '',
    photoBlob,
    createdAt: new Date().toISOString(),
  });
  await requestQueueSync();
}

/**
 * Replay every queued completion. Returns { synced, failed, dropped }.
 * 'dropped' = the server says the occurrence is no longer completable
 * (already done / gone) — we discard rather than retry forever.
 */
export async function replayQueue() {
  const items = await listPendingPhotos();
  let synced = 0, failed = 0, dropped = 0;

  for (const item of items) {
    try {
      const photoKey = item.photoBlob ? await uploadPhoto(item.photoBlob) : undefined;
      await api('/api/complete', {
        method: 'POST',
        headers: { 'x-account-id': item.accountId },
        body: { occurrenceId: item.occurrenceId, note: item.note, photoKey },
      });
      await removePendingPhoto(item.id);
      synced++;
    } catch (err) {
      if (err.code === 'already_completed' || err.code === 'not_found' || err.code === 'wrong_worker') {
        await removePendingPhoto(item.id);
        dropped++;
      } else {
        failed++; // network or transient — stays queued for next replay
      }
    }
  }
  return { synced, failed, dropped };
}
