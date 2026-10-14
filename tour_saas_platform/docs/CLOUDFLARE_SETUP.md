# Cloudflare Dashboard Setup Guide

This document explains step-by-step how to set up all Cloudflare resources
required by this platform — completely from the Cloudflare Dashboard (no CLI needed
for the initial setup).

---

## What you will create

| Resource | What it is | What we use it for |
|----------|-----------|-------------------|
| **Worker** | A serverless API runtime | Handles login, tour management, upload orchestration |
| **D1 database** | A managed SQLite database | Stores users, sessions, and tours |
| **R2 bucket** | Large object / file storage | Stores uploaded ZIP files |

---

## Step 1 — Create a Cloudflare account

1. Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. Enter your email and create a password.
3. Verify your email address.
4. You are now inside the Cloudflare Dashboard.

> **Note:** The free tier includes Workers (100,000 requests/day),
> D1 (5 GB storage, 5 million reads/day), and R2 (10 GB storage, 1 million
> Class A operations). This is more than enough to build and test this platform.

---

## Step 2 — Find your Account ID

You will need your Account ID later for the wrangler.jsonc configuration.

1. Log in to [https://dash.cloudflare.com](https://dash.cloudflare.com)
2. Look at the right sidebar. You will see **Account ID** followed by a long string
   like `abc1234def5678...`
3. Copy this value and save it somewhere safe.

You will put this in `wrangler.jsonc` → `vars.R2_ACCOUNT_ID`.

---

## Step 3 — Create the D1 Database

D1 is Cloudflare's serverless SQL database. It runs SQLite under the hood.

1. In the Cloudflare Dashboard, click **Workers & Pages** in the left sidebar.
2. Click **D1 SQL Database**.
3. Click **Create database**.
4. Enter the name: `tour-saas-db`
5. Select a location (choose the one closest to you).
6. Click **Create**.

You will see a page showing your new database. Copy the **Database ID** —
it looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

Now open `wrangler.jsonc` in your project and replace `YOUR_DATABASE_ID_HERE`
with the actual Database ID:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "tour-saas-db",
    "database_id": "paste-your-database-id-here",  // ← change this
    "migrations_dir": "migrations"
  }
]
```

---

## Step 4 — Create the R2 Bucket

R2 is Cloudflare's object storage (similar to Amazon S3). This is where the large
ZIP files will be stored.

1. In the Cloudflare Dashboard, click **R2 Object Storage** in the left sidebar.
2. Click **Create bucket**.
3. Enter the bucket name: `tour-saas-uploads`
4. Select a location (optional — leave as automatic).
5. Click **Create bucket**.

> **Important:** The bucket name must exactly match `R2_BUCKET_NAME` in
> `wrangler.jsonc`. If you use a different name, update it in both places.

---

## Step 5 — Configure R2 CORS for Direct Browser Uploads

When the browser uploads ZIP parts directly to R2, the browser makes a
cross-origin PUT request to R2's domain. You must configure CORS on the bucket
to allow this — otherwise the browser will be blocked.

1. Click on your `tour-saas-uploads` bucket.
2. Click the **Settings** tab.
3. Scroll down to **CORS Policy**.
4. Click **Edit CORS policy**.
5. Paste the following JSON:

**For development (Vite dev server on port 5173):**
```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:8787"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "ETag"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**For production (replace with your actual domain):**
```json
[
  {
    "AllowedOrigins": ["https://your-domain.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "ETag"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

> **Why `ExposeHeaders: ["ETag"]`?**
> After uploading each part, the browser needs the ETag header from R2's response
> to complete the multipart upload. CORS policies block custom response headers
> by default, so we must explicitly expose ETag.

---

## Step 6 — Create R2 API Token (for presigned URLs)

The Worker needs its own API credentials to sign presigned URLs for each upload
part. This is different from your personal Cloudflare account login.

1. Click on your `tour-saas-uploads` bucket.
2. Click the **Settings** tab.
3. Scroll down to **R2 API tokens**.
4. Click **Create API token**.
5. Give it a name like `tour-saas-uploads-token`.
6. Set permissions: **Object Read & Write**.
7. Under **Specify bucket(s)**, select **Apply to specific buckets** and choose
   `tour-saas-uploads`.
8. Click **Create API Token**.

You will see two values:
- **Access Key ID** — looks like a long alphanumeric string
- **Secret Access Key** — shown only once, copy it now

You will use these in Step 9 (setting secrets).

---

## Step 7 — Create the Worker

1. In the Cloudflare Dashboard, click **Workers & Pages**.
2. Click **Create**.
3. Click **Create Worker**.
4. Name it `tour-saas-worker`.
5. Click **Deploy** (this creates a placeholder Worker — you will replace it with
   your actual code by deploying from your terminal).

> You can ignore the code editor in the Dashboard. You will deploy using wrangler.

---

## Step 8 — Connect D1 to the Worker

1. In **Workers & Pages**, click on `tour-saas-worker`.
2. Click the **Settings** tab.
3. Scroll down to **Bindings**.
4. Click **Add** → **D1 database**.
5. Set **Variable name**: `DB`
6. Select your `tour-saas-db` database.
7. Click **Save**.

This is what `env.DB` refers to in the Worker code.

---

## Step 9 — Connect R2 to the Worker

1. Still in the Worker's **Settings** → **Bindings**.
2. Click **Add** → **R2 bucket**.
3. Set **Variable name**: `TOUR_BUCKET`
4. Select your `tour-saas-uploads` bucket.
5. Click **Save**.

This is what `env.TOUR_BUCKET` refers to in the Worker code.

---

## Step 10 — Set Secret Variables

Secrets are sensitive values like API keys that should never be committed to
source control. They are stored encrypted in Cloudflare.

In your terminal (with wrangler installed), run:

```bash
# Set the R2 API credentials for presigned URL generation
npx wrangler secret put R2_ACCESS_KEY_ID
# → Paste your Access Key ID from Step 6

npx wrangler secret put R2_SECRET_ACCESS_KEY
# → Paste your Secret Access Key from Step 6
```

You can also set them from the Cloudflare Dashboard:
1. Worker → Settings → Variables and Secrets
2. Click **Add** → **Secret**
3. Add `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`

---

## Step 11 — Update wrangler.jsonc

Open `wrangler.jsonc` and fill in the placeholder values:

```jsonc
"vars": {
  "ENVIRONMENT": "development",           // change to "production" for prod
  "APP_URL": "https://your-worker.workers.dev",
  "CORS_ORIGIN": "https://your-domain.com",
  "R2_ACCOUNT_ID": "your-account-id",    // from Step 2
  "R2_BUCKET_NAME": "tour-saas-uploads",
  "PART_SIZE_BYTES": "10485760",
  "UPLOAD_CONCURRENCY": "3",
  "MAX_RETRIES": "3"
}
```

For production, update `ENVIRONMENT`, `APP_URL`, and `CORS_ORIGIN` to reflect
your real domain.

---

## Step 12 — Apply Database Migrations

Before deploying, create the database tables by running the migration:

```bash
# Apply migration to the REMOTE D1 database
npm run migrate:remote
```

You should see output confirming the migration was applied successfully.

To verify:
1. Cloudflare Dashboard → D1 → `tour-saas-db`
2. Click the **Tables** tab
3. You should see: `users`, `sessions`, `tours`

---

## Step 13 — Create the First Admin User

```bash
# Generate a password hash and get the INSERT command
node scripts/hash-password.mjs YourSecurePassword123!
```

The script will print a ready-to-run `wrangler d1 execute` command.
Run the `--remote` version to insert the admin user into the production database.
You can change the name and email address in the command before running it.

---

## Step 14 — Deploy the Worker

```bash
# Build frontend + deploy Worker
npm run deploy
```

This command:
1. Builds the React frontend with Vite → `dist/public/`
2. Deploys the Worker + static assets to Cloudflare

After deployment, Cloudflare will show you the Worker URL, which looks like:
`https://tour-saas-worker.your-subdomain.workers.dev`

---

## Step 15 — Verify the Deployment

**Test the Worker API:**
```bash
curl https://tour-saas-worker.your-subdomain.workers.dev/api/auth/me
# Should return: {"success":false,"error":{"code":"UNAUTHORIZED",...}}
# (This is correct — the endpoint is protected)
```

**Test login:**
```bash
curl -X POST https://tour-saas-worker.your-subdomain.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"YourSecurePassword123!"}'
# Should return: {"success":true,"data":{"id":"...","name":"Admin",...}}
```

**Test the frontend:**
Open the Worker URL in your browser. You should see the login page.

---

## Step 16 — Test ZIP Upload

1. Open the Worker URL in your browser.
2. Log in with your admin credentials.
3. Click **Upload Tour** in the sidebar.
4. Enter a tour name.
5. Select a ZIP file (any size).
6. Click **Start Upload**.
7. Watch the progress bar.
8. Verify the tour appears in the Tours list with status `uploaded`.

**Verify in R2:**
1. Cloudflare Dashboard → R2 → `tour-saas-uploads`
2. You should see a file at path: `tours/{tourId}/original.zip`

**Verify in D1:**
1. Cloudflare Dashboard → D1 → `tour-saas-db`
2. Click **Query** tab
3. Run: `SELECT id, name, status, file_size FROM tours;`
4. You should see your tour with `status = 'uploaded'`

---

## Troubleshooting

**Upload fails with CORS error:**
- Check the R2 CORS policy (Step 5)
- Make sure `ExposeHeaders` includes `ETag`
- Make sure the origin in the CORS policy matches your actual frontend URL

**Login fails:**
- Check that migrations were applied (Step 12)
- Check that the admin user was created (Step 13)
- Check that the password hash was generated correctly

**Worker returns 500:**
- Check that all bindings are set (Steps 8, 9)
- Check that secrets are set (Step 10)
- Check wrangler.jsonc for correct Account ID and bucket name
- View Worker logs: Cloudflare Dashboard → Workers → `tour-saas-worker` → Logs

**D1 not found:**
- Check that `database_id` in `wrangler.jsonc` matches the actual ID from Step 3
