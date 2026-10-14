# Disk cleanup guide

Safe ways to reclaim disk space from local development artifacts.

## Quick cleanup (React / Worker)

From `tour_saas_platform`:

```bash
npm run clean
```

This removes (rebuildable caches only):

| Path | What it is |
|------|------------|
| `dist/` | Production frontend build output |
| `node_modules/.vite/` | Vite dependency pre-bundle cache |
| `node_modules/.cache/` | Tooling cache |
| `.wrangler/state/v3/cache/` | Wrangler miniflare cache |
| `.wrangler/state/v3/observability/` | Local trace/log store (often grows large) |

**Not removed:** `.wrangler/state/v3/d1/` (local D1 SQLite), `.dev/` (Node migration DB), `.env`, `.dev.vars`.

To also drop the local D1 database (fresh DB — re-run migrations after):

```powershell
Remove-Item -Recurse -Force .wrangler\state\v3\d1
npm run migrate:local
```

## Go processor temp files

ZIP downloads and large-file multipart staging use `TEMP_DIR` (default: OS temp; recommended: `C:\temp\tour-processor` in `.env`).

| File pattern | When created | When removed |
|--------------|--------------|--------------|
| `{tourId}.zip` | ZIP download | `defer` after job finishes (success or failure) |
| `{tourId}-r2upload-*.tmp` | Multipart upload of large ZIP entries | `defer` after each upload |
| Orphaned files from crashed runs | Previous processor process | **Auto-deleted on processor startup** |

Manual cleanup (processor stopped):

```powershell
Remove-Item -Force C:\temp\tour-processor\*.zip, C:\temp\tour-processor\*r2upload*.tmp -ErrorAction SilentlyContinue
```

Or delete the whole folder and recreate:

```powershell
Remove-Item -Recurse -Force C:\temp\tour-processor
New-Item -ItemType Directory -Path C:\temp\tour-processor
```

## npm cache (optional)

Only if global npm cache is huge:

```bash
npm cache clean --force
```

## What is already gitignored

- `dist/`, `.wrangler/`, `.dev/`, `node_modules/`, `*.log`
- Vite caches: `.vite/`, `node_modules/.vite/`, `node_modules/.cache/`

Do not commit build outputs or local Wrangler state.
