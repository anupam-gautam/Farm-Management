// Demo data load + factory reset (Phase 8).

import { api } from './api.js';
import { ownerGuardHeaders } from './auth.js';

export async function loadDemoData() {
  return api('/api/seed', {
    method: 'POST',
    headers: await ownerGuardHeaders(),
    body: { action: 'demo' },
  });
}

export async function factoryReset() {
  return api('/api/seed', {
    method: 'POST',
    headers: await ownerGuardHeaders(),
    body: { action: 'reset' },
  });
}
