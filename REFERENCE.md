# Farm Manager PWA — Technical Reference

> AI hint: This is a remote farm task management PWA. Owner assigns tasks remotely, workers complete them on-site with optional photo proof. No build step — edit files and run. Jump straight to **File Map** to find what you need.

---

## What This App Does

- **Owner** (remote): creates/assigns tasks, raises urgent alerts, views photo proof, manages worker accounts
- **Worker** (on-site): sees assigned task feed, completes tasks with notes/photos, acknowledges alerts
- Tasks can be one-time or recurring (daily/weekly). Completion is locked until 30 min before due time.
- Photos auto-purge after 7 days; text history is permanent.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5 + ES modules + Tailwind CSS (CDN) — **no build step** |
| Routing | Hash-based SPA (`#/dashboard`, `#/worker`, etc.) in `src/main.js` |
| Backend | Vercel Serverless Functions (`/api/*.js`) |
| Database | JSON file — `data/local-db.json` (local) / `/tmp/db.json` (Vercel prod) |
| File Storage | Vercel Blob (photos) |
| Offline | `localStorage` cache + IndexedDB queue (`src/db.js`) |
| Auth | PBKDF2-SHA256 hashed, compared client-side (usability gate, not security boundary) |
| i18n | English + Nepali — all strings via `t('key')` in `src/i18n-dictionary.js` |
| Cron | Vercel Cron → `api/cron/purge-photos.js` (daily 7-day photo purge) |

---

## Database — JSON File Only (No Postgres)

The entire database is a single JSON file. No external database service is needed anywhere.

| Environment | File path | How it's set |
|---|---|---|
| Local dev | `data/local-db.json` | default (no env var needed) |
| Vercel prod | `/tmp/db.json` | set `FARM_LOCAL_DB=/tmp/db.json` in Vercel env vars |

`/tmp` is the only writable path in Vercel's serverless runtime. The file is created automatically on first request if it doesn't exist.

**Security** — `/data/*` is blocked from public URL access via a rewrite rule in `vercel.json`:
```json
{ "source": "/data/(.*)", "destination": "/404" }
```
The JSON file is only ever read/written by serverless functions in `api/` — never served directly to the browser.

**`api/_lib/store.js`** — `getStore()` always returns the file backend. The path is controlled by `FARM_LOCAL_DB` env var. No Postgres, no switching logic.

**Important Vercel limitation** — `/tmp` is ephemeral. Each serverless function invocation may get a fresh container with an empty `/tmp`. This means data written in one request may not be visible in the next if Vercel spins up a new container. For a small private farm app with low traffic this is acceptable. For persistence across cold starts, use the **Backup/Restore** feature regularly (Owner → Settings → Export data).

---

## File Map

```
index.html              # App shell — top bar, view container, #modal-host, #alert-host
manifest.json / sw.js   # PWA install + offline cache
vercel.json             # Routes, /data/* block, cron schedule, security headers

src/
  main.js               # Bootstrap, hash router, top-bar wiring, lang toggle
  config.js             # Constants: 30-min window, poll interval, image targets
  api.js                # fetch wrapper, server-time skew, offline detection
  auth.js               # PBKDF2 hashing, login, session (sessionStorage), owner guard headers
  sync.js               # 20s poll loop, write queue, offline reconciliation
  tasks.js              # fetchTaskFeed(), deriveStatus(), sortForWorkerFeed(), canComplete()
  alerts.js             # renderAlertBanner(), getTaskAlert(), chime, notifications
  i18n.js               # t(), setLang(), formatSmartDateTime(), formatRelative()
  i18n-dictionary.js    # All EN + Nepali strings (185 keys each — must stay in parity)
  db.js                 # IndexedDB: pending photo queue
  images.js             # Canvas compression (1024px, JPEG 0.7)
  photoQueue.js         # uploadPhoto(), queueCompletion(), replayQueue()
  backup.js             # JSON export/import
  seed.js               # Demo data + factory reset
  charts.js             # SVG analytics (no library)
  dateRange.js          # Date filter presets, range helpers
  nepaliDate.js         # Bikram Sambat conversion
  pwa.js                # Install prompt, update banner

  views/
    login.js            # Login + forced password change
    ownerDashboard.js   # Task list, alert indicators, assign/edit/delete, raise alert modal
    workerFeed.js       # Worker task cards with alert indicators, completion modal
    taskEditor.js       # Create/edit task drawer
    recurringChoice.js  # Edit this day vs entire series modal
    workers.js          # Worker account manager
    settings.js         # Backup/restore, demo data, factory reset, purge
    gallery.js          # Photo proof gallery
    analytics.js        # Charts and completion stats
    components/
      dateFilterBar.js  # Reusable date range filter bar

api/
  bootstrap.js          # Seeds accounts from credentials.seed.json on first call
  tasks.js              # GET feed (tasks+occurrences+serverTime), POST create/update/delete/cancel
  alerts.js             # GET active alerts, POST raise (owner), POST acknowledge (worker)
  complete.js           # POST completion — re-validates 30-min rule server-side
  photos.js             # POST upload to Blob, GET signed URL
  accounts.js           # GET list, POST create/update/reset-password
  logs.js               # GET completion logs
  backup.js             # GET export, POST full-overwrite import
  seed.js               # POST load demo data
  cron/purge-photos.js  # Deletes blobs >7 days, sets photo_status='purged'

  _lib/
    store.js            # getStore() — JSON file backend only, path from FARM_LOCAL_DB env var
    guard.js            # checkOwnerGuard() — validates x-owner-key header
    assignees.js        # Multi-worker assignment helpers
    recurrence.js       # expandTask() — generates occurrence due dates
    range.js            # parseRangeQuery() for date filtering
    blob.js             # Vercel Blob helpers
    purge.js            # Photo purge logic
    time.js             # Farm timezone offset

data/
  credentials.seed.json # Bootstrap accounts (hashed) — read by api/bootstrap.js on first call
  local-db.json         # Local dev database (auto-created, gitignored)

tools/
  dev-server.js         # Local dev server: node tools/dev-server.js → http://localhost:8765
  check-*.js            # Test suites (i18n, auth, tasks, alerts, backup, etc.)
```

---

## Data Model

All stored in the JSON file under top-level keys: `meta`, `accounts`, `tasks`, `occurrences`, `completion_logs`, `alerts`.

**accounts** — `id, username, password_hash, salt, iterations, role (owner|worker), display_name, must_change_password, active`

**tasks** — `id, title, description, scheduled_at, recurrence (none|daily|weekly), recurrence_weekdays, recurrence_time, recurrence_ends_at, priority (normal|urgent), photo_required, assigned_account_id, assigned_account_ids, active, skipped_due_at, created_by`

**occurrences** — `id, task_id, due_at, status (pending|completed|missed|cancelled)` — one row per actual due instance; recurring tasks expand into occurrences for a rolling window

**completion_logs** — append-only, never deleted — `id, occurrence_id, task_id, task_title_snapshot, completed_at, completed_by, completed_by_name, worker_note, photo_blob_key, photo_status (none|stored|purged), photo_purged_at`

**alerts** — `id, task_id, message, raised_at, raised_by, active, acknowledged_by, acknowledged_at`

---

## Key Behaviours

**30-min completion rule** — `canComplete()` in `src/tasks.js`. Worker can complete only when `now >= due_at - 30min`. Server re-validates in `api/complete.js`. Clock skew corrected via server time captured in `api.js`.

**Recurring tasks** — `expandTask()` in `api/_lib/recurrence.js` generates occurrence `due_at` values for a rolling window. Called on every `GET /api/tasks`. Idempotent — deduplicates by `task_id|due_at` key.

**Alert flow** — Owner clicks "Send urgent alert" → `POST /api/alerts {action:'raise', taskId}` → stored `active:true`. `fetchTaskFeed()` fetches alerts in parallel. `alertTaskIds` Set drives `hasAlert` flag in `cardHtml()`. Visual: red ring + 🔔 icon + "Alert active" on card. Worker acknowledges → `active:false`.

**Auth flow** — `GET /api/accounts` returns all accounts including hashes. Browser runs PBKDF2 comparison. Session in `sessionStorage`. Owner guard: `x-owner-key` = `SHA256(ownerHash + '|farm-guard')`.

**Offline** — Writes queued in `localStorage` by `sync.js`. Photos queued in IndexedDB by `db.js`. `replayQueue()` on reconnect.

**i18n rule** — Zero string literals in views. All text via `t('section.key')`. EN and NE must have identical key sets — enforced by `tools/check-i18n.js`.

---

## Local Development

```bash
npm install
node tools/dev-server.js
# → http://localhost:8765
```

Data stored in `data/local-db.json` (auto-created on first request). Delete it to reset.

Default credentials (from `data/credentials.seed.json`):
- Owner: `admin` / `farm123`
- Worker: `worker` / `field123`

Run tests: `npm test`

---

## Deploy to Vercel

No database service needed. The app runs entirely on Vercel Serverless Functions + a JSON file in `/tmp`.

### Steps

1. Push repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Add New Project → import the repo
3. Set these environment variables in the Vercel dashboard (Project → Settings → Environment Variables):

| Variable | Value | Required |
|---|---|---|
| `FARM_LOCAL_DB` | `/tmp/db.json` | **Yes** — tells the app where to write data on Vercel |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token | Yes — for photo storage |
| `CRON_SECRET` | Any random string | Yes — protects the purge cron endpoint |
| `FARM_TZ_OFFSET_MINUTES` | `345` | Optional — Nepal UTC+5:45, change for your timezone |

4. Deploy. On first visit, open `https://your-app.vercel.app/api/bootstrap` — this seeds the default accounts.
5. Log in as `admin` / `farm123` and immediately change the password.

### How to get BLOB_READ_WRITE_TOKEN

Vercel dashboard → Storage → Create → Blob Store → copy the `BLOB_READ_WRITE_TOKEN` from the `.env` tab.

### After each deploy

Bump `CACHE_VERSION` in `sw.js` so existing users get the "update available" prompt.

### Vercel services used

| Service | Purpose |
|---|---|
| Vercel Serverless Functions | All `/api/*` handlers |
| Vercel Blob | Photo storage only (`@vercel/blob`) |
| Vercel Cron | Daily photo purge at 02:00 UTC |
| `/tmp` filesystem | JSON database — ephemeral per container |

### Data persistence warning

Vercel `/tmp` is container-local and ephemeral. Data persists as long as the same container is reused (typically minutes to hours). For a low-traffic private app this works fine in practice. **Use the Backup feature** (Owner → Settings → Export) regularly to keep a safe copy. If the container is recycled, the next request to `/api/bootstrap` will re-seed default accounts — restore from your backup JSON immediately after.

---

## Security Notes

- `/data/*` URLs return 404 — the JSON file is never served directly
- Credentials are PBKDF2-hashed but compared in the browser — the hash list is readable by anyone with the URL. Mitigations: strong hashing, forced password change on first login, owner guard header on destructive endpoints, `robots.txt` + `noindex`
- Keep the Vercel deployment URL private — it is the only access control at the network level

---

## Backup

Owner → Settings → Export data → downloads full JSON. To restore: Settings → Import data (full overwrite). **Export before every import.** There is no automatic safety backup.
