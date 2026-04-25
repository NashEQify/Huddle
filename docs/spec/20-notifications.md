intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Notification delivery, unread tracking, and activity ordering rules
  action: Defines notification scope, server-side read positions, notification sounds, browser notifications, tab title counter, and activity-based sorting

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 10-domain, 25-websocket, 40-voice |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2): §20.2 now enumerates the four `mark_read` trigger points (navigation / focus / `unread.init` self-match / deferred DM directId resolution) (F-CSD-2002) and documents the client-side "active-scope coalescing" filter that prevents the currently-viewed scope from rendering as unread (F-CSD-2001). DIM-Map rows flipped to ✓: §20.3 Konsistenz (F-CSD-042 resolved, commit dbc4e4e and prior), §20.5 Completeness (F-CSD-050 resolved — scope-count semantics match), §20.6 Completeness (F-CSD-051/052 resolved — all `lastActivityAt` bump sources implemented). History: 2026-04-14 — Task 009 Batch 2 retroactive drift-sync. |

## Was diese Spec beschreibt

This spec governs how users are notified about new activity. It covers server-side read position tracking (unread state), notification sounds (message and DM call ring), browser notifications, the tab title counter, and the activity ordering rules that drive sidebar sorting. Notification scope is tied to membership state (only `joined` rooms and DMs produce notifications).

---

# 20. Notifications & Activity (Normative)

## 20.1 Notification Scope
Notifications and unread indicators exist only for:
- direct conversations
- group rooms where membership_state == joined

For group rooms where membership_state == left or not_joined:
- no notifications
- no unread indicators

<!-- DIM-Map §20.1 Notification Scope
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

## 20.2 Server-Side Read Positions
Unread state is persisted server-side via the `ReadPosition` model
(`read_positions` table). Each row stores `(user_id, scope_type, scope_id,
last_read_at)`.

**On WS connect:** The server computes unread scopes by comparing each
scope's latest non-self-authored message timestamp against the user's
`last_read_at`. Scopes with messages newer than `last_read_at` (or with no
read position at all but having messages from other users) are included in
the `unread.init` event payload as scope keys.

**Scope key format (`unread.init` payload):**
- Room: `"room:{roomId}"`
- Direct: `"dm-user:{otherUserId}"` — the userId of the DM counterparty,
  NOT the `directConversation.id`. This aligns the key with the Users
  sidebar entry (which is indexed by userId), since DMs have no persistent
  sidebar row of their own.

The client resolves `otherUserId → directId` lazily via
`GET /api/direct/:otherUserId` when the user navigates to a DM, because
server-side read positions are keyed by DM row id (see below).

**On navigation / focus:** The client sends a `mark_read` WS message with
`{ scopeType, scopeId }`. For DMs, `scopeType: 'direct'` and `scopeId` is
the `directId` (NOT the key used in `unread.init`); for rooms,
`scopeType: 'room'` and `scopeId` is the `roomId`. The server upserts the
read position with `lastReadAt = now()`, after validating that the user
has access (joined for rooms, participant for DMs).

**`mark_read` trigger points (enumeration):** The client fires a
`mark_read` for the currently active scope in each of the following
cases:
(a) navigation to a scope (room or DM),
(b) a `window focus` event,
(c) an `unread.init` payload that lists the already-active scope,
(d) for DMs only: the deferred arrival of `GET /api/direct/:otherUserId`
when the `directId` is not yet cached.
Repeated `mark_read` upserts are harmless (idempotent over
`lastReadAt = now()`).

**Active-scope coalescing (client):** While a scope is the active view,
the client does not render it as unread. Specifically:
- On `unread.init`, the scope matching the current active view is
  omitted from the in-memory unread map.
- On `message.new` in the currently active scope with the tab focused,
  the client does not increment the unread count (the message is
  immediately visible).
These are display-only filters; the server still stores/clears the read
position via `mark_read`. Cross-ref: the same active-scope predicate
gates the notification-sound play condition in §20.3.

**Access-check failure semantics:** If the access check fails (membership
missing or state != `joined` for rooms, or caller is not a participant for
DMs), the server **silently ignores** the `mark_read` message. No error
event is sent back to the client; no read position is upserted. (Rationale:
the scenarios are either stale-client drift or a no-op from the user's
perspective — no user-visible correction is required.)

**Self-authored messages** never count as unread (filtered server-side via
`authorId != userId`).

<!-- DIM-Map §20.2 Server-Side Read Positions
  Completeness:        ✓  (key format + silent-fail both documented)
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓  (unread.init key format + mark_read scopeId semantics explicit)
  Abhaengigkeiten:     ✓
-->

## 20.3 Notification Sound

When a new message arrives (via `message.new` WS event) and the scope is not
the currently active view:
- Play a short notification sound (synthesized via Web Audio API, no external
  audio file). The sound is a two-tone descending beep: a sine oscillator
  starts at 800Hz at t=0, switches to 600Hz at t+0.1s, and stops at t+0.3s.
  Gain envelope starts at 0.1 and exponentially ramps to 0.001 over the
  0.3s window (no audible click on stop).
- Sound plays only if the browser tab is not focused OR the user is viewing
  a different scope.

**AudioContext lifecycle:** The shared Web Audio `AudioContext` is created
lazily on the first sound-producing call. Because browsers (notably
Chrome) suspend `AudioContext` instances until a user gesture, the app
registers a one-shot document-level listener for `click` and `keydown` on
mount; the first such event calls `ensureAudioContext()`, which calls
`ctx.resume()` if the context is suspended, then removes the listener.
This ensures that subsequent notification sounds (including an incoming
call ring arriving before any additional user gesture) can play
immediately. If `AudioContext` is unavailable (older browsers / blocked
environments), all sound APIs silently no-op.

### DM Call Ring Sound

When an incoming DM call notification arrives (`dm.call.incoming`):
- Play a continuous ring loop. Each burst contains **three two-tone
  chirps** (880Hz → 660Hz per chirp, tone switch at +0.15s within the
  chirp, 0.4s total gain envelope per chirp, 0.6s stride between chirps
  within the burst → burst length ≈ 1.8s). After each burst there is a
  ~2s silence, then the next burst repeats.
- Ring stops when: user accepts, user declines, caller leaves, the call
  ends, or the auto-decline timeout fires (30s — see 40-voice §40.8).
- Implemented via `startCallRingLoop()` in `notification-sound.ts`, which
  returns a cleanup function that terminates the loop.

<!-- DIM-Map §20.3 Notification Sound
  Completeness:        ✓  (envelope, AudioContext lifecycle, ring timing all captured)
  Konsistenz:          ✓  (F-CSD-042 resolved — sound gate `!document.hasFocus() || currentScopeKey !== scopeKey` matches spec)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓  (notification-sound.ts API surface)
  Abhaengigkeiten:     ✓  (Web Audio AudioContext dependency + user-gesture suspend)
-->

## 20.4 Browser Notifications

Browser notifications are used **only for incoming DM calls**, not for
chat messages. When a DM call arrives and the tab is not focused:
- Show a browser notification. **Title:** `Incoming Call`.
  **Body:** `{username} is calling you`, where `{username}` falls back to
  `Someone` if the caller's username has not yet been resolved (e.g. a
  first incoming call arriving before `/api/users` has loaded).
- Requires user permission (`Notification.requestPermission()`).
- Permission is requested on first incoming call, not eagerly on app start.
  If the user has already denied permission, no retry / re-prompt occurs.
- Clicking the notification focuses the app tab, runs the optional
  caller-supplied onClick handler, and closes the notification.

**Focus-gate placement:** The "tab is not focused" check is enforced
**inside** `showNotification()` via `document.hasFocus()`. Call sites
(e.g. `IncomingCallOverlay`) may invoke `showNotification()`
unconditionally on every `shouldShow` transition; the function itself
no-ops when the tab is focused. This keeps the gating logic in one place.

**Notification lifecycle:**
- Each browser notification **auto-dismisses after 5 seconds**.
- All notifications share the collapse tag `"huddle-message"`, so a newer
  notification replaces the prior visible one (no stacking pile-up).
- Icon is the app favicon (`/favicon.ico`).

Message notifications are handled via the in-app notification sound only
(see 20.3). Browser notifications for messages are explicitly disabled.

<!-- DIM-Map §20.4 Browser Notifications
  Completeness:        ✓  (title, body fallback, focus gate, TTL, tag, icon, click handler)
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓  (showNotification signature + internal focus gate)
  Abhaengigkeiten:     ✓  (Notification API, permission state machine)
-->

## 20.5 Tab Title Counter

The browser tab title reflects unread state:
- No unreads: `Huddle`
- With unreads: `(N) Huddle` where N is the total number of scopes
  with unread messages (not total message count).
- Counter updates in real-time as messages arrive and scopes are read.

<!-- DIM-Map §20.5 Tab Title Counter
  Completeness:        ✓  (F-CSD-050 resolved — totalUnreadCount now counts scopes-with-unread, matches spec and overview §F)
  Konsistenz:          ✓ (spec-internal; matches overview.md §F invariant)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

## 20.6 Activity and Ordering
last_activity_at is updated by:
- message sent
- call started/ended
- room screenshare started/ended
- **group membership transition** (join / leave / rejoin) — each such
  transition updates `Room.lastActivityAt` on the affected room, matching
  the system-message emission that records the state change in chat
  history (see 30-chat system-message semantics).

Chatrooms sorting:
- membership bucket priority (joined > left > not_joined)
- within bucket: last_activity_at DESC

<!-- DIM-Map §20.6 Activity and Ordering
  Completeness:        ✓  (F-CSD-051/052 resolved — `lastActivityAt` bumped on message send, membership join/leave/rejoin, call start/end (room_started/room_finished webhooks), screenshare start/end (track_published/unpublished + participant_left cleanup))
  Konsistenz:          ✓ (spec-internal)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
