# Production Deployment Guide

This guide covers deploying Huddle on your own server with Docker.

## Prerequisites

- A Linux server (tested on Ubuntu/Debian)
- Docker and Docker Compose v2
- A domain name (e.g., `huddle.example.com`)
- A subdomain for LiveKit signaling (e.g., `lk.example.com`)
- A reverse proxy (Caddy, nginx, Cloudflare Tunnel, etc.)
- Port 7882/UDP open on your firewall for WebRTC media

## Architecture Overview

```
Internet
  |
  +-- Reverse proxy (Caddy / nginx / cloudflared)
  |     |
  |     +-- huddle.example.com --> app container (port 3000)
  |     +-- lk.example.com     --> LiveKit signaling (port 7890)
  |
  +-- Direct (must be publicly reachable)
        |
        +-- Port 7882/UDP -- LiveKit media (WebRTC)
        +-- Port 7881/TCP -- LiveKit ICE TCP fallback (optional)
```

**Key point:** LiveKit media (UDP) cannot go through most reverse proxies. Port 7882/UDP must be directly accessible from the internet. The app and LiveKit signaling (WSS) can share a reverse proxy on different subdomains.

## 1. Clone and Configure

```bash
git clone https://github.com/NashEQify/Huddle.git
cd Huddle
cp .env.example .env
```

Edit `.env` with real values:

```bash
# Database credentials
DB_USER=huddle
DB_PASSWORD=<generate: openssl rand -hex 16>

# LiveKit API credentials (shared between app and LiveKit server)
# These can be any random strings, but must match between app and LiveKit config
LIVEKIT_API_KEY=<generate: openssl rand -hex 12>
LIVEKIT_API_SECRET=<generate: openssl rand -hex 24>

# LiveKit signaling URL (pick ONE of the two options below)
#
# Option A: Build-time (baked into the JS bundle during docker build)
VITE_LIVEKIT_URL=wss://lk.example.com
#
# Option B: Runtime (served by the backend, no rebuild needed)
# Preferred for pre-built images (docker-compose.standalone.yml)
LIVEKIT_PUBLIC_URL=wss://lk.example.com

# Session signing secret
SESSION_SECRET=<generate: openssl rand -hex 32>
```

**LiveKit URL configuration:**
- **`VITE_LIVEKIT_URL`** is a Vite environment variable baked into the JS bundle at build time. If you change it, you must rebuild the app container.
- **`LIVEKIT_PUBLIC_URL`** is a runtime alternative served by the backend via `/api/config`. Set this when using a pre-built Docker image (e.g., `docker-compose.standalone.yml`) so you don't need to rebuild. If both are set, `LIVEKIT_PUBLIC_URL` takes priority.

## 2. Configure LiveKit

Edit `livekit.prod.yaml` with your server's public IP and LiveKit API key:

```yaml
port: 7890

rtc:
  port_range_start: 7882
  port_range_end: 7892
  tcp_port: 7881
  use_external_ip: false
  node_ip: <YOUR_SERVER_PUBLIC_IP>    # Replace with your server's public IP

room:
  empty_timeout: 60

webhook:
  urls:
    - http://127.0.0.1:3000/api/livekit/webhook
  api_key: <SAME_AS_LIVEKIT_API_KEY>  # Must match LIVEKIT_API_KEY in .env
```

The `LIVEKIT_KEYS` environment variable in docker-compose.yml automatically passes the API key/secret pair to LiveKit, so you do not need a `keys:` section in the YAML. However, the `webhook.api_key` field must be set manually to the same value as `LIVEKIT_API_KEY` in your `.env`.

## 3. Build and Start

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This starts three containers:
- **app** -- The Huddle application (port 3000, localhost only)
- **postgres** -- PostgreSQL database (no host port in production)
- **livekit** -- LiveKit server (host network mode, port 7890 for signaling, 7882 UDP for media)

Database migrations run automatically on app startup.

## 4. Reverse Proxy Setup

You need to proxy two subdomains to the local services.

### Option A: Caddy

```
huddle.example.com {
    reverse_proxy localhost:3000
}

lk.example.com {
    reverse_proxy localhost:7890
}
```

### Option B: nginx

```nginx
server {
    listen 443 ssl;
    server_name huddle.example.com;

    # SSL certificates (e.g., from Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/huddle.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/huddle.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    server_name lk.example.com;

    ssl_certificate /etc/letsencrypt/live/lk.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/lk.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7890;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Option C: Cloudflare Tunnel (cloudflared)

If you use Cloudflare Tunnel, configure two routes:
- `huddle.example.com` -> `http://localhost:3000`
- `lk.example.com` -> `http://localhost:7890`

LiveKit media (UDP) still needs direct port access -- cloudflared only handles HTTP/WS.

## 5. Firewall

Open these ports on your server firewall:

| Port | Protocol | Purpose |
|------|----------|---------|
| 7882 | UDP | LiveKit media (WebRTC) -- required |
| 7881 | TCP | LiveKit ICE TCP fallback -- recommended |

The app (port 3000) and LiveKit signaling (port 7890) do NOT need to be open -- they are accessed through your reverse proxy.

Example with UFW:

```bash
sudo ufw allow 7882/udp comment "LiveKit WebRTC media"
sudo ufw allow 7881/tcp comment "LiveKit ICE TCP fallback"
```

**Warning about Docker and UFW:** Docker manipulates iptables directly and bypasses UFW rules. All Docker port bindings in this project bind to `127.0.0.1` to prevent accidental public exposure. LiveKit runs with `network_mode: host` and listens on all interfaces for media -- this is intentional and required for WebRTC.

## 6. First Login

1. Open `https://huddle.example.com` in your browser
2. Click "Sign Up" and create the first account
3. The first user automatically becomes admin
4. Use the Admin Console to manage users and rooms

## 7. Backups

### Database

```bash
# Dump the database
docker compose exec postgres pg_dump -U huddle huddle > backup.sql

# Restore from dump
cat backup.sql | docker compose exec -T postgres psql -U huddle huddle
```

### Uploads

The uploads directory is at `./data/uploads` (relative to the repo). Back it up however you back up files:

```bash
rsync -av ./data/uploads /path/to/backup/uploads
```

### Full backup script example

```bash
#!/bin/bash
BACKUP_DIR="/path/to/backups/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Database
docker compose exec -T postgres pg_dump -U huddle huddle > "$BACKUP_DIR/db.sql"

# Uploads
rsync -av ./data/uploads "$BACKUP_DIR/"

echo "Backup complete: $BACKUP_DIR"
```

## Updating

```bash
cd /path/to/Huddle
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Database migrations run automatically on app startup.

## Troubleshooting

### Voice/video calls don't connect

- Verify port 7882/UDP is open and reachable from the internet
- Check that `node_ip` in your LiveKit config matches your server's public IP
- Check that `LIVEKIT_PUBLIC_URL` (runtime) or `VITE_LIVEKIT_URL` (build-time) points to the correct WSS URL
- Look at LiveKit logs: `docker compose logs livekit`

### WebSocket connection fails

- Ensure your reverse proxy is configured to upgrade WebSocket connections
- Check that both `Upgrade` and `Connection` headers are forwarded

### App won't start

- Check logs: `docker compose logs app`
- Verify PostgreSQL is healthy: `docker compose ps`
- Ensure `DATABASE_URL` can reach the postgres container

### LiveKit webhook errors

- LiveKit must be able to reach the app at `http://127.0.0.1:3000`
- Check that `webhook.api_key` in LiveKit config matches `LIVEKIT_API_KEY` in `.env`
