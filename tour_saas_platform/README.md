# 360° Tour SaaS Platform — Foundation

A production-ready foundation for a 360° virtual tour SaaS platform.

Built on Cloudflare Workers, D1, and R2. Large ZIP files are uploaded
directly from the browser to R2 — the Worker never receives the file bytes.

---

## What this includes

- **Login / Authentication** — secure session-based auth, PBKDF2 password hashing
- **Dashboard** — live stats from D1 (total, uploading, ready tours)
- **Tour management** — create and list tours
- **Large file upload** — direct browser-to-R2 multipart upload with progress
- **Cloudflare Worker API** — Hono-based REST API with authentication middleware
- **D1 database** — users, sessions, tours schema with migrations
- **R2 storage** — `tours/{tourId}/original.zip`
- **Documentation** — step-by-step Cloudflare Dashboard setup guide

---

## Architecture

```
Browser (React + Bootstrap 5)
  │
  │  /api/* → Cloudflare Worker (Hono)
  │                │
  │                ├─ Authentication (PBKDF2 + D1 sessions)
  │                ├─ Tour management (D1)
  │                └─ Upload orchestration
  │                    │
  │                    ├─ Create multipart upload (R2 S3 API)
  │                    ├─ Sign presigned URLs per part (aws4fetch)
  │                    └─ Complete/abort (R2 S3 API)
  │
  └─ ZIP parts → R2 directly (presigned URLs, Worker never touched)
```

### Upload flow (simplified)

```
Browser → Worker: create tour (POST /api/tours)
Browser → Worker: initiate upload (POST .../upload/initiate)
Worker  → R2:    CreateMultipartUpload
Browser → Worker: get presigned URL per part (POST .../upload/part-url)
Browser → R2:    PUT each part directly (presigned URL)
Browser → Worker: complete upload (POST .../upload/complete)
Worker  → R2:    CompleteMultipartUpload
Worker  → D1:    UPDATE tour status = 'uploaded'
```

The Worker never receives ZIP bytes. 3 GB files work fine.

---

## Folder structure

```
tour_saas_platform/
├── src/
│   ├── worker/
│   │   ├── index.ts              Worker entry point (Hono app)
│   │   ├── types.ts              Env interface + shared types
│   │   ├── middleware/
│   │   │   └── auth.ts           Session cookie → D1 validation
│   │   ├── routes/
│   │   │   ├── auth.ts           POST /login, /logout, GET /me
│   │   │   ├── dashboard.ts      GET /dashboard/stats
│   │   │   ├── tours.ts          GET/POST /tours, GET /tours/:id
│   │   │   └── uploads.ts        POST /tours/:id/upload/*
│   │   ├── services/
│   │   │   ├── auth.ts           PBKDF2 hash/verify
│   │   │   ├── session.ts        D1 session CRUD + cookie helpers
│   │   │   ├── tours.ts          D1 tour CRUD
│   │   │   └── r2.ts             R2 multipart upload (aws4fetch)
│   │   └── utils/
│   │       ├── response.ts       ok() / err() helpers
│   │       └── validation.ts     Zod schemas
│   └── frontend/
│       ├── index.html
│       ├── tsconfig.json
│       └── src/
│           ├── App.tsx           React Router setup
│           ├── types/index.ts    Shared TypeScript types
│           ├── components/
│           │   └── Layout.tsx    Bootstrap sidebar layout
│           ├── pages/
│           │   ├── LoginPage.tsx
│           │   ├── DashboardPage.tsx
│           │   ├── ToursPage.tsx
│           │   └── UploadPage.tsx
│           └── services/
│               ├── api.ts        Typed fetch wrapper
│               └── uploader.ts  Multipart upload engine
├── migrations/
│   └── 0001_initial.sql          users, sessions, tours tables
├── scripts/
│   └── hash-password.mjs         Admin user setup helper
├── docs/
│   ├── CLOUDFLARE_SETUP.md       Dashboard setup guide (start here)
│   ├── LOCAL_DEVELOPMENT.md      Running locally
│   ├── R2_UPLOAD_FLOW.md         Multipart upload architecture
│   └── DATABASE.md               Schema + migration reference
├── wrangler.jsonc                Cloudflare Worker configuration
├── vite.config.ts                Frontend build configuration
├── tsconfig.json                 Worker TypeScript config
└── package.json
```

---

## Requirements

- Node.js 18 or newer
- npm 9 or newer
- A Cloudflare account (free tier is sufficient)

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Cloudflare resources

Read **`docs/CLOUDFLARE_SETUP.md`** for the full step-by-step guide.

At minimum you need to:
1. Create a D1 database and update `wrangler.jsonc` with the database ID
2. Create an R2 bucket and configure CORS on it
3. Create R2 API credentials
4. Set secrets with `wrangler secret put`

### 3. Apply database migrations

```bash
# Local development:
npm run migrate:local

# Production:
npm run migrate:remote
```

### 4. Create the first admin user

```bash
node scripts/hash-password.mjs YourSecurePassword123!
# Run the command it prints
```

### 5. Run locally

```bash
# Terminal 1 — Worker (port 8787):
npm run dev:worker

# Terminal 2 — Frontend (port 5173):
npm run dev:frontend

# Terminal 3 — Go ZIP processor (port 9000) — required after ZIP upload:
cd D:\next\tour_processor
go run .
```

Open **http://localhost:5173** and log in.

Without Terminal 3, uploads finish in R2 but tours stay stuck in `processing`.

---

## Deployment

```bash
# Build frontend + deploy Worker to Cloudflare:
npm run deploy
```

This runs `vite build` then `wrangler deploy`. Cloudflare will print the
Worker URL after deployment.

---

## API reference

All API endpoints return:
```json
{ "success": true, "data": { ... } }
// or
{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Login |
| POST | `/api/auth/logout` | Yes | Logout |
| GET | `/api/auth/me` | Yes | Current user |
| GET | `/api/dashboard/stats` | Yes | Tour counts + recent tours |
| GET | `/api/tours` | Yes | List tours |
| POST | `/api/tours` | Yes | Create tour |
| GET | `/api/tours/:id` | Yes | Get tour |
| POST | `/api/tours/:id/upload/initiate` | Yes | Start multipart upload |
| POST | `/api/tours/:id/upload/part-url` | Yes | Presigned URL for one part |
| POST | `/api/tours/:id/upload/complete` | Yes | Finalize upload |
| POST | `/api/tours/:id/upload/abort` | Yes | Cancel upload |

---

## Environment variables

See `.env.example` for a documented list of all configuration values.

**Secrets** (set with `wrangler secret put`):
- `R2_ACCESS_KEY_ID` — R2 API token key ID
- `R2_SECRET_ACCESS_KEY` — R2 API token secret

**Vars** (in `wrangler.jsonc`):
- `ENVIRONMENT` — `development` or `production`
- `CORS_ORIGIN` — allowed frontend origin
- `R2_ACCOUNT_ID` — your Cloudflare account ID
- `R2_BUCKET_NAME` — R2 bucket name
- `PART_SIZE_BYTES` — upload part size (default: 10 MiB)
- `UPLOAD_CONCURRENCY` — parallel parts (default: 3)
- `MAX_RETRIES` — retry count per part (default: 3)

---

## Database migrations

```bash
npm run migrate:local    # Apply to local development database
npm run migrate:remote   # Apply to production database
```

See `docs/DATABASE.md` for schema details and useful queries.

---

## Manual test checklist

1. Login with correct credentials → redirect to dashboard
2. Login with wrong password → error message, no redirect
3. Access `/api/dashboard/stats` without cookie → `401 UNAUTHORIZED`
4. Dashboard shows real counts from D1
5. Create a tour → appears in tours list with `draft` status
6. Upload a ZIP → progress bar updates, status becomes `uploaded`
7. Cancel an upload mid-way → status becomes `failed`, R2 parts cleaned up
8. User A cannot access User B's tour → `404 NOT_FOUND`
9. Logout → cookie cleared, subsequent API call → `401`
10. Verify tour file in R2 at `tours/{tourId}/original.zip`

---

## Common errors

**`no such table: users`**
→ Run `npm run migrate:local` (or `migrate:remote` for production)

**`Invalid email or password`**
→ Run the admin user creation script (Step 4 in Quick start)

**Upload stuck at 0%**
→ Check that R2 API credentials are set (`wrangler secret put`)
→ Check R2 CORS policy includes `ExposeHeaders: ["ETag"]`

**Worker returns 500**
→ Check bindings in Cloudflare Dashboard (D1 binding `DB`, R2 binding `TOUR_BUCKET`)
→ Check that all secrets are set
→ View Worker logs in Cloudflare Dashboard → Workers → Logs

---

## Future features (not implemented)

This foundation is designed to be extended with:

- Go ZIP processor (triggered via Cloudflare Queue after upload)
- Tour publishing + custom domains / subdomains
- Visitor booking and calendar
- Analytics and visit tracking
- Billing (Stripe integration)
- Multi-tenant organizations
- Email notifications
- Advanced role-based permissions

See `docs/R2_UPLOAD_FLOW.md` for where the Go processor integration point is.

---

## Technology

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Bootstrap 5, Vite |
| API | Cloudflare Workers, Hono, TypeScript |
| Database | Cloudflare D1 (SQLite) |
| File storage | Cloudflare R2 |
| Auth | PBKDF2-SHA256, server-side sessions |
| Upload signing | aws4fetch (S3-compatible presigned URLs) |
| Validation | Zod |
