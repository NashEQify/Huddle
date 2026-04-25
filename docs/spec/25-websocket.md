intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Real-time communication protocol between client and server
  action: Defines the WebSocket connection lifecycle, heartbeat, reconnection, event format, full event catalog (presence, chat, typing, call, screenshare, room, unread, notification, user events), presence mechanism, and resilience patterns

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.3.0 |
| **Konsumiert** | overview, 10-domain, 30-chat, 40-voice, 45-video, 50-screenshare, 80-admin |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2): §25.5 Screenshare Events now documents `screenshare.takeover` event with its unique single-recipient `sendToUser` audience (F-CSD-2504); matching audience row added to §25.5a matrix. `mode` enum note updated — `'global'` variant removed in commit 5c2889a, spec now reflects closed `'room' | 'direct'` set (F-CSD-2502). §25.5 Room Events `room.deleted` description corrected from "Two Emission Paths" to the actual single-endpoint reality — `DELETE /api/rooms/:roomId` permits admin OR creator, no separate admin-only path (F-CSD-2506). §25.7 Missed Message Recovery rewritten — user decision: `GET /api/messages/since` is out of scope for v1; spec now documents actual client behavior (reload-on-navigate) and marks gap-recovery endpoint as post-v1 (F-CSD-2507). F-CSD-2503 (4004 reconnect gate) resolved in commit f1ff3af. F-CSD-2505 (client `screenshare.takeover` listener) resolved in commit 0968715. History: 2026-04-11 — T-004 Batch 1 retroactive sync. |
| **Earlier Updates** | 2026-04-10 — `call.speaking` per-user wire format with server-injected userId, scope-aware broadcast rules (room vs DM), membership-filtered room broadcasts, queue drop-oldest clarification |

## Was diese Spec beschreibt

This spec defines the WebSocket protocol that powers all real-time features: presence, chat delivery, typing indicators, call signaling, screenshare coordination, room events, and unread tracking. It specifies connection lifecycle, authentication (cookie-based), heartbeat, reconnection with backoff, the JSON event envelope, the complete event catalog, and resilience patterns (optimistic send, deduplication, missed message recovery, API fetch resilience).

---

# 25. WebSocket Protocol (Normative)

## 25.1 Connection

### Endpoint
- `wss://{app_host}/ws`
- Same origin as the web app (through cloudflared tunnel)

### Authentication
- WS upgrade request carries the session cookie (Secure, HttpOnly)
- Server validates session on upgrade; rejects with 401 if invalid
- No separate WS auth token -- cookie-based only

### Lifecycle
1. Client opens WS after successful login or auto-login
2. Server sends `presence.sync` (full state snapshot) **and** `unread.init`
   (list of scope keys with unread messages — see §25.5 Unread Events) to
   the newly-connected client.
3. Server broadcasts `presence.online` to all other connected clients.
4. Bidirectional event flow until disconnect
5. Client closes WS on logout

### Single Connection per User (Normative)

The server maintains at most one WebSocket per `userId`. When a user opens
a second WS (duplicate browser tab, reconnect while an older stale socket
is still registered, React StrictMode double-mount, etc.), the server:

1. Closes the previously-registered socket for that user with close code
   **4000** (`Replaced by new connection`).
2. Registers the new socket in its place.

Client-side `ws.tsx` treats close code 4000 as a terminal close and does
**not** attempt to reconnect (the newer connection already holds the slot).

This keeps presence, typing state, unread broadcasts, and DM targeting
consistent: every piece of server-side per-user logic assumes a single
live socket.

### 25.1.1 Close Codes (Normative)

| Code | Reason | Emitted by | Client reaction |
|---|---|---|---|
| `1000` | Normal closure | Client (logout, unmount) | — (intentional) |
| `4000` | `Replaced by new connection` | Server (`addConnection`) | Do NOT reconnect; a newer connection already owns the slot |
| `4001` | `Unauthorized` | Server (`wsPlugin` auth check) | Do NOT reconnect; redirect to login |
| `4002` | `Pong timeout` | Server (heartbeat watchdog) | Reconnect with backoff |
| `4003` | `Internal error` | Server (`ws.on('error')` fallback) | Reconnect with backoff |
| `4004` | `Account deactivated` | Server (`removeAllConnectionsForUser`, admin deactivation) | Do NOT reconnect; account is disabled (see 80-admin) |

Clients MUST gate their reconnect logic on the close code: codes 4000,
4001, and (by app-policy) 4004 are terminal; all other unexpected closes
(including 4002, 4003, 1006 transport-level failures) trigger the
exponential backoff loop in §25.3.

<!-- DIM-Map §25.1 Connection + §25.1.1 Close Codes
  Completeness:        ✓ (unread.init in lifecycle, single-connection-per-user section, full close code taxonomy 1000/4000/4001/4002/4003/4004)
  Konsistenz:          ✓ (cross-ref §25.3 for reconnect reaction, §25.6 for presence map, 80-admin for 4004)
  Implementierbarkeit: ✓ (addConnection replacement semantics with exact close code, client reconnect gate condition list)
  Interface-Vertraege: ✓ (close-code-to-client-reaction contract table, 4000/4001/4004 terminal vs 4002/4003/1006 retried)
  Abhaengigkeiten:     ✓ (src/server/src/ws/handler.ts addConnection + removeAllConnectionsForUser, src/client/src/stores/ws.tsx onclose gate)
-->

## 25.2 Heartbeat

- Server sends `ping` frame every 30 seconds
- Client responds with `pong` (handled by browser WS implementation)
- Server closes connection if no pong received within 10 seconds
- Maximum time to detect dead client: ~40 seconds

## 25.3 Reconnection (Client)

On unexpected disconnect:
- Client attempts reconnect with exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
- On successful reconnect: server sends fresh `presence.sync` + `unread.init`
- Client reloads missed messages via REST (see 25.7)
- Reconnect resets backoff counter

**Terminal close codes (Normative):** The client MUST NOT attempt to
reconnect on close codes `4000` (replaced by new connection — §25.1
Single Connection per User), `4001` (unauthorized — redirect to login),
or `4004` (account deactivated). See §25.1.1 Close Codes for the full
taxonomy. All other unexpected closes, including transport-level code
`1006` and the server-emitted `4002` (pong timeout) and `4003` (internal
error), feed into the exponential backoff loop.

UI during disconnect:

**Reconnection Banner:**
- Position: top of main content area, full-width, below the app header.
- Style: `var(--warning)` border-bottom (1px), `var(--bg-elevated)` background, `var(--font-mono)`, `var(--text-sm)`.
- Text while disconnected: `[ CONNECTION LOST ] reconnecting...`
- Text on successful reconnect: `[ CONNECTED ]` in `var(--accent)`, auto-dismiss after 2 seconds.
- The banner appears when the WS `close` event fires and disappears 2 seconds after successful reconnect.
- Chat remains readable during disconnect (existing behavior).
- Messages are queued locally (see 25.7).

## 25.4 Event Format

All WS messages use JSON with this envelope:

```
{ "type": string, "payload": object }
```

Server-to-client events and client-to-server events use the same format.

## 25.5 Event Catalog

### Presence Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `presence.sync` | S->C | `{ users: [{ userId, isActive, lastSeenAt }] }` | Full presence snapshot, sent on connect/reconnect |
| `presence.online` | S->C | `{ userId }` | User came online |
| `presence.offline` | S->C | `{ userId, lastSeenAt }` | User went offline |

### Chat Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `message.new` | S->C | flat `MessageResponse` (see below) | New message in room or DM. Room: `broadcastToUsers(joined members)`. DM: `sendToUser` per participant. |
| `message.reaction` | S->C | `{ messageId, scopeType, scopeId, emoji, userId, action: 'add'\|'remove', reactions: [{ emoji, count, userIds }] }` | Reaction added/removed |
| `message.deleted` | S->C | `{ messageId, scopeType, scopeId }` | Message soft-deleted (tombstone) |
| `message.edited` | S->C | `{ messageId, scopeType, scopeId, content, editedAt, editedBy }` | Message content updated |

`scopeType`: `'room'` or `'direct'`
`scopeId`: `room_id` or `direct_id`

**`message.new` Payload Shape (Normative):** The payload is a **flat**
`MessageResponse` object, NOT wrapped in a `{ scopeType, scopeId, message }`
envelope. The shape matches the response of `POST /api/messages` exactly:

```ts
{
  id: string;
  scopeType: 'room' | 'direct';
  scopeId: string;
  authorId: string;
  content: string;       // may start with `::system::` for system messages
  createdAt: string;     // ISO 8601
  author: {
    id: string;
    username: string;
    profile: {
      title: string;
      avatarKind: 'built_in' | 'uploaded';
      builtInAvatarId: string | null;
      builtInAvatarUrl: string | null;
      portraitUrl: string | null;
    } | null;
  };
  attachments?: Array<{ id, kind, mimeType, fileName, fileSize, url, ... }>;
  replyTo?: { id, authorId, author, content | null, deletedAt? };
}
```

System messages use the same flat shape; see "System Messages in Rooms"
below for the `::system::` content convention. Canonical TypeScript
interface: `MessageNewPayload` in `src/shared/src/ws-events.ts`.

**`message.new` Delivery Scoping (Normative):**

- **Room scope**: fanned out via `broadcastToUsers(memberIds, payload)`
  where `memberIds` are the userIds with
  `GroupMembership.state === 'joined'` on the room. Non-members and
  `left` members do **not** receive the push — they read history on
  their next visit via REST. This enforces Invariant E at the transport
  layer (see CGL-002 note below).
- **DM scope**: delivered via two explicit `sendToUser(participantAId, …)`
  and `sendToUser(participantBId, …)` calls so only the two DM
  participants receive the push. No third party sees DM message traffic
  over the wire.

Same scoping applies to `message.edited`, `message.deleted`, and
`message.reaction` — see §25.5a Broadcast Scope Audience Rules for the
full matrix.

**System Messages in Rooms (Normative):**

When a user joins, leaves, or re-joins a room, the server additionally
persists a special `Message` record with `content` prefixed by
`::system::<action>` (`::system::joined`, `::system::left`,
`::system::rejoined`) and broadcasts it as a normal `message.new` event
to the room's joined members. These system messages are part of the
room's chat history and render as in-line "user joined/left" notices.
The content format is reserved — clients MUST NOT send user-authored
messages starting with `::system::` (see 30-chat.md).

This means **two WS events** are emitted per membership change: one
`room.membership` (for sidebar state) and one `message.new` (for chat
history). The creator path in `POST /api/rooms` creates the initial
`::system::joined` record in the creation transaction but does not
re-broadcast it — the creator sees it on first room open via REST.

**Room Message Broadcast Filtering (Normative, CGL-002):** For room-scoped
message events (`message.new`, `message.deleted`, `message.edited`,
`message.reaction`), the server MUST filter the broadcast audience to
users with `GroupMembership.state === 'joined'` on the room. Non-members
and `left` members MUST NOT receive room message broadcasts in real-time
— they pull history on their next visit via REST.

This enforces Invariant E ("Membership states bestimmen Zugriff auf alles")
at the WebSocket transport layer rather than relying on client-side
filtering. Prior to the CGL-002 fix, room message broadcasts were global
— meaning any authenticated user received every room message over the
wire, and only the client's scope filter hid non-member messages. That
was a real info-leak over the wire, not just a UX concern.

Implementation helper: `broadcastToUsers(userIds, message)` in
`ws/handler.ts` — iterates an externally-provided userId list and looks
up each connection individually. Contrast with `broadcast(message)` which
iterates the full connection map.

<!-- DIM-Map §25.5 Chat Events (message.new flat payload + scoped delivery + system messages)
  Completeness:        ✓ (flat MessageResponse shape fully inlined, room vs DM delivery paths, system message convention, 2-event-per-membership-change rule)
  Konsistenz:          ✓ (references 30-chat.md for `::system::` reserved prefix, shared MessageNewPayload interface, CGL-002 membership filter)
  Implementierbarkeit: ✓ (broadcastToUsers vs sendToUser named, creator-path no-re-broadcast edge case documented)
  Interface-Vertraege: ✓ (MessageResponse flat shape is the canonical wire format, attachments + replyTo optional fields listed)
  Abhaengigkeiten:     ✓ (src/shared/src/ws-events.ts MessageNewPayload, src/server/src/routes/messages.ts + membership.ts emitters)
-->

### Typing Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `typing.start` | C->S | `{ scopeType, scopeId }` | Local user started typing |
| `typing.stop` | C->S | `{ scopeType, scopeId }` | Local user stopped typing |
| `typing.update` | S->C | `{ scopeType, scopeId, typingUserIds: string[] }` | Current typers for a scope |

Full typing behavior defined in `30-chat.md` Section 30.6. The protocol-level
invariants that affect WS traffic:

**Server-Side 5-Second Timeout (Normative):** On each `typing.start`, the
server sets or resets a per-(scope, user) timeout of **5000 ms**
(`TYPING_TIMEOUT_MS` in `src/server/src/ws/typing.ts`). If neither a
follow-up `typing.start` (which resets the timer) nor an explicit
`typing.stop` arrives within the window, the server removes the user
from the scope's typer set and broadcasts an updated `typing.update`.
Clients can therefore rely on stale typers self-expiring even if the
client crashes before sending `typing.stop`.

**Auto-Clear on Disconnect (Normative):** When a WS disconnects, the
server iterates every scope the user was typing in, clears the
per-(scope, user) timeout, removes the user from the typer set, and
broadcasts a `typing.update` per affected scope — to the same audience
that would have received a normal update (membership-filtered room
audience, DM participants pair). This is implemented by
`clearTypingForUser(userId)` called from the `ws.on('close')` handler.

<!-- DIM-Map §25.5 Typing Events
  Completeness:        ✓ (5s server-side timeout + disconnect auto-clear documented, cross-ref 30-chat for full UX)
  Konsistenz:          ✓ (typing membership validation cross-ref, audience matrix in §25.5a)
  Implementierbarkeit: ✓ (TYPING_TIMEOUT_MS constant named, clearTypingForUser entry point named)
  Interface-Vertraege: ✓ (typing.update audience rules)
  Abhaengigkeiten:     ✓ (src/server/src/ws/typing.ts, 30-chat.md §30.6)
-->

### Call Events

All call events use unified scope: `{ scope: { type: 'room' | 'direct', id: string } }`

| Event | Direction | Payload | Description |
|---|---|---|---|
| `call.started` | S->C | `{ scope, startedBy }` | Call session began. Emitted from LiveKit `room_started` webhook. |
| `call.ended` | S->C | `{ scope }` | Call session ended (all left or force-ended). Emitted from LiveKit `room_finished` webhook. |
| `call.joined` | S->C | `{ scope, userId }` | Participant joined call. Emitted from LiveKit `participant_joined` webhook. |
| `call.left` | S->C | `{ scope, userId }` | Participant left call. Emitted from LiveKit `participant_left` webhook. |
| `call.participants` | S->C | `{ scope, participants: [{ userId, isMuted, isSpeaking, hasCamera }] }` | Full participant state snapshot, rebroadcast after every `participant_joined` / `participant_left` webhook. |
| `call.camera` | S->C | `{ scope, userId, hasCamera }` | Camera track published/unpublished. Emitted from LiveKit `track_published` / `track_unpublished` webhooks for `source === CAMERA`. |
| `call.speaking` | C->S | `{ scope, isSpeaking: boolean }` | Local client announces its OWN speaking state (only on transitions). See Server-Injected userId below. |
| `call.speaking` | S->C | `{ scope, userId, isSpeaking: boolean }` | Per-user speaking state relay. `userId` is **server-injected** from the authenticated session. |
| `call.force_end` | C->S | `{ scope: { type, id } }` | Admin force-ends a call. Server verifies `isAdmin` **and** scope membership, then deletes the LiveKit room (cascade `call.ended` via webhook). Non-admin attempts **and** out-of-scope admin attempts are silently dropped. See 80-admin.md 80.6. |

**`call.muted` is NOT a live event (Normative):** An earlier revision of
this catalog listed a `call.muted` event. It is **dead code** — the
server never emits it and no client listens for it. Clients derive mute
state from two sources instead:

1. Local LiveKit `TrackMuted` / `TrackUnmuted` events for participants in
   the same LiveKit Room (direct, not going through the app WS layer).
2. Server-rebroadcast `call.participants` snapshots, which carry the
   current `isMuted` flag for each participant and fire on every
   `participant_joined` / `participant_left` webhook.

The `CallMutedPayload` interface in `src/shared/src/ws-events.ts` is
dead code and is flagged for removal — reimplementers should **not**
wire it up.

**`call.force_end` Authorization (Normative):** The force-end handler
(`handleCallForceEnd` in `src/server/src/routes/livekit.ts`) verifies
ALL of:

1. The sender's session has `isAdmin === true`.
2. For `scope.type === 'room'`: the admin has a `joined` membership in
   the target room.
3. For `scope.type === 'direct'`: the admin is one of the two participants
   of the target DirectConversation.

Any of these checks failing results in a **silent drop** — no error is
returned to the sender, no event is emitted. Force-end is implemented by
`roomService.deleteRoom(livekitRoomName)`, which triggers a
`room_finished` webhook and the usual `call.ended` broadcast downstream.

**Server-Injected userId (Normative):** The server MUST overwrite any
client-provided `userId` with the authenticated session's userId before
broadcasting `call.speaking`. This prevents spoofing where a malicious
client could mark other users as speaking (or suppress their speaking
indicator) by forging the `userId` field. Legacy clients may still send
a full `{ speakingUserIds: string[] }` array — in that case the server
derives `isSpeaking` from whether the array is non-empty and stamps
`userId` with the session's own id.

**Per-User Update Semantic (Normative):** `call.speaking` is a per-user
transition announcement, NOT a full-set snapshot. Each broadcast
announces ONE user's state change (started or stopped speaking).
Receiving clients MUST update the target user's entry in their local
`speakingMap` **without decaying other users' states** — an earlier
version of the spec used full-set replace which would implicitly stop
other speakers on every broadcast. Decay-to-false uses the existing
500ms hysteresis timer, applied per-user.

**Client Send Discipline (Normative):** The client sends `call.speaking`
ONLY on transitions of the LOCAL participant's speaking state — not on
every LiveKit `ActiveSpeakersChanged` event. Transition detection uses
a `lastLocalSpeakingRef` comparison: send only when the new local state
differs from the last broadcast. This minimizes WS traffic.

**Broadcast Scope Rules (Normative, CGL-002 expansion):** The server
broadcasts `call.speaking` (and all scope-sensitive events) according
to the scope audience rules below.

**`call.speaking` Scope Membership (Informative):** The server does
**not** verify that the sender is actually a LiveKit participant of
the referenced scope before relaying. This is an intentional trust-
based simplification: the group is small, Cloudflare Access is the
outer gate, and the worst-case spoof (a connected user flipping
speaking indicators in a scope they are not participating in) is
low-impact. The server does however enforce the server-injected
`userId` (see above) so a client cannot forge *other* users' speaking
state. Clients currently in the same LiveKit call for the referenced
scope ignore incoming `call.speaking` relays because they already
have first-hand `ActiveSpeakersChanged` data from LiveKit; only
clients *outside* the call consume the relay (e.g. to render a
speaking dot on sidebar tiles).

**Typing Membership Validation (Normative):** Before processing
`typing.start` / `typing.stop`, the server MUST verify the sender has
access to the scope:
- Room scope: sender must have a `joined` membership in the room.
- Direct scope: sender must be a participant of the DirectConversation.
Events for unauthorized scopes are silently dropped.

<!-- DIM-Map §25.5 Call Events
  Completeness:        ✓ (webhook sources named for every event, call.muted dead row removed, call.force_end non-member admin drop, call.speaking scope membership policy documented)
  Konsistenz:          ✓ (cross-ref 40-voice §40.5 for wire format, 80-admin §80.6 for force_end, CGL-001 spec/code consistency for server-injected userId)
  Implementierbarkeit: ✓ (isAdmin + scope membership gate enumerated, silent drop policy stated)
  Interface-Vertraege: ✓ (CallMutedPayload flagged dead, CallSpeakingPayload per-user wire format, CallForceEndPayload scope shape)
  Abhaengigkeiten:     ✓ (handleCallForceEnd + webhook event names, LiveKit Track.Source enum for camera/screenshare)
-->

### Screenshare Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `screenshare.started` | S->C | `{ mode, scopeId, userId, sourceRoomId?, sourceRoomName? }` | Screenshare began. Emitted from LiveKit `track_published` webhook for `source === SCREEN_SHARE`. |
| `screenshare.ended` | S->C | `{ mode, scopeId, userId }` | Screenshare ended. Multiple emission paths — see below. |

`mode`: `'room'` or `'direct'`

**Conditional Source-Room Fields (Normative):** `sourceRoomId` and
`sourceRoomName` are populated **only when `mode === 'room'`** — the
server looks up the source room name from the `Room` record in the DB.
For DM screenshares (`mode === 'direct'`) both fields are omitted so
remote viewers render the share without a room label.

**`screenshare.ended` — Three Emission Paths (Informative):** The
server-side in-memory state in `activeScreenshares: Map<key, entry>`
(keyed by `${mode}:${scopeId}`) is cleared — and `screenshare.ended`
emitted — on the first of whichever LiveKit webhook fires:

1. **`track_unpublished`** for the `SCREEN_SHARE` track — the sharer
   stopped the share explicitly (`Stop sharing` button or browser
   stop-share control).
2. **`participant_left`** when the sharing participant leaves the
   screenshare LiveKit room — e.g. the sharer closed the tab or
   navigated away.
3. **`room_finished`** when the screenshare LiveKit room is destroyed
   entirely — e.g. all participants left or the room empty-timeout
   elapsed.

Whichever path fires first wins; subsequent paths see no entry in
`activeScreenshares` and are no-ops.

**`mode` enum:** `mode` is a closed set of `'room' | 'direct'`. An
earlier revision of `src/shared/src/ws-events.ts` carried a `'global'`
variant for backward-compat; it was removed in commit `5c2889a`
(2026-04-24) after confirming no emit path produced it.

### `screenshare.takeover` (S→C, targeted)

Payload: `{ mode: 'room' | 'direct', scopeId: string, takenOverBy: string }`.

When a second user starts screensharing for the same `(mode, scopeId)`
slot that is already occupied, the server sends `screenshare.takeover`
**only to the prior publisher** via `sendToUser`, BEFORE broadcasting
the new `screenshare.started` for the new publisher. Emit site:
`src/server/src/routes/livekit.ts:521-531` (inside the `track_published`
handler when `activeScreenshares.get(key)` has a different `userId` than
the new publisher).

The prior publisher's client listens for this event
(`src/client/src/stores/screenshare.tsx`, CGL-007 handler) and, if the
`(mode, scopeId)` matches its active local share, invokes the local
cleanup function — unpublishing and disconnecting its own screenshare
LiveKit room. This guarantees the prior publisher's local state
reconciles with the authoritative server-side takeover BEFORE the
`screenshare.started` broadcast arrives.

Audience is **uniquely single-recipient** among screenshare events; see
§25.5a.

<!-- DIM-Map §25.5 Screenshare Events
  Completeness:        ✓ (sourceRoomId/sourceRoomName conditional, 3-path end emission, takeover event documented, 'global' removed)
  Konsistenz:          ✓ (cross-ref 50-screenshare.md for UX, `activeScreenshares` map as server-side state)
  Implementierbarkeit: ✓ (webhook fire order documented with first-wins cleanup)
  Interface-Vertraege: ✓ (sourceRoomId/sourceRoomName marked omitted for DM mode)
  Abhaengigkeiten:     ✓ (src/server/src/routes/livekit.ts activeScreenshares, LiveKit track.source enum)
-->

### 25.5a Broadcast Scope Audience Rules (Normative)

Not all events should reach every connected user. The server resolves the
audience per-event based on scope:

| Event class | Room scope audience | DM scope audience |
|---|---|---|
| `message.*` (new/edited/deleted/reaction) | `joined` members only | 2 DM participants |
| `call.started/.ended/.joined/.left/.participants/.camera/.speaking` | all connected users (global) | 2 DM participants |
| `screenshare.started/.ended` | all connected users (global) | 2 DM participants |
| `screenshare.takeover` | targeted — prior publisher only (single-recipient `sendToUser`) | targeted — prior publisher only |
| `typing.update` | `joined` members only | 2 DM participants |
| `room.created/.deleted/.updated/.membership` | all connected users (global) | n/a |
| `user.updated`, `presence.*` | all connected users (global) | n/a |

**Rationale — room scope is global for calls/screenshare/rooms**: Rooms
are visible in every user's sidebar per Invariant A, regardless of
membership. Room call/screenshare activity is a **social cue** — showing
"something is happening in room X" to non-members lets them decide whether
to join. The cost of leaking "activity in room X" is negligible in a
trust-based group.

**Rationale — DM scope is always targeted**: A direct conversation is
private between exactly two users. User C has no business knowing that
user A and user B are on a call, screensharing, typing, or exchanging
messages. DM events MUST be sent only to the 2 participants via
`broadcastToUsers([participantA, participantB], message)`.

**Rationale — room messages are membership-filtered**: Room message
content is the private body of the conversation. Non-members (never-
joined) and `left` members have no real-time access to messages; they
can read history on their next visit if they were or become members.
See 25.5 §Chat Events above.

**Rationale — room typing is membership-filtered**: Typing indicators
only matter to users who can actually see the message being typed. A
non-member of room X has no business knowing who's typing in room X.

**Helper functions (informative)**:

- `broadcast(message, excludeUserId?)` — global fan-out. Use for
  events that are audience-global (room.created, user.updated,
  presence.*, etc.) or the room branches of call/screenshare events.
- `broadcastToUsers(userIds, message, excludeUserId?)` — targeted
  fan-out over an externally-provided userId list. Use for
  membership-filtered room messages and DM-scoped events.
- `broadcastToCallScope(scope, message, excludeUserId?)` and
  `broadcastToScreenshareScope(ssInfo, message, excludeUserId?)` —
  convenience helpers in `src/server/src/lib/scope-broadcast.ts` that
  encode the room-vs-DM branching once.

### Room Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `room.created` | S->C | `{ id, name, discoverable, hasPassword, lastActivityAt, createdBy }` | New room created. Flat record, **not** wrapped in `{ room }`. |
| `room.membership` | S->C | `{ roomId, userId, state: 'joined' \| 'left' \| 'not_joined', username }` | Membership state changed. Carries `username` so receivers can render "user joined/left" without a lookup. |
| `room.deleted` | S->C | `{ roomId }` | Room hard-deleted (cascade). Broadcast to all. Two emission paths — see below. |
| `room.updated` | S->C | `{ roomId, roomName? }` OR `{ roomId, hasPassword? }` | Sparse partial update — see below. |

**`room.created` Payload Shape (Normative):** The payload is a **flat**
record, **not** a `{ room: {...} }` wrapper. Fields:

```ts
{
  id: string;
  name: string;
  discoverable: boolean;
  hasPassword: boolean;
  lastActivityAt: string;   // ISO 8601
  createdBy: string;        // userId of creator
}
```

**`room.membership` + Accompanying System Message (Normative):** Each
membership state change emits **two** WS events in order:

1. `room.membership` — sidebar-level state update, carries
   `{ roomId, userId, state, username }`.
2. `message.new` — system message persisted in the room's chat history
   with `content` = `::system::joined` / `::system::left` /
   `::system::rejoined`. See "System Messages in Rooms" under Chat
   Events above.

Reimplementers MUST wire both handlers, or the chat view will miss
inline join/leave notices even though the sidebar updates correctly.

**`room.updated` is Sparse (Normative):** A single `room.updated` event
carries **exactly one** of `roomName` (from admin rename endpoint
`PATCH /api/admin/rooms/:roomId`) or `hasPassword` (from password
set/clear endpoint `PUT /api/rooms/:roomId/password`), **not both**.
Clients apply a partial update and preserve any unchanged fields. There
is no code path that emits both fields in a single `room.updated` event.

**`room.deleted` emission (Informative):** Room deletion flows through
the single endpoint `DELETE /api/rooms/:roomId`, which permits admin OR
room creator. The admin console reuses this endpoint — there is no
separate `DELETE /api/admin/rooms/:roomId` path. The endpoint emits a
flat `{ roomId }` payload via global `broadcast`. See also the
idempotent P2025-handled path (CGL-013 / F-CA-R2) which still broadcasts
`room.deleted` so the sidebar stays consistent across clients.

<!-- DIM-Map §25.5 Room Events
  Completeness:        ✓ (room.created flat shape, room.membership + username + accompanying system message.new, room.updated sparse partial, room.deleted single endpoint)
  Konsistenz:          ✓ (cross-ref Chat Events System Messages subsection, matches src/shared/src/ws-events.ts RoomMembershipPayload)
  Implementierbarkeit: ✓ (both membership-change events enumerated, sparse-update rule stated, creator-path no-re-broadcast edge case flagged)
  Interface-Vertraege: ✓ (full room.created field list with types, room.updated XOR shape)
  Abhaengigkeiten:     ✓ (src/server/src/routes/rooms.ts + admin.ts + membership.ts emitters)
-->

### Unread Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `unread.init` | S->C | `{ unreadScopes: string[] }` | Scopes with unread messages, sent on connect |
| `mark_read` | C->S | `{ scopeType, scopeId }` | Client marks a scope as read |

`unread.init` is computed server-side by comparing each scope's latest
non-self-authored message timestamp against the user's `ReadPosition.lastReadAt`.
`mark_read` upserts the ReadPosition with `lastReadAt = now()`.

**Scope key formats in `unreadScopes`:**
- Room scopes: `room:{roomId}` (e.g., `room:clx1abc23`)
- DM scopes: `dm-user:{otherUserId}` (e.g., `dm-user:clx9xyz42`) -- keyed by the other participant's user ID, NOT by `direct:{directId}`. This allows the client to show unread indicators for DM users before knowing the DirectConversation ID.

### DM Call Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `dm.call.incoming` | S->C | `{ directId, callerId }` | DM call started by the other participant — ring notification for the callee. Suppressed if the other party is already in the call (see below). |
| `dm.call.decline` | C->S | `{ directId, callerId }` | Callee declines an incoming DM call. Server validates the sender is a participant of the DirectConversation. |
| `dm.call.declined` | S->C | `{ directId, declinedBy }` | Sent to the caller after their DM call was declined. Informational — call teardown on the caller side is driven by the subsequent `call.ended` from the `room_finished` webhook. |

**`dm.call.decline` Server Handling (Normative):** The handler
`handleDmCallDecline(userId, payload)` in
`src/server/src/routes/livekit.ts`:

1. Verifies the sender is `participantAId` or `participantBId` of the
   `DirectConversation`. Silent drop on mismatch.
2. Emits `dm.call.declined` to `callerId` via `sendToUser` with payload
   `{ directId, declinedBy: userId }`.
3. Calls `roomService.deleteRoom('call:dm:{directId}')` so the caller
   is ejected from the LiveKit room via the subsequent `room_finished`
   webhook, which broadcasts `call.ended` as normal.

**`dm.call.incoming` Single-Ring Suppression (Normative):** The
`participant_joined` webhook handler for DM calls checks, before
sending `dm.call.incoming` to the other DirectConversation participant,
whether that participant is already present in the LiveKit room's
participant list:

```ts
const isOtherInCall = participants.some((p) => p.userId === otherId);
if (!isOtherInCall) {
  sendToUser(otherId, { type: 'dm.call.incoming', payload: { directId, callerId } });
}
```

This ensures the ring notification fires exactly once per DM call
session — only the first joiner triggers the ring; subsequent re-joins,
reconnects, or the second party's own `participant_joined` webhook do
not re-ring.

**Client-Side Single-Active-Call Suppression (Normative):** When a
client receives `dm.call.incoming` while already in an active call
(`activeScope !== null`), the client silently drops the notification
without showing the ring UI. This enforces Invariant H (Single Active
Call per User) — the user is never prompted to join a second call
while in the first. See `src/client/src/stores/call.tsx` and 40-voice
§40.6 for the UI behavior.

<!-- DIM-Map §25.5 DM Call Events
  Completeness:        ✓ (incoming + decline + declined all cataloged, server-side single-ring suppression, client-side single-active-call suppression)
  Konsistenz:          ✓ (dm.call.decline payload matches 40-voice §40.8 corrected form {directId, callerId}, cross-ref Invariant H)
  Implementierbarkeit: ✓ (handleDmCallDecline flow enumerated 1-3, isOtherInCall guard code shown)
  Interface-Vertraege: ✓ (DmCallDeclinePayload + DmCallDeclinedPayload from src/shared/src/ws-events.ts)
  Abhaengigkeiten:     ✓ (LiveKit roomService.deleteRoom, room_finished → call.ended cascade, activeScope from CallProvider)
-->

### User Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `user.updated` | S->C | `{ userId, profile: { title, avatarKind, builtInAvatarUrl, portraitUrl } }` | User changed profile/portrait. Broadcast to all. |

**`user.updated` Emission Sources (Informative):** Emitted from two
endpoints with identical payload shape:

1. `PATCH /api/settings/profile` — title / avatar kind / built-in
   avatar changes.
2. `POST /api/settings/portrait` — portrait image upload.

Receivers need not distinguish the source; both update the same
profile fields client-side.

## 25.6 Presence Mechanism

Presence is derived from WebSocket connection state:

- **Online**: User has an active, authenticated WS connection
- **Offline**: WS connection closed (graceful or after ping timeout)

Server maintains an in-memory connection registry:

```ts
// src/server/src/ws/handler.ts
const connections = new Map<string, WsConnection>();
```

The map value is the live `WsConnection` reference — there is **no**
separate `connectedAt` timestamp stored on the entry. A connection's
liveness is derived from `ws.readyState === ws.OPEN`. `lastSeenAt` is
persisted in the DB `User.lastSeenAt` column and updated only in the
disconnect handler. Presence online/offline status is computed by
`getOnlineUserIds()` / `isUserOnline(userId)` reading the Map keys.

Per §25.1 Single Connection per User, the registry is single-slot per
`userId` — a second connection replaces the first and closes it with
code 4000.

On WS connect:
- `addConnection(userId, ws)` — closes any prior connection for the
  same user with code 4000 first.
- Send `presence.sync` and `unread.init` to the new connection.
- Broadcast `presence.online` to all other connected clients.

On WS disconnect:
- `removeConnection(userId, ws)` — only removes if the stored reference
  matches (avoids race with a replacement handshake).
- Update `lastSeenAt = now()` in the DB.
- Broadcast `presence.offline` to all remaining clients.
- Clear all typing state for this user and broadcast a `typing.update`
  for each scope the user was typing in (see §25.5 Typing Events above
  and `30-chat.md` §30.6).

### Admin Deactivation Cascade (Normative)

When an admin deactivates a user via
`PATCH /api/admin/users/:userId/deactivate` (see 80-admin §80.4), the
server executes — in addition to revoking the user's sessions — the
following WS-layer cleanup:

1. `removeAllConnectionsForUser(userId)` — closes the user's live WS
   (if any) with close code **4004** (`Account deactivated`) and
   removes it from the connection map immediately.
2. A synthetic `broadcast({ type: 'presence.offline', payload: { userId, lastSeenAt: now } })`
   fires to propagate the state change to all remaining clients
   immediately (not waiting for the natural `ws.on('close')` handler).

The natural disconnect handler also fires as the socket is closed and
updates `lastSeenAt` in the DB; the double `presence.offline` broadcast
is benign because clients treat the second event as a no-op for
already-offline users. Cross-ref: 80-admin §80.4 Deactivation.

<!-- DIM-Map §25.6 Presence Mechanism
  Completeness:        ✓ (corrected map shape, single-slot registry semantics, admin deactivation cascade with 4004 + presence.offline)
  Konsistenz:          ✓ (cross-ref §25.1 Single Connection per User, §25.1.1 Close Codes 4004, 80-admin §80.4)
  Implementierbarkeit: ✓ (removeAllConnectionsForUser named, double-broadcast idempotency called out)
  Interface-Vertraege: ✓ (Map<string, WsConnection> as canonical shape, no {connectedAt} phantom field)
  Abhaengigkeiten:     ✓ (src/server/src/ws/handler.ts connection registry, src/server/src/routes/admin.ts deactivation flow)
-->

### Last Seen Display

The Users section shows `last_seen_at` for offline users as relative time:
- Less than 1 hour: `{N}m ago`
- Less than 24 hours: `{N}h ago`
- Older: date only (e.g., `Mar 15`)

## 25.7 Resilience

### Optimistic Message Sending

When a user sends a message:
1. Message appears immediately in the local chat (optimistic, with pending state
   and a `_tempId` for tracking)
2. Message is sent to server via REST POST
3. On success: replace optimistic message (matched by `_tempId`) with server response
4. On failure: mark message with error indicator + `[ retry ]` button
   - The error indicator is a small `var(--error)` icon or border on the left of the message row.
   - The `[ retry ]` button is inline, below the message content, `var(--text-muted)`, `var(--error)` on hover.
   - Clicking retry re-sends via REST POST. On success, error state clears and message finalizes.

### Optimistic Deduplication (Normative)

When the REST POST succeeds, the server also broadcasts a `message.new` WS event
for the same message. Without deduplication, the message would appear twice:
once from the optimistic insert, once from the WS broadcast.

**Strategy: Author-based skip while pending.**
When the client receives a `message.new` WS event:
- If `msg.author.id === currentUserId` AND there are any pending (optimistic)
  messages in the current view -> skip the WS message entirely. The REST
  response will finalize the optimistic message.
- If the author is someone else -> always insert normally.

This approach replaces an earlier ID-based tracking approach (`pendingIdsRef`)
which was more complex and error-prone. The author-based check is simpler
and handles all edge cases correctly because a user can only have one
pending send at a time in a given scope.

**Important:** The `_pending` flag and `_tempId` are client-only fields,
never sent to the server. They are removed when the REST response replaces
the optimistic message.

### WS Event Dispatch Safety (Normative)

When iterating over the `connections` Map to broadcast events, the server
MUST take a snapshot of the connection entries before iteration:

```ts
const snapshot = [...connections];
for (const [userId, ws] of snapshot) { ... }
```

Without this, a connection that closes during broadcast could mutate
the Map mid-iteration, causing skipped or duplicate deliveries. This
matters specifically on hosts with many concurrent network interfaces
(Docker, Tailscale, WireGuard, etc.) where WS reconnect churn is
elevated and the mutation window is non-zero.

The targeted helper `broadcastToUsers(userIds, message)` does not
iterate the Map at all — it iterates an externally-provided list and
looks up each userId individually via `connections.get(userId)`. This
is inherently safer against concurrent mutations and SHOULD be used for
membership-filtered or scope-targeted broadcasts.

### Message Queue During Disconnect

If WS is disconnected when the user sends a message:
- Message is queued locally (in-memory, not persisted)
- On reconnect: queued messages are sent via REST in order
- Queue is limited to 50 messages. On overflow, the **oldest** entry is
  dropped (`queue.shift()`), NOT the newest. Rationale: for offline-resume
  UX the most recent user actions are more valuable than older ones, and
  the spec wording ("oldest dropped if exceeded") is authoritative. The
  dropped message is logged via `console.warn` so diagnosticians can see
  the drop in DevTools.

### Missed Message Recovery (v1 scope)

**No gap-recovery endpoint in v1.** There is no
`GET /api/messages/since` route. After a WS reconnect the client does
NOT attempt to diff its in-memory message list against the server.

Actual reconnect behavior (v1):
- Client re-establishes the WS connection per §25.3 backoff.
- `unread.init` arrives fresh; the active-scope coalescing rules from
  §20.2 apply.
- When the user navigates to a scope (or refreshes the active scope),
  the normal `GET /api/messages` list endpoint runs and loads the
  latest N messages — so any messages missed during the disconnect
  window surface as soon as the scope is re-entered.
- New messages arriving post-reconnect stream in via `message.new` as
  usual.

**Known limitation.** If the user stays on a single active scope
through a short disconnect, new messages posted by others during the
gap are not backfilled until the user navigates away and back (or
refreshes). This is acceptable for v1's small private-group use-case
(≤15 users, mostly short disconnects, not a high-fanout chat).

**Planned for post-v1.** A dedicated `GET /api/messages/since?scope=...
&after=...` gap-recovery endpoint is on the post-v1 backlog (would
allow per-scope delta fetch on reconnect without a full list reload).
Intentionally out of scope for v1.

### API Fetch Resilience (Normative)

All REST API calls from the client MUST be wrapped in try-catch that handles:
1. **Network errors**: `fetch()` itself can throw (offline, DNS failure,
   connection refused). Catch and return `{ ok: false, error: { code: 'NETWORK_ERROR', message } }`.
2. **Non-JSON responses**: The server may return HTML error pages (e.g., from
   a reverse proxy). `res.json()` will throw on non-JSON. Catch and return
   a graceful error object.
3. **HTTP error status codes**: Check `res.ok` and handle error responses.

Without this resilience pattern, any transient network issue crashes the UI
instead of showing a recoverable error state.

### LiveKit Disconnect Independence

LiveKit and WS are independent connections:
- If only LiveKit disconnects: chat continues, call shows "Reconnecting call..." in controls
- If only WS disconnects: call audio continues, chat/typing/presence paused
- LiveKit has built-in reconnection (ICE restart, server reconnect)

### Call Quality Indicator

LiveKit provides connection quality events (excellent / good / poor).
Display as small icon in call controls:
- Excellent/Good: green dot (or hidden)
- Poor: yellow dot
- Disconnected: red dot with "Reconnecting..."
