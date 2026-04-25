intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Screen sharing system for room calls and DM calls via LiveKit (companion two-room design)
  action: Defines screenshare scope (room + DM), two-room design vs. the call room, start/stop behavior, user gesture timing, concurrency rules (post-click error for cross-scope conflicts, takeover via confirmation + getDisplayMedia-first ordering), UI (inline preview + non-resizable modal window + double-click shortcut), sidebar indicator with broadcast audience, server-side active-screenshare map + startup reconciliation + `GET /api/livekit/screenshares` endpoint, screenshare WS payload (incl. `sourceRoomId`/`sourceRoomName`), viewer Room lifecycle, admin force-end, quality settings (1080p capture via `getDisplayMedia`, publish via `publishTrack` with ScreenSharePresets encoding, no adaptive streaming on viewer)

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 10-domain, 25-websocket, 40-voice |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 6 findings + 3 CGL resolutions): §50.1 `'global'` dead-enum note cleaned up — F-CSD-094 resolved in commit 5c2889a (F-CSD-5005). §50.2 bracket-label buttons migrated to Lucide icon descriptions — `MonitorUp`/`MonitorX` (share/stop), `PictureInPicture2`/`Maximize` (preview), `Maximize`/`X` (window header); bracket text retained only for `[ YES, TAKE OVER ]` / `[ CANCEL ]` / `[ screenshare: {username} ]` per 05-icons §05.5 (F-CSD-5003). §50.2 Eligibility now documents `getDisplayMedia`-absent device-hide behavior (F-CSD-5004). §50.2 Takeover section updated — F-CSD-088 closed by client listener in 0968715 (F-CSD-5001 resolved); spec now describes the complete server-signal-and-client-cleanup handshake. §50.6 admin cleanup rewritten — single shared `DELETE /api/rooms/:roomId` endpoint now calls `roomService.deleteRoom` for both `call:{id}` and `ss:room:{id}` companion rooms (F-CSD-5002 resolved in f939823, error-severity differentiation via F-CA-R1 commit 926bcd8). §50.8 Failure Modes adds rows for getDisplayMedia-absent (F-CSD-5004) and generic `Screenshare failed:` catch-all (F-CSD-5006); admin-delete row updated to single endpoint. History: 2026-04-14 — Task 009 Batch 2. |

## Was diese Spec beschreibt

This spec defines screen sharing behavior in Huddle. Screenshare is call-coupled (auto-joins the corresponding call) and uses a **dedicated companion LiveKit room** — distinct from the call room. Covered here: two-room design, scope rules (room + DM, no global), user-gesture timing for `getDisplayMedia`, concurrency (one active share per scope; takeover via confirmation + getDisplayMedia-first ordering), cross-scope-call post-click guard, UI (inline preview + non-resizable modal window with double-click shortcut), sidebar indicator + broadcast audience, server-side active-screenshare map + reconciliation + API endpoint, screenshare WS payload schema, viewer Room lifecycle + access control, admin force-end, quality settings (1080p publisher, `adaptiveStream: false` viewer).

---

# 50. Screenshare (LiveKit) (Normative)

Screenshare is call-coupled.
Starting screenshare auto-joins the corresponding call (per overview.md
Invariant E). The single active call constraint applies (overview.md Invariant H).
Leaving a call stops the user's active screenshare (client-side enforced via a
`prevActiveScopeRef` watcher in `ScreenshareProvider` — cleanup runs when
`callState.activeScope` transitions from non-null to null).

## 50.1 Scope

Screenshare is available in both room calls and DM calls. Each uses a
**separate LiveKit room** for the screenshare stream, distinct from the call room.

| Scope              | LiveKit Room Name      |
|-------------------|------------------------|
| Room Screenshare   | `ss:room:{room_id}`    |
| DM Screenshare     | `ss:dm:{direct_id}`    |

See overview.md Invariant I.

There is no global screenshare. The `ScreenshareStartedPayload` /
`ScreenshareEndedPayload` `mode` union is `'room' | 'direct'` only
(F-CSD-094 resolved in commit `5c2889a`, 2026-04-24). The client still
has a defensive filter rejecting unexpected `mode` values as a
runtime-type safety net, but no `'global'` branch exists in the shared
types.

### 50.1a Two-Room Design (Normative)

<!-- DIM-Map §50.1a Two-Room Design
  Completeness:        ✓
  Konsistenz:          ✓ (overview.md Invariant E rewritten in lockstep)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓ (LiveKit Room count per sharer)
-->

A conversation that has an active screenshare runs **two LiveKit rooms
simultaneously**:

- The **call room** (`call:{room_id}` or `call:dm:{direct_id}`) — carries
  audio, optional camera, presence/speaking, and signalling for the call.
- The **screenshare room** (`ss:room:{room_id}` or `ss:dm:{direct_id}`) —
  carries the screen capture track only.

Consequences:

1. **The sharer holds TWO LiveKit `Room` connections** while sharing: one
   for the call, one for the screenshare room. Both are independent LiveKit
   connections bound to the same user identity (different tokens, different
   rooms).
2. **Every viewer opens its OWN LiveKit `Room` connection** to the
   screenshare room — this is not a subscription within the call room.
   See §50.5 Viewer for lifecycle details.
3. **Screenshare-room webhook events are intentionally siloed from
   call-room events.** `scopeFromRoomName` in
   `src/server/src/routes/livekit.ts` returns `null` for
   `ss:room:*`/`ss:dm:*`, so `track_published`/`track_unpublished`/
   `room_started`/`room_finished` on a screenshare room NEVER emit
   `call.started` or `call.ended` WS events. Screenshare lifecycle is
   broadcast exclusively via `screenshare.started`/`screenshare.ended` (see
   §50.2a and 25-websocket.md).

Rationale for the split:
- LiveKit encoder/bandwidth presets for a 1080p ScreenShare source differ
  materially from call audio/camera; running screenshare on a dedicated
  room keeps per-room SFU policy clean.
- Viewers of a screenshare are not necessarily in the call (e.g. someone
  navigating into the room during a share who hasn't clicked the call
  button). A dedicated room lets them subscribe without first joining the
  call room.

Invariant E in `overview.md` is authored around the same two-room reality.
If Invariant E and this section ever disagree, `overview.md` wins (per the
priority rule), but they are kept aligned.

## 50.2 Room Screenshare

<!-- DIM-Map §50.2 Room Screenshare
  Completeness:        ✓
  Konsistenz:          ✓ (cross-scope guard reclassified post-click; CODE-BUG F-CSD-084 ledgered)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (copy + button labels match code)
  Abhaengigkeiten:     ✓
-->

Eligibility:
- joined room: allowed
- left/not_joined: not allowed (requires rejoin/join)
- **Browser capability**: the client's browser MUST implement
  `navigator.mediaDevices.getDisplayMedia`. On devices where the API
  is absent (iOS Safari + all iOS browsers, most Android mobile
  browsers), the `ScreenshareControls` component renders nothing —
  the share icon is simply not shown in the header. No error banner,
  no disabled button. The store has a defensive inline guard
  returning `{ ok: false, error: 'Screen sharing is not supported on
  this device' }` as a dead-path safety net in case the component
  renders despite the global check. (Replaces the earlier
  always-show/fail-on-click UX; commit `b3d7415`.)

Start behavior:
- Clicking the Lucide `MonitorUp` icon button (label "Share screen" —
  see 05-icons.md §05.4) auto-joins room voice/call when needed, then
  starts room screenshare.
- No confirmation prompt (per overview.md Invariant E -- screenshare is immediate).

**Cross-Scope Call Guard (Screenshare) — Post-click:**
If the user is already in a call in a DIFFERENT scope, the share
button is NOT pre-emptively disabled. The click is accepted and
`getDisplayMedia()` fires first (to respect the user-gesture window).
The store then detects the cross-scope conflict and returns
`{ ok: false, error: 'Leave your current call first to screenshare here' }`.
The captured stream is discarded (all tracks stopped) and the error is shown
inline next to the button in `var(--error)` for 3 seconds.

Note: the spec previously prescribed a pre-emptive `disabled` + `title`
tooltip; the code currently uses the post-click inline error instead. This
means users in a cross-scope call still see the browser's display picker
before the error. Whether to switch to a pre-emptive disable is a
UX-correctness decision tracked as a code-gap item (F-CSD-084); until
decided, the post-click inline error is the as-is behaviour.

### User Gesture Timing (Normative)

When the user clicks the screenshare button, the browser's `getDisplayMedia()`
MUST be called immediately within the click handler (synchronous user gesture
context). The screen capture prompt must appear before any async work (joining
the call, fetching tokens, connecting to LiveKit).

Without this, the browser's user gesture window expires during the async
token fetch + `room.connect()` sequence, and `getDisplayMedia()` is blocked
as if it were called without user interaction.

Pattern: capture first, then async join:
1. `getDisplayMedia({ video: { width: 1920, height: 1080, frameRate: 30 }, audio: false })` -- immediate, in click handler
2. If not in call: `joinCall()` -- async
3. Connect to screenshare LiveKit room -- async
4. Publish captured track via `publishTrack(...)` -- async

If `getDisplayMedia()` throws (user cancels the picker, NotAllowed,
NotReadable, any other error), the store returns
`{ ok: false, error: 'Screen capture failed: <err.message>' }`. The UI shows
that concatenated error string in `var(--error)` for 3 seconds. The code
does NOT distinguish "user cancelled" from other failure classes (no
separate muted-coloured cancel message). The previous screenshare (if any
takeover was in progress) is NOT ended, because the takeover's "end old"
step only runs AFTER `getDisplayMedia()` succeeds.

Concurrency:
- Only one active room screenshare per room at a time.
- Enforcement is **not** at the LiveKit publish layer — see §50.2a. The
  server keeps a tracking map; the client-side UX (takeover confirmation)
  is what actually prevents simultaneous shares.
- Takeover requires confirmation. The active modal copy is:

  > A screenshare is active. Starting yours will end the current screenshare. Continue?

  Buttons: `[ YES, TAKE OVER ]` and `[ CANCEL ]`. The confirmation does
  NOT reference a username (the sharer's `ActiveScreenshare` payload
  contains `userId`, and no username lookup is performed at the confirm
  step). Clicking outside the modal closes it (same outside-click handler
  as other confirm modals).

**Takeover sequence:**
1. User confirms takeover.
2. `getDisplayMedia()` is called immediately (user gesture timing — MUST be
   synchronous within the click handler).
3. If user cancels the browser's display picker (or `getDisplayMedia()`
   throws for any other reason): show
   `"Screen capture failed: <err.message>"` in `var(--error)`, fading after
   3s. The previous screenshare is NOT ended.
4. If `getDisplayMedia()` succeeds: the new sharer publishes to the same
   `ss:room:{id}` / `ss:dm:{id}` LiveKit room. The store replaces the
   `activeScreenshare` entry on the `screenshare.started` WS event.
5. The previous screenshare is only superseded AFTER `getDisplayMedia()`
   returns a stream successfully, so cancelling the picker never destroys
   an active share.

**Server-assisted takeover (F-CSD-088 resolved)**: when a new publisher
registers for a `(mode, scopeId)` already occupied, the server sends
`screenshare.takeover` (single-recipient `sendToUser`) to the prior
publisher BEFORE broadcasting the new `screenshare.started` (see
25-websocket §25.5). The prior publisher's client (`screenshare.tsx`
CGL-007 handler, commit `0968715`) receives the event and, if the
`(mode, scopeId)` matches its active local share, invokes its local
`cleanupRef.current()` — unpublishing and disconnecting its own
screenshare LiveKit room. Both sides converge before the next
`screenshare.started` broadcast; the client signal-and-cleanup
handshake is now complete (F-CSD-088 closed).

UI:
- When active, show a preview at top of chat (`ScreensharePreview`
  component).
  - Inline label: `[ screenshare: {username} ]` (bracket text retained
    per 05-icons.md §05.5).
  - Inline preview overlay buttons (Lucide icons via `IconButton`,
    32x32 touch-target carve-out per 05.3):
    - `PictureInPicture2` — label "Open screenshare window" (opens
      the modal window).
    - `Maximize` — label "Fullscreen" (toggles browser fullscreen on
      the video element).
  - **Double-clicking anywhere on the preview** also opens the
    screenshare window (shortcut for the `PictureInPicture2` button).
- Screenshare window: **non-draggable, non-resizable full-viewport
  modal overlay** with dark backdrop (`rgba(10,10,20,0.85)` +
  `backdrop-filter: blur(4px)`). Video is letterboxed at up to
  `90vw × 85vh` with `object-fit: contain`. Header bar has Lucide
  `Maximize` (label "Fullscreen") + Lucide `X` (label "Close
  screenshare window") icon buttons. **Clicking the backdrop does NOT
  close the window** — only the `X` close button does.
- Closing the window does not stop the stream.
- The main share toggle in the header controls row is a single Lucide
  `MonitorUp` / `MonitorX` icon (via `IconButton`) — label "Share
  screen" / "Stop sharing". Bracket-text button labels (`[ SHARE
  SCREEN ]`, `[ STOP SHARING ]`, `[ EXPAND ]`, `[ FULLSCREEN ]`,
  `[ CLOSE ]`) used in earlier spec revisions were migrated to Lucide
  icons in T-033 (commit `ea0304d`). The **takeover-confirmation
  modal** buttons (`[ YES, TAKE OVER ]` / `[ CANCEL ]`) and the
  inline `[ screenshare: {username} ]` label remain as bracket text
  (see 05-icons.md §05.5 text retention).

### Sidebar Indicator

<!-- DIM-Map §50.2 Sidebar Indicator
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (broadcast audience documented)
  Abhaengigkeiten:     ✓
-->

When a room has an active screenshare, the room entry in the Chatrooms
sidebar section shows a `[SS]` indicator in `text-muted` next to the
room name.

**Broadcast audience:**
- Room-screenshare events (`screenshare.started` / `screenshare.ended`
  with `mode: 'room'`) are broadcast to **ALL connected users**, regardless
  of membership — the `[SS]` indicator appears in every user's sidebar for
  the affected room. This is implemented by
  `broadcastToScreenshareScope` in `src/server/src/lib/scope-broadcast.ts`.
- DM-screenshare events (`mode: 'direct'`) are **targeted** to the two DM
  participants only.

Cleanup:
- If the sharer disconnects / crashes / the network drops, the screenshare
  LiveKit room emits `track_unpublished` / `participant_left` /
  `room_finished`. The server removes the entry from its
  `activeScreenshares` map and broadcasts `screenshare.ended`.
- Leaving voice/call stops the user's active screenshare (client-side, via
  the `prevActiveScopeRef` watcher on `activeScope`).
- The user clicking the browser's native "Stop sharing" overlay triggers
  local cleanup via `videoTrack.onended = () => cleanup()`.
- LiveKit `RoomEvent.LocalTrackUnpublished` (source `ScreenShare`) also
  triggers cleanup.
- LiveKit `RoomEvent.Disconnected` on the local screenshare room triggers
  cleanup (covers the network-drop path on the sharer's side).

### 50.2a Server-side Screenshare State (Normative)

<!-- DIM-Map §50.2a Server-side State
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (endpoint contract specified)
  Abhaengigkeiten:     ✓ (LiveKit webhooks)
-->

The server keeps an in-memory `Map<string, ActiveScreenshare>` keyed by
`{mode}:{scopeId}` (e.g. `room:abc123`, `direct:xyz789`). The map is:

- **Written** on LiveKit webhook `track_published` where `source ===
  SCREEN_SHARE` (livekit SDK source `3`).
- **Deleted** on `track_unpublished`, `participant_left`, and
  `room_finished`.
- **Rebuilt on boot** by `syncScreenshareState()` (see §50.7).

Enforcement note: "server-enforced" is a misnomer — the server **tracks**
state and broadcasts events, but it does NOT block a second
`SCREEN_SHARE` publish at the LiveKit layer. The effective
single-share-per-scope rule comes from the client-side takeover UX (see
§50.2 Concurrency). Any ambition to add true server-side enforcement is
tracked via the Code Gap Ledger (F-CSD-088).

**`GET /api/livekit/screenshares`** — auth-gated.
Returns `{ data: { screenshares: ActiveScreenshare[] } }`. Used by clients
on mount of `ScreenshareProvider` to seed local state; after that, WS
`screenshare.started`/`screenshare.ended` events keep it current.

`ActiveScreenshare` payload shape:

```ts
{
  mode: 'room' | 'direct';
  scopeId: string;           // roomId or directId
  userId: string;            // sharer's user id
  sourceRoomId?: string;     // room mode only — same as scopeId
  sourceRoomName?: string;   // room mode only — Room.name from DB
}
```

The `sourceRoomId` / `sourceRoomName` fields are populated for room
screenshares by a DB lookup of `Room.name` at `track_published` time
and during startup reconciliation. They are omitted for DM screenshares.
These fields are also present on the `screenshare.started` WS payload
(see `src/shared/src/ws-events.ts`) and support labelling screenshares
when the view context is not the room itself (e.g. future cross-room
notifications).

## 50.3 DM Screenshare

<!-- DIM-Map §50.3 DM Screenshare
  Completeness:        ✓
  Konsistenz:          ✓ (controls-visibility reconciled with code)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Eligibility:
- Both DM participants may start a screenshare. The user does NOT have to be
  in the DM call first — clicking `[ SHARE SCREEN ]` auto-joins the DM call
  as described in 50.3 Start behavior.

Start behavior:
- Same as room screenshare -- auto-joins DM call if not already in it.
- Same user gesture timing rule applies (`getDisplayMedia` first).
- Same cross-scope post-click guard applies (§50.2) if the user is already in
  a call in a different scope.

Concurrency:
- Only one active DM screenshare per conversation at a time (same tracking
  mechanism as §50.2a).
- Takeover with confirmation (same copy, same buttons, same `getDisplayMedia`-
  first ordering as room screenshare).

UI:
- `ScreenshareControls` appear in the DM view whenever the DirectConversation
  entity exists (i.e. whenever `directId` is present in `DmView`). It is NOT
  gated on the user already being in the DM call — auto-join handles that.
- `ScreensharePreview` appears in the DM view when a DM screenshare is
  active in that conversation.
- Same preview and window behavior as room screenshare (inline preview
  with `[ EXPAND ]` / `[ FULLSCREEN ]` + double-click shortcut;
  non-resizable modal window).

Cleanup:
- Same as room screenshare (§50.2 Cleanup).

## 50.4 Scope Validation (Normative)

### Component-Level Scope Matching

`ScreensharePreview` and `ScreenshareControls` render based on the global
screenshare store state. Because the store is global but these components
are rendered within a specific room or DM view, they MUST validate that
the active screenshare's scope matches the component's local scope.

Without this validation, navigating between rooms while a screenshare is
active in room A would cause room B's view to incorrectly show room A's
screenshare preview.

Implementation: the screenshare store exposes scope-specific getters
(`getRoomScreenshare(scopeId)` / `getDmScreenshare(scopeId)`). Components
read via those getters rather than via a generic `activeScreenshare`
field. The effect is the same as the canonical pattern:

```ts
// Canonical pattern — either this or a scope-specific getter is acceptable
if (activeScreenshare?.scopeId !== currentScopeId) return null;
```

The same pattern applies to `VideoGrid`: it must validate that the active
call's scope matches the view's scope before rendering participant tiles.

### Staleness Guards on Async Fetches (Normative)

Components that perform async operations (fetching messages, room data,
participants) MUST check a staleness ref before setting state with the
result. If the user has navigated away from the scope during the async
operation, setting state would update the wrong view.

Pattern:
```ts
const staleRef = useRef(false);
useEffect(() => {
  staleRef.current = false;
  fetchData().then(data => {
    if (!staleRef.current) setState(data);
  });
  return () => { staleRef.current = true; };
}, [scopeId]);
```

This applies to: `RoomView.fetchRoom`, `DmView.fetchMessages`,
`DmView.loadOlderMessages`, and any other async fetch in scoped views.

## 50.5 Screenshare Quality

<!-- DIM-Map §50.5 Screenshare Quality
  Completeness:        ✓
  Konsistenz:          ✓ (publisher path matches code)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (viewer lifecycle + token permissions specified)
  Abhaengigkeiten:     ✓
-->

Screenshare targets 1080p resolution with sharp text/UI rendering.

### Publisher (Sender)

Capture path (as-is):

1. `navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height:
   1080, frameRate: 30 }, audio: false })` — called directly in the click
   handler for user-gesture timing (§50.2 User Gesture Timing).
2. A new `Room()` is created, connected to the screenshare LiveKit room.
3. The captured video track is published via:

   ```ts
   room.localParticipant.publishTrack(videoTrack, {
     source: Track.Source.ScreenShare,
     videoEncoding: ScreenSharePresets.h1080fps30.encoding, // ~5 Mbps cap
   });
   ```

Notes:
- The code does **NOT** call `setScreenShareEnabled` (the LiveKit-wrapper
  helper) — direct `publishTrack` is used instead so the getDisplayMedia
  call and the publish happen in separate steps.
- `contentHint: 'detail'` is **NOT** set on the video track. Whether to
  add it for sharper text/UI encoding is a code-quality decision, not a
  spec rewrite — recorded in the Code Gap Ledger, not here.
- 30 fps target allows smooth scrolling/gaming; the 5 Mbps ceiling from
  `ScreenSharePresets.h1080fps30.encoding` is adequate for LAN and
  Gigabit uplinks.

**Audio (out of scope v1):**
Screenshare captures video only — `audio: false` in `getDisplayMedia`.
System/tab audio sharing is explicitly out of scope for v1. The server
webhook handler has a branch for `SCREEN_SHARE_AUDIO` (source `4`) that is
effectively dead code because no client publishes screenshare audio.

### Viewer (Receiver)

Each viewer opens its **own LiveKit `Room` connection** to the
screenshare room — separate from any call-room connection. Lifecycle:

1. When `ScreensharePreview` mounts and `activeScreenshare` is present (and
   the local user is not the sharer), the component calls
   `POST /api/livekit/token` with the screenshare room name
   (`ss:room:{roomId}` or `ss:dm:{directId}`).
2. Permission rules for screenshare tokens match call-room tokens:
   room membership for `ss:room:*` (the user must be a member of the
   underlying group), DM participation for `ss:dm:*`. Non-members who see
   the `[SS]` sidebar indicator (rooms are broadcast globally per §50.2
   Sidebar Indicator) cannot actually subscribe — they would receive 403
   from `/api/livekit/token`.
3. The viewer connects a new `Room({ adaptiveStream: false })`. Adaptive
   streaming would scale down based on the video element's rendered size
   (~300 px tall inline preview ⇒ ~360p), defeating the 1080p publisher
   config. With it disabled the viewer always receives the full 1080p
   stream, rendering sharp in both EXPAND and FULLSCREEN views.
4. The Room is disconnected on component unmount, on scope change
   (different room/DM), or when `activeScreenshare` clears (sharer ended).
5. EXPAND / FULLSCREEN views reuse the same track from the same viewer
   Room — they do not open additional connections.

## 50.6 Admin-Initiated Cleanup

<!-- DIM-Map §50.6 Admin Cleanup
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓ (see 80-admin.md)
-->

Room deletion flows through the single shared endpoint
`DELETE /api/rooms/:roomId` (admin OR creator — there is no separate
`DELETE /api/admin/rooms/:roomId` route). After the DB transaction
deletes messages, memberships, and the Room row, the handler calls
`roomService.deleteRoom('call:{roomId}')` and
`roomService.deleteRoom('ss:room:{roomId}')` to tear down both
LiveKit companion rooms (commit `f939823`, F-CSD-5002 resolved).
Errors from `deleteRoom` are differentiated by severity: 404
("room not found") is logged at `debug` level and treated as already-
gone (idempotent); any other error is logged at `error` level but
does not fail the DB delete (the client's `room.deleted` broadcast
still fires). Any active screenshare in that room is force-ended as
part of this cleanup. See also 80-admin.md §80.5 and
`src/server/src/routes/rooms.ts` for the implementation.

## 50.7 Server Startup Reconciliation

<!-- DIM-Map §50.7 Startup Reconciliation
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓ (LiveKit RoomServiceClient)
-->

Because the `activeScreenshares` map is in-memory only, the server rebuilds
it on boot.

`syncScreenshareState()` (in `src/server/src/routes/livekit.ts`) is invoked
fire-and-forget from the server bootstrap (`src/server/src/index.ts`). It:

1. Calls `roomService.listRooms()` for all LiveKit rooms.
2. Filters to rooms matching `ss:room:*` / `ss:dm:*`.
3. For each, calls `roomService.listParticipants()` and inspects each
   participant for a `source === 3` (SCREEN_SHARE) track publication.
4. Rebuilds the `activeScreenshares` map entry with `mode`, `scopeId`,
   `userId`, and — for room mode — looks up `sourceRoomId` /
   `sourceRoomName` from the DB.
5. Logs a summary count of restored entries.

Failures are **non-fatal**: caught, logged as warnings, and the map starts
empty. Subsequent webhook events (`track_published` / `track_unpublished`)
take over once LiveKit webhooks start flowing.

## 50.8 Failure Modes

| Failure | Symptom | Handling |
|---|---|---|
| `getDisplayMedia` API absent on device (iOS, older Android) | `ScreenshareControls` component returns null — button not rendered at all | No user-visible error; store's defensive inline guard returns `{ ok: false, error: 'Screen sharing is not supported on this device' }` if invoked directly anyway |
| `getDisplayMedia` cancelled / denied | Error thrown in click handler | `{ ok: false, error: 'Screen capture failed: <err.message>' }`; UI shows error in `var(--error)` for 3s; previous share (if any) untouched |
| Unexpected error after capture succeeded (connect() throw, publish mismatch, any non-enumerated step) | Outer try/catch | Captured stream discarded, local Room disconnected, `{ ok: false, error: 'Screenshare failed: <err>' }`. Note the prefix differs from `Screen capture failed:` — the latter is specific to `getDisplayMedia` and `publishTrack` failures; `Screenshare failed:` is the generic fallback. |
| Auto-join call fails (permission, offline DM target, etc.) | `joinResult.ok === false` | Captured stream discarded, `{ ok: false, error: 'Failed to join {mode} call' }`; no LiveKit connection opened |
| `/api/livekit/token` fails for screenshare room | 401/403/5xx | Captured stream discarded, `{ ok: false, error: 'Failed to get screenshare token' }` |
| `room.connect()` to screenshare room fails | Network / LiveKit down | Captured stream discarded, store returns error, no share started |
| `publishTrack` fails | LiveKit / encoder error | Captured stream discarded, viewer Room disconnected, `{ ok: false, error: 'Screen capture failed: <err>' }` |
| Cross-scope call conflict (user in call A, shares in B) | Post-click inline error | Stream discarded, `Leave your current call first to screenshare here` in `var(--error)` for 3s (see §50.2 — F-CSD-084 open) |
| Sharer's local network drop | `RoomEvent.Disconnected` on local screenshare Room | Client runs `cleanup()`; server emits `screenshare.ended` on `participant_left`/`room_finished` |
| Sharer clicks browser "Stop sharing" overlay | `videoTrack.onended` | Client runs `cleanup()`; LiveKit unpublish → server emits `screenshare.ended` |
| Viewer loses connection | `RoomEvent.Disconnected` on viewer Room | Viewer re-mounts from scratch on next render; no server effect |
| Server restart with shares active | In-memory map empty at boot | `syncScreenshareState()` rebuilds map from LiveKit; if sync fails, warnings logged and map remains empty until next webhook |
| Admin (or creator) deletes room during active share | Shared `DELETE /api/rooms/:roomId` | `roomService.deleteRoom('call:{id}')` AND `roomService.deleteRoom('ss:room:{id}')` called after DB transaction commits; share force-ended (§50.6; F-CSD-5002 resolved in f939823) |

## 50.9 Acceptance Criteria (Screenshare)

- [ ] Room screenshare starts and auto-joins call if needed
- [ ] Only one room screenshare per room at a time (takeover with confirmation; tracked server-side, enforced via client UX)
- [ ] DM screenshare starts and auto-joins DM call if needed
- [ ] Only one DM screenshare per conversation at a time
- [ ] Screenshare preview shown at top of chat (room and DM)
- [ ] Double-click on preview opens the screenshare window (shortcut for EXPAND)
- [ ] Screenshare window opens via EXPAND button
- [ ] Screenshare window is a non-draggable, non-resizable modal overlay; backdrop click does not close it
- [ ] Screenshare stops when user leaves call
- [ ] Screenshare cleans up on sharer disconnect (`Disconnected`, `LocalTrackUnpublished`, `videoTrack.onended`)
- [ ] Sidebar shows [SS] indicator for rooms with active screenshare; broadcast to ALL users for rooms, only DM participants for DMs
- [ ] LiveKit room names follow patterns in overview.md Invariant I
- [ ] Closing screenshare window does not stop the stream
- [ ] Screenshare quality targets 1080p capture, 30 fps, ~5 Mbps via `ScreenSharePresets.h1080fps30.encoding`
- [ ] `audio: false` — screenshare captures video only (v1)
- [ ] `getDisplayMedia` called immediately in click handler (user gesture timing)
- [ ] `getDisplayMedia` cancellation shows `Screen capture failed: <err>` in `var(--error)` for 3 seconds; previous share untouched
- [ ] Cross-scope call attempt shows post-click inline error (`Leave your current call first to screenshare here`) — pre-emptive disable not implemented (see F-CSD-084)
- [ ] Each viewer opens its own LiveKit Room to the screenshare room with `adaptiveStream: false`
- [ ] `GET /api/livekit/screenshares` returns the server's active-screenshare map for client seeding
- [ ] Server rebuilds active-screenshare state on boot via `syncScreenshareState()`
- [ ] Admin room deletion force-ends active screenshares in that room
