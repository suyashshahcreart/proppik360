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

## Production (VPS)

Same SQL files; target PostgreSQL on the server when that layer is added. For now local dev uses SQLite on D:.
