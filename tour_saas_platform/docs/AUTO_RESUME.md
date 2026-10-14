# Automatic tour processing resume

How pending tours recover when the Go processor is down, the network blips, or a browser upload never reaches `/upload/complete`.

## Status machine (actual)

| Status | Meaning |
|--------|---------|
| `draft` | Tour created, no upload started |
| `uploading` | Multipart session open; ZIP **not** finalized in R2 yet |
| `uploaded` | Reserved in types; rarely set — treat like `processing` for recovery |
| `processing` | ZIP is in R2; Worker has asked (or will ask) Go to process |
| `ready` | Viewer files uploaded; tour is live |
| `failed` | Upload aborted, incomplete, or processing error |

Happy path: `draft` → `uploading` → `processing` → `ready`.

## Why tours get stuck

### Stuck at **Uploading** (e.g. `sankalp-2`)

Multipart was **initiated** (`upload_id` + `r2_key` stored) but `POST .../upload/complete` never succeeded. Incomplete multipart parts are **not** a final R2 object — `tours/{id}/original.zip` does not exist. The Go processor cannot help until the ZIP is finalized (or the user re-uploads).

### Stuck at **Processing**

`upload/complete` ran and set `processing`, but `POST PROCESSOR_WEBHOOK_URL` (`/jobs`) never reached Go (processor down, wrong URL, Worker isolate ended before fire-and-forget finished).

## Recovery mechanisms

```
Browser complete
  → Worker: CompleteMultipart + status=processing
  → waitUntil(notifyProcessor with retries/backoff)
       ↓ fail?
Worker cron every 5 min  ──┐
Go startup / every 2 min ──┼──► reconcile + re-POST /jobs (idempotent)
UI: processor offline→online ─┘
User: Resume / Retry button
```

1. **Reliable notify** (`processor-notify.ts`): retries with exponential backoff; scheduled via `executionCtx.waitUntil` so Cloudflare does not kill the outbound `/jobs` call when the HTTP response returns.
2. **Worker cron** (`wrangler.jsonc` `*/5 * * * *`): runs `reconcilePendingJobs`.
3. **Reconcile** (`reconcile.ts`):
   - `uploading` + ZIP exists in R2 → `processing` + notify
   - `uploading` + no ZIP + stale (>2h) → `failed` (re-upload)
   - `uploaded` / stale `processing` → re-notify
4. **Go startup** (`main.go` `resumePendingJobs`): `POST /api/processor/reconcile`, then `GET /api/processor/pending`, enqueue each tour. Retries after 15s and every 2 minutes.
5. **Idempotent `/jobs`**: JobQueue dedupes in-flight `tourId`; already-`ready` tours are skipped inside `RunJob`.
6. **UI**: Tours page probes `GET /api/tours/processor-status`, warns when offline, auto-resumes stuck tours when health flips online, and exposes **Resume** / **Retry**.

## Manual ops

```bash
# Reset an incomplete upload (no ZIP in R2) so the user can re-upload
npx wrangler d1 execute tour-saas-db --local --command \
  "UPDATE tours SET status='failed', processing_error='Upload incomplete — re-upload required.', updated_at=datetime('now') WHERE id='sankalp-2';"

# Force Worker reconcile (processor secret)
curl -X POST http://127.0.0.1:8787/api/processor/reconcile \
  -H "X-Processor-Secret: $PROCESSOR_SECRET" \
  -H "Content-Type: application/json" -d "{}"

# List pending jobs
curl http://127.0.0.1:8787/api/processor/pending \
  -H "X-Processor-Secret: $PROCESSOR_SECRET"
```

## Verify

1. Start Worker (`npx wrangler dev`) and Go processor (`go run .` in `tour_processor`).
2. `GET http://127.0.0.1:9000/health` → `{"status":"ok"}`.
3. Tours UI shows no processor warning.
4. Stop Go, complete an upload → tour stays `processing`; start Go → within seconds (startup resume) or ≤5 min (cron) it processes.
5. Stuck `uploading` with ZIP in R2 → Resume or reconcile heals to `processing`.
6. Stuck `uploading` without ZIP → Resume marks `failed`; use Retry Upload.
