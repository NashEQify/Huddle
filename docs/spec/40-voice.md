intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Voice call system powered by LiveKit for group rooms and DMs
  action: Defines call model, eligibility, join/leave controls, microphone defaults, speaking signal relay, in-call UI, DM call specifics (offline guard, incoming overlay, leave=end), audio implementation details, disconnect cleanup, connection resilience, and remote mute

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.5.0 |
| **Konsumiert** | overview, 10-domain, 25-websocket, 45-video, 50-screenshare, 70-audio-settings, 80-admin |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 16 findings): §40.3 camera-fail silent behavior documented (F-CSD-4001); §40.5 hysteresis corrected to "LiveKit active-speakers + 500ms decay" (F-CSD-4002); §40.6 Connection Quality Indicator split into current-v1.3 (Excellent/Good/Poor/Reconnecting) vs future-work (Reconnected/Disconnected) (F-CSD-4003); §40.6 camera toggle now covers iOS facingMode fallback via `buildCameraConstraints` (F-CSD-4004); §40.6 Active Call Border clarified as group-room-only (F-CSD-4005); §40.6 Call Duration Timer format "CALL 3:42" (no brackets/middot) + participant count badge visible-only-when-not-in-call (F-CSD-4006/4007); §40.8 ring-timeout layered backstops documented (F-CSD-4008, commit b4b2b92); §40.8 ring sound detail corrected to "3× descending 2-tone rings" (F-CSD-4010); §40.10 GainNode signal chain head updated to `createLocalAudioTrack` (F-CSD-4013); §40.10 toggle guards extended to `toggleBlur` + `isTogglingBlurRef` with CGL-012 rollback (F-CSD-4014); §40.12 `JoinCallFailReason` enum expanded to 5 reasons with UI-string table (F-CSD-4015); §40.13 participant context menu now documents both Direct-message and Mute-user items (F-CSD-4016). Resolved CGLs: F-CSD-4009 GO TO CALL link landed in 6ea125d; F-CSD-4011 Browser Notification focus gate landed in 0146e7c. History: 2026-04-11 — Batch 1 T-004 findings. |
| **Earlier Updates** | 2026-04-10 — `call.speaking` wire format (per-user, server-injected userId, scope-aware broadcast), GainNode fallback mode documented, mute-participant server-side same-room enforcement, `toggleCamera` preserves deviceId, background blur self-hosts MediaPipe assets |

## Was diese Spec beschreibt

This spec defines everything about voice calls: the single-call-per-conversation model, membership eligibility, join/leave UI, microphone defaults, the speaking indicator relay mechanism (LiveKit -> WS -> all clients), in-call controls and UI (duration timer, active call border), DM-specific call behavior (offline guard, incoming call overlay, leave=end semantics), low-level audio implementation details (webAudioMix, GainNode pipeline, mute guards), disconnect cleanup, call connection resilience, and remote participant muting.

---

# 40. Calls (LiveKit) (Normative)

## 40.1 Model
- Single Call concept (LiveKit) per conversation scope:
  - group room call: LiveKit room `call:{room_id}` (see overview.md Invariant I)
  - direct call: LiveKit room `call:dm:{direct_id}` (see overview.md Invariant I)
- Audio is baseline.
- Camera is optional inside call.
- A user can be in at most one active call at a time (see overview.md Invariant H).

## 40.2 Eligibility
Group rooms:
- joined: call allowed
- left/not_joined: call not allowed until rejoin/join

Direct:
- call allowed for both participants.

## 40.3 Join Call Control
Conversation UI MUST expose:
- "Join Call" button
- "Leave Call" button when in call

Join Call dropdown:
- "Join (audio only)"
- "Join with camera"

Rules:
- Audio-only join does NOT enable camera.
- Join with camera enables camera immediately upon successful call connection.
- If camera fails:
  - user still joins audio-only. The failure is logged via
    `console.error` but no user-visible toast/banner is shown — the
    visual state (`hasCamera === false`, camera icon in "off" variant)
    is the only cue. This silent-fail is intentional for v1.3; a
    toast is future work.

## 40.4 Microphone Default
- On joining call, microphone starts unmuted by default.
- User can mute/unmute via Mute control.
- Muting affects microphone audio publishing only.

## 40.5 Speaking Signal for UI (Normative)

Speaking state is derived from LiveKit `ActiveSpeakersChanged` events by
each call participant's own client, then **relayed via WebSocket** to
observers outside the call. For observers IN the call, the LiveKit-SDK
events drive the `speakingMap` directly — the WS relay is redundant for
them and filtered out on the receive side.

### Wire Format (Normative)

The `call.speaking` WS event is **per-user** — each broadcast announces
one user's speaking-state transition, NOT a full-set snapshot:

```ts
// Client → server (sender announces their own state only):
{
  type: 'call.speaking',
  payload: { scope: CallScope, isSpeaking: boolean }
}

// Server → clients (userId injected from authenticated session):
{
  type: 'call.speaking',
  payload: { scope: CallScope, userId: string, isSpeaking: boolean }
}
```

**Server MUST inject `userId`** from the authenticated session before
broadcasting. Clients MUST NOT be trusted to report other users' speaking
state — the server authoritatively stamps the event with the sender's
own userId. This prevents "call.speaking spoofing" where a malicious
client could mark other users as speaking.

### Mechanism

1. LiveKit fires `ActiveSpeakersChanged` on the participant's client.
2. The client checks whether the LOCAL participant is in the new active
   speakers list, compared to the previous local speaking state.
3. If the local speaking state **changed** (only on transitions, not on
   every LiveKit event), the client sends `call.speaking` with
   `{ scope, isSpeaking: <new local state> }`.
4. Server overwrites the outgoing payload with `userId` from the
   authenticated session and broadcasts **scope-aware**:
   - **Room scope** → global broadcast (non-members see "activity" social
     cue in their sidebar).
   - **Direct scope** → targeted broadcast to the 2 DM participants only
     (privacy: user C does not learn A and B are talking).
5. The sender is excluded from the broadcast echo (`excludeUserId` on
   the transport level).
6. Receiving clients update their local `speakingMap` **per-user** —
   only the target userId's state is changed. Other users' states are
   not decayed as a side-effect of receiving a single transition.
7. Clients that are themselves IN the referenced call skip the event
   (they have direct LiveKit audio-level data with lower latency).

### Hysteresis / Decay

Speaking should be stable (no rapid flicker):

- Smoothing: LiveKit `ActiveSpeakersChanged` membership is the source
  signal (boolean per user — in/out of active-speakers set); a 500ms
  fall-off decay (`SPEAKING_DECAY_MS`) on the receive side prevents the
  `isSpeaking` flag from flickering between spoken words. There is no
  additional RMS-threshold comparison in the call store (a
  `SPEAKING_THRESHOLD` constant is declared but unused — decay alone
  does the smoothing; the threshold-based RMS logic in
  `lib/audio-utils.ts::calculateRms` is only for the VoiceTest meter).
- When `isSpeaking: false` arrives, schedule a decay timer instead of
  flipping the UI immediately, to avoid flashing on short pauses between
  words.
- CSS animation: `avatar-speaking` class with pulsing box-shadow
  (`0 0 0 3px var(--accent)`, double shadow, 1s cycle).

## 40.6 In-Call UI
When in a call, UI MUST show:
- Mute toggle
- Camera toggle
- Leave button
- Screenshare button (room calls; DM calls -- see `50-screenshare.md`)
- Background Blur toggle (`[ BLUR ]`) — visible only when camera is enabled.
  See §45.7 in `45-video.md` for full Blur implementation details (lazy-load
  of `@livekit/track-processors`, Firefox hard-block, MediaPipe self-host,
  `showProcessedStreamLocally=true` requirement, failure modes, etc.).
  `40-voice.md` only describes the control's presence in the CallControls;
  `45-video.md §45.7` is the single source of truth for the behavior.
- Connection Quality Indicator — see below.

Camera toggle:
- publishes/unpublishes camera track
- does not affect call membership
- When enabling camera (both on join-with-camera and on mid-call re-enable),
  the published track MUST use `VideoPresets.h1080.resolution` — 1080p is the
  hard-coded target resolution, LiveKit adapts downward via simulcast when
  bandwidth constraints apply.
- On mid-call re-enable via `toggleCamera`, the previously stored
  `videoCameraDeviceId` from settings is resolved through
  `buildCameraConstraints()` (see `src/client/src/lib/camera-constraints.ts`)
  and passed to `setCameraEnabled` so the user's device choice
  survives off/on toggles.
- **Platform-specific constraint resolution**:
  - **Desktop (Chromium / Firefox / Safari on macOS)**: the deviceId
    is passed through unchanged — `{ deviceId: <id> }`.
  - **iOS (WebKit on iPhone/iPad)**: WebKit ignores `deviceId` for
    camera capture, so `buildCameraConstraints` translates the stored
    deviceId to a `facingMode` (`'user'` for front, `'environment'`
    for back) by inspecting the corresponding `MediaDeviceInfo.label`
    for `front/facetime/user/selfie` vs `back/rear/environment/wide/
    ultra/telephoto` tokens. Fallback `facingMode: 'user'` when a
    label exists but direction is unclear.
  - **Android (Chromium mobile)**: same facingMode-preferred path as
    iOS (deviceId support is inconsistent across OEM/browser combos).
  Both paths apply identically to join-with-camera (initial join) and
  mid-call `toggleCamera`.

### Call Duration Timer

A call duration timer is shown **to all users viewing the room**, not
just call participants. The timer appears next to the room name in
the room header when a call is active. Rendered format: `"CALL 3:42"`
— a literal `CALL ` prefix followed by `mm:ss`, no brackets around
the prefix, no middle-dot separator (earlier spec revisions showed
`[ CALL ] 3:42 · 4 in call`; the shipped rendering is simpler).

**Participant Count (Group Rooms):**
A participant count badge `"{n} in call"` (e.g. `"4 in call"`) is
rendered inside `CallControls` next to the Join button, visible only
when the current user is **not** in the call. When the current user
IS in the call, the count badge is omitted — the
`CallParticipantsStrip` in the header conveys the same information
with richer detail (avatars + speaking indicators), so a count badge
would duplicate the signal.

### Active Call Border

When a user is in a call for the current group room, the **room**
header shows a red border (`box-shadow: inset 0 0 0 2px var(--error)`)
to visually indicate active call participation. DM headers do **not**
show a red border — DM call participation is already unambiguous
because the Join Call dropdown is replaced by the in-call control set
when the user is in the DM's call.

### Connection Quality Indicator (Normative)

CallControls MUST render a small connection state indicator that reflects the
LiveKit Room's current connection health. **Current implementation (v1.3)**:

- **Excellent / Good**: green dot (`var(--accent)`), no label, hover
  tooltip `"Connection: excellent"` / `"Connection: good"`.
- **Poor**: yellow dot, hover tooltip `"Connection: poor"`, no
  persistent label.
- **Reconnecting**: `"Reconnecting..."` text in `var(--error)` replaces
  the dot entirely. No pulsing animation.

**Future states (not yet implemented — tracked as code-side work)**:

- **Reconnected** (transient, ~2s after reconnect): green dot, label
  `"Reconnected"`, then the indicator reverts to the idle good-quality
  state. **Not wired in v1.3.**
- **Lost** (after max retry attempts): red dot, label `"Disconnected"`.
  **Not wired in v1.3.**

Wiring (implementation guidance):

```ts
room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
  if (participant.isLocal) setConnectionQuality(quality);
});
room.on(RoomEvent.Reconnecting, () => {
  setConnectionState(ConnectionState.Reconnecting);
});
room.on(RoomEvent.Reconnected, () => {
  setConnectionState(ConnectionState.Connected);
  // Show "Reconnected" transient banner ~2s, then clear
});
```

The indicator is client-side only — the server does not broadcast quality
state between participants. Each user sees only their own connection quality.

## 40.7 Leaving Call
- Leaving call stops all tracks published by the user in that call.

## 40.8 DM Voice Calls

### Overview

Direct conversations support voice calls. The call session follows the same LiveKit model as
group room calls. All Global Invariants (E, H) apply identically.

LiveKit room name: `call:dm:{direct_id}` (see overview.md Invariant I)

DM calls differ from group room calls in two ways:

1. There are exactly two possible participants (the two DM participants).
2. There is no explicit "join" membership gate -- both DM participants may always start or join
   the call.

### WS Event Schema (Unified Scope)

All call-related WS events use a unified scope field (full catalog in `25-websocket.md`):

```
{ type: 'call.*', payload: { scope: { type: 'room' | 'direct', id: string }, ... } }
```

- DM calls: `scope.type = 'direct'`, `scope.id = direct_conversation_id`
- Group calls: `scope.type = 'room'`, `scope.id = room_id`

### Offline Guard (Normative)

A DM call MUST NOT be initiated to an offline user. The client checks
presence state before calling. If the other user is offline: show inline
error `User is offline.` and do not start the call. See overview.md
Invariant G.

### Call Button Placement

The call button appears in the DM view header, right-aligned, always visible when a DM
conversation is open.

Label states:

- No active call: `[ CALL ]`
- Active call, current user not in it: `[ JOIN CALL ]`
- Current user is in this call: shows in-call controls (see below)

### Call States

**Idle (no active call)**
- Button: `[ CALL ]`
- No participant indicator

**Connecting**
- Button disabled, label: `connecting...`

**Active -- current user NOT in call**
- Button: `[ JOIN CALL ]`
- Small indicator: the other participant's username + status (muted / speaking)

**Active -- current user IN call**
- In-call controls replace the call button: `[ MIC ]  [ CAM ]  [ SCREENSHARE ]  [ LEAVE ]`
- Duration timer shown (elapsed since user joined)

**Waiting (user started call, other participant not yet joined)**
- In-call controls shown
- Below controls: `waiting for {other_username}...`
- Resolves when the other participant joins or the caller leaves

**Ring Timeout (Normative — 30 seconds):**

If the callee does not accept or decline within **30 seconds**, two things
happen simultaneously:

1. **Callee side**: `IncomingCallOverlay` auto-declines. The overlay
   disappears, ring stops.
2. **Caller side**: If no second participant has joined the LiveKit room
   within 30 seconds of the caller joining, the caller auto-leaves. This
   prevents "caller stuck waiting forever" when callee is AFK.

The 30-second value is shared — both sides use the same timer, enforced
client-side independently (no server coordination). The caller's auto-leave
triggers the standard leave flow (server deletes the LiveKit room per
§40.9 DM Call Leave = End).

**Ring-timeout backstops (caller side)**: the 30s auto-leave timer is
armed ONLY when the LiveKit room has no remote participants at the
moment the caller finishes joining. Four independent guards prevent
it from firing when the other user is actually present:

1. **Pre-arm size check** — the timer is not armed if
   `room.remoteParticipants.size > 0` at join-time.
2. **`call.joined` clears** — when we receive any `call.joined` event
   with a non-self `userId`, the ring timer is cleared.
3. **`call.participants` backstop** — when we receive a
   `call.participants` snapshot containing any non-self user, the
   timer is cleared (race-safe for cases where we missed a
   `call.joined` during the short window between our join and our
   WS re-subscription).
4. **Fire-time re-check** — at the 30s fire moment, the callback
   re-checks `remoteParticipants.size` as a final guard; if a remote
   is now present, the cleanup is skipped.

This layered design addresses the DM ring-timeout race fixed in
commit `b4b2b92`.

**Decline Flow (Normative):**

When the callee clicks `[ DECLINE ]` in `IncomingCallOverlay`:

1. Client sends `dm.call.decline` WS event to server with the payload
   `{ directId: string, callerId: string }`. Both fields are required —
   `directId` identifies the DM conversation, `callerId` identifies the
   user the callee is declining. (Earlier drafts used `directConversationId`;
   the actual wire format is `directId` + `callerId`.)
1a. Server sends `dm.call.declined` (S→C) to the caller with payload
   `{ directId: string, declinedBy: string }` via targeted `sendToUser`.
   This is an **explicit decline notification** — distinct from the
   later `call.ended` broadcast — so the caller's UI can distinguish
   "declined" vs "normal hangup" and show appropriate feedback (e.g.
   "User declined your call" toast).
2. Server deletes the LiveKit room `call:dm:{direct_id}` via
   RoomServiceClient `deleteRoom()`.
3. LiveKit sends `room_finished` webhook to server.
4. Server broadcasts `call.ended` to both users (scope-targeted).
5. Caller's client receives `call.ended` and disconnects from the room
   (the caller was still in the room waiting). The caller's UI returns
   to idle DM view.

The decline does NOT keep the call active for the caller. Unlike the
earlier design (decline only dismisses overlay), decline now actively
kicks the caller out via the server's room deletion. This prevents
"phantom calls" where the caller continues waiting after being declined.

### Multi-Call Constraint

See overview.md Invariant H.

If a user clicks CALL or JOIN CALL while already in a different call:
- Show inline message: `Leave current call first.` with a `[ GO TO CALL ]` link that navigates to the conversation scope of the active call.
- The `[ GO TO CALL ]` link uses the active call scope from the call store to navigate directly to the room or DM where the user's current call is.
- Do not auto-leave the existing call.
- Do not navigate away.

### Incoming Call Overlay (Global)

When a DM call is started by the other participant, a **global fixed-position
overlay** (`IncomingCallOverlay`) appears near the top of the viewport,
visible regardless of which view the user is on. This is the **only**
incoming-call UI — there is no longer a per-DmView banner (earlier designs
had both; the duplication caused confusion and was removed).

- Overlay shows: `{username} is calling...  [ ACCEPT ]  [ DECLINE ]`
- A continuous ring sound plays: **three descending 2-tone rings**
  (880Hz → 660Hz, ~150ms per tone, 0.4s envelope per ring) spaced
  600ms apart — total burst ≈ 1.8s — followed by ~2s silence, then
  repeat. Implemented via Web Audio API oscillators in
  `src/client/src/lib/notification-sound.ts` (`playCallRingSound` +
  `startCallRingLoop`); no audio asset is shipped. The ring loop runs
  until
  the user responds or the call ends.
- **ACCEPT**: joins the DM call and navigates to the DM view.
- **DECLINE**: triggers the Decline Flow above — sends `dm.call.decline`
  WS event, server deletes the LiveKit room, caller receives `call.ended`
  and is disconnected. The decline is NOT purely local.
- The overlay disappears when: the user accepts, the user declines, the
  caller leaves, `call.ended` is received for that DM, or the 30-second
  auto-decline timer fires.
- The overlay does NOT appear if the user is already in another call
  (client-side suppression — see below).
- Incoming DM call state is managed in `CallProvider` (not scoped to
  DmView), ensuring it works from any view.

**Browser Notification (Normative):**

When a `dm.call.incoming` event is received and the page is not currently
focused, the client MUST also fire a **Browser Notification** via the
Notifications API with title `"Incoming Call"` and body `"{username} is
calling you"`. Clicking the notification focuses the window. Permission
is requested lazily on first incoming call (not at app-start).

- Permission check: `Notification.permission === 'granted'` → fire directly.
- `Notification.permission === 'denied'` → skip silently.
- `Notification.permission === 'default'` → call `requestPermission()`
  then fire on success.

The Browser Notification is **additive** — it does not replace the in-app
overlay or the ring sound, it supplements them for the case where the user
has Huddle in a background tab.

**Client-Side Suppression (Normative):**

The server sends `dm.call.incoming` **unconditionally** whenever a caller
joins an empty DM call room — regardless of whether the receiver is currently
in another call. The "don't show overlay if already in another call" rule
is enforced **client-side** in the `dm.call.incoming` handler: the client
inspects its own `activeCall` state and skips rendering the overlay + ring
if non-null.

Rationale: the server has no reliable real-time view of every user's call
state (LiveKit is the source of truth for call membership, not the app
server). Pushing the filter client-side keeps the server dumb and the
invariant local.

Consequence: the server does NOT need to track "who is currently in which
call" for notification-gating purposes. That state lives in each client's
`CallProvider`.

The Users section sidebar entry also shows a call indicator icon for the
calling user (unchanged).

**MUST NOT**: Duplicate per-DmView IncomingCallBanner. The global
overlay is the single source of truth for incoming call UI. An earlier
version had both a per-DmView `IncomingCallBanner` and the global
overlay — the banner was removed as part of DM call lifecycle cleanup.
Re-adding a per-scope banner would cause visual duplication and state
desync.

### Screenshare in DM Calls

Screenshare is available in DM calls. The in-call controls show a screenshare
button when the user is in the DM call. DM screenshares use LiveKit room name
`ss:dm:{direct_id}` (see overview.md Invariant I). See `50-screenshare.md`
for full screenshare behavior.

### Camera in DM Calls

Identical to group room calls. Global Invariant E applies:

- Camera OFF by default.
- Clicking CAM while not in call: prompt to join call first (one-click confirmation per
  Invariant E), then enable camera.
- Camera failure: show error, audio continues.

## 40.9 DM Call Leave = End

In DM calls, leaving the call ends it for both participants. When a
participant leaves a DM call (`participant_left` webhook), the server
deletes the LiveKit room. This triggers a `room_finished` webhook which
broadcasts `call.ended` to both participants.

Rationale: A 1-on-1 call with only one person is pointless. Leaving
always ends the DM call.

**Implementation Note (Race Avoidance):** the server MUST call
`roomService.deleteRoom()` on `participant_left` for DM-scope rooms
**unconditionally**, without first checking the remaining participant
count via `listParticipants()`. The count check is an attractive but
broken optimization — LiveKit's participant list can race with the
webhook firing, producing false "0 participants" reads right as the
webhook arrives, which would cause the delete to be skipped in cases
where it should fire. Unconditional delete on DM `participant_left`
is idempotent (a second delete is a no-op) and race-safe. Group room
calls are handled separately via `empty_timeout: 60` in
`livekit.yaml` and do NOT need unconditional delete.

### Group Room Calls -- No "End Call for All"

Group room calls have `[ LEAVE ]` only. There is no "End Call for All"
button in the UI. Each user leaves individually. The call ends
automatically when the last participant leaves (LiveKit `empty_timeout: 60s`).

Admin can force-end any call via the Admin Console (see `80-admin.md` 80.6).

## 40.10 Audio Implementation Details (Normative)

### Remote Audio Playback — Explicit `track.attach()` (Normative)

**Current approach**: Use `RoomEvent.TrackSubscribed` to explicitly attach
remote audio tracks to HTMLAudioElements appended to `document.body`.
NOT `webAudioMix`.

```ts
room = new Room({
  adaptiveStream: true,
  dynacast: true,
  // NO webAudioMix — we handle playback explicitly
});

room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
  if (track.kind === Track.Kind.Audio && participant.identity !== user.id) {
    const el = track.attach();
    el.id = `lk-audio-${participant.identity}`;
    document.body.appendChild(el);
  }
});

room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
  if (track.kind === Track.Kind.Audio) {
    track.detach().forEach((el) => el.remove());
  }
});
```

**Rationale** (incident history):

An earlier version used `webAudioMix: true` to route remote audio through
the Web Audio API, supposedly bypassing browser autoplay policies. In
practice this was unreliable:

1. After the async token fetch + `room.connect()` sequence, the
   user-gesture context expired, leaving the Room's internal AudioContext
   in `suspended` state.
2. Calling `room.startAudio()` after connect to resume it worked
   inconsistently — sometimes AudioContext remained suspended, producing
   silent remote audio (speaking indicators worked, but no sound).
3. Debugging cost multiple sessions across two weeks.

The current approach (explicit `track.attach()` + `<audio>` elements on
`document.body`) is the simplest reliable LiveKit audio playback path —
no AudioContext, no Web Audio API, just HTMLAudioElement browser
autoplay. If this doesn't produce sound, the issue is in WebRTC transport,
not playback (measurable via LiveKit stats).

**Constraint (MUST NOT)**: Do NOT re-add `webAudioMix: true`. The
`<audio>` element approach is load-bearing for reliable cross-browser
audio playback. If someone wants to experiment with Web Audio API
routing again (e.g. for mixing multiple streams into one GainNode),
do it as an explicit add-on, NOT by flipping `webAudioMix` back on —
which would leave the explicit attach in place and cause **double
audio** (every remote participant heard twice).

**Cleanup**: The `TrackUnsubscribed` handler detaches and removes the
`<audio>` elements. On full disconnect, the track.detach() is sufficient
— no manual DOM sweep needed.

### Local Microphone: GainNode Pipeline (Normative)

Local microphone still uses the GainNode pipeline from 70-audio-settings
§70.3 for input gain control. This is unchanged by the webAudioMix
removal — the GainNode pipeline applies to the LOCAL microphone track
only, not remote audio playback.

Signal chain (unchanged):
```
createLocalAudioTrack({ deviceId, noiseSuppression })  // LiveKit
  -> LocalAudioTrack.mediaStreamTrack
  -> AudioContext.createMediaStreamSource
  -> GainNode (gain.value = storedGain / 100)
  -> AudioContext.createMediaStreamDestination
  -> destination.stream.getAudioTracks()[0] = processedTrack
  -> room.localParticipant.publishTrack(processedTrack, { source: Microphone })
```

**Note**: the track source is LiveKit's `createLocalAudioTrack` rather
than raw `getUserMedia`. This gives us LiveKit's default echo
cancellation and lets the Audio Settings `noiseSuppression` toggle
take effect at track-creation time. The resulting `MediaStreamTrack`
then flows through the custom GainNode pipeline for input-gain
control.

The GainNode pipeline's AudioContext is created explicitly in
`CallProvider`. It does NOT interfere with remote audio playback since
remote audio bypasses Web Audio API entirely (via `<audio>` elements).

### GainNode Fallback Mode (Degraded, Normative)

The GainNode pipeline setup can fail under edge cases:

- `AudioContext` creation refused (browser policy, user-gesture expired
  after async token fetch + `room.connect()` sequence)
- `getUserMedia` failure inside the pipeline wrapper path (permissions
  flap, device seized by another app between permission grant and track
  creation)
- WebAudio API unsupported (very old browsers — not a real target, but
  the fallback catches it anyway)

When the pipeline setup throws, the call MUST NOT fail. Instead, the
client MUST fall back to LiveKit's built-in
`room.localParticipant.setMicrophoneEnabled(true)` path — which creates
a working microphone track bypassing the GainNode.

**Consequences of the fallback mode** (observable degradation):

- Audio works — the user can speak and be heard.
- **Input gain slider has NO EFFECT** — the GainNode is not in the
  signal chain, so the Audio Settings "Input Gain" slider changes
  nothing for the current call session.
- `gainPipelineRef.current` is `null` in this mode. State-dependent code
  (e.g. future input-gain UI indicators) can detect fallback mode by
  checking this ref.

**Error surfacing (MUST)**: the fallback MUST log a
`console.error('[Call] GainNode pipeline setup failed — falling back...')`
with the original error, followed by a
`console.warn('[Call] Mic active via fallback path (no GainNode, no
input-gain control)')`. Silent degradation is forbidden — the user or
diagnostician MUST be able to see the fallback in DevTools.

**Recovery**: the fallback persists for the current call session. A
rejoin (leave + rejoin the call) creates a fresh GainNode pipeline and
exits the fallback mode.

**Spec-level note**: this is a documented degradation path, not an
intended mode. If the pipeline setup becomes reliable across all
browsers/contexts, the fallback branch should be removed. Until then,
"better mic than no mic" is the accepted trade-off.

### Output Device Routing (Normative)

When the user has selected a specific audio output device (speaker/headset)
via Audio Settings, the client MUST route remote call audio to that device
by calling LiveKit's `room.switchActiveDevice('audiooutput', deviceId)` after
the room connects successfully. This applies the selection to the
HTMLAudioElements attached via `track.attach()` (see above).

```ts
// After room.connect() resolves:
if (mediaSettings.audioOutputDeviceId) {
  try {
    await room.switchActiveDevice('audiooutput', mediaSettings.audioOutputDeviceId);
  } catch {
    // Fall back to browser default silently — selected device may have been
    // unplugged, and we must not crash the call for a device-routing error.
  }
}
```

**Failure handling**: `switchActiveDevice` failure (device disappeared,
permission revoked, etc.) MUST fall back to the browser default silently.
A call-breaking error here would be worse than losing the output selection.

**Scope**: only `audiooutput` is routed via this API. Microphone input
device is selected earlier via `getUserMedia({ audio: { deviceId } })` in
the GainNode pipeline setup (see §70.3). Video camera device is selected
via `setCameraEnabled({ deviceId })` (see §40.6 Camera toggle).

### Microphone Track Publishing

The microphone track is published with `source: Track.Source.Microphone`
so LiveKit correctly associates it for mute/unmute operations:
```ts
room.localParticipant.publishTrack(processedTrack, {
  source: Track.Source.Microphone,
});
```

### Mute/Unmute

Mute/unmute uses the `LocalTrackPublication.mute()` / `.unmute()` API
directly, NOT `setMicrophoneEnabled()`. The latter would create a new
track, bypassing the GainNode pipeline.

```ts
const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
if (micPub) {
  newMuted ? await micPub.mute() : await micPub.unmute();
}
```

### Mute/Camera/Blur Toggle Guards (Normative)

`toggleMute`, `toggleCamera`, AND `toggleBlur` MUST each use a
ref-based guard (`isMutingRef` / `isTogglingCameraRef` /
`isTogglingBlurRef`) to prevent concurrent execution.
Without these guards, rapid double-clicks can cause:
- Double-publish of tracks (two microphone or camera tracks)
- State inconsistency between UI and actual track state
- Race conditions where the second toggle reads stale state

Pattern:
```ts
const isMutingRef = useRef(false);
const toggleMute = async () => {
  if (isMutingRef.current) return;
  isMutingRef.current = true;
  try {
    // ... mute/unmute logic
  } finally {
    isMutingRef.current = false;
  }
};
```

The same pattern applies to `toggleCamera` (with `isTogglingCameraRef`)
and `toggleBlur` (with `isTogglingBlurRef`). `toggleBlur` additionally
MUST revert `localStorage['video.backgroundBlur']` + React state on
`setProcessor` failure — state and persisted setting must not diverge
(CGL-012).

Additionally, mute state MUST be read from the actual track publication
state (not from a closure variable) to avoid stale-closure bugs:
```ts
const currentlyMuted = micPub?.isMuted ?? true;
```

### Cleanup Deduplication (Normative)

Call cleanup (room disconnect, track stop, state reset) can be triggered
from multiple sources simultaneously: WebSocket `call.ended` event,
LiveKit `Disconnected` event, and explicit leave. To prevent double-cleanup
(which causes state update errors and potential double WS notifications),
cleanup MUST use an `isCleaningUpRef` guard:

```ts
const isCleaningUpRef = useRef(false);
const cleanup = () => {
  if (isCleaningUpRef.current) return;
  isCleaningUpRef.current = true;
  // ... cleanup logic
  queueMicrotask(() => { isCleaningUpRef.current = false; });
};
```

The `queueMicrotask` reset ensures the guard is released after the current
microtask completes, preventing permanent lockout while still deduplicating
concurrent calls within the same event loop turn.

### Speaking Map Cleanup (Normative)

When a `call.left` WS event is received, the leaving user's entry MUST be
removed from `speakingMap`. Without this cleanup, a user who was speaking
when they left would continue showing the speaking glow indicator
indefinitely.

### Room Ref Timing (Normative)

The `roomRef` (used by WS event handlers to access the LiveKit Room
instance) MUST only be set AFTER `room.connect()` resolves successfully.
Setting it before connect means WS handlers could attempt to operate on
a room that hasn't finished connecting, causing undefined behavior.

### LiveKit Service Client Centralization

The server uses a shared LiveKit configuration module (`lib/livekit.ts`)
that exports `roomService` (RoomServiceClient), `webhookReceiver`
(WebhookReceiver), and credential constants. Both `admin.ts` and
`livekit.ts` routes import from this module. This prevents configuration
drift and ensures the production guard (env var validation) runs exactly
once.

<!-- DIM-Map §40.10 Audio Implementation
  Completeness:        ✓ (explicit track.attach, incident history, webAudioMix MUST NOT, GainNode separation, output-device routing via switchActiveDevice, mute guards, cleanup dedup)
  Konsistenz:          ✓ (references 70-audio-settings GainNode pipeline, consistent with 40.5 speaking)
  Implementierbarkeit: ✓ (code examples for TrackSubscribed/Unsubscribed, switchActiveDevice, mute ref pattern, cleanup ref pattern)
  Interface-Vertraege: ✓ (Room constructor options, RoomEvent names, Track.Kind enum, LocalTrackPublication API, Room.switchActiveDevice signature)
  Abhaengigkeiten:     ✓ (livekit-client Room/RoomEvent/Track, HTMLAudioElement, document.body DOM, mediaSettings store)
-->

<!-- DIM-Map §40.8 DM Calls (Ring Timeout 30s + Decline Flow + No Duplicate Banner + Browser Notification + Suppression)
  Completeness:        ✓ (both-sides auto-decline at 30s, full decline WS flow with dm.call.declined server event, Browser Notification, client-side suppression, MUST NOT banner duplication)
  Konsistenz:          ✓ (cross-refs to 40.9 DM Call Leave=End for room-deletion mechanism, 25-websocket for event catalog)
  Implementierbarkeit: ✓ (dm.call.decline / dm.call.declined WS events specified with exact payloads, server steps 1-5 + 1a enumerated, Notification API permission flow)
  Interface-Vertraege: ✓ (dm.call.decline payload: { directId, callerId }, dm.call.declined payload: { directId, declinedBy }, Notification constructor signature)
  Abhaengigkeiten:     ✓ (RoomServiceClient.deleteRoom, room_finished webhook, call.ended broadcast, sendToUser targeted send, Notification.requestPermission)
-->

<!-- DIM-Map §40.6 In-Call UI (Connection Quality + Reconnecting + Camera Resolution + Blur Control)
  Completeness:        ✓ (all controls listed, quality indicator states, reconnecting/reconnected transitions, 1080p VideoPresets, Blur control with cross-ref)
  Konsistenz:          ✓ (cross-refs to 45-video §45.7 for blur detail, 40.12 for reconnect mechanism, 50-screenshare for screenshare button)
  Implementierbarkeit: ✓ (RoomEvent.ConnectionQualityChanged / Reconnecting / Reconnected wiring shown, VideoPresets.h1080.resolution named)
  Interface-Vertraege: ✓ (LiveKit RoomEvent enum, ConnectionQuality enum, ConnectionState enum, VideoPresets object from livekit-client)
  Abhaengigkeiten:     ✓ (livekit-client RoomEvent/ConnectionQuality/VideoPresets, CallProvider ConnectionState, CallControls component)
-->

## 40.11 Call Disconnect Cleanup

### Participant Disconnect

When a participant's LiveKit connection drops (ungraceful close, network loss):
- LiveKit participant timeout: 30 seconds (configurable in `livekit.yaml`)
- After timeout: participant is removed from the LiveKit room
- Server broadcasts `call.left` for the disconnected user

### Empty Call Cleanup

- `livekit.yaml` config: `empty_timeout: 60` (seconds)
- When the last participant leaves or disconnects, LiveKit waits 60 seconds
  before destroying the room
- If a participant reconnects within that window, the call continues
- After timeout: room is destroyed, server broadcasts `call.ended`
- This prevents "ghost calls" that appear active but have no participants

### DM Call Disconnect

When the initiator of a DM call disconnects while in waiting state:
- Other participant's incoming call banner disappears
- Call state returns to idle

## 40.12 Call Connection Resilience (Normative)

Lessons learned from production deployment on a multi-interface server.

### Client Connection Settings

- `peerConnectionTimeout: 30000` (30s, increased from default 15s). On servers
  with many network interfaces, ICE candidate gathering takes longer. The default
  15s timeout caused premature connection failures.
- Automatic retry with 1s delay on connect failure (single retry). If the first
  `room.connect()` fails, wait 1s and retry once before reporting failure.

### joinCall Return Type

`joinCall` returns `{ ok: boolean, reason?: JoinCallFailReason }`
instead of bare boolean. The reason enum is:

```ts
type JoinCallFailReason =
  | 'already_in_call'   // concurrent active call; map to multi-call constraint UI (§40.8)
  | 'connecting'        // guard against re-entrant join during in-flight connect
  | 'offline'           // presence check failed (user not online per WS presence)
  | 'token_failed'      // HTTP error from POST /api/livekit/token
  | 'connect_failed';   // room.connect() threw (LiveKit SFU unreachable / ICE failure)
```

UI strings (from `CallControls.reasonToMessage`):

| Reason | User-visible message |
|--------|---------------------|
| `already_in_call` | `Leave current call first.` + `[ GO TO CALL ]` link |
| `connecting` | `Already connecting.` |
| `offline` | `User is offline.` |
| `token_failed` | `Could not start call (token). Try again.` |
| `connect_failed` | `Could not connect to call. Try again.` |

### AudioContext Unlock

The app registers a click/keydown listener on mount to call `ensureAudioContext()`
on first user interaction. This ensures notification sounds and call ringtones
work even before any explicit audio action. Without this, browsers may keep the
AudioContext suspended until a user gesture occurs in audio-related code.

### Auto-Reconnect State Machine (Normative)

LiveKit's built-in reconnection is the primary mechanism for surviving
transient WebSocket/ICE failures. The client MUST surface the reconnect
state to the UI via the `RoomEvent.Reconnecting` and `RoomEvent.Reconnected`
events — the CallControls Connection Quality Indicator (§40.6) is the
UI binding for these states.

**Mechanism:**

1. LiveKit detects WS or ICE disconnect → fires `Reconnecting` event.
2. Client flips `ConnectionState.Reconnecting`, CallControls shows the
   red pulsing `"Reconnecting..."` indicator.
3. LiveKit retries internally (backoff controlled by LiveKit client,
   up to its own limit).
4. On success: LiveKit fires `Reconnected` → client flips back to
   `ConnectionState.Connected`, indicator shows `"Reconnected"` transient
   for ~2s, then idles to the quality dot.
5. On permanent failure (LiveKit's retry budget exhausted): LiveKit fires
   `Disconnected` with a reason; client triggers the standard cleanup
   flow (§40.11) and the UI returns to the idle "not in call" state.

The client does NOT implement its own reconnection loop for the LiveKit
room — LiveKit handles that. The client's responsibility is state surfacing
and cleanup on terminal failure.

**WebSocket (app-level) vs LiveKit Reconnection**: these are two separate
resilience systems operating in parallel. The app's WebSocket (chat/presence,
see §25-websocket) has its own exponential-backoff reconnect logic
(`1s → 30s`). The LiveKit room has its own reconnect. Either can be in
`Reconnecting` state independently; the UI indicator in CallControls
reflects LiveKit-room state only. A broken app-WS does not show in the
call UI — it surfaces via the global connection banner (see §25-websocket).

### ICE on Multi-Interface Hosts (Normative)

On servers with many network interfaces (Docker bridges, Tailscale, WireGuard,
veth pairs), LiveKit's Pion UDP mux can fail for concurrent participants. The
production `livekit.yaml` MUST filter interfaces to only the public NIC
(`interfaces.includes: [eth0]`) and restrict IPs to the public IPv4
(`ips.includes: [PUBLIC_IP/32]`). TCP fallback port (7881) is also configured
for cases where UDP mux still fails.

Without interface filtering, Pion attempts to bind on all ~35 interfaces,
causing port exhaustion and ICE failures for the second concurrent participant.

## 40.13 Mute Participant (Remote)

### Overview

An authenticated user can mute another participant's microphone in a call.

### API Endpoint

```
POST /api/livekit/mute-participant
  Auth: [requireAuth]
  Body: { roomName: string, userId: string, muted: boolean }
  Response: { data: { ok: true } }
```

### Authorization Rules (Normative — Server-Enforced)

The server MUST enforce the following checks before executing the mute,
in this order:

1. **Authenticated session**: `requireAuth` middleware ensures the
   caller has a valid session. Without auth, `401`.

2. **Valid room name**: `parseRoomName(roomName)` must return a parsed
   scope. Invalid names → `400 INVALID_ROOM_NAME`.

3. **Same-room enforcement**: the server calls `listParticipants(roomName)`
   and verifies that the authenticated caller's `userId` is present in
   the participant list. If the caller is NOT in the LiveKit room:
   `403 NOT_IN_ROOM — "Caller must be in the same call to mute
   participants"`.

4. **Target present**: the requested target `userId` must also be in the
   same `listParticipants(roomName)` result. Otherwise `404 NOT_FOUND
   — "Participant not in room"`.

5. **Mute action**: find the target's Microphone track (`source === 1`)
   and call LiveKit `RoomServiceClient.mutePublishedTrack()` with the
   requested boolean.

The same-room enforcement closes an earlier authorization gap where any
authenticated user could mute any other user in any call by guessing
the LiveKit room name (trivial since the pattern is predictable).

### UI

Available via the participant context menu (opened by right-click /
long-press on a participant avatar in `CallParticipantsStrip`). The
menu shows two items:

1. **Direct message** — navigates to a DM with that user (Lucide
   `MessageSquare` icon, see 05-icons.md §05.4).
2. **Mute user** / **Unmute user** — toggles the target's microphone
   via `POST /api/livekit/mute-participant`; label depends on the
   target's current mute state (Lucide `UserX` / `User` icons).

## 40.14 GET /api/rooms/:roomId/members

### Overview

Returns the members of a room. Used by the ActiveUsersStrip to filter
displayed users to only those who have joined the room.

```
GET /api/rooms/:roomId/members
  Auth: [requireAuth]
  Response: { data: { members: [{ userId, membershipState, joinedAt }] } }
```

This ensures the ActiveUsersStrip shows only joined members, not all online users.

### Acceptance Criteria (Calls)

- [ ] Call button visible in DM header for both participants
- [ ] DM call to offline user is prevented with "User is offline." error
- [ ] Incoming call overlay appears globally (fixed position, any view)
- [ ] Incoming call ring sound plays continuously until resolved
- [ ] Incoming call indicator appears on user entry in sidebar
- [ ] In-call controls: Mute, Camera, Leave, Screenshare (room + DM)
- [ ] Cannot join a second call while already in one (error message shown)
- [ ] WS events use unified scope `{ type: 'direct' | 'room', id }`
- [ ] DM call leave = end (server deletes LiveKit room)
- [ ] Leaving call stops own active screenshare
- [ ] Ghost calls are cleaned up after 60s empty timeout
- [ ] Disconnected participants are removed after 30s LiveKit timeout
- [ ] LiveKit room names follow patterns in overview.md Invariant I
- [ ] Remote audio uses explicit `track.attach()` in TrackSubscribed handler; webAudioMix is NOT set
- [ ] TrackUnsubscribed handler detaches and removes `<audio>` elements
- [ ] Only non-local audio tracks are attached (filter `participant.identity !== user.id`)
- [ ] Local microphone uses GainNode pipeline for input gain (70-audio-settings §70.3)
- [ ] GainNode pipeline setup failure falls back to `setMicrophoneEnabled(true)` with explicit console.error + console.warn (degradation mode)
- [ ] Speaking state (`call.speaking`) wire format is per-user: `{ scope, userId, isSpeaking }` with server-injected userId
- [ ] Server MUST overwrite/inject `userId` from session before broadcasting `call.speaking` (spoofing prevention)
- [ ] `call.speaking` broadcast is scope-aware: room scope → global, DM scope → only the 2 participants
- [ ] Sender is excluded from its own `call.speaking` echo
- [ ] Client only sends `call.speaking` on LOCAL speaking state transitions (not on every LiveKit event)
- [ ] DM ring timeout is 30 seconds (both caller and callee auto-leave)
- [ ] DM decline sends `dm.call.decline` WS event with payload `{ directId, callerId }` (NOT `{ directConversationId }`); server sends `dm.call.declined` with `{ directId, declinedBy }` to caller; server deletes LiveKit room; caller receives `call.ended`
- [ ] Server sends `dm.call.declined` (S→C) to caller as explicit decline notification, distinct from the subsequent `call.ended` broadcast
- [ ] No per-DmView IncomingCallBanner — only global IncomingCallOverlay
- [ ] Browser Notification (`Notification` API) fires on `dm.call.incoming` when page is not focused; permission requested lazily on first incoming call
- [ ] Server sends `dm.call.incoming` unconditionally; client suppresses overlay if already in another call (suppression is client-side, not server-side)
- [ ] DM call room deletion on `participant_left` webhook is unconditional (no `listParticipants()` pre-check) to avoid race with LiveKit participant list updates
- [ ] Call connection uses 30s peer connection timeout
- [ ] joinCall returns { ok, reason } for differentiated error handling
- [ ] CallControls shows Connection Quality Indicator with states: Excellent/Good (green), Poor (yellow), Reconnecting (red pulsing + "Reconnecting..."), Reconnected (transient "Reconnected" ~2s), Disconnected (red + "Disconnected")
- [ ] Reconnect state machine wires `RoomEvent.Reconnecting` → `ConnectionState.Reconnecting` and `RoomEvent.Reconnected` → `ConnectionState.Connected` with transient "Reconnected" UI surfacing
- [ ] Client does NOT implement its own LiveKit reconnect loop — LiveKit handles reconnection; client only surfaces state and triggers cleanup on permanent failure
- [ ] `toggleCamera` passes stored `videoCameraDeviceId` to `setCameraEnabled` on re-enable (preserves user device choice across off/on toggles)
- [ ] Camera enable (both join-with-camera and toggle-on) uses `VideoPresets.h1080.resolution` — 1080p target with LiveKit simulcast adaptation
- [ ] Audio output device routing: after `room.connect()` resolves, client calls `room.switchActiveDevice('audiooutput', storedDeviceId)` if a non-default output device is selected; failure falls back to browser default silently
- [ ] Remote mute: server-side enforces caller in same LiveKit room (`listParticipants()` check), returns `403 NOT_IN_ROOM` if not
- [ ] `[ BLUR ]` button rendered in CallControls when camera is enabled; full Blur behavior spec lives in `45-video.md §45.7` (single source of truth — `40-voice` only describes control presence)
- [ ] Remote mute available via participant context menu
