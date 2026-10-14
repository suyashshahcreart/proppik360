# PropPik360 — v1 production deploy (VPS + R2)

Monorepo: `tour_saas_platform` (Node API + React admin) + `tour_processor` (Go).

## Domain layout

| Host | Purpose |
|------|---------|
| **https://360.proppik.cloud** | Admin UI; nginx serves static build and proxies **`/api`** to Node |
| **https://api360.proppik.cloud** | Node API (optional public alias; same backend as `/api` on 360) |
| **https://proppik360.com** | Public 360 viewers (Cloudflare R2 custom domain) |

Go processor listens on **`127.0.0.1:9000` only** — do not expose port 9000 on the public internet.

Tour viewer URLs: `https://proppik360.com/{tour_id}/index.html` (flat R2 layout).

---

## 1. Clone on VPS

```bash
sudo mkdir -p /opt/proppik360
sudo chown $USER:$USER /opt/proppik360
git clone https://github.com/suyashshahcreart/proppik360.git /opt/proppik360
cd /opt/proppik360
git checkout main   # or: git checkout v1.0.0
mkdir -p data/temp
```

### Prerequisites (Ubuntu 22/24 example)

```bash
sudo apt update
sudo apt install -y git nginx curl build-essential
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo apt install -y golang-go
```

---

## 2. Platform (`tour_saas_platform`)

```bash
cd /opt/proppik360/tour_saas_platform
cp .env.example .env
nano .env
```

### Required production values

```env
SQLITE_PATH=/opt/proppik360/data/platform.sqlite
PORT=8787
ENVIRONMENT=production

APP_URL=https://api360.proppik.cloud
CORS_ORIGIN=https://360.proppik.cloud

R2_ACCOUNT_ID=<cloudflare account id>
R2_ACCESS_KEY_ID=<r2 token>
R2_SECRET_ACCESS_KEY=<r2 secret>
R2_BUCKET_NAME=proppik360
R2_PUBLIC_DOMAIN=proppik360.com

PROCESSOR_WEBHOOK_URL=http://127.0.0.1:9000/jobs
PROCESSOR_SECRET=<long random secret — same in tour_processor/.env>
```

Install, database, frontend build:

```bash
export VITE_R2_PUBLIC_DOMAIN=proppik360.com
npm install
npm run setup
npm run build:frontend
```

`setup` = migrations + seed admin + RBAC backfill. Change the seeded admin password after first login.

Default seed (local script): `admin@example.com` — set a strong password in production.

---

## 3. Go processor (`tour_processor`)

```bash
cd /opt/proppik360/tour_processor
cp .env.example .env
nano .env
```

```env
WORKER_API_URL=http://127.0.0.1:8787
PROCESSOR_SECRET=<same as platform>
PORT=9000
R2_ACCOUNT_ID=<same>
R2_ACCESS_KEY_ID=<same>
R2_SECRET_ACCESS_KEY=<same>
R2_BUCKET_NAME=proppik360
R2_PUBLIC_DOMAIN=proppik360.com
TEMP_DIR=/opt/proppik360/data/temp
MAX_CONCURRENT_JOBS=2
```

Build and test:

```bash
go build -o tour-processor .
curl -s http://127.0.0.1:8787/health    # start API first, or test processor after systemd
./tour-processor &
curl -s http://127.0.0.1:9000/health
```

---

## 4. systemd services

Adjust `User=` if you deploy as a dedicated user instead of `www-data`.

**`/etc/systemd/system/proppik360-api.service`**

```ini
[Unit]
Description=PropPik360 Node API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/proppik360/tour_saas_platform
EnvironmentFile=/opt/proppik360/tour_saas_platform/.env
ExecStart=/usr/bin/npx tsx src/server/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/proppik360-processor.service`**

```ini
[Unit]
Description=PropPik360 Go tour processor
After=network.target proppik360-api.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/proppik360/tour_processor
EnvironmentFile=/opt/proppik360/tour_processor/.env
ExecStart=/opt/proppik360/tour_processor/tour-processor
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /opt/proppik360/data
sudo systemctl daemon-reload
sudo systemctl enable --now proppik360-api proppik360-processor
curl -s http://127.0.0.1:8787/health
```

---

## 5. nginx

DNS: `360.proppik.cloud` and `api360.proppik.cloud` → VPS IP. Enable HTTPS (Certbot or Cloudflare).

### 360.proppik.cloud — admin + `/api`

**`/etc/nginx/sites-available/360.proppik.cloud`**

```nginx
server {
    listen 80;
    server_name 360.proppik.cloud;
    root /opt/proppik360/tour_saas_platform/dist/public;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 0;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

The React app uses relative `/api/*` URLs so session cookies stay on **360.proppik.cloud**.

### api360.proppik.cloud — API only

**`/etc/nginx/sites-available/api360.proppik.cloud`**

```nginx
server {
    listen 80;
    server_name api360.proppik.cloud;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 0;
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/360.proppik.cloud /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api360.proppik.cloud /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. R2 public viewer domain

In Cloudflare Dashboard:

1. R2 → bucket **proppik360** → Settings → connect custom domain **proppik360.com** (or a subdomain if the apex hosts another site).
2. Published tours appear at `https://proppik360.com/{tour_id}/index.html`.

Keep **`R2_PUBLIC_DOMAIN`** and **`VITE_R2_PUBLIC_DOMAIN`** in sync with that hostname (rebuild frontend after changes).

---

## 7. Smoke tests

| Check | Expected |
|-------|----------|
| `https://api360.proppik.cloud/health` | `{"ok":true,"service":"proppik360-api",...}` |
| `https://360.proppik.cloud` | Login page |
| Upload page (logged in) | Processor online |
| Upload ZIP → completed | Viewer opens on **proppik360.com** |
| Firewall | Ports 80/443 open; **9000 not public** |

---

## 8. Deploy updates

```bash
cd /opt/proppik360
git pull
cd tour_saas_platform
npm install
npm run migrate
export VITE_R2_PUBLIC_DOMAIN=proppik360.com
npm run build:frontend
cd ../tour_processor
go build -o tour-processor .
sudo systemctl restart proppik360-api proppik360-processor
```

---

## Local development (Windows)

See root [README.md](../README.md): `powershell -File scripts/dev.ps1` — API `:8787`, Vite `:5173`, Go `:9000`.

---

## Planned after v1 (not in this release)

Per-tour viewer slugs and branding overrides (`branding-overrides/`, `{slug}/index.html` on R2) — see product notes in repo discussions.
