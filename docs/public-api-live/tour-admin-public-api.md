# PropPIK360 — Tour Admin Public APIs (Live)

**Base URL:** `https://360.proppik.cloud`  
**API prefix:** `/api/tour-admin`  
**Live docs:** https://360.proppik.cloud/api-docs/

This document covers **two public API groups** for integrators (tour viewer / admin apps). They do **not** use the SaaS platform login cookie.

| # | Group | Prefix |
|---|--------|--------|
| 1 | Tour login (password + OTP) | `/api/tour-admin/:tourId/...` |
| 6 | Viewer bucket file system | `/api/tour-admin/:tourId/fs/...` |
| 7 | Open tours catalog (no auth) | `/api/public/tours` |
| 8 | Open customers catalog (no auth) | `/api/public/customers` |

Alternative API host (same backend): `https://api360.proppik.cloud`

---

## Response format

Success:

```json
{ "success": true, "data": { ... } }
```

Error:

```json
{ "success": false, "error": { "code": "AUTH_FAILED", "message": "..." } }
```

---

## Authentication

### Optional partner key

If the server has `TOUR_ADMIN_API_KEY` set, every request in both groups must include:

- Header: `X-Tour-Admin-Api-Key: <key>`  
  **or** `Authorization: Bearer <same key>` (when not using a tour session token)

If the env var is empty, this header is not required.

### Tour admin session (folder 6)

After **password** or **OTP** login (folder 1), use:

- `Authorization: Bearer <token>`

The `token` is the UUID returned as `data.token`. Sessions last **7 days** (server default).

You can also pass the token as query `?token=` on **GET session** only.

---

## 1. Public — Tour login

`tourId` must be exactly **6 digits** (e.g. `000200`).

### GET `/api/tour-admin/:tourId/config`

Public flags for the tour’s active admins.

**Response `data`:**

| Field | Type | Description |
|--------|------|-------------|
| `tour_id` | string | 6-digit id |
| `password_enabled` | boolean | Any active admin allows password login |
| `otp_enabled` | boolean | Any active admin allows OTP |
| `is_active` | boolean | Always true when config exists |
| `admin_count` | number | Active admins for this tour |

**404** — tour missing or no active tour admins.

---

### POST `/api/tour-admin/:tourId/login/password`

**Body (JSON):**

```json
{
  "username": "admin-000200",
  "password": "your-password"
}
```

**200 `data`:**

```json
{
  "token": "<session-uuid>",
  "expires_at": "2026-10-28T12:00:00.000Z",
  "tour_id": "000200",
  "login_method": "password"
}
```

**401/403/404** — `AUTH_FAILED` with message.

---

### POST `/api/tour-admin/:tourId/otp/send`

**Body:**

```json
{ "mobile": "9876543210" }
```

Digits only; matched against admin `mobile` / `country_code`.

**200 `data`:** `{ "sent": true, "expires_in_sec": 300 }`  
Uses MSG91 when configured; mock mode may log OTP on server.

---

### POST `/api/tour-admin/:tourId/otp/verify`

**Body:**

```json
{
  "mobile": "9876543210",
  "otp": "123456"
}
```

**200 `data`:** same shape as password login with `login_method: "otp"`.

---

### GET `/api/tour-admin/:tourId/session`

**Headers:** `Authorization: Bearer <token>` **or** query `?token=<token>`

**200 `data`:** session validation payload (`valid`, `tour_id`, `admin_id`, `login_method`, `expires_at`, …).

**401** — invalid or expired token.

---

### POST `/api/tour-admin/:tourId/logout`

**Headers:** `Authorization: Bearer <token>` (optional but recommended)

**200 `data`:** `{ "message": "Logged out" }` — invalidates session server-side.

---

## 6. Public — Tour viewer FS

Operates on the **viewer R2 bucket** (`proppik360`), keys under `{tourId}/` only.  
Does **not** change `tours.status` or SaaS upload state.

**Requires:** valid tour admin **Bearer token** for the same `tourId`.

### Path rules

- Query/body `path` is **relative** to the tour root (no leading `/`, do not prefix `tourId/`).
- Empty `path` on **list** = tour root.
- Max upload size per PUT: **5 MB**.
- Allowed extensions include: `html`, `css`, `js`, `json`, `png`, `jpg`, `svg`, `woff`, `woff2`, `mp4`, …

**Protected (403 on write/delete where noted):**

- `backup_zip/` (hidden from root list)
- `.manifest.json`, `original.zip`
- `index.html` — may be **overwritten** but not **deleted**

---

### GET `/api/tour-admin/:tourId/fs/list`

**Query:**

| Param | Description |
|--------|-------------|
| `path` | Folder to list (optional, default root) |
| `cursor` | Pagination cursor from previous response |

**200 `data`:** `{ tourId, path, folders[], files[], cursor, truncated }`  
Each file includes public `url` on `R2_PUBLIC_DOMAIN` (e.g. `proppik360.com`).

---

### GET `/api/tour-admin/:tourId/fs/object`

**Query:** `path` (required) — file relative path  

**Query:** `download=1` — adds presigned `downloadUrl` (900s) and `downloadExpiresInSec`

**200 `data`:** metadata + public `url` (does not stream bytes in JSON).

**404** — file not found.

---

### PUT `/api/tour-admin/:tourId/fs/object?path=...`

Raw request body = file bytes.  
**Content-Type** optional (inferred from extension).

**200 `data`:** `{ path, key, size, url, op: "created" | "updated" }`

**413** — over 5 MB. **403** — protected path.

---

### POST `/api/tour-admin/:tourId/fs/mkdir`

**Body:**

```json
{ "path": "assets/custom" }
```

Creates folder marker `{path}/.keep` (idempotent).

---

### DELETE `/api/tour-admin/:tourId/fs/object?path=...`

**Delete file:** `path` = file path, no extra query.

**Delete folder (recursive):** `path` = folder + `recursive=true`  
Deletes up to **200** keys per call; if `truncated: true`, call again.

**409** — folder not empty and `recursive` not set.

---

## Postman collection

Import:

**https://360.proppik.cloud/PropPIK360-Tour-Admin-Public.postman_collection.json**

Variables:

| Variable | Live default |
|----------|----------------|
| `apiBase` | `https://360.proppik.cloud` |
| `tourId` | Your 6-digit tour id |
| `tourAdminToken` | Set automatically after login requests |
| `fsPath` / `fsFilePath` | Examples for FS calls |

---

## 7. Public — Open tours catalog

No login and no token. Soft-deleted tours are omitted. Internal fields (`owner_id`, `upload_id`, `r2_key`) are stripped.

### GET `/api/public/tours`

| Query | Example | Notes |
|-------|---------|--------|
| `tour_id` | `000002` | Exact 6-digit id |
| `customer_id` | UUID | Client row id |
| `client` | `Acme` | Matches customer id, first/last name, or company |
| `date_from` / `from` | `2026-01-01` | `created_at` start (YYYY-MM-DD or ISO) |
| `date_to` / `to` | `2026-12-31` | `created_at` end |
| `page` | `1` | Default 1 |
| `per_page` | `50` | Default 50, max 200 |

**Local:** `http://127.0.0.1:8787/api/public/tours`  
**Live:** `https://360.proppik.cloud/api/public/tours`

---

## 8. Public — Open customers catalog

No login and no token. Soft-deleted customers are omitted. `owner_id` is stripped. Each item includes `tour_count`.

### GET `/api/public/customers`

| Query | Example | Notes |
|-------|---------|--------|
| `customer_id` | UUID | Exact client id |
| `client` | `Acme` | Matches id, name, company, email, mobile |
| `date_from` / `from` | `2026-01-01` | `created_at` start |
| `date_to` / `to` | `2026-12-31` | `created_at` end |
| `page` | `1` | Default 1 |
| `per_page` | `50` | Default 50, max 200 |

**Local:** `http://127.0.0.1:8787/api/public/customers`  
**Live:** `https://360.proppik.cloud/api/public/customers`

---

## Typical flow

1. `GET .../config` — check password/OTP availability  
2. `POST .../login/password` or OTP send/verify — save `token`  
3. `GET .../fs/list?path=` — browse viewer files  
4. `PUT .../fs/object?path=assets/foo.json` — upload overlay files  
5. `POST .../logout` when done  

---

*PropPIK360 v1.1.1 — live `360.proppik.cloud`*
