# Huddle

Self-hosted voice, video, and chat for small groups. Terminal aesthetic. One Docker command.

> Built for 10 friends, not 10,000 servers.

## Try it in 60 seconds

```bash
git clone https://github.com/NashEQify/Huddle.git
cd Huddle
docker compose up
```

Then open **http://localhost:3000**. The first account you sign up becomes admin.

No config, no `.env` editing, no secrets to generate — the dev defaults in `docker-compose.yml` work out of the box. Three containers start: the app, PostgreSQL, and a local LiveKit server. Everything runs on your machine, database stays empty, nothing phones home.

> ⚠️ The defaults are **dev defaults** (unsafe passwords, dev LiveKit keys). Fine for local evaluation. For a real deployment, see [Production Deployment](#production-deployment) below.

## What is this?

A private Discord/Signal alternative you run on your own server. Text chat with persistent history, voice calls, video, screenshare, emoji reactions, file uploads -- all wrapped in a terminal-inspired UI with monospace fonts, box-drawing borders, and mint-on-dark colors.

Designed for small trusted groups (5-15 people). No federation, no bots, no enterprise features. Just a place to hang out.

## Features

- **Chat** -- Persistent messages, replies, edits, deletes, emoji reactions, @mentions, file/image uploads with lightbox, full-text search
- **Voice & Video** -- LiveKit-powered calls with camera, mute, speaking indicators
- **Screenshare** -- 1080p30 screen sharing with in-app preview and fullscreen viewer
- **Background Blur** -- Toggle camera background blur in settings or during calls
- **Audio Visualizer** -- Hidden Milkdrop/Butterchurn visualizer (click the waveform icon)
- **Rooms** -- Group rooms with join/leave/discover, optional passwords
- **Direct Messages** -- 1-on-1 chat, voice, video, screenshare
- **Presence** -- Online/offline indicators, last seen timestamps
- **Notifications** -- Unread dots, tab counter, call ring sounds
- **Themes** -- 10 color themes (Terminal Mint, Amber Console, Arctic, etc.)
- **Admin Console** -- User management, password resets, room management

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript |
| UI | Tailwind CSS + Custom Design System |
| Backend | Node.js + Fastify + TypeScript |
| Realtime | WebSocket (Chat, Presence) |
| Media | LiveKit (Voice, Video, Screenshare) |
| Database | PostgreSQL + Prisma ORM |
| Auth | Session Cookies (Secure, HttpOnly) |
| Password | Argon2id |

## Production Deployment

The quick-start above is for local evaluation only — it uses dev credentials and binds LiveKit to localhost. For a real deployment you need your own domain, real secrets, and direct UDP access for WebRTC.

### 1. Clone and configure

```bash
git clone https://github.com/NashEQify/Huddle.git
cd Huddle
cp .env.example .env
# Edit .env with real secrets (see below)
# Edit livekit.prod.yaml with your server's public IP and API key
```

### 2. Build and start

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 3. Point a reverse proxy at it

You need two subdomains: one for the app, one for LiveKit signaling. See [SETUP.md](SETUP.md) for Caddy, nginx, and Cloudflare Tunnel examples.

Plus one firewall rule: **port 7882/UDP** must be reachable from the internet. WebRTC media can't go through most reverse proxies.

### Environment Variables

Copy `.env.example` to `.env` and fill in real values.

**Secrets (must change for production):**

| Variable | Example | Purpose |
|---|---|---|
| `DB_PASSWORD` | `openssl rand -hex 16` | PostgreSQL password |
| `SESSION_SECRET` | `openssl rand -hex 32` | Cookie signing key (min 32 chars) |
| `LIVEKIT_API_KEY` | `openssl rand -hex 12` | Shared secret between app and LiveKit |
| `LIVEKIT_API_SECRET` | `openssl rand -hex 24` | Shared secret between app and LiveKit |

**LiveKit URLs (critical for calls):**

The app has three separate LiveKit URL variables for different purposes:

| Variable | When | Example | Purpose |
|---|---|---|---|
| `LIVEKIT_URL` | Set in docker-compose.yml | `ws://livekit:7880` | Internal: server talks to LiveKit (token generation, room API). Rarely needs changing. |
| `LIVEKIT_PUBLIC_URL` | Set in `.env` | `wss://lk.yourdomain.com` | **Runtime client URL.** The app serves this to browsers via `GET /api/config`. This is what makes calls work. Set this to the public WebSocket URL of your LiveKit server. |
| `VITE_LIVEKIT_URL` | Set in `.env` | `wss://lk.yourdomain.com` | Build-time fallback. Baked into the frontend by Vite. Only used if `LIVEKIT_PUBLIC_URL` is empty. Note: `.dockerignore` excludes `.env`, so this has no effect in Docker builds unless you pass it as a build arg. |

**For production, always set `LIVEKIT_PUBLIC_URL`.** If it's missing, clients fall back to `ws://localhost:7880` and calls fail for everyone except the server host.

After changing `.env` values, recreate the container to pick up the changes:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate app
```

> **Deploy with AI:** This repo is designed to be agent-friendly. Point Claude, Cursor, or any AI coding assistant at this README and [SETUP.md](SETUP.md) — the instructions are copy-paste-ready and the project rules in [CLAUDE.md](CLAUDE.md) give agents full context.

## Development (hot reload)

If you want to hack on the code, run the app with hot reload against a local infrastructure stack:

```bash
git clone https://github.com/NashEQify/Huddle.git
cd Huddle
cp .env.example .env
npm install
npm run dev:infra              # start postgres + livekit in docker
npx prisma migrate dev         # apply database schema
npx prisma db seed             # seed avatars, titles, MOTD quotes
npm run dev                    # start client + server with hot reload
```

Then open http://localhost:5173. See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

## Security Notice

This app is designed for **small trusted groups behind a reverse proxy or VPN**. It is NOT hardened for public-facing deployment on the open internet. Authentication exists for identity within the group, not as a security perimeter.

Recommended setup:
- Put it behind Cloudflare Access, Authelia, or a VPN
- Do NOT expose it directly to the internet without an access control layer

## Design Specs

The `docs/spec/` directory contains comprehensive design specifications covering every feature. These specs are detailed enough to reimplement the app from scratch in any language.

## Architecture Decisions

See [decisions.md](decisions.md) for the rationale behind key technical choices.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
