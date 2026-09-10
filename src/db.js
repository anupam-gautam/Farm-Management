// IndexedDB primitives. Currently one object store:
//   pendingPhotos — completions captured offline, awaiting upload+sync
//     { id, occurrenceId, accountId, note, photoBlob, createdAt }
//
// Phase 6 also purges any locally cached photos older than 7 days here.

const DB_NAME = 'farm-pwa';
const DB_VERSION = 1;
const STORE = 'pendingPhotos';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = fn(store);
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function queuePendingPhoto(item) {
  const db = await openDb();
  await tx(db, 'readwrite', (s) => s.put(item));
  db.close();
}

export async function listPendingPhotos() {
  const db = await openDb();
  const result = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function removePendingPhoto(id) {
  const db = await openDb();
  await tx(db, 'readwrite', (s) => s.delete(id));
  db.close();
}

export async function countPendingPhotos() {
  return (await listPendingPhotos()).length;
}

/**
 * 7-day local lifecycle (PLAN §2.3): queued photos older than 168h are
 * deleted on app init. By that age the occurrence is long past / missed, so
 * the queued completion is stale — the server-side log history is unaffected.
 */
export async function purgeStalePendingPhotos() {
  const cutoff = Date.now() - 168 * 60 * 60 * 1000;
  const items = await listPendingPhotos();
  let purged = 0;
  for (const item of items) {
    if (new Date(item.createdAt).getTime() < cutoff) {
      await removePendingPhoto(item.id);
      purged++;
    }
  }
  return purged;
}
