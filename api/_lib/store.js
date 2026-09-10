// Data-access layer — npoint.io JSON backend.
// Set NPOINT_BIN_ID in environment variables.

const BIN_ID = process.env.NPOINT_BIN_ID;
const BASE = `https://api.npoint.io/${BIN_ID}`;

async function read() {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(`npoint read failed: ${res.status}`);
  return res.json();
}

async function write(db) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(db),
  });
  if (!res.ok) throw new Error(`npoint write failed: ${res.status}`);
}

import { assigneeFieldsFromIds, normalizeTaskAssignees } from './assignees.js';

export const SCHEMA_VERSION = 1;

function normalizeAccountRow(a) {
  return {
    id: a.id,
    username: a.username,
    hash: a.hash ?? a.password_hash,
    salt: a.salt,
    iterations: a.iterations,
    role: a.role,
    display_name: a.display_name,
    must_change_password: Boolean(a.must_change_password),
    active: a.active !== false,
    created_at: a.created_at || new Date().toISOString(),
    updated_at: a.updated_at || new Date().toISOString(),
  };
}

let storePromise = null;
export function getStore() {
  if (!storePromise) storePromise = Promise.resolve(createStore());
  return storePromise;
}
export function resetStoreForTests() {
  storePromise = null;
}

function createStore() {
  return {
    kind: 'npoint',

    async ensureSchema() {
      const db = await read();
      if (db.meta.schemaVersion !== SCHEMA_VERSION) {
        db.meta.schemaVersion = SCHEMA_VERSION;
        await write(db);
      }
      return SCHEMA_VERSION;
    },

    async seedIfEmpty(accounts) {
      const db = await read();
      if (db.accounts.length > 0) return false;
      const now = new Date().toISOString();
      db.accounts = accounts.map((a, i) => ({
        id: `acc_${Date.now()}_${i}`,
        ...a,
        created_at: now,
        updated_at: now,
      }));
      db.meta.seededAt = now;
      await write(db);
      return true;
    },

    async listAccounts() {
      return (await read()).accounts;
    },

    async insertAccount(account) {
      const db = await read();
      const now = new Date().toISOString();
      const row = { id: `acc_${Date.now()}_${db.accounts.length}`, ...account, created_at: now, updated_at: now };
      db.accounts.push(row);
      await write(db);
      return row;
    },

    async updateAccount(id, fields) {
      const db = await read();
      const row = db.accounts.find((a) => a.id === id);
      if (!row) return null;
      Object.assign(row, fields, { updated_at: new Date().toISOString() });
      await write(db);
      return row;
    },

    async getMeta(key) {
      return (await read()).meta[key];
    },

    async setMeta(key, value) {
      const db = await read();
      db.meta[key] = value;
      await write(db);
    },

    async listTasks() {
      return (await read()).tasks.map(normalizeTaskAssignees);
    },

    async insertTask(task) {
      const db = await read();
      const now = new Date().toISOString();
      const assignees = assigneeFieldsFromIds(
        task.assigned_account_ids?.length
          ? task.assigned_account_ids
          : (task.assigned_account_id ? [task.assigned_account_id] : []),
      );
      const row = normalizeTaskAssignees({
        id: `task_${Date.now()}_${db.tasks.length}`,
        skipped_due_at: task.skipped_due_at ?? [],
        ...task,
        ...assignees,
        created_at: now,
        updated_at: now,
      });
      db.tasks.push(row);
      await write(db);
      return row;
    },

    async updateTask(id, fields) {
      const db = await read();
      const row = db.tasks.find((t) => t.id === id);
      if (!row) return null;
      const patch = { ...fields };
      if (fields.assigned_account_ids !== undefined || fields.assigned_account_id !== undefined) {
        Object.assign(patch, assigneeFieldsFromIds(
          fields.assigned_account_ids?.length
            ? fields.assigned_account_ids
            : (fields.assigned_account_id ? [fields.assigned_account_id] : row.assigned_account_ids || []),
        ));
      }
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      Object.assign(row, normalizeTaskAssignees(row));
      await write(db);
      return row;
    },

    async deleteTask(id) {
      const db = await read();
      db.tasks = db.tasks.filter((t) => t.id !== id);
      db.occurrences = db.occurrences.filter((o) => o.task_id !== id);
      await write(db);
    },

    async listOccurrences({ sinceIso, fromIso, toIso } = {}) {
      const db = await read();
      const start = fromIso ?? sinceIso;
      return db.occurrences.filter((o) => {
        if (start && o.due_at < start) return false;
        if (toIso && o.due_at >= toIso) return false;
        return true;
      });
    },

    async insertOccurrencesIfMissing(rows) {
      const db = await read();
      const existing = new Set(db.occurrences.map((o) => `${o.task_id}|${o.due_at}`));
      const now = new Date().toISOString();
      let inserted = 0;
      for (const r of rows) {
        const key = `${r.task_id}|${r.due_at}`;
        if (existing.has(key)) continue;
        db.occurrences.push({
          id: `occ_${Date.now()}_${db.occurrences.length}`,
          status: 'pending',
          ...r,
          created_at: now,
        });
        existing.add(key);
        inserted++;
      }
      if (inserted) await write(db);
      return inserted;
    },

    async deleteFuturePendingOccurrences(taskId, nowIso) {
      const db = await read();
      db.occurrences = db.occurrences.filter(
        (o) => !(o.task_id === taskId && o.status === 'pending' && o.due_at > nowIso)
      );
      await write(db);
    },

    async markMissedOccurrences(cutoffIso) {
      const db = await read();
      let changed = 0;
      for (const o of db.occurrences) {
        if (o.status === 'pending' && o.due_at < cutoffIso) {
          o.status = 'missed';
          changed++;
        }
      }
      if (changed) await write(db);
      return changed;
    },

    async getOccurrence(id) {
      const db = await read();
      return db.occurrences.find((o) => o.id === id) || null;
    },

    async setOccurrenceStatus(id, status) {
      const db = await read();
      const row = db.occurrences.find((o) => o.id === id);
      if (!row) return null;
      row.status = status;
      await write(db);
      return row;
    },

    async deleteOccurrence(id) {
      const db = await read();
      const before = db.occurrences.length;
      db.occurrences = db.occurrences.filter((o) => o.id !== id);
      if (db.occurrences.length === before) return false;
      await write(db);
      return true;
    },

    async skipOccurrence(occurrenceId) {
      const db = await read();
      const occurrence = db.occurrences.find((o) => o.id === occurrenceId);
      if (!occurrence) return null;
      const task = db.tasks.find((t) => t.id === occurrence.task_id);
      if (!task) return null;
      const skipped = [...new Set([...(task.skipped_due_at || []), occurrence.due_at])];
      task.skipped_due_at = skipped;
      task.updated_at = new Date().toISOString();
      db.occurrences = db.occurrences.filter((o) => o.id !== occurrenceId);
      await write(db);
      return occurrence;
    },

    async migrateLegacyCancelledOccurrences() {
      const db = await read();
      const legacy = db.occurrences.filter((o) => o.status === 'cancelled');
      if (!legacy.length) return;
      for (const occ of legacy) {
        const task = db.tasks.find((t) => t.id === occ.task_id);
        if (!task) continue;
        task.skipped_due_at = [...new Set([...(task.skipped_due_at || []), occ.due_at])];
        task.updated_at = new Date().toISOString();
      }
      db.occurrences = db.occurrences.filter((o) => o.status !== 'cancelled');
      await write(db);
    },

    async insertCompletionLog(log) {
      const db = await read();
      const row = {
        id: `log_${Date.now()}_${db.completion_logs.length}`,
        photo_blob_key: null,
        photo_status: 'none',
        photo_purged_at: null,
        ...log,
        created_at: new Date().toISOString(),
      };
      db.completion_logs.push(row);
      await write(db);
      return row;
    },

    async listCompletionLogs({ fromIso, toIso } = {}) {
      const logs = (await read()).completion_logs;
      return logs.filter((l) => {
        if (fromIso && l.completed_at < fromIso) return false;
        if (toIso && l.completed_at >= toIso) return false;
        return true;
      });
    },

    async updateCompletionLog(id, fields) {
      const db = await read();
      const row = db.completion_logs.find((l) => l.id === id);
      if (!row) return null;
      Object.assign(row, fields);
      await write(db);
      return row;
    },

    async insertAlert(alert) {
      const db = await read();
      const row = {
        id: `alert_${Date.now()}_${db.alerts.length}`,
        active: true,
        acknowledged_by: null,
        acknowledged_at: null,
        ...alert,
      };
      db.alerts.push(row);
      await write(db);
      return row;
    },

    async listAlerts({ activeOnly = false } = {}) {
      const db = await read();
      return activeOnly ? db.alerts.filter((a) => a.active) : db.alerts;
    },

    async acknowledgeAlert(id, accountId) {
      const db = await read();
      const row = db.alerts.find((a) => a.id === id);
      if (!row) return null;
      row.active = false;
      row.acknowledged_by = accountId;
      row.acknowledged_at = new Date().toISOString();
      await write(db);
      return row;
    },

    async exportBackup() {
      const db = await read();
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        accounts: db.accounts.map(normalizeAccountRow),
        tasks: db.tasks,
        occurrences: db.occurrences,
        completion_logs: db.completion_logs,
        alerts: db.alerts,
        settings: { ...db.meta },
      };
    },

    async importBackup(payload) {
      await write({
        meta: { ...(payload.settings || {}), schemaVersion: SCHEMA_VERSION, importedAt: new Date().toISOString() },
        accounts: (payload.accounts || []).map(normalizeAccountRow),
        tasks: payload.tasks || [],
        occurrences: payload.occurrences || [],
        completion_logs: payload.completion_logs || [],
        alerts: payload.alerts || [],
      });
    },

    async factoryReset(seedAccounts) {
      const now = new Date().toISOString();
      await write({
        meta: { schemaVersion: SCHEMA_VERSION, seededAt: now },
        accounts: seedAccounts.map((a, i) => normalizeAccountRow({
          id: `acc_${Date.now()}_${i}`,
          ...a,
          created_at: now,
          updated_at: now,
        })),
        tasks: [],
        occurrences: [],
        completion_logs: [],
        alerts: [],
      });
    },
  };
}
