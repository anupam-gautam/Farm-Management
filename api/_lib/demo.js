// Realistic demo dataset for Phase 8 — exercises every task variant.
// Dates are relative to "now" so the feed always looks alive.

import { SCHEMA_VERSION } from './store.js';

function isoOffset(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function farmTodayAt(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const farmOffset = 345; // UTC+5:45
  const shifted = new Date(Date.now() + farmOffset * 60_000);
  const y = shifted.getUTCFullYear();
  const mo = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  return new Date(Date.UTC(y, mo, d, h, m) - farmOffset * 60_000).toISOString();
}

/**
 * Build a full backup payload using the supplied accounts.
 * Requires at least one owner and one worker.
 */
export function buildDemoBackup(accounts) {
  const owner = accounts.find((a) => a.role === 'owner');
  const worker = accounts.find((a) => a.role === 'worker' && a.active);
  if (!owner || !worker) throw new Error('demo_requires_owner_and_worker');

  const now = new Date().toISOString();
  const ownerId = owner.id;
  const workerId = worker.id;

  const tasks = [
    {
      id: 'demo_task_onetime_urgent',
      title: 'Repair broken fence — north paddock',
      description: 'Urgent: cattle escaped yesterday. Photo proof required.',
      scheduled_at: isoOffset(2 * 3600_000),
      recurrence: 'none',
      recurrence_weekdays: null,
      recurrence_time: null,
      recurrence_ends_at: null,
      priority: 'urgent',
      photo_required: true,
      assigned_account_id: workerId,
      active: true,
      created_by: ownerId,
      created_at: isoOffset(-3 * 86_400_000),
      updated_at: now,
    },
    {
      id: 'demo_task_onetime_normal',
      title: 'Deliver feed sacks to barn',
      description: 'One-time delivery from the supplier.',
      scheduled_at: isoOffset(-2 * 3600_000),
      recurrence: 'none',
      recurrence_weekdays: null,
      recurrence_time: null,
      recurrence_ends_at: null,
      priority: 'normal',
      photo_required: false,
      assigned_account_id: workerId,
      active: true,
      created_by: ownerId,
      created_at: isoOffset(-5 * 86_400_000),
      updated_at: now,
    },
    {
      id: 'demo_task_daily',
      title: 'Morning milking',
      description: 'Daily routine — start at 6 AM farm time.',
      scheduled_at: null,
      recurrence: 'daily',
      recurrence_weekdays: null,
      recurrence_time: '06:00',
      recurrence_ends_at: null,
      priority: 'normal',
      photo_required: false,
      assigned_account_id: workerId,
      active: true,
      created_by: ownerId,
      created_at: isoOffset(-14 * 86_400_000),
      updated_at: now,
    },
    {
      id: 'demo_task_weekly',
      title: 'Weekly pasture inspection',
      description: 'Walk the perimeter every Monday and Thursday.',
      scheduled_at: null,
      recurrence: 'weekly',
      recurrence_weekdays: [1, 4],
      recurrence_time: '09:00',
      recurrence_ends_at: null,
      priority: 'urgent',
      photo_required: true,
      assigned_account_id: workerId,
      active: true,
      created_by: ownerId,
      created_at: isoOffset(-21 * 86_400_000),
      updated_at: now,
    },
    {
      id: 'demo_task_photo_purged',
      title: 'Spray pesticide — east field',
      description: 'Completed last week; photo was purged after 7 days.',
      scheduled_at: isoOffset(-10 * 86_400_000),
      recurrence: 'none',
      recurrence_weekdays: null,
      recurrence_time: null,
      recurrence_ends_at: null,
      priority: 'normal',
      photo_required: true,
      assigned_account_id: workerId,
      active: true,
      created_by: ownerId,
      created_at: isoOffset(-12 * 86_400_000),
      updated_at: now,
    },
  ];

  const occurrences = [
    {
      id: 'demo_occ_fence',
      task_id: 'demo_task_onetime_urgent',
      due_at: isoOffset(2 * 3600_000),
      status: 'pending',
      created_at: isoOffset(-3 * 86_400_000),
    },
    {
      id: 'demo_occ_feed_done',
      task_id: 'demo_task_onetime_normal',
      due_at: isoOffset(-2 * 3600_000),
      status: 'completed',
      created_at: isoOffset(-5 * 86_400_000),
    },
    {
      id: 'demo_occ_feed_missed',
      task_id: 'demo_task_onetime_normal',
      due_at: isoOffset(-3 * 86_400_000),
      status: 'missed',
      created_at: isoOffset(-6 * 86_400_000),
    },
    {
      id: 'demo_occ_milk_yesterday',
      task_id: 'demo_task_daily',
      due_at: farmTodayAt('06:00'),
      status: 'pending',
      created_at: isoOffset(-1 * 86_400_000),
    },
    {
      id: 'demo_occ_milk_done',
      task_id: 'demo_task_daily',
      due_at: isoOffset(-1 * 86_400_000),
      status: 'completed',
      created_at: isoOffset(-2 * 86_400_000),
    },
    {
      id: 'demo_occ_pasture',
      task_id: 'demo_task_weekly',
      due_at: isoOffset(86_400_000),
      status: 'pending',
      created_at: isoOffset(-7 * 86_400_000),
    },
    {
      id: 'demo_occ_spray_done',
      task_id: 'demo_task_photo_purged',
      due_at: isoOffset(-10 * 86_400_000),
      status: 'completed',
      created_at: isoOffset(-12 * 86_400_000),
    },
  ];

  const completion_logs = [
    {
      id: 'demo_log_feed',
      occurrence_id: 'demo_occ_feed_done',
      task_id: 'demo_task_onetime_normal',
      task_title_snapshot: 'Deliver feed sacks to barn',
      completed_at: isoOffset(-90 * 60_000),
      completed_by: workerId,
      completed_by_name: worker.display_name,
      worker_note: 'All 20 sacks delivered. Barn door was stuck — fixed the latch.',
      photo_blob_key: null,
      photo_status: 'none',
      photo_purged_at: null,
      created_at: isoOffset(-90 * 60_000),
    },
    {
      id: 'demo_log_milk',
      occurrence_id: 'demo_occ_milk_done',
      task_id: 'demo_task_daily',
      task_title_snapshot: 'Morning milking',
      completed_at: isoOffset(-22 * 3600_000),
      completed_by: workerId,
      completed_by_name: worker.display_name,
      worker_note: 'Cow #3 was restless but milk yield normal.',
      photo_blob_key: null,
      photo_status: 'none',
      photo_purged_at: null,
      created_at: isoOffset(-22 * 3600_000),
    },
    {
      id: 'demo_log_spray_purged',
      occurrence_id: 'demo_occ_spray_done',
      task_id: 'demo_task_photo_purged',
      task_title_snapshot: 'Spray pesticide — east field',
      completed_at: isoOffset(-10 * 86_400_000),
      completed_by: workerId,
      completed_by_name: worker.display_name,
      worker_note: 'Sprayed rows 1–8. Wind was calm. Wore full PPE.',
      photo_blob_key: 'demo/purged-spray-photo.jpg',
      photo_status: 'purged',
      photo_purged_at: isoOffset(-3 * 86_400_000),
      created_at: isoOffset(-10 * 86_400_000),
    },
    {
      id: 'demo_log_late',
      occurrence_id: 'demo_occ_milk_done',
      task_id: 'demo_task_daily',
      task_title_snapshot: 'Morning milking (late example)',
      completed_at: isoOffset(-5 * 86_400_000 + 45 * 60_000),
      completed_by: workerId,
      completed_by_name: worker.display_name,
      worker_note: 'Completed 45 minutes late — truck blocked the lane.',
      photo_blob_key: 'demo/late-milk-photo.jpg',
      photo_status: 'stored',
      photo_purged_at: null,
      created_at: isoOffset(-5 * 86_400_000 + 45 * 60_000),
    },
    {
      id: 'demo_log_photo_ok',
      occurrence_id: 'demo_occ_pasture',
      task_id: 'demo_task_weekly',
      task_title_snapshot: 'Weekly pasture inspection',
      completed_at: isoOffset(-4 * 86_400_000),
      completed_by: workerId,
      completed_by_name: worker.display_name,
      worker_note: 'North gate hinge loose — needs repair soon.',
      photo_blob_key: 'demo/pasture-inspection.jpg',
      photo_status: 'stored',
      photo_purged_at: null,
      created_at: isoOffset(-4 * 86_400_000),
    },
  ];

  const alerts = [
    {
      id: 'demo_alert_ack',
      task_id: 'demo_task_onetime_urgent',
      message: 'Cattle spotted near the road — fix fence ASAP',
      raised_at: isoOffset(-30 * 60_000),
      raised_by: ownerId,
      active: false,
      acknowledged_by: workerId,
      acknowledged_at: isoOffset(-20 * 60_000),
    },
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    accounts: accounts.map((a) => ({
      id: a.id,
      username: a.username,
      hash: a.hash,
      salt: a.salt,
      iterations: a.iterations,
      role: a.role,
      display_name: a.display_name,
      must_change_password: a.must_change_password,
      active: a.active,
      created_at: a.created_at,
      updated_at: a.updated_at,
    })),
    tasks,
    occurrences,
    completion_logs,
    alerts,
    settings: { schemaVersion: SCHEMA_VERSION, demoLoadedAt: now },
  };
}
