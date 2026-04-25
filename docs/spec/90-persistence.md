intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Data storage locations and persistence strategy across server and client
  action: Defines what is stored in the database (Prisma), in-memory (ephemeral server state), on the filesystem (uploads), and in the client (localStorage keys for preferences, theme, font size)

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.1.0 |
| **Konsumiert** | overview, 10-domain, 15-auth, 25-websocket, 70-audio-settings, 75-user-settings, 95-visualizer |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 11 findings applied): §90.1 DB enumeration expanded with BuiltInAvatar model and previously-unlisted columns (previousLoginAt, lastSeenAt, usernameCanonical, createdAt, lastActivityAt on Room/DirectConversation, GroupMembership.state enum + joinedAt/leftAt, Message soft-delete + edit + replyToId polymorphic scopeType/scopeId) (F-CSD-9002); §90.2 Presence corrected per user-decision F-CSD-9001 — single-connection per user (last-write-wins via code 4000 close); new bullets for heartbeat state + activeScreenshares map (F-CSD-9003); §90.4 removed dead "Last known username" line (F-CSD-9006); §90.4 added visualizer localStorage keys (F-CSD-9005); sidebar key names made concrete (F-CSD-9007); `video.backgroundBlur` dual-ownership noted (F-CSD-9008); message queue cap 50 + drop-oldest documented (F-CSD-9011); theme key `huddle-theme` retained (F-CSD-9004 resolved via migration shim in commit d8bde90). |

## Was diese Spec beschreibt

This spec is the canonical reference for where every piece of data lives. It lists all server-side database entities (Prisma), ephemeral in-memory state (presence, typing, login attempts, call state), filesystem storage (uploads), and client-side localStorage keys (device preferences, UI preferences, color theme, chat font size). It ensures no data storage location is ambiguous or undocumented.

---

# 90. Persistence (Normative)

## 90.1 Server Stores (Database -- Prisma)

Canonical table list with product-meaningful columns. The full shape
is always defined by `prisma/schema.prisma` (source of truth).

- **Users**: `id`, `username`, `username_canonical` (unique index —
  lookup + lockout keying), `email`, `is_admin`, `is_active`,
  `last_login_at` (current session start), `previous_login_at` (prior
  session start — Welcome Screen reads this; see 10-domain §10.1),
  `last_seen_at` (WS disconnect timestamp — advisory, §10.4),
  `created_at`.
- **Credentials**: `password_hash` (Argon2id), `must_change_password`.
- **Sessions**: crypto-random IDs (`randomBytes(32).toString('base64url')`);
  no database-level default — IDs are always generated in application
  code.
- **UserProfiles**: `title`, `avatar_kind` (`built_in` | `uploaded`),
  `built_in_avatar_id`, `portrait_url`.
- **BuiltInAvatar** (separate catalog table, seed-only): `id`,
  `label`, `image_url`. Referenced by
  `UserProfiles.built_in_avatar_id`. See 75-user-settings §75.2.1 for
  the seed list.
- **Rooms**: `id`, `name`, `created_by`, `discoverable`,
  `password_hash` (optional), `created_at`, `last_activity_at` (used
  for sidebar sorting, see 20-notifications §20.6).
- **DirectConversations**: `id`, `user_a_id` / `user_b_id` (lex-sorted
  canonical pair, unique), `last_activity_at`. Created eagerly on DM
  view open.
- **GroupMemberships**: `state` enum `{ joined, left, not_joined }`;
  `joined_at`; `left_at`. Absence-as-`not_joined` rule — see
  10-domain §10.3.
- **Messages**: polymorphic `scope_type` (`room` | `direct`) +
  `scope_id` with app-level integrity (no DB FK). Soft-delete
  columns: `deleted_at`, `deleted_by`. Edit tracking: `edited_at`,
  `edited_by`. Reply: `reply_to_id` (self-relation, ON DELETE SET
  NULL). System messages use `::system::<action>` content sentinel.
- **Attachments**: file metadata (MIME, size, filename, storage path);
  actual files live on disk — see §90.3.
- **Reactions**: per-user per-message per-emoji; max 10 per user per
  message (see 10-domain §10.3 reaction allowlist).
- **ReadPositions**: per-user per-scope `last_read_at` for unread
  tracking. See 20-notifications §20.2.
- **TitlePool**: seeded titles, 200-entry cap, deduped. See
  10-domain §10.2.
- **MotdPool** (table `motd_quotes`): seeded quotes with
  `text`/`attribution`/`source='seed'` column. Re-seeding deletes
  only `source='seed'` rows. See 65-welcome §65.4.

## 90.2 Server Stores (In-Memory / Ephemeral)

- **Presence state**: WS connection → online/offline. **Single
  connection per user** (last-write-wins semantics): a new WS
  connection force-closes the prior one with code `4000 Replaced by
  new connection`. Admin deactivation uses code `4004`. Multi-tab or
  multi-device users cannot hold concurrent WS connections. Earlier
  spec revisions claimed "multi-connection per user supported" — that
  was aspirational and never implemented; user-decision 2026-04-24
  to keep single-connection semantics and align spec to code.
- **WS heartbeat state**: per-connection ping/pong timers (30s ping
  interval, 10s pong timeout, close code `4002` on timeout). Lives
  in `src/server/src/ws/index.ts`.
- **Typing state**: per scope per user, with 5s server-side timeout,
  membership-validated. Cleared on WS close.
- **Login attempt counters**: per username-canonical, for lockout
  (5 attempts / 5 min). Resets on server restart.
- **Active screenshares**: `activeScreenshares` Map keyed by
  `{mode}:{scopeId}` (`room:{id}` / `direct:{id}`) holding
  `{mode, scopeId, userId, sourceRoomId, sourceRoomName}`; authoritative
  in-memory registry populated from LiveKit webhook events,
  consumed by admin endpoints and `/api/livekit/screenshares`.
- **Session cleanup timer**: periodic 24h interval, cleared on
  SIGTERM/SIGINT before `fastify.close()`.

## 90.3 Server Stores (Filesystem)
- Uploaded files: path configured via `UPLOAD_DIR` env variable (fallback: `UPLOADS_DIR`, then `./uploads`). Docker bind-mount maps host directory to `/data/uploads` in container.
- Storage structure: `{year}/{month}/{attachment_id}_{sanitized_filename}`

## 90.4 Client Stores (Local, per browser)

- **Media device preferences** (localStorage `audio.*` / `video.*`
  keys): `audio.inputDeviceId`, `audio.outputDeviceId`,
  `audio.inputGain`, `audio.outputVolume`, `audio.noiseSuppression`,
  `video.cameraDeviceId`, `video.mirrorSelfView`,
  `video.backgroundBlur`. Read/written via
  `useMediaSettings` (see `src/client/src/hooks/useMediaSettings.ts`).
  Defaults are owned by 70-audio-settings / 75-user-settings — 90 is
  not the normative source for default values.
- **`video.backgroundBlur` dual ownership**: also read/written
  directly from the call store (`src/client/src/stores/call.tsx`)
  because apply-failures trigger a revert of the persisted value
  (CGL-012). Other `audio.*` / `video.*` keys go through
  `useMediaSettings` only.
- **Sidebar UI state**: `sidebar-section-order` (JSON array of section
  ids) and `sidebar-section-collapsed` (JSON object
  `{ chatrooms: bool, users: bool }`). See 60-sidebar §60.2
  persistence-validation rules.
- **Visualizer preferences** (see 95-visualizer): `viz.fpsCap`
  (FPS cap override, default "60"), `viz.cycleEnabled` (auto-cycle
  toggle, default `'false'`), `viz.cycleInterval` (auto-cycle
  interval in ms), `viz.lastPreset` (most recently loaded preset
  name).
- **Message queue during disconnect** (in-memory only — React
  `useRef` array, NOT persisted to disk): capped at 50 messages,
  drops the OLDEST entry on overflow (via `queue.shift()`); flushed
  in order on reconnect.
- **Color theme preference**: `huddle-theme` key in localStorage
  (raw theme id string). On app start, if `huddle-theme` is missing
  AND the legacy key `hangout-theme` is present, the value is
  migrated once (commit `d8bde90`); see 75-user-settings §75.7.
- **Chat font size**: `huddle-chat-font-size` key in localStorage
  (raw integer in pixels; clamped to 12–24). See 30-chat §30.20.

Note: Unread state is server-side (ReadPosition model), not
client-side. It survives page reload.

**Not persisted**: the login screen does NOT pre-fill a "last known
username" from localStorage — the username field always starts empty
on `LoginPage`. Earlier spec revisions listed this as a feature; it
was never implemented and was removed from the spec on 2026-04-24.
