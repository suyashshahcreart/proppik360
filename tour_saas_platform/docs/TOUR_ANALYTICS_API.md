# Tour analytics / tracking history

JSON snapshots per tour, upserted on `(tour_id, source, tracking_key, publish_version)`.

| Source | Product | POST route | GET |
|--------|---------|------------|-----|
| `main_tour` | Main tour viewer (`proppik360.com`) | `POST /api/public/tours/:tourId/analytics` | SaaS only |
| `tour_admin` | Tour admin static site | `POST /api/tour-admin/:tourId/analytics` | Tour-admin session |

**Publish version** maps to upload **Attempt #** (`publish_version`):

- `main_tour` — latest `tour_upload_history.attempt_number` unless overridden in POST
- `tour_admin` — latest `artifact_upload_history` row with `artifact_type = tour_admin`

---

## POST ingest (both platforms)

Auth: shared server secret (never commit to public repos).

- Header `X-Analytics-Ingest-Key: <TOUR_ANALYTICS_INGEST_SECRET>`
- **or** `Authorization: Bearer <same secret>`

If `TOUR_ANALYTICS_INGEST_SECRET` is unset on the server, ingest returns **401**.

`tourId` must be exactly **6 digits**. Unknown tour → **404**.

### Body

```json
{
  "tracking_key": "session:abc-123",
  "publish_version": 2,
  "label": "Optional human label",
  "recorded_at": "2026-10-28T12:00:00.000Z",
  "payload": {
    "pageViews": 12,
    "hotspotsClicked": ["kitchen", "bedroom"]
  }
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `tracking_key` | yes | 1–128 chars; e.g. `visitor:{uuid}`, `day:2026-10-28`, `session:{id}` |
| `payload` | yes | JSON object; max ~512 KB serialized |
| `publish_version` | no | Integer ≥ 1; defaults from upload history for that `source` |
| `label` | no | Short description |
| `recorded_at` | no | ISO timestamp; defaults to server time |
| `source` | no | Fixed per route (`main_tour` on public POST, `tour_admin` on tour-admin POST) |

**Upsert:** same `(tour_id, source, tracking_key, publish_version)` replaces `payload`, `label`, `recorded_at`, and `updated_at`.

### Example — main tour viewer

```http
POST /api/public/tours/221026/analytics
X-Analytics-Ingest-Key: ***
Content-Type: application/json

{
  "tracking_key": "day:2026-10-28",
  "payload": { "visitors": 42, "avgDurationSec": 180 }
}
```

Serve the ingest key from your **build-time env** or a **same-origin proxy** — do not ship the raw secret in client-side source in a public git repo.

### Example — tour admin site

```http
POST /api/tour-admin/221026/analytics
X-Analytics-Ingest-Key: ***
Content-Type: application/json

{
  "tracking_key": "admin:settings",
  "payload": { "lastLogin": "2026-10-28T09:00:00Z" }
}
```

---

## GET — Main 360 admin (SaaS)

**Route:** `GET /api/tours/:id/analytics`  
**Auth:** SaaS session cookie + permission `tour_analytics_view`  
**`:id`:** 6-digit public `tour_id` (same as tour detail page)

| Query | Description |
|-------|-------------|
| `source` | `main_tour` or `tour_admin` (omit for both) |
| `tracking_key` | Filter exact key |
| `publish_version` | Filter attempt number |
| `limit` | Max rows (default 50, max 200) |

**Response:**

```json
{
  "success": true,
  "data": {
    "tourId": "221026",
    "history": [
      {
        "id": "...",
        "tour_id": "221026",
        "source": "main_tour",
        "tracking_key": "day:2026-10-28",
        "publish_version": 3,
        "label": null,
        "payload": { "visitors": 42 },
        "recorded_at": "...",
        "created_at": "...",
        "updated_at": "..."
      }
    ]
  }
}
```

UI: **Tour view** → **Analytics / tracking** (Main 360 admin only).

---

## Environment

```env
TOUR_ANALYTICS_INGEST_SECRET=long-random-string
```

See also `tour-admin-public-api.md` for tour-admin **GET** with Bearer login token.

---

## Postman / Bruno

Separate import guide (folders, variables, test flow):

**[TOUR_ANALYTICS_POSTMAN.md](./TOUR_ANALYTICS_POSTMAN.md)**

Collection files:

| File | `apiBase` default |
|------|-------------------|
| [docs/postman/PropPIK360-Tour-Analytics.postman_collection.json](../../docs/postman/PropPIK360-Tour-Analytics.postman_collection.json) | Local `http://127.0.0.1:8787` |
| [docs/postman/PropPIK360-Tour-Analytics-Live.postman_collection.json](../../docs/postman/PropPIK360-Tour-Analytics-Live.postman_collection.json) | Live `https://360.proppik.cloud` |
