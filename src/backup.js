// JSON export / overwrite import (Phase 8).

import { api } from './api.js';
import { ownerGuardHeaders } from './auth.js';

/** Download a full backup as a JSON file. */
export async function downloadBackup() {
  const data = await api('/api/backup', { headers: await ownerGuardHeaders() });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `farm-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Overwrite server data from a parsed backup object. */
export async function importBackup(backup) {
  return api('/api/backup', {
    method: 'POST',
    headers: await ownerGuardHeaders(),
    body: backup,
  });
}

/** Read a File object and parse as JSON backup. */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error('invalid_file'));
      }
    };
    reader.onerror = () => reject(new Error('invalid_file'));
    reader.readAsText(file);
  });
}
