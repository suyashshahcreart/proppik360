# Settings & tour admin

BrokerX-style flat key-value settings plus per-tour admin credentials.

## Permissions

| Permission | Use |
|------------|-----|
| `setting_view` | Open Settings page |
| `setting_edit` | Save any settings tab (alternative to tab-specific) |
| `setting_general` | General tab |
| `setting_sms` | MSG91 tab |
| `setting_tour_admin` | Tour master admin tab |
| `tour_admin_view` | View tour admin block on tour edit |
| `tour_admin_edit` | Create/update/reset tour admin |

Admin role receives all of the above via migration `0021`.

**Page access:** `setting_view` OR any `setting_*` tab permission.

## Settings keys (`settings` table)

| Key | Tab | Notes |
|-----|-----|--------|
| `support_email` | general | |
| `support_phone` | general | |
| `tour_admin_api_base_url` | general | Base for copy links (no trailing slash). Local default: `http://127.0.0.1:8787/api/tour-admin` |

## MSG91 templates

Stored as JSON in `settings.msg91_templates`:

```json
{
  "login_otp": "692962755f7a7c3df13a38b3",
  "tour_access_otp": "6979cf558c68297cf6363b36",
  "registration_otp": "…"
}
```

- Manage in **Settings → SMS (MSG91) → Manage Templates** (BrokerX-style key + template ID).
- Tour-admin OTP resolves: `tour_access_otp` → `login_otp` → legacy `msg91_otp_template_id`.
- `MSG91_AUTH_KEY` stays in `.env` only. Optional `msg91_timeout_ms` (default 30000).

## Tour master admin templates

Multiple default admin profiles live in `tour_admin_master_templates` (Settings → Tour master admin).

- Auto-create flag remains on `tour_admin_master_settings.auto_create_on_tour_create`.
- Each **active** template becomes a `tour_admins` row when a tour is created (unique username per tour).
- Username pattern may include `{tour_id}`.
- CRUD: `GET/POST /api/system/tour-admin-master/templates`, `GET/PUT/DELETE .../templates/:id`.
| `sms_msg91_enabled` | sms | `0` / `1` |
| `msg91_sender_id` | sms | |
| `msg91_otp_template_id` | sms | MSG91 Flow / OTP template |
| `msg91_route` | sms | Default `4` |
| `otp_length` | sms | 4–8, default `6` |
| `otp_expiry_sec` | sms | Default `300` |
| `msg91_mock_mode` | sms | `1` = log OTP to console, skip MSG91 |

**Never store in DB:** `MSG91_AUTH_KEY` — set only in server `.env`.

## Env vars

```env
MSG91_AUTH_KEY=
TOUR_ADMIN_API_KEY=   # optional partner gate for /api/tour-admin/*
TOUR_ADMIN_CORS_ORIGINS=   # optional comma-separated extra origins for /api/tour-admin/*
```

## SaaS APIs

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/system/settings` | cookie + settings perms |
| PATCH | `/api/system/settings` | `{ tab: 'general' \| 'sms', ... }` |
| GET/PUT | `/api/system/tour-admin-master` | cookie |
| GET/PUT | `/api/tours/:tourId/tour-admin` | cookie |
| POST | `/api/tours/:tourId/tour-admin/reset-password` | cookie |

## Public tour-admin APIs (`tour_id` scoped)

Optional header when `TOUR_ADMIN_API_KEY` is set: `X-Tour-Admin-Api-Key` or `Authorization: Bearer …`.

| Method | Path | Body / notes |
|--------|------|----------------|
| GET | `/api/tour-admin/:tourId/config` | Which methods enabled |
| POST | `/api/tour-admin/:tourId/login/password` | `{ username, password }` → `{ token, expires_at }` |
| POST | `/api/tour-admin/:tourId/otp/send` | `{ mobile }` |
| POST | `/api/tour-admin/:tourId/otp/verify` | `{ mobile, otp }` → token |
| GET | `/api/tour-admin/:tourId/session` | `Authorization: Bearer <token>` |
| POST | `/api/tour-admin/:tourId/logout` | Bearer token |
| GET | `/api/tour-admin/:tourId/fs/list` | `?path=&cursor=` — viewer folder listing |
| GET | `/api/tour-admin/:tourId/fs/object` | `?path=` metadata; `download=1` presigned GET |
| PUT | `/api/tour-admin/:tourId/fs/object` | `?path=` create/overwrite file (max 5 MB) |
| POST | `/api/tour-admin/:tourId/fs/mkdir` | `{ path }` |
| DELETE | `/api/tour-admin/:tourId/fs/object` | `?path=&recursive=` |

Viewer-bucket FS (`proppik360/{tourId}/` only). See [PLAN-tour-admin-viewer-fs.md](./PLAN-tour-admin-viewer-fs.md).

## Tour master admin

Singleton row `tour_admin_master_settings.id = 'default'`.

When `auto_create_on_tour_create = 1`, creating a tour inserts `tour_admins` with username from `default_username_pattern` (`{tour_id}` substituted). Password mode: `random` (plain returned only in apply path logs) or `fixed` (shared hash).

## UI

- **System → Settings** — `/system/settings` (General, SMS, Tour master admin)
- **Tour edit** — collapsible **Tour admin login** section

## Admin package ZIP (Phase B)

Separate from viewer upload. See [PLAN-phase-b-admin-artifact-upload.md](./PLAN-phase-b-admin-artifact-upload.md).

| Env | Purpose |
|-----|---------|
| `R2_ADMIN_BUCKET_NAME` | Admin package R2 bucket |
| `R2_ADMIN_PUBLIC_DOMAIN` | Public hostname for `{tourId}/` |

Permission: `tour_admin_upload`. UI: Tour view → Upload admin package (`/upload?tour=…&artifact=tour_admin`).

## Migrations

- `0018_settings.sql`
- `0019_tour_admin_master.sql`
- `0020_tour_admins.sql`
- `0021_settings_permissions.sql`
- `0022_tour_admin_auth.sql`
- `0025_artifact_uploads.sql`
