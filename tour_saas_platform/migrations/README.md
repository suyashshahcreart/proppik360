# Database migrations (SQLite)

Applied by **`npm run migrate`** → `scripts/migrate-platform.mjs`  
Default database: **`D:/Extra/proppik360/data/platform.sqlite`**

Each file is tracked in the `d1_migrations` table (historical name).

## Fresh local reset

```powershell
cd D:\Extra\proppik360\tour_saas_platform
Remove-Item -Force D:\Extra\proppik360\data\platform.sqlite -ErrorAction SilentlyContinue
npm run setup
```

## Recent migrations (Phase A settings / tour admin)

| File | Purpose |
|------|---------|
| `0018_settings.sql` | Flat `settings` key-value store |
| `0019_tour_admin_master.sql` | Singleton tour-admin defaults |
| `0020_tour_admins.sql` | Per-tour admin credentials |
| `0021_settings_permissions.sql` | `setting_*` + `tour_admin_*` RBAC |
| `0022_tour_admin_auth.sql` | OTP requests + tour-admin sessions |
| `0023_tour_admin_master_templates.sql` | Multiple default admin templates; multi admins per tour |
| `0024_msg91_templates.sql` | MSG91 Flow templates JSON map + timeout |
| `0025_artifact_uploads.sql` | Generic artifact ingest sessions/history + tour_artifacts + `tour_admin_upload` |

See [docs/SETTINGS.md](../../docs/SETTINGS.md) and [docs/PLAN-phase-b-admin-artifact-upload.md](../../docs/PLAN-phase-b-admin-artifact-upload.md).

## Production (VPS)

Same SQL files; target PostgreSQL on the server when that layer is added. For now local dev uses SQLite on D:.
