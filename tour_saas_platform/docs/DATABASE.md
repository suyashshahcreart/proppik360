# Database Documentation

This platform uses **Cloudflare D1** — a serverless SQLite database that runs
close to your users on Cloudflare's edge network.

---

## What is D1?

D1 is Cloudflare's managed SQL database. It uses SQLite syntax, so standard
SQL commands work. It is:
- **Serverless** — no database server to manage
- **Automatic replication** — Cloudflare handles backups and redundancy
- **Integrated** — connects directly to your Worker via the `env.DB` binding

---

## Schema overview

```
users
  id (TEXT, UUID)
  name, email, password_hash
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  created_at, updated_at

sessions
  id (TEXT, UUID) ← this is the session cookie value
  user_id (FK → users)
  expires_at
  created_at

tours
  id (TEXT, UUID)
  name
  owner_id (FK → users)
  original_filename, file_size
  r2_key ← server-generated: tours/{tourId}/original.zip
  upload_id ← R2 multipart upload session identifier
  status: draft | uploading | uploaded | processing | ready | failed | archived
  created_at, updated_at
```

---

## Migration commands

Migrations are SQL files in the `migrations/` directory. Each migration runs
once and is tracked in a `d1_migrations` table in your database.

**Apply to local database (development):**
```bash
npm run migrate:local
# runs: wrangler d1 migrations apply tour-saas-db --local
```

**Apply to remote database (production):**
```bash
npm run migrate:remote
# runs: wrangler d1 migrations apply tour-saas-db --remote
```

**Check which migrations have been applied:**
```bash
npx wrangler d1 migrations list tour-saas-db --remote
```

---

## Creating new migrations

When you need to add a new table or column in the future:

```bash
npx wrangler d1 migrations create tour-saas-db add_organizations
```

This creates `migrations/0002_add_organizations.sql`.
Edit the file and add your SQL, then apply it.

---

## Useful D1 queries

Run these via the Cloudflare Dashboard (D1 → Query tab) or with wrangler:

```bash
# List all users
npx wrangler d1 execute tour-saas-db --remote --command "SELECT id, name, email, role, status FROM users"

# List all tours
npx wrangler d1 execute tour-saas-db --remote --command "SELECT id, name, status, file_size, created_at FROM tours"

# Count tours by status
npx wrangler d1 execute tour-saas-db --remote --command "SELECT status, COUNT(*) as count FROM tours GROUP BY status"

# Delete expired sessions (cleanup)
npx wrangler d1 execute tour-saas-db --remote --command "DELETE FROM sessions WHERE expires_at < datetime('now')"

# Manually update a tour status
npx wrangler d1 execute tour-saas-db --remote --command "UPDATE tours SET status='draft' WHERE id='your-tour-id'"
```

---

## Tour status lifecycle

```
draft       → Tour created, no upload started
uploading   → R2 multipart upload in progress
uploaded    → Upload complete, awaiting processing
processing  → (Future) Go processor is working
ready       → (Future) Tour is live
failed      → Upload or processing failed (can retry)
archived    → Soft-deleted / disabled
```

Only `draft → uploading → uploaded` are used in this foundation.

The `failed` status can be reset to `draft` manually to allow re-uploading.

---

## Admin user creation

```bash
# Step 1: Generate password hash
node scripts/hash-password.mjs YourPassword123!

# Step 2: Run the INSERT command that the script prints.
# Example (your hash will be different):
npx wrangler d1 execute tour-saas-db --remote --command \
  "INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at) \
   VALUES ('uuid-here', 'Admin', 'admin@example.com', 'hash-here', 'admin', 'active', datetime('now'), datetime('now'))"
```

You can modify the name and email address freely. Do not modify the password_hash.

---

## D1 limitations to be aware of

| Limit | Value |
|-------|-------|
| Maximum database size | 10 GB (free tier: 5 GB) |
| Maximum row size | 1 MB |
| Maximum number of databases | 10 (free tier) |
| SQL syntax | SQLite — most standard SQL works |

**SQLite-specific notes:**
- No native UUID function — UUIDs are generated in the Worker with `crypto.randomUUID()`
- Timestamps are stored as TEXT in ISO 8601 format: `datetime('now')` returns `2026-09-01 14:30:00`
- Foreign keys are declared but must be explicitly enabled per-connection if you need cascades in raw queries (D1 enables FK enforcement automatically)

---

## Future schema additions

When expanding the platform, the following tables are anticipated:

```sql
-- (Future) Multi-tenant organizations
organizations (id, name, slug, plan, created_at)
organization_members (user_id, org_id, role)

-- (Future) Booking
bookings (id, tour_id, visitor_email, scheduled_at, status)

-- (Future) Analytics
tour_views (id, tour_id, visitor_id, viewed_at, duration_seconds)

-- (Future) Billing
subscriptions (id, org_id, stripe_subscription_id, plan, status)
```

The current schema is designed to accommodate these additions without
restructuring the `users` and `tours` tables.
