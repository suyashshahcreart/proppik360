# Tour-admin viewer FS APIs

Partner/other-project API to manage files under the **viewer** R2 bucket `proppik360/{tourId}/`. Uses the existing tour-admin login token. R2 access keys never leave this server.

Does **not** change `tours.status`, ingest, or the admin package bucket.

## Auth

1. `POST /api/tour-admin/:tourId/login/password` (or OTP) → `{ token, expires_at }`
2. All `/fs/*` calls: `Authorization: Bearer <token>`
3. Token `tour_id` must match URL `:tourId`
4. Optional `X-Tour-Admin-Api-Key` when server has `TOUR_ADMIN_API_KEY`

When the partner API key is set, send it in `X-Tour-Admin-Api-Key` and keep the session token in `Authorization`.

## Endpoints

Base: `/api/tour-admin/:tourId/fs`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/list?path=&cursor=` | Folder listing (files + folders) |
| GET | `/object?path=` | Metadata; add `download=1` for a short-lived presigned GET |
| PUT | `/object?path=` | Create or overwrite file (raw body, max 5 MB) |
| POST | `/mkdir` | `{ "path": "assets/custom" }` |
| DELETE | `/object?path=&recursive=` | Delete file, or folder when `recursive=true` |

Response shape: `{ success, data }` or `{ success: false, error: { code, message } }`.

## Path rules

Client path is relative: `assets/js/app.js` → key `000002/assets/js/app.js`.

Reject `..`, leading `/`, `\`, `//`, control chars, or a client-supplied `{tourId}/` prefix.

**Deny write/delete:** `backup_zip/` (and children), `.manifest.json`, `original.zip`.  
**Deny delete only:** `index.html` (overwrite allowed).  
`backup_zip` is hidden from root listings.

Allowed upload extensions: `html,css,js,json,xml,txt,svg,png,jpg,jpeg,webp,gif,ico,woff,woff2,ttf,mp4,webm,mp3`.

Folders are R2 prefixes. `mkdir` writes `{tourId}/{path}/.keep`.

## Errors

| Code | HTTP |
|------|------|
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `CONFLICT` | 409 |
| `TOO_LARGE` | 413 |
| `INVALID_INPUT` | 422 |

Recursive delete is capped at 200 keys per request (`truncated: true` if more remain).

## CORS

`CORS_ORIGIN` is always allowed. Optional `TOUR_ADMIN_CORS_ORIGINS` (comma-separated) adds partner browser origins for `/api/tour-admin/*`. Server-to-server clients do not need CORS.

## Postman

Folder **6. Public — Tour viewer FS** in [postman/PropPIK360-Tour-Admin.postman_collection.json](./postman/PropPIK360-Tour-Admin.postman_collection.json). Login in folder 1 first so `tourAdminToken` is set.
