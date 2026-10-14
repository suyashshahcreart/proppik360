# Local Development Guide

This guide explains how to run the platform on your local machine for development.

---

## Prerequisites

Install the following before starting:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18 or newer | https://nodejs.org |
| npm | 9 or newer | Comes with Node.js |

You do NOT need Docker, a local database server, or any other tools.

Wrangler (the Cloudflare CLI) is installed automatically by `npm install`.

---

## Installation

```bash
# Clone or create the project folder, then install dependencies:
cd D:\next\tour_saas_platform
npm install
```

---

## How local development works

You run **three** processes simultaneously:

```
Terminal 1: wrangler dev (port 8787)
             ↓
             Cloudflare Worker running locally
             - Handles /api/* requests
             - Uses local D1 (SQLite file in .wrangler/)
             - ZIP multipart uploads go to **real R2** (presigned URLs)
             - On upload complete → POST PROCESSOR_WEBHOOK_URL (/jobs)

Terminal 2: vite (port 5173)
             ↓
             React frontend dev server
             - Hot module replacement (instant updates)
             - Proxies /api/* to the Worker on port 8787

Terminal 3: go run . in tour_processor (port 9000)
             ↓
             Go ZIP processor
             - Receives POST /jobs { tourId }
             - Calls Worker /api/processor/tours/:id for metadata + download URL
             - Downloads ZIP from R2, extracts, re-uploads viewer files
```

You access the app at: **http://localhost:5173**

The frontend dev server on port 5173 handles all React pages, and automatically
forwards any `/api/...` requests to the Worker on port 8787.

If the Go processor is not running, uploads still land in R2 and the tour
stays stuck in `processing` — check Worker logs for
`processor notify failed` or `PROCESSOR_WEBHOOK_URL not set`.

---

## Step 1 — Apply local database migrations

Before running the app for the first time, create the database tables:

```bash
npm run migrate:local
```

This creates a local SQLite file at `.wrangler/state/v3/d1/` and runs the SQL
from `migrations/0001_initial.sql`.

---

## Step 2 — Create a local admin user

Generate a password hash and insert the user into the local database:

```bash
# 1. Generate the hash and INSERT command
node scripts/hash-password.mjs YourPassword123!

# 2. Copy and run the --local command that the script prints
# It will look like:
npx wrangler d1 execute tour-saas-db --local --command "INSERT INTO users ..."
```

You only need to do this once. The user will persist in the local database file.

---

## Step 3 — Configure wrangler.jsonc

Open `wrangler.jsonc`. The default values work for local development:

```jsonc
"vars": {
  "ENVIRONMENT": "development",
  "CORS_ORIGIN": "http://localhost:5173",
  "R2_ACCOUNT_ID": "YOUR_ACCOUNT_ID_HERE",  // ← put your actual account ID
  "R2_BUCKET_NAME": "tour-saas-uploads",
  ...
}
```

Replace `YOUR_ACCOUNT_ID_HERE` with your actual Cloudflare Account ID
(found in the Cloudflare Dashboard sidebar).

---

## Step 4 — Set up R2 secrets for upload testing

The multipart upload presigned URLs require real R2 API credentials, even in
local development. (The local R2 emulation does not support presigned URLs.)

If you have already created R2 API credentials (see `docs/CLOUDFLARE_SETUP.md`
Step 6), set them as local secrets:

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

> **Note:** For local development without R2 credentials, you can still test
> all authentication and tour management features. The upload flow requires
> real R2 credentials to generate presigned URLs.

---

## Step 5 — Start the Worker

```bash
# In Terminal 1:
npm run dev:worker
```

This starts the Cloudflare Worker locally on port 8787.

You will see output like:
```
⛅️ wrangler 3.x.x
...
[mf:inf] Ready on http://127.0.0.1:8787
```

The Worker automatically reloads when you change any `src/worker/**/*.ts` file.

---

## Step 6 — Start the Frontend

```bash
# In Terminal 2 (open a new terminal):
npm run dev:frontend
```

This starts the Vite dev server on port 5173.

You will see:
```
VITE v5.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

---

## Step 7 — Start the Go ZIP processor

ZIP processing does **not** continue after R2 upload unless this service is up.

```bash
# In Terminal 3:
cd D:\next\tour_processor
# Ensure .env exists (copy from .env.example) with:
#   WORKER_API_URL=http://localhost:8787
#   PROCESSOR_SECRET=dev-processor-secret-change-in-production  # must match SaaS
#   R2_* credentials matching tour_saas_platform/.dev.vars
#   PORT=9000
go run .
```

You should see:
```
[main] Tour Processor starting on :9000
[main] Worker API: http://localhost:8787
```

Smoke-check:
```bash
curl http://127.0.0.1:9000/health
# → {"status":"ok"}
```

`PROCESSOR_WEBHOOK_URL` in `wrangler.jsonc` / `.dev.vars` must be
`http://127.0.0.1:9000/jobs`, and `PROCESSOR_SECRET` must match on both sides.

---

## Step 8 — Open the app

Open **http://localhost:5173** in your browser.

You should see the login page. Log in with the credentials you set in Step 2.

---

## Development tips

### Viewing D1 data

```bash
# List all tours
npx wrangler d1 execute tour-saas-db --local --command "SELECT * FROM tours"

# List all users
npx wrangler d1 execute tour-saas-db --local --command "SELECT id, name, email, role FROM users"

# Clear sessions (force re-login)
npx wrangler d1 execute tour-saas-db --local --command "DELETE FROM sessions"
```

### Resetting the local database

Delete the local D1 state and start fresh:

```powershell
# From project root (PowerShell)
Remove-Item -Recurse -Force .wrangler\state\v3\d1 -ErrorAction SilentlyContinue
Remove-Item -Force .dev\local.sqlite -ErrorAction SilentlyContinue

npm run migrate:local
# or (no workerd): npm run migrate:local:node

# Re-create the admin user (not seeded by migrations)
node scripts/hash-password.mjs YourPassword123!
# Run the printed --local wrangler d1 execute command
```

See `migrations/README.md` for migration order and production notes.

### Worker TypeScript types

After changing bindings in `wrangler.jsonc`, regenerate the TypeScript types:

```bash
npm run types
```

This creates/updates `worker-configuration.d.ts` at the project root.

### Checking Worker logs

The Worker prints log output to Terminal 1 (where `wrangler dev` is running).
Look for `console.log` output from the Worker code, like:

```
[auth] Login successful: user=abc123 email=admin@example.com
[upload] Initiated: tour=xyz uploadId=abc parts=290 size=3000000000
```

---

## Common issues

**Port already in use:**
```bash
# Kill whatever is on port 8787
npx kill-port 8787
# Or change the port:
npm run dev:worker -- --port 8788
# And update Vite proxy in vite.config.ts to match
```

**Migrations not applied:**
```
Error: no such table: users
```
→ Run `npm run migrate:local`

**Login fails locally:**
→ Check that you created the admin user in the local database (Step 2)
→ Make sure you used the `--local` flag in the wrangler d1 execute command

**Upload fails with 500:**
→ Check that `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` secrets are set
→ Run `npx wrangler secret list` to verify

**Upload finishes but tour stays in `processing`:**
→ Start the Go processor (`cd D:\next\tour_processor && go run .`)
→ Confirm `curl http://127.0.0.1:9000/health` returns `{"status":"ok"}`
→ Confirm `PROCESSOR_WEBHOOK_URL=http://127.0.0.1:9000/jobs` in `.dev.vars` / `wrangler.jsonc`
→ Confirm `PROCESSOR_SECRET` matches on Worker and processor
→ Restart `npm run dev:worker` after changing `.dev.vars`
