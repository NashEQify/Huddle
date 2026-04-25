# Huddle — Technical Specification

Implementation reference. Derived from Design Specs (`docs/spec/`).
If this file conflicts with a Design Spec, the Design Spec wins.

## 1. Local Development Setup

### Prerequisites

- Node.js 20+
- Docker + Docker Compose (for postgres + livekit)
- npm (comes with Node.js)

### Environment

Copy `.env.example` to `.env` and fill in values:

```env
# Database
DB_USER=huddle
DB_PASSWORD=localdev
DATABASE_URL=postgresql://huddle:localdev@localhost:5432/huddle

# LiveKit (local dev — no TLS)
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
LIVEKIT_URL=ws://localhost:7880

# Session
SESSION_SECRET=local-dev-secret-min-32-chars-long

# App
NODE_ENV=development
PORT=3000

# Uploads
UPLOAD_DIR=/tmp/huddle-uploads
UPLOAD_MAX_SIZE_MB=10
```

### Start Infrastructure

```bash
# Start postgres + livekit only (app runs in dev mode outside Docker)
docker compose up -d postgres livekit

# Wait for postgres
docker compose exec postgres pg_isready -U huddle

# Run Prisma migrations
npx prisma migrate dev

# Seed database (titles, quotes, built-in avatars)
npx prisma db seed
```

### Start App (Dev Mode)

```bash
# From repo root (npm workspaces)
npm install
npm run dev
```

This starts:
- Vite dev server (client) with HMR on port 5173, proxying API/WS to port 3000
- Fastify server on port 3000

### Local Dev vs Production Differences

| Aspect | Local Dev | Production |
|---|---|---|
| App | `npm run dev` (Vite HMR + Fastify) | Docker container, Fastify serves static build |
| LiveKit URL | `ws://localhost:7880` | `wss://your-livekit-domain.com` (through cloudflared) |
| Uploads | `UPLOAD_DIR` env var (e.g. `/tmp/...`) | Bind mount `./data/uploads` |
| TLS | None (localhost) | Cloudflare terminates TLS |
| Cloudflare Access | None | Active (outer auth gate) |

### Vite Dev Proxy Config

```typescript
// src/client/vite.config.ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

## 2. Database Schema (Prisma)

Source of truth for DB structure. All types derived from `docs/spec/10-domain.md`.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Auth ───────────────────────────────────────────────

model User {
  id                String    @id @default(cuid())
  username          String    @unique           // stored as-is; uniqueness via usernameCanonical
  usernameCanonical String    @unique @map("username_canonical") // lower-case for uniqueness
  email             String
  isAdmin           Boolean   @default(false) @map("is_admin")
  isActive          Boolean   @default(true) @map("is_active")
  lastLoginAt       DateTime? @map("last_login_at")
  lastSeenAt        DateTime? @map("last_seen_at")
  createdAt         DateTime  @default(now()) @map("created_at")

  credentials       Credential?
  sessions          Session[]
  profile           UserProfile?
  roomsCreated      Room[]            @relation("RoomCreator")
  memberships       GroupMembership[]
  messages          Message[]
  reactions         Reaction[]
  dmParticipantA    DirectConversation[] @relation("ParticipantA")
  dmParticipantB    DirectConversation[] @relation("ParticipantB")

  @@map("users")
}

model Credential {
  userId             String   @id @map("user_id")
  passwordHash       String   @map("password_hash")
  mustChangePassword Boolean  @default(false) @map("must_change_password")
  updatedAt          DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("credentials")
}

model Session {
  id        String    @id @default(cuid())
  userId    String    @map("user_id")
  createdAt DateTime  @default(now()) @map("created_at")
  expiresAt DateTime  @map("expires_at")
  revokedAt DateTime? @map("revoked_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

// ─── Profile / Identity ─────────────────────────────────

enum AvatarKind {
  built_in
  uploaded
}

model UserProfile {
  userId          String     @id @map("user_id")
  title           String     @default("")
  avatarKind      AvatarKind @default(built_in) @map("avatar_kind")
  builtInAvatarId String?    @map("built_in_avatar_id")
  portraitUrl     String?    @map("portrait_url")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_profiles")
}

model BuiltInAvatar {
  id       String @id
  label    String
  imageUrl String @map("image_url") // path to SVG file

  @@map("built_in_avatars")
}

model TitlePoolEntry {
  id     String @id @default(cuid())
  title  String
  source String @default("seed") // "seed" | "user"

  @@map("title_pool")
}

model MotdQuote {
  id          String @id @default(cuid())
  text        String @db.VarChar(200)
  attribution String @db.VarChar(60)
  source      String @default("seed") // "seed" | "user"

  @@map("motd_quotes")
}

// ─── Chat Domain ────────────────────────────────────────

model Room {
  id             String   @id @default(cuid())
  name           String   @db.VarChar(50)
  discoverable   Boolean  @default(true)
  createdBy      String   @map("created_by")
  lastActivityAt DateTime @default(now()) @map("last_activity_at")
  createdAt      DateTime @default(now()) @map("created_at")

  creator     User              @relation("RoomCreator", fields: [createdBy], references: [id])
  memberships GroupMembership[]
  messages    Message[]         @relation("RoomMessages")

  @@map("rooms")
}

model DirectConversation {
  id             String   @id @default(cuid())
  participantAId String   @map("participant_a_id")
  participantBId String   @map("participant_b_id")
  lastActivityAt DateTime @default(now()) @map("last_activity_at")
  createdAt      DateTime @default(now()) @map("created_at")

  participantA User      @relation("ParticipantA", fields: [participantAId], references: [id])
  participantB User      @relation("ParticipantB", fields: [participantBId], references: [id])
  messages     Message[] @relation("DirectMessages")

  // Ensure unique pair (always store lower ID as A)
  @@unique([participantAId, participantBId])
  @@map("direct_conversations")
}

enum MembershipState {
  joined
  left
  not_joined
}

model GroupMembership {
  roomId   String          @map("room_id")
  userId   String          @map("user_id")
  state    MembershipState @default(not_joined)
  joinedAt DateTime?       @map("joined_at")
  leftAt   DateTime?       @map("left_at")

  room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([roomId, userId])
  @@map("group_memberships")
}

model Message {
  id        String   @id @default(cuid())
  scopeType String   @map("scope_type") // "room" | "direct"
  scopeId   String   @map("scope_id")   // room_id or direct_id
  authorId  String   @map("author_id")
  content   String   @default("")
  createdAt DateTime @default(now()) @map("created_at")

  author      User         @relation(fields: [authorId], references: [id])
  attachments Attachment[]
  reactions   Reaction[]

  // Polymorphic: either room or direct
  room   Room?               @relation("RoomMessages", fields: [scopeId], references: [id], map: "fk_message_room")
  direct DirectConversation? @relation("DirectMessages", fields: [scopeId], references: [id], map: "fk_message_direct")

  @@index([scopeType, scopeId, createdAt])
  @@map("messages")
}

model Attachment {
  id          String   @id @default(cuid())
  messageId   String   @map("message_id")
  filename    String   @db.VarChar(200)
  contentType String   @map("content_type")
  sizeBytes   Int      @map("size_bytes")
  storagePath String   @map("storage_path")
  createdAt   DateTime @default(now()) @map("created_at")

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@map("attachments")
}

model Reaction {
  messageId String @map("message_id")
  userId    String @map("user_id")
  emoji     String

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([messageId, userId, emoji])
  @@map("reactions")
}
```

### Schema Notes

**DirectConversation participant ordering**: Always store the lexicographically smaller user ID
as `participantAId`. This ensures uniqueness without needing to check both orderings.
Lookup helper: `findDM(userA, userB)` → sort IDs, query by `participantAId + participantBId`.

**Message polymorphic scope**: `scopeType` + `scopeId` together identify whether a message
belongs to a room or DM. The FK relations to Room and DirectConversation are optional —
Prisma handles this, but the application layer must ensure consistency (only one FK is set
per message, matching `scopeType`).

**Prisma workaround**: The dual optional FK on Message may require `@ignore` on one relation
or manual SQL for the FK constraints depending on Prisma version. If Prisma doesn't support
dual optional FKs cleanly, drop the explicit FK relations and enforce referential integrity
at the application layer. The `@@index([scopeType, scopeId, createdAt])` is the critical
performance index regardless.

## 3. REST API Routes

All routes return JSON: `{ data: ... }` on success, `{ error: { code: string, message: string } }` on failure.

Auth: Session cookie required on all routes except `POST /api/auth/signup` and `POST /api/auth/login`.

### 3.1 Auth

```
POST /api/auth/signup
  Body: { username, email, password, passwordRepeat }
  201: { data: { user: { id, username, email, isAdmin }, profile: { title, avatarKind, builtInAvatarId } } }
  400: validation errors
  409: username taken
  Sets session cookie.

POST /api/auth/login
  Body: { username, password }
  200: { data: { user, profile, mustChangePassword } }
  401: invalid credentials
  429: too many attempts (locked for 5 min)
  Sets session cookie.

POST /api/auth/logout
  200: { data: { ok: true } }
  Clears session cookie.

GET /api/auth/session
  200: { data: { user, profile, mustChangePassword } }
  401: no valid session
  Used for auto-login check on app start.

POST /api/auth/change-password
  Body: { newPassword, newPasswordRepeat }
  200: { data: { ok: true } }
  Clears mustChangePassword flag.
  NOTE: No currentPassword required — only available when mustChangePassword is true.
```

### 3.2 Users

```
GET /api/users
  200: { data: { users: [{ id, username, profile, isActive, lastSeenAt }] } }
  Returns all users. Used for sidebar Users section and presence display.

GET /api/users/:userId
  200: { data: { user, profile } }
  404: user not found
```

### 3.3 User Settings

```
PATCH /api/settings/profile
  Body: { title?, builtInAvatarId? }
  200: { data: { profile } }
  No password required.

POST /api/settings/portrait
  Multipart: file (PNG/JPEG/WebP, max 1 MB)
  200: { data: { profile } }
  Sets avatarKind to "uploaded", stores cropped square image.

PATCH /api/settings/email
  Body: { email, currentPassword }
  200: { data: { user } }
  401: password incorrect

PATCH /api/settings/password
  Body: { currentPassword, newPassword, newPasswordRepeat }
  200: { data: { ok: true } }
  401: current password incorrect

POST /api/settings/motd-quote
  Body: { text, attribution }
  201: { data: { quote } }
```

### 3.4 Rooms

```
GET /api/rooms
  200: { data: { rooms: [{ id, name, discoverable, lastActivityAt, membership }] } }
  Returns all rooms with current user's membership state.

POST /api/rooms
  Body: { name, discoverable? }
  201: { data: { room } }
  Creator auto-joined. Broadcasts room.created via WS.

PATCH /api/rooms/:roomId/join
  200: { data: { membership } }
  Sets membership to "joined". Broadcasts room.membership via WS.

PATCH /api/rooms/:roomId/leave
  200: { data: { membership } }
  Sets membership to "left". Broadcasts room.membership via WS.

PATCH /api/rooms/:roomId/rejoin
  200: { data: { membership } }
  Sets membership back to "joined". Broadcasts room.membership via WS.
```

### 3.5 Messages

```
GET /api/messages?scopeType={room|direct}&scopeId={id}&before={timestamp}&limit={50}
  200: { data: { messages: [...], hasMore: boolean } }
  Cursor-based pagination. Returns messages older than `before` timestamp.
  Default limit: 50. Max limit: 100.

GET /api/messages/since?scopeType={room|direct}&scopeId={id}&after={timestamp}
  200: { data: { messages: [...] } }
  Returns messages newer than timestamp. Used for missed message recovery.
  Max: 200 messages (if more, client should do full reload).

POST /api/messages
  Multipart form data:
    - scopeType: "room" | "direct"
    - scopeId: room_id or direct_id (or "new:{otherUserId}" for first DM)
    - content: string (text, may be empty if files-only)
    - files: File[] (0-5 files, each max 10 MB)
  201: { data: { message, directId? } }
  If scopeId starts with "new:", creates DirectConversation first, returns directId.
  Broadcasts message.new via WS.

POST /api/messages/:messageId/reactions
  Body: { emoji }
  200: { data: { reactions } }
  Toggle: adds if not present, removes if present.
  Broadcasts message.reaction via WS.
```

### 3.6 LiveKit

```
POST /api/livekit/token
  Body: { roomName }
  200: { data: { token } }
  Validates: user is authenticated, room name matches allowed patterns (call:*, ss:*),
  user has permission for the scope (membership check for rooms).
  Identity in token = user.id
```

### 3.7 Welcome Screen Data

```
GET /api/welcome
  200: { data: { lastLoginAt, onlineCount, totalUsers, activeCalls, activeScreenshares, motdQuote, tip } }
  Returns data for the Welcome Screen. motdQuote is randomly selected.
```

### 3.8 Admin (requires is_admin)

All admin routes check `is_admin: true`. Return 403 if not admin.

```
GET /api/admin/users
  200: { data: { users: [{ id, username, email, isAdmin, isActive, lastSeenAt, createdAt }] } }

POST /api/admin/users/:userId/reset-password
  200: { data: { tempPassword } }
  Generates 12-char alphanumeric temp password. Sets mustChangePassword.

PATCH /api/admin/users/:userId/deactivate
  200: { data: { user } }
  Revokes sessions, closes WS. Broadcasts presence.offline.

PATCH /api/admin/users/:userId/reactivate
  200: { data: { user } }

GET /api/admin/rooms
  200: { data: { rooms: [{ id, name, memberCount, hasActiveCall }] } }

DELETE /api/admin/rooms/:roomId
  200: { data: { ok: true } }
  Deletes room + memberships + messages. Force-ends call. Broadcasts room.deleted.

PATCH /api/admin/rooms/:roomId
  Body: { name }
  200: { data: { room } }
  Broadcasts room.updated.

POST /api/admin/calls/:scope/end
  Body: { scopeType, scopeId }
  200: { data: { ok: true } }
  Force-ends call via LiveKit Admin API. Broadcasts call.ended.

GET /api/admin/system
  200: { data: { totalUsers, onlineUsers, totalRooms, activeCalls, activeScreenshares, uploadSizeBytes, dbSizeBytes } }
```

## 4. WebSocket Implementation

Full protocol defined in `docs/spec/25-websocket.md`. This section covers implementation details.

### Fastify WebSocket Setup

```typescript
// Use @fastify/websocket plugin
import websocket from '@fastify/websocket';

fastify.register(websocket);

fastify.register(async (fastify) => {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    // Validate session from cookie on upgrade
    const session = await validateSession(req);
    if (!session) {
      socket.close(4001, 'Unauthorized');
      return;
    }
    handleConnection(socket, session.userId);
  });
});
```

### Server-Side State (In-Memory)

```typescript
// Connection registry
const connections = new Map<string, WebSocket>(); // userId → ws

// Typing state
const typingState = new Map<string, NodeJS.Timeout>(); // "scopeType:scopeId:userId" → timeout

// Login attempt tracking
const loginAttempts = new Map<string, { count: number; lockedUntil?: Date }>();
```

Call state and screenshare state are derived from LiveKit — the server queries LiveKit's
API when needed rather than maintaining a parallel state machine. WS events for calls
are triggered by LiveKit webhooks.

### LiveKit Webhooks

Configure LiveKit to send webhooks to the app:

```yaml
# livekit.yaml addition
webhook:
  urls:
    - http://app:3000/api/livekit/webhook
  api_key: devkey
```

Webhook handler translates LiveKit events to WS broadcasts:
- `participant_joined` → `call.joined` / `call.participants`
- `participant_left` → `call.left` / `call.participants`
- `room_finished` → `call.ended`
- `track_published` (screen share track) → `screenshare.started`
- `track_unpublished` (screen share track) → `screenshare.ended`

## 5. LiveKit Integration Details

### Token Generation

```typescript
import { AccessToken } from 'livekit-server-sdk';

function generateToken(userId: string, roomName: string): string {
  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: userId, ttl: '6h' }
  );
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return token.toJwt();
}
```

### Room Name Validation

Token endpoint must validate room name matches allowed patterns:

```typescript
const ROOM_PATTERNS = {
  roomCall:       /^call:[\w-]+$/,         // call:{room_id}
  dmCall:         /^call:dm:[\w-]+$/,       // call:dm:{direct_id}
  roomScreenshare:/^ss:room:[\w-]+$/,       // ss:room:{room_id}
  globalScreenshare:/^ss:global:[\w-]+$/,   // ss:global:{user_id}
};
```

### LiveKit Admin API (for force-end)

```typescript
import { RoomServiceClient } from 'livekit-server-sdk';

const roomService = new RoomServiceClient(
  process.env.LIVEKIT_URL,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

// Force-end a call
await roomService.deleteRoom(livekitRoomName);
```

### Local Dev: LiveKit Config

For local development, `livekit.yaml`:

```yaml
port: 7880
rtc:
  port_range_start: 7882
  port_range_end: 7882
  use_external_ip: false  # local dev: false. production: true
keys:
  devkey: devsecret
room:
  empty_timeout: 60
webhook:
  urls:
    - http://host.docker.internal:3000/api/livekit/webhook
  api_key: devkey
# TURN not needed for local dev
```

Note: `host.docker.internal` lets LiveKit (in Docker) reach the app (running outside Docker
in dev mode). On Linux, use `--add-host=host.docker.internal:host-gateway` in docker-compose
or the app's local network IP.

## 6. File Upload Implementation

### Storage Path

```typescript
function getStoragePath(attachmentId: string, filename: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const sanitized = sanitizeFilename(filename);
  return `${year}/${month}/${attachmentId}_${sanitized}`;
}
```

### Upload Route

Uses `@fastify/multipart` for file handling.

```
POST /api/messages
  Content-Type: multipart/form-data
  Fields: scopeType, scopeId, content
  Files: files[] (0-5)
```

Validation pipeline:
1. File count check (max 5)
2. Per-file size check (max 10 MB)
3. Content-Type whitelist check (declared MIME)
4. Magic byte validation (actual content)
5. Filename sanitization
6. Write to upload directory
7. Create Message + Attachment records in transaction

### File Serving

```
GET /api/uploads/:attachmentId/:filename
```

- Auth check (session cookie)
- Look up Attachment record
- Stream file from disk with correct Content-Type and Content-Disposition headers
- 404 if attachment not found

### Image Processing

Portrait uploads (`POST /api/settings/portrait`) are cropped to square:
- Use `sharp` npm package
- Center crop to square aspect ratio
- Resize to 256×256px
- Output as WebP for storage efficiency

## 7. Seed Data

### Mechanism

Prisma seed script (`prisma/seed.ts`) runs via `npx prisma db seed`.

Seed data files:
- `prisma/seed-data/titles.json` — TitlePool entries (~5000 for production, ~50 for initial dev)
- `prisma/seed-data/motd-quotes.json` — MotdQuote entries (~100-150)
- `prisma/seed-data/avatars.json` — BuiltInAvatar entries (25)

### Built-In Avatars

25 pixel-art style SVGs of iconic game characters. Stored as static files served by the app:
- Path: `src/client/public/avatars/{avatar_id}.svg`
- DB stores: `id`, `label`, `imageUrl` (relative path like `/avatars/nico-bellic.svg`)

SVGs are simple, colorful, pixel-art style:
- 64×64px viewBox
- Flat colors, no gradients
- Recognizable silhouette/color scheme per character
- Mint/sage accent tones to fit TTY aesthetic

Character list from `75-user-settings.md` Section 75.2.1.

### Title Pool Categories

The seed script generates titles in these categories:
- Gaming references: "Dovahkiin", "Nerevarine", "Keyblade Master"
- Historical/nobility: "Graf von Pixelburg", "Ihre Durchlaucht", "Erzherzog"
- Ironic/witty: "Seine Erlauchtheit", "Oberste Heeresklickung", "Generalfeldwebel der Tastatur"

### MOTD Quote Format

```json
[
  { "text": "It's dangerous to go alone! Take this.", "attribution": "Old Man, The Legend of Zelda" },
  { "text": "The cake is a lie.", "attribution": "Portal" },
  { "text": "War. War never changes.", "attribution": "Narrator, Fallout" }
]
```

## 8. Shared Types

Shared TypeScript types between client and server (`src/shared/types/`):

```typescript
// src/shared/types/ws-events.ts
// All WS event types as defined in docs/spec/25-websocket.md

export type WsEventType =
  | 'presence.sync' | 'presence.online' | 'presence.offline'
  | 'message.new' | 'message.reaction'
  | 'typing.start' | 'typing.stop' | 'typing.update'
  | 'call.started' | 'call.ended' | 'call.joined' | 'call.left'
  | 'call.participants' | 'call.muted' | 'call.camera' | 'call.speaking'
  | 'call.force_end'
  | 'screenshare.started' | 'screenshare.ended'
  | 'room.created' | 'room.membership' | 'room.deleted' | 'room.updated'
  | 'dm.call.incoming';

export interface WsMessage<T = unknown> {
  type: WsEventType;
  payload: T;
}

// src/shared/types/api.ts
// API request/response shapes matching Section 3 of this spec

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: { code: string; message: string };
}

export type ScopeType = 'room' | 'direct';

export interface CallScope {
  type: ScopeType;
  id: string;
}
```

## 9. Project Scripts

```jsonc
// package.json (root)
{
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "npm run -w src/server dev",
    "dev:client": "npm run -w src/client dev",
    "build": "npm run build:shared && npm run build:server && npm run build:client",
    "build:shared": "npm run -w src/shared build",
    "build:server": "npm run -w src/server build",
    "build:client": "npm run -w src/client build",
    "db:migrate": "npx prisma migrate dev",
    "db:seed": "npx prisma db seed",
    "db:reset": "npx prisma migrate reset"
  },
  "workspaces": ["src/client", "src/server", "src/shared"],
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

## 10. Docker (Production)

### Port Binding Security

Docker bypasses UFW via direct iptables manipulation. Port bindings without an explicit
IP (e.g. `"5433:5432"`) bind to `0.0.0.0` — publicly reachable from the internet,
regardless of UFW rules.

**Rule: All port bindings MUST specify `127.0.0.1`.**

- Base compose (dev): `"127.0.0.1:PORT:PORT"` — localhost only
- Prod override: `ports: !override []` when no host port needed (e.g. postgres — app
  connects via Docker internal network), otherwise `"127.0.0.1:PORT:PORT"`
- LiveKit media ports (7882/UDP, 7881/TCP) run via `network_mode: host`, not Docker port binding

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY src/shared/package.json src/shared/
COPY src/server/package.json src/server/
COPY src/client/package.json src/client/
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src/server/dist ./src/server/dist
COPY --from=builder /app/src/client/dist ./src/client/dist
COPY --from=builder /app/src/shared/dist ./src/shared/dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
CMD ["node", "src/server/dist/index.js"]
```

### Production Startup

The server entrypoint:
1. Runs `prisma migrate deploy` (applies pending migrations)
2. Runs seed if DB is empty (first deploy only)
3. Starts Fastify on port 3000
4. Serves static client build from `src/client/dist`
5. Registers API routes and WS handler
