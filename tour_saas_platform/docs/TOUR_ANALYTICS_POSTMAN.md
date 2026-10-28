# Tour analytics — Postman / Bruno

Import-ready collection for **POST ingest** and **GET history** (SaaS + tour-admin).

| Resource | Path in repo |
|----------|----------------|
| API reference | [TOUR_ANALYTICS_API.md](./TOUR_ANALYTICS_API.md) |
| Collection JSON | [../../docs/postman/PropPIK360-Tour-Analytics.postman_collection.json](../../docs/postman/PropPIK360-Tour-Analytics.postman_collection.json) |

**Live host (optional):** after import, set collection variable `apiBase` to `https://360.proppik.cloud`.

---

## Import

1. Open Postman or Bruno → **Import** → choose `PropPIK360-Tour-Analytics.postman_collection.json`.
2. Open the collection **Variables** tab and set:
   - `tourId` — your 6-digit tour id
   - `analyticsIngestKey` — same as server `TOUR_ANALYTICS_INGEST_SECRET`
   - `saasPassword` — for SaaS GET (folder 5)
3. For **GET tour-admin** (folder 4): run folder **3** login first (or paste an existing `tourAdminToken`).
4. For **GET SaaS** (folder 6): run folder **5** login; enable the **cookie jar** for your `apiBase` host.

---

## Collection folders (pane layout)

| # | Folder | Auth |
|---|--------|------|
| 1 | POST ingest — main tour | `X-Analytics-Ingest-Key: {{analyticsIngestKey}}` |
| 2 | POST ingest — tour admin | Same ingest key |
| 3 | Helper — Tour admin login | Sets `{{tourAdminToken}}` |
| 4 | GET — tour admin site | `Authorization: Bearer {{tourAdminToken}}` |
| 5 | Helper — SaaS login | Session cookie |
| 6 | GET — Main 360 admin | Cookie + `tour_analytics_view` |

---

## Variables

| Variable | Example | Used for |
|----------|---------|----------|
| `apiBase` | `http://127.0.0.1:8787` | All requests |
| `tourId` | `221026` | Path segment |
| `analyticsIngestKey` | *(secret)* | Folders 1–2 |
| `trackingKey` | `session:postman-test` | Sample body / query |
| `tourAdminToken` | UUID | Folder 4 (auto after login) |
| `tourAdminApiKey` | *(optional)* | When `TOUR_ADMIN_API_KEY` is set on server |
| `saasEmail` / `saasPassword` | Platform user | Folder 5–6 |

---

## Suggested test flow

1. **POST** folder 1 — upsert main-tour snapshot (expect **200** or **201**).
2. **POST** folder 2 — upsert tour-admin snapshot.
3. **GET** folder 6 (after SaaS login) — see both sources in `data.history`.
4. **GET** folder 4 (after tour-admin login) — only `tour_admin` rows.

Common errors:

| Code | Cause |
|------|--------|
| **401** | Wrong/missing ingest key or tour-admin token |
| **403** | Tour-admin session is for a different `tourId` |
| **404** | Unknown tour id |
| **422** | Invalid body or query |

---

## Publishing on live docs (optional)

To mirror tour-admin public docs on the VPS, copy the JSON next to other api-docs assets and link it from your index page, e.g.:

`PropPIK360-Tour-Analytics.postman_collection.json`

Source file to copy: `docs/postman/PropPIK360-Tour-Analytics.postman_collection.json`.
