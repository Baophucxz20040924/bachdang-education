# Backend Deployment — Ubuntu 24.04 + PM2 + Nginx

Manual, step-by-step deployment of the Education AI **backend only** on a single VPS
(**2 vCPU / 2 GB RAM, Ubuntu 24.04 LTS**).

> Scope: this guide hosts **only the backend API**. The frontend is **not** hosted
> here, and MongoDB is **not** run locally — the database is **MongoDB Atlas** (cloud).

- Database: **MongoDB Atlas** (cloud) — nothing to install on the VPS.
- Process manager: **PM2** (fork mode, 1 instance).
- Reverse proxy / TLS: **Nginx** + Let's Encrypt.
- Architecture: `Internet → Nginx (:80/:443) → PM2 Node app (127.0.0.1:4000)`

> Run commands as a normal user with `sudo`. Replace every `<...>` placeholder.

---

## 0. Before you start — checklist

- [ ] VPS reachable via SSH, Ubuntu 24.04.
- [ ] (Optional but recommended) A domain, e.g. `api.example.com`, with an **A record** pointing to the VPS public IP. Needed for HTTPS.
- [ ] MongoDB Atlas cluster + connection string.
- [ ] In **Atlas → Network Access**, add the VPS public IP (or `0.0.0.0/0` temporarily to test).
- [ ] Your Beeknoee API key (if using real AI), or leave `AI_PROVIDER=mock`.

Find your VPS public IP:
```bash
curl -4 ifconfig.me
```

---

## 1. System update & essential packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx ufw curl
```

## 2. Create swap (REQUIRED on 2 GB)

PDF/DOCX extraction can spike 300–500 MB per document. Swap prevents the OS from
OOM-killing the app on a 2 GB box.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# Reduce swappiness so it's used only under real pressure
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf
free -h       # verify: Swap line shows 2.0Gi
```

## 3. Install Node.js 20 LTS + PM2

Ubuntu 24.04's apt Node is old; use NodeSource for Node 20 LTS.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

node -v    # v20.x
npm -v
pm2 -v
```

## 4. Get the code

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
cd /var/www
git clone <YOUR_REPO_URL> education-project
cd education-project/backend

# Install production dependencies only
npm ci --omit=dev

# Runtime directories (uploaded files + PM2 logs)
mkdir -p logs storage/knowledge
```

## 5. Configure environment (`.env`)

```bash
cp .env.example .env
nano .env
```

Fill in (production values):

```ini
NODE_ENV=production
PORT=4000
TRUST_PROXY=1

# MongoDB Atlas
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/education_ai

# Auth — generate a strong secret:  openssl rand -hex 32
JWT_SECRET=<paste-random-64-hex>
JWT_EXPIRES=7d

# Allow the origin that will call this API (your frontend's URL/domain,
# wherever it is hosted). No trailing slash.
CORS_ORIGIN=https://<origin-that-calls-this-api>

# AI provider
AI_PROVIDER=beeknoee
BEEKNOEE_API_KEY=sk-bee-<your-key>
BEEKNOEE_BASE_URL=https://platform.beeknoee.com/v1
BEEKNOEE_MODEL=deepseek/deepseek-v3.2
BEEKNOEE_EMBED_MODEL=gemini-embedding-001

# Knowledge base
STORAGE_DRIVER=local
MAX_UPLOAD_MB=15

# Seed password (dev convenience; change it)
SEED_DEFAULT_PASSWORD=<change-me>
```

Generate a JWT secret quickly:
```bash
openssl rand -hex 32
```

> `.env` is already in `.gitignore` — never commit it.

### (Optional) Seed demo data the first time
```bash
npm run seed
# Demo logins (password = SEED_DEFAULT_PASSWORD): admin / gv.lan / hs.an, hs.ha, hs.binh
```

## 6. Start the backend with PM2

```bash
# From /var/www/education-project/backend
pm2 start ecosystem.config.cjs --env production
pm2 status
pm2 logs education-ai-backend     # Ctrl+C to exit log view
```

Verify locally (should return JSON `{"status":"ok",...}`):
```bash
curl http://127.0.0.1:4000/api/health
```

Make PM2 survive reboots + rotate logs:
```bash
pm2 save
pm2 startup systemd        # copy & run the sudo command it prints
pm2 install pm2-logrotate  # auto-rotate logs so disk doesn't fill
```

PM2 settings (in `backend/ecosystem.config.cjs`, pre-tuned for 2 GB):
- `fork` mode, `instances: 1` — required: uploads are on local disk and processing
  runs in-process; cluster mode would race. Do **not** change to cluster.
- `max_memory_restart: 900M`, `--max-old-space-size=768` — guards against OOM.

## 7. Configure Nginx reverse proxy

```bash
sudo cp /var/www/education-project/deploy/nginx/education-ai.conf \
        /etc/nginx/sites-available/education-ai.conf

sudo nano /etc/nginx/sites-available/education-ai.conf
#   -> change  server_name  to your domain (or the VPS IP if no domain)

sudo ln -s /etc/nginx/sites-available/education-ai.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default    # remove the default welcome page

sudo nginx -t                 # must say "syntax is ok" / "test is successful"
sudo systemctl reload nginx
```

Verify through Nginx (port 80):
```bash
curl http://<domain-or-IP>/api/health
```

## 8. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'    # opens 80 and 443
sudo ufw enable
sudo ufw status
```
Port 4000 stays private (only Nginx on localhost reaches it).

## 9. HTTPS / TLS (requires a domain)

Only if you have a domain pointing to the VPS:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.<your-domain>
# Choose redirect HTTP->HTTPS when asked. Auto-renew is installed via systemd timer.
sudo certbot renew --dry-run   # confirm renewal works
```

After enabling TLS, make sure `CORS_ORIGIN` in `.env` matches the real origin
that calls this API (scheme + host, no trailing slash), then reload:
```bash
pm2 reload education-ai-backend
```

---

## 10. Smoke test (end to end)

```bash
# Health
curl https://api.<your-domain>/api/health

# Login with a seeded account (if you ran npm run seed)
curl -X POST https://api.<your-domain>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"gv.lan","password":"<SEED_DEFAULT_PASSWORD>"}'
# -> returns { "token": "...", "user": {...} }
```

---

## Updating to a new version (redeploy)

```bash
cd /var/www/education-project/backend
git pull
npm ci --omit=dev
pm2 reload education-ai-backend   # low-downtime reload
pm2 logs education-ai-backend --lines 50
```

---

## Operations cheatsheet

| Command | Purpose |
|---|---|
| `pm2 status` | Process state |
| `pm2 logs education-ai-backend` | Live logs |
| `pm2 monit` | Live CPU/RAM |
| `pm2 reload education-ai-backend` | Low-downtime reload (deploys) |
| `pm2 restart education-ai-backend` | Hard restart |
| `pm2 flush` | Clear logs |
| `free -h` / `htop` | Memory check |
| `sudo tail -f /var/log/nginx/error.log` | Nginx errors |

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `pm2 logs` shows `Không thể kết nối MongoDB` | Atlas IP whitelist missing the VPS IP, or wrong `MONGODB_URI`. Add IP in Atlas → Network Access. |
| `curl .../api/health` fails locally | App not running: `pm2 status`, check `pm2 logs` for the error. |
| Works on `127.0.0.1:4000` but not via domain | Nginx not reloaded / wrong `server_name` / firewall. `sudo nginx -t && sudo systemctl reload nginx`. |
| 413 Request Entity Too Large on upload | Raise `client_max_body_size` in the Nginx conf (must be ≥ `MAX_UPLOAD_MB`). |
| 429 Too Many Requests unexpectedly | `TRUST_PROXY` not set to `1`; the limiter keys everyone to Nginx's IP. Set it in `.env` and `pm2 reload`. |
| App restarts during big uploads | Memory spike hit `max_memory_restart`. Ensure swap is on (`free -h`) and `MAX_UPLOAD_MB` is low (15). |
| CORS errors in browser | `CORS_ORIGIN` must exactly match the origin calling this API (scheme + host, no trailing slash). |
| `certbot` fails | Domain A record must resolve to the VPS IP and port 80 must be open before running certbot. |

---

## Security reminders

- Never commit `.env`; keep `JWT_SECRET` and `BEEKNOEE_API_KEY` secret.
- Keep port 4000 closed to the internet (only Nginx reaches it).
- Narrow the Atlas IP whitelist to the VPS IP once testing is done.
- `storage/knowledge/` holds uploaded source files — back it up and never expose it via a static web path.
- Run `sudo apt update && sudo apt upgrade -y` and `npm audit` periodically.
