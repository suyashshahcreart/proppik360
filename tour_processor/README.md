# Tour Processor (Go)

Downloads uploaded tour ZIPs from R2, extracts them, uploads viewer files back to R2, and reports progress/completion to the Cloudflare Worker API.

## Prerequisites

- Go 1.22+ (module declares `go 1.27.1`)
- A configured `.env` (see `.env.example`)
- SaaS Worker running locally on port **8787** (or set `WORKER_API_URL`)

## Quick start (local)

```bash
cd D:\next\tour_processor
# First time: copy .env.example → .env and fill R2 credentials
# PROCESSOR_SECRET must match tour_saas_platform (.dev.vars / wrangler vars)
go run .
```

Listens on **`:9000`** by default (`PORT` in `.env`).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | none | Liveness — `{"status":"ok"}` |
| POST | `/jobs` | `X-Processor-Secret` | Body `{"tourId":"..."}` → `202 Accepted` |

The SaaS Worker calls `POST /jobs` after multipart upload completes
(`PROCESSOR_WEBHOOK_URL`, typically `http://127.0.0.1:9000/jobs`).

## Required env

| Variable | Example |
|----------|---------|
| `WORKER_API_URL` | `http://localhost:8787` |
| `PROCESSOR_SECRET` | same as SaaS `PROCESSOR_SECRET` |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token |
| `R2_BUCKET_NAME` | `tour-saas-uploads` |
| `R2_PUBLIC_DOMAIN` | public hostname for viewer URLs |
| `PORT` | `9000` |
| `TEMP_DIR` | e.g. `C:\temp\tour-processor` — orphaned `*.zip` / `r2upload-*.tmp` cleaned on startup |

## Temp files & disk space

Downloaded ZIPs land in `TEMP_DIR` as `{tourId}.zip` and are removed when each job finishes. If the processor crashes or is killed, leftovers are removed automatically the next time you start the service.

Manual cleanup (with the processor stopped):

```powershell
Remove-Item -Force C:\temp\tour-processor\*.zip, C:\temp\tour-processor\*r2upload*.tmp -ErrorAction SilentlyContinue
```

See also `tour_saas_platform/docs/DISK_CLEANUP.md` for frontend/Wrangler cleanup.

## Smoke test

```bash
curl http://127.0.0.1:9000/health
curl -X POST http://127.0.0.1:9000/jobs ^
  -H "Content-Type: application/json" ^
  -H "X-Processor-Secret: dev-processor-secret-change-in-production" ^
  -d "{\"tourId\":\"YOUR_TOUR_ID\"}"
```
