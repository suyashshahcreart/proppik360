# Phase A: Settings + MSG91 + Tour master admin

Implemented before viewer slug/branding and upload-path changes.

## Architecture

```text
settings(name, value)              → General + SMS non-secrets
tour_admin_master_settings (1 row) → defaults for every new tour
tour_admins (per tour_id)          → username/password/mobile
.env                               → MSG91_AUTH_KEY, TOUR_ADMIN_API_KEY (never UI)
UI: /system/settings               → vertical tabs, permission per tab
Runtime: getSetting(name, fallback) → in-memory cache on Node, bust on PATCH
Public: /api/tour-admin/:tourId/*  → password + OTP + sessions
```

## Delivered

1. Migrations `0018`–`0022`
2. Services: `settings`, `tour-admin-master`, `tour-admins`, `tour-admin-auth`, `msg91`
3. APIs under `/api/system/settings`, `/api/system/tour-admin-master`, `/api/tours/:id/tour-admin`, `/api/tour-admin/:tourId/*`
4. UI: Settings page + Tour details tour-admin section
5. Docs: [SETTINGS.md](./SETTINGS.md)

## Out of scope (later)

- Viewer slugs / `branding-overrides`
- Upload path optimizations
- BrokerX booking/FTP/payment tabs

See also the Cursor plan file and [SETTINGS.md](./SETTINGS.md) for keys and permission matrix.
