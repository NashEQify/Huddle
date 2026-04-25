intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Canonical data model for all persistent and derived entities
  action: Defines User, Session, Profile, Room, DirectConversation, Message, Attachment, Reaction, Presence, ReadPosition, Call, and TitlePool/MotdPool entities with their fields, constraints, and creation rules

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 15-auth, 25-websocket, 30-chat, 35-uploads, 75-user-settings, 80-admin |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2): §10.1 User now lists `previous_login_at` as a distinct field and describes the login-rotation (F-CSD-1001); §10.1 DIM-Map flipped to Implementierbarkeit ✓ — CGL-004/F-CSD-010 resolved in ceb9211 (F-CSD-1002); §10.2 signup now documents HTTP 503 `AVATAR_POOL_EMPTY` fail-fast when `BuiltInAvatar` pool is empty (CGL-023 / F-CSD-147) (F-CSD-1003); §10.3 Room and §10.7 pin the exact rejected control-char set (U+0000..U+001F, U+007F, U+2028, U+2029) and flip Implementierbarkeit ✓ — CGL/F-CSD-016 resolved in 9ff3aea (F-CSD-1004). History: 2026-04-14 — Task 009 Batch 2 retroactive sync (MOTD, signup seeding, DM canonical pair, system messages, edit/delete window, reaction allowlist, presence broadcast, CallParticipantState derivation, Room password at creation). |

## Was diese Spec beschreibt

This spec defines the canonical data model for Huddle. Every persistent entity (User, Room, Message, etc.) and every derived/ephemeral entity (PresenceState, CallParticipantState) is specified here with its fields, types, constraints, and creation rules. Other specs reference these entities by name. The Prisma schema is the implementation of this model.

---

# 10. Domain Model (Normative)

**ID Generation:** All entity primary keys use CUID (`@default(cuid())`) except
Session IDs which use crypto-random (`randomBytes(32).toString('base64url')`).
See 15-auth.md 15.8 for session ID security rationale.

<!-- DIM-Map §10.1 Auth Entities
  Completeness:        ✓  (fields and session-cookie storage match current code, including `previous_login_at`)
  Konsistenz:          ✓  (schema + route behavior + session id generation all aligned)
  Implementierbarkeit: ✓  (rotation of `last_login_at → previous_login_at` + `last_login_at = now` implemented in `routes/auth.ts` login handler; previously tracked as CGL-004 / F-CSD-010, resolved in commit ceb9211)
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓  (15-auth for session id rationale, 65-welcome for `previous_login_at` consumer)
-->

## 10.1 Auth Entities

### User
- user_id: string
- username: string (unique display name, original casing preserved)
- username_canonical: string (separate column storing `username.toLowerCase()`; the unique index is on this column, not on `username`)
- email: string (required)
- is_admin: boolean (default: false; first signup gets true automatically)
- is_active: boolean (default: true; false = deactivated by admin, cannot login)
- last_login_at?: timestamp (current session start, written on every successful login)
- previous_login_at?: timestamp (the value of `last_login_at` *before* the current rotation — i.e., the start of the previous session; this is the timestamp exposed to the Welcome Screen as `WelcomeData.lastLoginAt`; see 65-welcome.md 65.3)
- last_seen_at?: timestamp (updated on WebSocket disconnect; used for presence display, see 00-terminology.md 00.4)
- created_at: timestamp

**Login rotation:** On each successful login the server transactionally
copies `last_login_at` into `previous_login_at` and then sets
`last_login_at = now`. First login ever leaves `previous_login_at`
null. The Welcome Screen consumes `previous_login_at` (wire name:
`lastLoginAt`), not the live `last_login_at`.

### Credentials (server-side only)
- user_id: string
- password_hash: string (Argon2id)
- must_change_password: boolean (default: false; true after admin password reset)
- updated_at: timestamp

### Session
- session_id: string
- user_id: string
- created_at: timestamp
- expires_at: timestamp
- revoked_at?: timestamp

Client/session storage (normative):
- Session is represented as an opaque value stored in a Secure, HttpOnly cookie.

## 10.2 Profile / Identity Entities

<!-- DIM-Map §10.2 Profile / Identity Entities
  Completeness:        ✓  (UserProfile hydration, signup seeding, TitlePool cap/dedup, MotdPool seeded-only)
  Konsistenz:          ✓  (Schema defaults + API response shape aligned with spec)
  Implementierbarkeit: ✓  (Exact caps, endpoints, fallback behavior specified)
  Interface-Vertraege: ✓  (hydrated avatar label/url fields, PATCH /api/settings/profile title side-effect)
  Abhaengigkeiten:     ✓  (Cross-refs to 75-user-settings for UI, 65-welcome for MOTD consumption)
-->

### UserProfile
- user_id: string
- title: string
- avatar_kind: built_in | uploaded
- built_in_avatar_id?: string (set when avatar_kind = built_in)
- portrait_url?: string (set when avatar_kind = uploaded; relative path to stored file)

Title rules:
- title may be empty or non-empty; if empty, UI omits quotes (implementation may also force non-empty; see `75-user-settings.md`).
- title display format: `<username> "<title>"` (quotes are literal).

Avatar hydration (normative):
- When `avatar_kind = built_in`, the server resolves the referenced `BuiltInAvatar` row
  and returns its `image_url` (as `builtInAvatarUrl`) and `label` (as
  `builtInAvatarLabel`) alongside the profile in all user-facing payloads
  (e.g., `GET /api/users`, `user.updated` WS event, message author hydration).
  If `builtInAvatarId` is null, both hydrated fields are null.
- When `avatar_kind = uploaded`, `portraitUrl` carries the relative upload path and
  the built-in fields are null.

Initial profile on signup (normative):
- On successful `POST /api/auth/signup`, the server assigns a random initial
  UserProfile before creating the User row:
  - `title`: a uniformly-random entry from `TitlePool` (any `source`, picked
    by random offset). Fallback: `""` if the pool is empty.
  - `avatar_kind`: always `built_in`.
  - `built_in_avatar_id`: a uniformly-random `BuiltInAvatar` id (picked by random
    offset). If the pool is empty, signup is **rejected** with HTTP 503
    `AVATAR_POOL_EMPTY` (an operator must seed the gallery before new users can
    sign up). This guarantees every User row has `avatar_kind='built_in'` paired
    with a valid `built_in_avatar_id`, so clients never have to render a
    built-in-with-null case. Resolved CGL-023 / F-CSD-147.
- User may change title and avatar later via `PATCH /api/settings/profile` (see
  `75-user-settings.md`).

### BuiltInAvatar
- avatar_id: string
- label: string
- image_url: string (relative path to PNG file, e.g. `/avatars/mario.png`)

Initial built-in avatar pool:
- 25 avatars representing iconic game protagonists as 256x256 PNG images.
- Exact list is defined in `75-user-settings.md` and can be extended later.

### TitlePool
Two sources:
1) Seeded titles (initial pool: ~450 curated titles)
2) User-submitted titles added over time

Persistence model:
- Seed titles are stored server-side (e.g., data file or DB seed).
- User-submitted titles are stored in DB and become eligible for future random selection.

Title submission (normative):
- When a user saves a new custom title via `PATCH /api/settings/profile`, the
  server attempts to add it to `TitlePool` as a `source='user'` entry.
- Cap: additions are only performed while the total count of `source='user'`
  entries is < 200. Once the cap is reached, additional user-submitted titles
  are silently dropped from the pool (the user's own profile title is still
  saved regardless).
- Dedup: if an entry with the exact same `title` string already exists in the
  pool (any `source`), no new row is created.
- No moderation step. Any accepted user-submitted title becomes immediately
  eligible for future random selection (including the signup seeding path).

### MotdPool
Seeded quotes: ~100-150 iconic gaming quotes shipped with the app (DB seed).
The pool is read-only at runtime — no user or admin can add, edit, or
remove quotes in v1.

Each entry:
- text: string (max 200 characters)
- attribution: string (max 60 characters, e.g., "GLaDOS, Portal")

<!-- DIM-Map §10.3 Chat Domain
  Completeness:        ✓  (DM canonical pair, lazy DM creation, not_joined semantics, system messages, edit/delete window, reaction allowlist now described)
  Konsistenz:          ✓  (Schema + API + permission checks aligned; immutability of system messages stated)
  Implementierbarkeit: ✓  (Room-name control-character filter enforced by `validateRoomName` in `src/server/src/lib/validation.ts`, called from POST /api/rooms and PATCH /api/admin/rooms/:roomId; previously tracked as CGL / F-CSD-016, resolved in commit 9ff3aea)
  Interface-Vertraege: ✓  (POST /api/messages lazy-DM path, P2002 handling, 3-min window FORBIDDEN code, reaction allowlist cross-ref)
  Abhaengigkeiten:     ✓  (Cross-refs 25-websocket, 30-chat, 80-admin, overview Invariants A/C/D)
-->

## 10.3 Chat Domain

### Room (Group Room)
- room_id: string
- room_name: string (1-50 characters, no control characters — rejected set: `U+0000..U+001F`, `U+007F`, `U+2028`, `U+2029`; i.e. C0 controls, DEL, LINE SEPARATOR, and PARAGRAPH SEPARATOR — all of which break rendering and enable log/CSV-injection)
- passwordHash: string? (Argon2id, optional)
- discoverable: boolean
- created_by: user_id
- last_activity_at: timestamp (server canonical)
- created_at: timestamp

Room password rules (normative):
- Password is optional. When set: 4-64 characters.
- Password is checked on join and rejoin. Users who are already `joined` are not
  re-prompted (they passed the check on their initial join).
- Admin bypasses the password check.
- Creator and admin can set, change, or remove the password via
  `PATCH /api/rooms/:roomId/password`.

### DirectConversation
- direct_id: string
- participant_a_id: user_id (canonical: lexicographically smaller of the two user ids)
- participant_b_id: user_id (canonical: lexicographically larger of the two user ids)
- last_activity_at: timestamp
- created_at: timestamp

Canonical pair (normative):
- The two participant columns are ordered: `participant_a_id < participant_b_id`
  by JavaScript string comparison. Callers (all server-internal) MUST canonicalize
  the pair via a `sortParticipants(a, b)` helper before any `findUnique` or
  `create`, so both participants can look up the same row regardless of which
  direction the request came from.
- Uniqueness: the composite index `(participant_a_id, participant_b_id)` is
  unique. Concurrent `create` requests from the two participants may race;
  the loser of the race receives Prisma error `P2002` and MUST handle it by
  re-reading the existing row with the same canonical pair.
- Self-DM is not allowed: `otherUserId == self` returns `VALIDATION_ERROR`.

Creation rule (normative):
- DirectConversation entities are created eagerly when a user opens the DM view
  (`GET /api/direct/:otherUserId`). This ensures call and screenshare controls
  are available immediately, not only after the first message.
- The UI shows the DM view immediately on user click.
- DirectConversations are also created lazily on the first-message path: a
  client MAY send `POST /api/messages` with `scopeType: 'direct'` and
  `scopeId: "new:<otherUserId>"`. The server validates `otherUserId` exists
  and `isActive === true`, rejects self-DM with `VALIDATION_ERROR`,
  canonicalizes the pair, and creates the DirectConversation if it does not
  exist (P2002 race handled by re-read). The response body includes the
  resolved `directId` so the client can pivot subsequent requests (WS joins,
  reads, etc.) to the real id.

### GroupMembership
- room_id: string
- user_id: string
- membership_state: joined | left | not_joined
- joined_at?: timestamp
- left_at?: timestamp

History rule (normative):
- When user transitions into joined, the room displays full available history immediately.

Row-existence semantics (normative):
- `not_joined` is represented in two equivalent ways at runtime and both MUST
  be treated identically by all permission checks:
  - (a) no `GroupMembership` row exists for `(roomId, userId)`.
  - (b) a row exists with `state = 'not_joined'`.
- Server behavior:
  - On room creation (`POST /api/rooms`), only the creator's row is inserted
    with `state = 'joined'`. No `not_joined` rows are written for other users.
  - On `POST /api/rooms/:roomId/join`, a row with `state = 'joined'` is
    inserted (upsert).
  - On `POST /api/rooms/:roomId/leave`, the existing row is transitioned to
    `state = 'left'`. On a subsequent rejoin it is transitioned back to
    `state = 'joined'`.
  - The server never explicitly writes `state = 'not_joined'`; that enum value
    exists purely so the derived client-facing membership state can be
    represented uniformly.
- The sidebar `discoverable` bucket (overview Invariant A) corresponds to:
  `not_joined` (either representation) AND `Room.discoverable = true`.

### Message
- message_id: string
- scope_type: room | direct
- scope_id: room_id or direct_id
- author_id: user_id
- content: string (may be empty if message is file-only; max 10000 characters after trim for user-submitted messages)
- created_at: timestamp
- deleted_at?: timestamp (soft-delete; non-null = tombstone)
- deleted_by?: user_id (who deleted: author or admin)
- edited_at?: timestamp (last edit time)
- edited_by?: user_id (who edited: author or admin)
- reply_to_id?: message_id (FK, onDelete: SetNull; reply target)

System messages (normative):
- Certain membership transitions are recorded as normal `Message` rows whose
  `content` uses the reserved prefix `::system::<action>`. Actions in v1:
  - `::system::joined` — written on room creation (creator) and on explicit
    join or rejoin by a member.
  - `::system::left` — written when a member leaves a room.
  - `::system::rejoined` — written when a previously-left member rejoins.
- Author identity: `author_id` of a system message is the user who performed
  the action.
- Ingress guard: user-submitted messages whose trimmed `content` starts with
  `::system::` are rejected at `POST /api/messages` with
  `VALIDATION_ERROR "Reserved message prefix"`.
- Immutability: system messages cannot be edited or deleted via
  `PATCH /api/messages/:id` or `DELETE /api/messages/:id`, even by admins.
  Attempts return `VALIDATION_ERROR`.
- Broadcast: system messages participate in normal membership-filtered
  broadcast like any other room message (see `25-websocket.md`).

Edit/delete authorization (normative):
- Author path: the author MAY edit or soft-delete their own message only if
  all of the following hold:
  - Message is not a tombstone (`deleted_at IS NULL`).
  - Message is not a system message (content does not start with `::system::`).
  - For `scope_type = room`: the author currently has
    `GroupMembership.state = 'joined'` for `scope_id`.
  - For `scope_type = direct`: the author is still one of the DM participants.
  - Elapsed time since `created_at` is < 3 minutes (`3 * 60 * 1000` ms).
  - Violations return `FORBIDDEN` with message `"time window expired"`
    (elapsed) or `"You can only edit/delete your own messages"` (author
    mismatch) or `"You must be a joined member..."` (membership).
- Admin path: a user with `User.is_admin = true` may edit or delete any
  non-tombstone, non-system message with no author, membership, or
  time-window restriction.
- Edit rewrites `content`, sets `edited_at = now()` and
  `edited_by = <actor>`. Delete soft-deletes: sets `deleted_at = now()` and
  `deleted_by = <actor>`; the row is retained as a tombstone.
- Cross-reference: `30-chat.md §30.9 / §30.10` for UX framing.

### Attachment
- attachment_id: string
- message_id: string
- filename: string (sanitized, max 200 characters)
- content_type: string (MIME type)
- size_bytes: integer
- storage_path: string (relative path under uploads directory)
- created_at: timestamp

### Reaction
- message_id: string
- user_id: string
- emoji: string (must be one of the server-maintained allowlist; see below)

Constraints:
- Max 10 reactions per user per message.
- No duplicate emoji per user per message.
- User may remove own reactions.
- `emoji` MUST be one of a server-maintained curated allowlist of Unicode
  strings (v1: 22 entries). The canonical list lives in `30-chat.md §30.5`.
  Strings outside the allowlist are rejected server-side with
  `VALIDATION_ERROR`. The exact Unicode form (including `U+FE0F` variation
  selector where applicable, e.g., `❤️`, `⚔️`) must match byte-for-byte;
  clients are responsible for normalizing before sending.

<!-- DIM-Map §10.4 Presence / Active Users
  Completeness:        ✓  (admin-triggered presence.offline broadcast now documented)
  Konsistenz:          ✓  (lastSeenAt persistence path unchanged; advisory timestamp noted)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓  (cross-ref to 25-websocket §25.6 and 80-admin)
  Abhaengigkeiten:     ✓
-->

## 10.4 Presence / Active Users

### PresenceState (ephemeral, in-memory)
- user_id: string
- is_active: boolean
- last_seen_at: timestamp (persisted to DB on disconnect)

Conversation-active users list (UI):
- "Active users" in a conversation header means:
  - users who are active in the system AND are participants/members relevant to that conversation
  - direct: the two participants (active subset)
  - group: members (active subset)

Presence mechanism defined in `25-websocket.md` Section 25.6.

Admin-triggered offline broadcast (normative):
- `PATCH /api/admin/users/:userId/deactivate` (see `80-admin.md`) revokes all
  sessions, force-closes all WS connections for the user, and additionally
  emits a `presence.offline` WS broadcast with
  `{ userId, lastSeenAt: <deactivation timestamp> }`.
- The broadcast's `lastSeenAt` is advisory and reflects the deactivation
  moment. `users.last_seen_at` in the DB is persisted only by the normal WS
  close path; a direct write by the deactivate handler is not performed.

## 10.4b Read Positions (Server-Side Unread Tracking)

### ReadPosition
- userId: string
- scopeType: string (`"room"` | `"direct"`)
- scopeId: string (room_id or direct_id)
- lastReadAt: timestamp

Composite primary key: `(userId, scopeType, scopeId)`.

Used by the server to compute unread scopes on WS connect (`unread.init`)
and updated when the client sends `mark_read`. See `20-notifications.md`
and `25-websocket.md` for protocol details.

<!-- DIM-Map §10.5 Calls & Speaking Indicator
  Completeness:        ✓  (derivation formulae for all four booleans pinned)
  Konsistenz:          ✓  (match LiveKit server-side listParticipants output semantics)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓  (MICROPHONE = source 1, CAMERA = source 2; matches LiveKit SDK constants)
  Abhaengigkeiten:     ✓  (25-websocket for speaking relay, overview Invariant I for room names)
-->

## 10.5 Calls & Speaking Indicator

### CallSession (Room or Direct)
- scope_type: room | direct
- scope_id: room_id or direct_id
- livekit_room_name: string (see overview.md Invariant I for patterns)
- participants: derived from LiveKit connection state

### CallParticipantState (derived)
- user_id: string
- is_in_call: boolean
- is_muted: boolean
- is_speaking: boolean (derived from audio level threshold with short decay)
- has_camera: boolean

Derivation (normative):
- The server computes participant state by calling LiveKit's
  `roomService.listParticipants(livekit_room_name)` and mapping each
  participant's published tracks (`TrackInfo.source`, `TrackInfo.muted`).
  Track-source enum values: `1 = MICROPHONE`, `2 = CAMERA`.
- `is_in_call` := the user's `identity` appears in the LiveKit participant
  list for the room.
- `is_muted` := no MICROPHONE track is both published and unmuted, i.e.
  `tracks.every(t => t.source !== MICROPHONE || t.muted)`. Note: a
  participant who has not published any microphone track at all is reported
  as `is_muted = true` (the "never spoke" case and the "published then muted"
  case are conflated by design — the UI treats both as "not audible").
- `has_camera` := at least one CAMERA track is published and unmuted, i.e.
  `tracks.some(t => t.source === CAMERA && !t.muted)`.
- `is_speaking` := driven by LiveKit audio-level / audio-activity events
  emitted on the client and relayed via the `call.speaking` WS message (see
  `25-websocket.md`). Used for UI glow only; has a short decay so rapid
  on/off flicker is damped client-side.

## 10.6 Email Change
Email change workflow requires current password verification (see `75-user-settings.md`).

<!-- DIM-Map §10.7 Room Creation
  Completeness:        ✓  (password field at creation documented; creator auto-join bypass documented)
  Konsistenz:          ✓  (matches 10.3 Room password rules and 30-chat.md §30.7)
  Implementierbarkeit: ✓  (control-character rejection enforced by `validateRoomName`; resolved in commit 9ff3aea)
  Interface-Vertraege: ✓  (POST /api/rooms body: { name, discoverable?, password? })
  Abhaengigkeiten:     ✓  (25-websocket for room.created, 10.3 for password rules)
-->

## 10.7 Room Creation

Any authenticated user can create a group room.

Fields (POST /api/rooms body):
- Room name (required, 1-50 characters, no control characters — rejected set: `U+0000..U+001F`, `U+007F`, `U+2028`, `U+2029`; see §10.3 Room).
- Discoverable (boolean, optional, default: true).
- Password (optional string; when provided non-empty, must be 4-64
  characters after trim; stored as Argon2id hash).

On creation:
- Creator is automatically `joined` (GroupMembership row written with
  `state='joined'` and `joined_at = now()`).
- A `::system::joined` system message is written by the server in the same
  transaction as the room row (see §10.3 Message system messages).
- If a password was provided, the creator is auto-joined without being
  prompted to re-enter it (they set it, no need to re-verify).
- Navigation switches to the new room.
- `room.created` WS event broadcast to all connected clients (payload
  includes `hasPassword` so the sidebar can render the lock indicator).
- `last_activity_at` set to creation timestamp.
