# Huddle — Agent Context

> Scoped rules for AI coding assistants working on this repo.
> **Product behavior and system design are documented in `docs/spec/` — that
> is the source of truth.** CLAUDE.md is NOT a duplicate of the spec; it
> points to it and adds agent-meta (conventions, navigation, onboarding).

## Source of Truth

- **Product behavior**: `docs/spec/` — `overview.md` is the index + global
  invariants; topic specs (e.g. `50-screenshare.md`) carry per-feature detail.
  On conflict: spec wins over code.
- **DB schema**: `prisma/schema.prisma` — SoT for tables/columns. Migrations
  via `npx prisma migrate dev`, never hand-edited SQL.
- **Deployment topology**: `docs/tech-spec.md` and `SETUP.md`.
- **Stack-choice rationale**: `decisions.md`.
- **Project vision + done-criteria**: `intent.md`.
- **Build history + tasks + plan**: `context/backlog.md`, `context/plan.yaml`,
  `context/tasks/` — private, tracked only in the dev repo `huddle_dev`
  (see "Working Memory" below).

## Tech Stack

| Layer    | Technology                                                     |
|----------|----------------------------------------------------------------|
| Frontend | React + Vite + TypeScript                                      |
| UI       | Tailwind CSS + Custom Design System                            |
| Backend  | Node.js + Fastify + TypeScript                                 |
| Realtime | WebSocket (chat/presence) + LiveKit (voice/video/screenshare)  |
| Database | PostgreSQL + Prisma ORM                                        |
| Auth     | Session cookies (Secure, HttpOnly) + Argon2id                  |

TypeScript end-to-end, npm workspaces — `src/client`, `src/server`,
`src/shared`. Simplicity first: no Turborepo/Nx, no CI/CD, no bundler
plugin unless Vite defaults fall short.

## Dateistruktur

```
huddle/
├── intent.md
├── CLAUDE.md               (this file)
├── decisions.md
├── SETUP.md                (deployment guide)
├── docs/
│   ├── spec/               (normative product spec — 19 topic files + overview)
│   └── tech-spec.md        (stack, infra, deployment)
│   (build history, plan, tasks: see context/ — private, dev repo only)
├── src/
│   ├── client/             (React + Vite)
│   ├── server/             (Fastify)
│   └── shared/             (shared TypeScript types)
├── prisma/
│   ├── schema.prisma       (DB SoT)
│   └── migrations/
├── tests/
│   ├── api/                (vitest — API)
│   └── e2e/                (Playwright)
├── docker-compose.yml
├── Dockerfile
├── livekit.yaml
├── .env.example
└── package.json            (monorepo root)
```

## Working Memory (private — dev repo only)

Two repos (dev/public split since 2026-05):

- **`huddle_dev`** (`git@github.com:NashEQify/huddle_dev.git`, private) — the
  working repo. `context/` is a normal tracked directory here; there is no
  nested repo and no `save.sh`.
- **`Huddle`** (`git@github.com:NashEQify/Huddle.git`, public) — generated from
  `huddle_dev` by `scripts/release-sync.sh`. Never edited directly.

What lives in `context/`:

- `overview.md`, `history.md`, `session-handoff.md` — Buddy session state
- `backlog.md`, `plan.yaml` — build tooling, v1.x build history
- `tasks/` — task files (YAML+MD pairs)
- `drift-reports/`, `council-*.md`, `launch-posts/` — internal reviews + launch prep

**Commit convention:** plain `git commit` + `git push` in `huddle_dev`; code
and context changes go into the same repo.

**Release to public** (squash-history convention — public keeps a single
commit; details in the header of `scripts/release-sync.sh`):

```bash
git clone git@github.com:NashEQify/Huddle.git ~/projects/huddle   # temporary clone
bash scripts/release-sync.sh
```

```bash
cd ~/projects/huddle && git add -A && git commit --amend --no-edit && git push --force-with-lease origin main
```

Then delete `~/projects/huddle` again. The force-push rewrites public history,
so it needs explicit confirmation. The public repo gets everything except
`context/`, `scripts/release-sync.sh`, `.env*` and build/runtime artefacts
(full exclude list in the script).

## Engineering Conventions (cross-cutting)

Rules that apply across specs — not duplicates of any single spec:

- **Secrets**: never committed. `.env.example` documents all env vars. Real
  secrets live outside the repo (`.env`, `livekit.prod.yaml`).
- **Prisma is DB SoT**: schema changes go through `prisma migrate dev`. No
  hand-edited SQL migrations.
- **API response format**: `{ data: ... }` on success,
  `{ error: { code, message } }` on failure. Consistent across all endpoints.
- **Commands in docs/READMEs**: copy-paste-ready. No placeholder tokens
  without an adjacent "replace with ..." note.
- **WebSocket auth**: cookie-based, same session as HTTP. Session carries
  through WS upgrade.
- **File uploads**: Content-Type validated by magic bytes (see
  `src/server/src/lib/uploads.ts`), max 10 MB, no path traversal.

## Design System (agent glance)

Full design rules live in the Design Skill. For a quick read:

- Aesthetic: Terminal Pastell — Mint/Sage (`#a8d8b9`) on dark blue-gray (`#1a1a2e`)
- Font: IBM Plex Mono end-to-end
- `border-radius: 0` everywhere (hard rule)
- Hex labels `[ 0x10 CHATROOMS ]` for section headers
- Box-drawing chars as separators
- No chat bubbles, no drop shadows on panels, no loading spinners

## Onboarding for Agents

1. Read this file.
2. Read `intent.md` for vision + done-criteria.
3. Read `docs/spec/overview.md` for the spec index + global invariants.
4. For your specific task area, open the matching topic spec (`docs/spec/NN-*.md`).
5. For frontend work, apply the Design System glance above.
6. `context/backlog.md` has the v1.x build history if you need historical context
   (private, dev repo only — see "Working Memory" above).

Before writing code: verify the relevant spec section still describes the
as-is behavior. If code and spec disagree: flag it, don't silently align
code to a stale spec or encode a bug into the spec.
