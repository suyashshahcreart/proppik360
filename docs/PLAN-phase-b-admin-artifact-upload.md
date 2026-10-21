# Phase B: Tour admin ZIP upload + history (artifact model 1.2)

Per-tour **admin package ZIP** upload with durable history, a **separate R2 bucket**, and **`R2_ADMIN_PUBLIC_DOMAIN`**. Does **not** change `tours.status` or the viewer ingest pipeline.

## Architecture

```text
SaaS UI  →  /api/tours/:id/artifacts/tour_admin/ingest/*
         →  Go ingest ?artifact=tour_admin  (session key tourId__tour_admin)
         →  publish_admin → ADMIN R2 bucket {tourId}/
         →  artifact_upload_history + tour_artifacts
```

Viewer ZIP remains on `upload_sessions` / `tour_upload_history` and Go ingest without `artifact` (default `tour_viewer`).

## Env

| Variable | Where | Purpose |
|----------|--------|---------|
| `R2_ADMIN_BUCKET_NAME` | SaaS + Go | Admin package bucket |
| `R2_ADMIN_PUBLIC_DOMAIN` | SaaS + Go | Public hostname (no `https://`) |
| Same R2 access keys | both | Shared account credentials |

## DB (migration `0025_artifact_uploads.sql`)

- `artifact_upload_sessions`
- `artifact_upload_history`
- `tour_artifacts` (1:1 pointer per `tour_id` + `artifact_type`)
- Permission `tour_admin_upload` (admin role)

## APIs

| Method | Path |
|--------|------|
| POST | `/api/tours/:id/artifacts/tour_admin/ingest/initiate` |
| PUT | `/api/tours/:id/artifacts/tour_admin/ingest/chunk` |
| POST | `/api/tours/:id/artifacts/tour_admin/ingest/complete` |
| POST | `/api/tours/:id/artifacts/tour_admin/ingest/abort` |
| GET | `/api/tours/:id/artifacts/tour_admin/ingest/status` |
| GET | `/api/tours/:id/artifacts/tour_admin/history` |
| GET | `/api/tours/:id/artifacts/tour_admin/publish-info` |

Processor callbacks (X-Processor-Secret):

- `POST /api/processor/artifacts/:tourId/tour_admin/complete|progress|fail|backup-complete|completed`

## UI

- Tour view → **Upload admin package** → `/upload?tour={id}&artifact=tour_admin`
- Tour view → **Admin package uploads** history + Open admin link

## Admin ZIP rules

- Must contain `index.html` at zip root or under a single top-level folder
- Flat publish to `{tourId}/` in the admin bucket
- Optional backup under `{tourId}/backup_zip/`

## Future hooks

| Feature | Hook |
|---------|------|
| Branding pack | New `artifact_type` |
| Merge branding into viewer | Processor / Worker job |
| Consolidate viewer history | Backfill `artifact_type=tour_viewer` |

See also [SETTINGS.md](./SETTINGS.md) for tour-admin login APIs used by the published admin package.
