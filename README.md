# PropPik 360 (`proppik360`)

Monorepo: **tour SaaS platform** (React + **Node API**) + **Go tour processor**.

- **Local path:** `D:\Extra\proppik360`
- **Database (local):** `D:\Extra\proppik360\data\platform.sqlite` (SQLite on D:)
- **Cloudflare:** **R2 only** (object storage) — no Workers, no D1, no Wrangler
- **Live (VPS):** Admin `https://360.proppik.cloud`, API `https://api360.proppik.cloud`, viewers `https://proppik360.com` — see [docs/DEPLOY-v1.md](docs/DEPLOY-v1.md)

## First-time setup

```powershell
cd D:\Extra\proppik360\tour_saas_platform
npm install
copy .env.example .env
# Edit .env — set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY

npm run setup
```

`setup` = migrations + admin user (`admin@example.com` / `Proppik360Local!`).

Copy secrets (not in git): `tour_saas_platform\.env`, `tour_processor\.env`.

Set **`R2_PUBLIC_DOMAIN`** in `.env` and `tour_processor\.env` after R2 public access is enabled.

## Run locally

```powershell
powershell -File D:\Extra\proppik360\scripts\dev.ps1
```

| Service | URL |
|---------|-----|
| **App (login)** | http://localhost:5173 |
| **API health** | http://127.0.0.1:8787/health |
| **Go processor** | http://127.0.0.1:9000/health |

**Login:** `admin@example.com` / `Proppik360Local!`

Manual (three terminals):

```powershell
cd D:\Extra\proppik360\tour_saas_platform
npm run dev:api
npm run dev:frontend
cd D:\Extra\proppik360\tour_processor
go run .
```

Health must return JSON: `{"ok":true,"service":"proppik360-api"}` — not HTML.

## Why there is no `.wrangler` folder

Wrangler was Cloudflare’s old local dev tool (D1 + Worker). This project uses **Node + SQLite on D:** instead. The `.wrangler` folder is removed and not used.

## Security

Never commit `.env`, `.dev.vars`, or R2 keys.
