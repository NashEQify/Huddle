intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Audio/video device configuration and the settings overlay tab system
  action: Defines persistent audio controls, settings tab navigation (Profile, Audio/Video, Color Theme, Admin), microphone/speaker device selection, gain pipeline, noise suppression, voice test with level meter, camera preview, device persistence, useMediaSettings hook, and settings overlay behavior

| | |
|---|---|
| **Layer** | Frontend |
| **Status** | aktuell |
| **spec_version** | 1.4.1 |
| **Konsumiert** | overview, 40-voice, 45-video, 75-user-settings, 80-admin |
| **Last Update** | 2026-04-24 — post-B-2 user-decision sync for 3 findings: §70.5 Noise Suppression keyboard amended to "Space OR Enter" (F-CSD-7006, spec-follows-code); §70.6 VoiceTest error variants restored to 4-variant mapping with user-friendly strings (NotAllowedError/NotFoundError/NotReadableError/default) — reverts B-2's option (a); paired code fix in `VoiceTest.tsx` to match (F-CSD-7007, code-follows-spec); §70.6 Loopback failure section normalized to code reality — `"loopback failed -- browser may block audio playback"` + `loopbackEnabled` reset to OFF on failure (no auto-retry) (F-CSD-7008, spec-follows-code). Earlier 2026-04-24 — retroactive drift-sync (Phase B B-2, 11 findings applied): §70.2 corrected to page-route (not overlay modal) — ESC-close not wired (F-CSD-7001); §70.2a background device fetch now conditionally includes `video: true` when camera permission is already `'granted'` (iOS enumeration fix, commit 81ab4e5) — "Why Audio-First / Conditionally Video" rewrite (F-CSD-7002); positional-fallback wording corrected to `{kind} {deviceId.slice(0,8)}` everywhere (F-CSD-7003); §70.3 new "GainNode Pipeline Failure Fallback" subsection (CGL-006) (F-CSD-7004); §70.4 Speaker fallback label documented (F-CSD-7005); §70.6 VoiceTest error-variant mapping aligned with code — only `NotAllowedError` is mapped, others use `err.message` verbatim (CGB-7001 noted) (F-CSD-7007); §70.7 new "iOS Camera Constraint Mapping" subsection — `buildCameraConstraints` with desktop/mobile branching (F-CSD-7009) — cross-ref 45-video §45.6; §70.7a rewritten end-to-end to reflect T14 migration (F-CSD-7012/7013/7014/7015): Subsection 1 now documents Firefox `about:config` + Brave Shields paragraphs (no checklist); Subsection 2 now documents inline heredoc clipboard recipe (no `curl` one-liner, no `[ COPIED ]` feedback); Subsection 3 now static text (no `ms-settings:sound` button); OS gating removed. §70.8 step 4 now uses `buildCameraConstraints` + `VideoPresets.h1080.resolution` (F-CSD-7016). History: 2026-04-11 — Batch 1 T-004 + Blur Delta + Phase A catchup. |
| **Earlier Updates** | 2026-04-10 — VoiceTest: AudioContext.resume on startTest (level meter works on Chrome/Brave), Loopback checkbox interactive when test idle (preference persists), CameraPreview: device-restart effect state-driven with `runningDeviceIdRef` anti-loop guard (no stale closures), AudioVideoSettings: NotAllowedError-specific catch |

## Was diese Spec beschreibt

This spec covers the Audio/Video Settings tab and the overall settings overlay structure. The settings overlay contains four tabs: Profile, Audio/Video, Color Theme, and Admin (admin-only). The Audio/Video tab provides microphone and speaker device selection, input gain with a GainNode pipeline, noise suppression toggle, a voice test with level meter and loopback, camera device selection with live preview, and a mirror self-view toggle. All device preferences are persisted in localStorage via the `useMediaSettings` hook and applied when joining calls.

---

# 70. Audio/Video Settings (Normative)

Covers the Audio/Video Settings tab in the Settings overlay and the persistent
audio controls visible during calls.

## 70.1 Persistent Audio Controls (Always Visible)

- Self mute toggle
- Output mute toggle
- Master volume slider
- Per-user volume control

Per-user volume:
- Local only
- Persistent per client (localStorage)
- Not stored server-side

> 70.1 is partially implemented in CallControls (mute toggle). Master volume
> slider, output mute, and per-user volume are future work.

---

## 70.2 Settings Page -- Tab Navigation

Settings render as a **full-page view** at a dedicated route
(`/settings/{tab}`). The previous view is replaced (not overlaid); tab
state is persisted in the URL and navigation to `/settings/<tab>`
opens the matching tab. There is no backdrop, no overlay modal, and
ESC is NOT wired as a global close key — users return to the previous
view via the sidebar or browser back navigation. Earlier spec
revisions described an overlay modal with ESC-close — that UX was
never shipped; the page-route layout is the normative UX.

The Settings overlay has tab navigation:

```
[ PROFILE ]  [ AUDIO / VIDEO ]  [ COLOR THEME ]  [ ADMIN ]
```

- **PROFILE** tab: existing content (Avatar, Title, Email, Password, Quote).
  **Layout preserved as-is**: two-column grid, max-width 900px. No changes
  to Profile tab layout or content.
- **AUDIO / VIDEO** tab: new content (sections 70.3-70.8).
- **COLOR THEME** tab: color scheme selection (see `75-user-settings.md` Section 75.7).
- **ADMIN** tab: visible only for admin users (`user.isAdmin === true`).
  Uses `var(--warning)` color for its tab label text and border to visually
  distinguish it from other settings tabs. Content defined in `80-admin.md`.
- Default tab on settings open: PROFILE.
- Tab state is persisted in the URL (`/settings/profile`, `/settings/audio-video`,
  `/settings/appearance`, `/settings/admin`).
  Navigating directly to a URL opens the corresponding tab.

### Tab Styling

Tabs rendered as a horizontal bar above the content area.

```
Active tab:   borderBottom: '2px solid var(--accent)', color: 'var(--accent)'
Inactive tab: borderBottom: '2px solid transparent', color: 'var(--text-secondary)'
Hover:        color: 'var(--text-primary)', borderBottom unchanged
```

All other borders: none. No background change between states. No padding change
between states (prevents layout shift). `borderRadius: 0`.

ARIA: container `role="tablist"`, each tab `role="tab"` + `aria-selected`.
Tab panels: `role="tabpanel"` + `aria-labelledby`.

### Audio/Video Tab Layout

Single column, max-width 600px, centered within the content area.
Sections use HexLabel pattern consistent with Profile tab:

| Section | Hex Code | Label |
|---------|----------|-------|
| Microphone | `0xB0` | `MICROPHONE` |
| Output | `0xB1` | `OUTPUT` |
| Noise Suppression | `0xB2` | `NOISE SUPPRESSION` |
| Voice Test | `0xB3` | `VOICE TEST` |
| Camera | `0xB4` | `CAMERA` |
| Troubleshooting | `0xB5` | `TROUBLESHOOTING` |

---

## 70.2a Device Selection Architecture (Normative)

The Audio/Video Settings tab uses an **instant-render architecture**: the page
renders on first paint without waiting for media permissions. Device dropdowns
populate with labels once permission is granted; until then they show unlabeled
entries using the deviceId-slice fallback (`Microphone {deviceId.slice(0,8)}`
etc.).

### Instant Render Rule

All three device selection hooks (`useMediaDeviceSelect` for `audioinput`,
`audiooutput`, `videoinput`) MUST be instantiated with `requestPermissions: false`.
This guarantees:

- The Audio/Video tab reaches first paint in milliseconds (no permission prompt
  blocks the UI).
- Tab navigation and section structure are visible immediately.
- Dropdowns are present and interactive; labels arrive asynchronously via the
  background fetch below.

Rationale: setting `requestPermissions: true` causes LiveKit's DeviceManager to
invoke `getUserMedia` inside the hook, which can hang on Brave (Shields block)
or trigger browser prompts while the user is still orienting. Both behaviors
block the settings page visibly and are unacceptable.

### Background Label Fetch

On component mount (`AudioVideoSettings`), a `useEffect` runs one pass of the
following, gated by `if (isInCall) return;`:

1. Call `navigator.mediaDevices.enumerateDevices()`.
2. Check whether any `audioinput` device has a non-empty `label`. If yes:
   permission was previously granted, labels are already cached, stop here.
3. If all audioinput labels are empty (first visit or permission revoked):
   a. Call `navigator.mediaDevices.getUserMedia({ audio: true })` — **audio only**,
      NOT video.
   b. Race the call against a **4 second timeout** (Brave Shields can hang
      `getUserMedia` silently).
   c. On success: immediately `stop()` all tracks in the returned stream.
   d. Dispatch a synthetic devicechange event:
      `navigator.mediaDevices.dispatchEvent(new Event('devicechange'))`.
4. The effect captures a `cancelled` flag and checks it before every state
   update; on unmount the cleanup sets `cancelled = true` and any pending
   promise is a no-op on resolution.

### Why Audio-First / Conditionally Video

Audio permission alone unlocks labels for **all** device kinds
(`audioinput`, `audiooutput`, `videoinput`) on Chromium, Firefox, and
Safari-desktop. The background fetch therefore defaults to
`{ audio: true }`.

**iOS Safari exception (commit `81ab4e5`)**: WebKit does NOT enumerate
camera devices until `getUserMedia({ video })` has been called at
least once in the session. Without a prior video call, the Settings
camera picker stays empty on iPad/iPhone even when camera permission
is granted. So the background fetch first queries
`navigator.permissions.query({ name: 'camera' })`; if the result is
`'granted'` (user granted camera permission in a previous session),
the constraints become `{ audio: true, video: true }` and the
resulting video track is immediately stopped.

**Invariant E compliance**: `video: true` is only added when camera
permission is ALREADY `'granted'` — the background fetch cannot by
itself trigger a new camera permission prompt. Camera exposure still
requires deliberate consent (the original grant was obtained via a
user-initiated camera action like joining a call with camera).

### Why Synthetic devicechange

LiveKit's `useMediaDeviceSelect` hook subscribes to
`navigator.mediaDevices.ondevicechange`. After the background fetch grants audio
permission, `enumerateDevices()` would now return labels — but LiveKit's hook
has cached the earlier unlabeled result and will not re-enumerate until it sees
a `devicechange` event. Dispatching a synthetic event triggers all three hooks
to re-query and surface the newly-available labels.

### In-Call Gate

The background fetch effect is skipped during active calls (`if (isInCall)
return;`). During a call the microphone is already captured and labels are
already resolved (the active audio track implicitly holds a permission grant).
Re-fetching would be a no-op at best and a redundant prompt at worst.

### Failure Tolerance

If the background fetch fails or times out:

- Timeout (4s): silently abandon. The user sees unlabeled devices. They can
  still select devices by position; selection persists.
- `NotAllowedError` (permission denied): set `micPermissionDenied` state. The
  microphone section shows the denial message from Failure Modes. Other sections
  (speaker, camera) still render and remain selectable.
- Other errors (e.g. `NotFoundError`): silently abandon. Logged to console for
  debugging.

The settings page MUST remain functional even when the background fetch fails.

---

## 70.3 Input Device (Microphone)

- Dropdown select listing all available `audioinput` devices.
- Use LiveKit `useMediaDeviceSelect({ kind: 'audioinput', track, requestPermissions: false })`.
- The `track` parameter: pass the `LocalAudioTrack` from the voice test preview
  (if running) to get accurate `activeDeviceId`. When no preview track exists,
  `activeDeviceId` will be empty -- show stored `audio.inputDeviceId` from
  localStorage as the selected item instead.
- Show device label; if label unavailable (permissions not yet granted),
  show `"Microphone {device.deviceId.slice(0, 8)}"` — the literal string
  `"Microphone "` followed by the first 8 characters of the device ID
  (NOT a positional `"Microphone 1"` / `"Microphone 2"` numbering).
  This gives each unlabeled device a stable, unique fallback label that
  survives re-enumeration in deterministic order. The same pattern applies
  to camera device fallback labels: `"Camera {device.deviceId.slice(0, 8)}"`.
- Changing device: immediately persist to localStorage key `audio.inputDeviceId`.
  Applied on next call join (NOT mid-call).
- Default: browser default device ("Default" entry always first).
- **In-call note:** If user is currently in a call and changes a device setting,
  show inline note below the dropdown: `"applies on next call join"` in
  `var(--text-muted)`.

### Input Volume (Gain)

- Slider: 0% - 200%.
- Default: 100%.
- At >100%: show inline warning text below slider:
  `"gain >100% -- audio quality may degrade"` in `var(--warning)`.
- Slider track: `var(--bg-input)` background, `var(--accent)` filled portion.
- Slider thumb: `var(--accent)`, `borderRadius: 0` (square thumb).
- Current value displayed right of slider: `{value}%`.
- Value persisted in localStorage key `audio.inputGain`.
- **In-call note:** Same as device setting -- show `"applies on next call join"`
  when user is in an active call.

### GainNode Implementation (Normative)

The gain is applied via a Web Audio API pipeline. This pipeline is used in
two places: (1) the voice test preview, and (2) during calls.

**Signal chain:**

```
Raw MediaStreamTrack (from getUserMedia / LiveKit track)
  -> AudioContext.createMediaStreamSource(new MediaStream([rawTrack]))
  -> GainNode (gain.value = storedGain / 100)
  -> [tap: AnalyserNode for level meter -- connect as parallel output from GainNode]
  -> AudioContext.createMediaStreamDestination()
  -> destination.stream.getAudioTracks()[0] = processedTrack
```

**For call join:** Instead of `room.localParticipant.setMicrophoneEnabled(true)`,
use `createLocalAudioTrack(options)` from `livekit-client` to get the raw track,
then process it through the GainNode pipeline, then publish the processed track
via `room.localParticipant.publishTrack(processedTrack)`.

**For voice test preview:** Same pipeline. The AnalyserNode taps the GainNode
output (post-gain level). The loopback audio element plays the destination stream.

**Constraint:** MUST NOT set `GainNode.gain.value = 0` as a mute substitute.
Muting is handled by LiveKit track publication state (`setMicrophoneEnabled`),
not by the gain node.

**GainNode lifecycle:** The GainNode reference is stored as a ref in CallProvider
(for calls) or locally in the VoiceTest component (for preview). It is created
once at call-join / test-start and destroyed at call-leave / test-stop.

### GainNode Pipeline Failure Fallback (Normative)

If `createGainPipeline` or `AudioContext.resume()` throws during call
join, the call falls back to LiveKit's default
`setMicrophoneEnabled(true)` path. In this degraded mode:
- (a) the call still has audio;
- (b) the Input Gain slider has NO effect for the duration of the
  call (audio bypasses the GainNode);
- (c) the failure is logged via `console.error` with prefix
  `[Call] GainNode pipeline setup failed ...`.

The fallback is one-shot per call — the user must leave and rejoin to
retry the pipeline. Tracked as CGL-006.

---

## 70.4 Output Device (Speaker)

- Dropdown select listing all available `audiooutput` devices.
- Use `useMediaDeviceSelect({ kind: 'audiooutput', requestPermissions: false })`.
  This provides consistent API with input device selection.
- Fallback label: if `device.label` is empty, display
  `"Speaker {device.deviceId.slice(0, 8)}"` — same deviceId-slice
  pattern as Microphone / Camera (§70.3).
- If `setSinkId` is not supported on `HTMLAudioElement.prototype`, hide the
  **entire output section** (dropdown + volume slider + section header) and show:
  `"output device selection not supported in this browser"` as a single-line note
  in `var(--text-muted)`.
- Changing device: immediately persist to localStorage key `audio.outputDeviceId`.
  Applied on next call join via `room.switchActiveDevice('audiooutput', storedId)`
  after `room.connect()`.
- Default: browser default.
- **In-call note:** Same as input device.

### Output Volume

- Slider: 0% - 100%.
- Default: 100%.
- Slider styling: same as input volume slider.
- Current value displayed right of slider: `{value}%`.
- Value persisted in localStorage key `audio.outputVolume`.

**Output volume implementation:** The slider is shown and the value persists,
but it is only applied in the voice test loopback (see 70.6). Applying output
volume to remote participant audio during calls requires LiveKit internal audio
element access and is deferred to 70.1 (master volume slider).

Rationale: LiveKit manages remote audio elements internally. Setting `volume`
on those elements requires either DOM traversal or LiveKit-internal APIs that
are fragile. The voice test loopback element is locally created and trivially
controllable.

---

## 70.5 Noise Suppression

- **Control type**: ARIA switch (NOT a styled checkbox). The DOM element
  is a `<div role="switch">` with `aria-checked={value}` reflecting the
  current state. Click toggles. Keyboard: **Space OR Enter toggles** (Space
  is the strict WAI-ARIA switch pattern; Enter is also accepted for
  robustness, matching common user expectation). Screen readers announce
  as "switch, on/off".
- Label: `"Noise Suppression"`.
- Sublabel: `"Browser-based noise suppression for microphone input"`.
- Default: ON.
- Persisted in localStorage key `audio.noiseSuppression`.
- **In-call note:** Same as device settings.

Rationale for `role="switch"` instead of checkbox: this is a
binary on/off preference that takes effect immediately (within the
"applies on next call join" caveat for in-call), not a multi-select
or form-submission semantic. ARIA switch is the more accurate
semantic and gives screen readers cleaner announcement text.

Implementation: pass `noiseSuppression: true/false` in `AudioCaptureOptions`
when creating the audio track (both for voice test preview and call join).

---

## 70.6 Voice Test

Live microphone test with visual level meter and optional loopback.

### Components

1. **Start/Stop Button**
   - Idle: `[ START TEST ]` -- accent border, accent text.
   - Active: `[ STOP TEST ]` -- error border, error text.
   - Starting test requests microphone permission if not granted.

2. **Level Meter**
   - Horizontal bar, full width.
   - Three color zones (left to right):
     - Green (`var(--success)`): 0-40% of normalized RMS level.
     - Yellow (`var(--warning)`): 40-70%.
     - Red (`var(--error)`): 70-100%.
   - RMS is calculated from AnalyserNode `getByteTimeDomainData()`:
     `rms = sqrt(sum((sample/128 - 1)^2) / N)`, then normalized to 0.0-1.0
     (clamp at 1.0). The AnalyserNode taps the **GainNode output** (post-gain).
   - Current level shown as a filled bar from left.
   - Updates at ~20fps (`requestAnimationFrame` with 50ms throttle).

3. **Loopback Toggle**
   - Checkbox: `"Play audio back to speakers"`.
   - Default: OFF.
   - **Always interactive (NOT disabled when test is idle)**. The checkbox
     can be ticked before clicking `[ START TEST ]` — the preference is
     saved and applied automatically when the test starts. The per-state
     hint label reflects this:
     - Test running → `(use headphones)`
     - Test idle → `(will play when test starts)`
   - When the test is running AND loopback is ON: route the GainNode output
     (destination stream) to a local `<audio>` element. Set
     `audio.volume = storedOutputVolume / 100`. If output device is stored,
     call `audio.setSinkId(storedOutputDeviceId)`.
   - When the test is idle: no playback regardless of checkbox state
     (preference only).
   - Loopback volume explicitly reads `audio.outputVolume` from localStorage
     at the moment loopback is toggled ON. If the user changes the output
     volume slider while loopback is active, the gain pipeline output
     volume update is reflected live (the level meter and the loopback audio
     element react to the new gain value within the same audio frame).
     Same applies to the input gain slider during voice test: live updates,
     no restart required.
   - `stopTest` tears down the playback audio element but does NOT reset the
     `loopbackEnabled` preference — it persists across start/stop cycles so
     the user doesn't have to re-tick it each time they rerun the test.
   - **Loopback playback failure (Normative)**: if `audio.play()` rejects
     (autoplay policy edge case, user gesture expired, audio element
     refused), surface an inline error below the loopback checkbox:
     `"loopback failed -- browser may block audio playback"` in
     `var(--error)`. The `loopbackEnabled` preference is **reset to OFF**
     — no auto-retry. The user must re-tick the checkbox to retry, which
     is a fresh user-gesture and typically clears the autoplay block.
     Rationale: auto-retry without a user gesture is fragile in modern
     browsers; explicit re-consent is both clearer and more reliable.

### In-Call Disable + Notice Banner (Normative)

When the user is in an active call (`isInCall === true` from
`useCall().state.activeScope !== null`), BOTH the Voice Test AND the
Camera Preview MUST be disabled in Settings:

- **Voice Test**: the `[ START TEST ]` button is disabled (rendered with
  `disabled={true}`). Existing `[ STOP TEST ]` (if a test was running
  when the user joined a call) tears down per the Auto-stop triggers.
- **Camera Preview**: the `[ ENABLE PREVIEW ]` button is disabled. Active
  preview (if any) is auto-stopped when the user enters a call.
- **Notice banner** between §70.5 (Noise Suppression) and §70.6 (Voice
  Test) sections, visible only when `isInCall`, content:
  `"voice test and camera preview disabled during active call"` in
  `var(--text-muted)`, `font-size: var(--text-xs)`,
  `font-family: var(--font-mono)`, `padding: var(--space-2) 0`.

Rationale: the audio device is already in use by the call. Starting a
voice test would either fail with `NotReadableError` (device exclusive
on Linux PipeWire) or steal the call's audio. Camera preview has the
same conflict on cameras that don't allow concurrent capture. Disabling
the controls + showing a banner explains why the user can't use them.

Other Settings sections (device dropdowns, gain, noise-suppression
toggle) remain interactive — they just show the per-setting `"applies
on next call join"` `InCallNote` next to the changed control instead
of being globally disabled.

### Behavior

- **Start:** Create a local audio track. Use `createLocalAudioTrack()` from
  `livekit-client` (not `usePreviewTracks`) with stored device + noise
  suppression constraints. Then apply the GainNode pipeline from 70.3.
  Connect AnalyserNode for level meter.
  - **Start error variants (Normative)**: DOMException `name` is mapped
    to user-friendly strings, NOT surfaced as raw `err.message`:
    - `NotAllowedError` → `"microphone access denied -- check browser
      permissions"` (and sets `micDenied` state to disable the test
      button until permission is re-granted).
    - `NotFoundError` → `"no microphone found"`.
    - `NotReadableError` → `"microphone in use by another application"`.
    - Any other error → `"voice test failed: {err.name}"` (fallback to
      `"voice test failed: unknown error"` if name is empty).
    Rendered inline below the `[ START TEST ]` button in `var(--error)`.
    Earlier spec revisions mapped `NotFoundError` and `NotReadableError`
    to friendly strings ("no microphone found" / "microphone in use by
    another application") — the mapping was never wired in code; spec
    now documents as-is. Friendly-mapping is a future improvement
    (tracked as CGB-7001 in the drift report).
  - **AudioContext resume (Normative)**: The GainNode pipeline's
    `AudioContext` MUST be resumed immediately after creation —
    `if (audioContext.state === 'suspended') await audioContext.resume();`
    — inside `startTest`, BEFORE starting the level meter animation frame.
    Chrome and Brave create new AudioContexts in `suspended` state per
    autoplay policy. Without an explicit resume, the AnalyserNode does not
    process samples and the level meter stays flat, leading to the "my mic
    is broken" user confusion. The loopback toggle is NOT the right place
    to resume — the meter must work from the first Start click regardless
    of whether the user ever touches loopback.
  - If `loopbackEnabled` is already `true` when the test starts, the
    client MUST auto-activate the playback element (deferred by a
    `queueMicrotask` so the pipeline ref is fully set first).
- **Stop:** Disconnect the Web Audio graph, stop and release the audio track.
  Level meter returns to zero. Loopback audio element paused and srcObject
  cleared. `loopbackEnabled` state is preserved (see above).
- **Auto-stop triggers:**
  - Switching to PROFILE tab (component unmount via tab switch).
  - Navigating away from Settings (component unmount).
  - Browser tab hidden (`document.addEventListener('visibilitychange')` --
    when `document.visibilityState === 'hidden'`, stop the test). Track is
    NOT auto-restarted on visibility return; user must click Start again.

### No Voice Activation Threshold

Voice activation threshold is NOT part of settings. LiveKit handles voice
activity detection server-side. No user-facing control needed.

---

## 70.7 Video Settings (Camera)

### Camera Device Selection

- Dropdown select listing all available `videoinput` devices.
- Use `useMediaDeviceSelect({ kind: 'videoinput', track: previewVideoTrack, requestPermissions: false })`.
  Pass the camera preview `LocalVideoTrack` when running (for accurate
  `activeDeviceId`). When no preview is running, fall back to showing stored
  `video.cameraDeviceId` from localStorage as selected.
- Changing device: immediately persist to localStorage key `video.cameraDeviceId`.
  Applied on next camera enable.
- Default: browser default.

### Self-View Preview

- Live camera preview below the device dropdown.
- Uses `createLocalVideoTrack()` from `livekit-client`, with
  constraints built via `buildCameraConstraints(deviceId)` — see
  "iOS Camera Constraint Mapping" below. Independent from the voice
  test audio track (separate instances with separate lifecycles).
- Preview container: max-width 400px, 16:9 aspect ratio (`aspectRatio: '16/9'`),
  dark background (`var(--bg-input)`) when no preview.

### iOS Camera Constraint Mapping (Normative — cross-ref 45-video §45.6)

On iOS Safari, WebKit ignores `deviceId` in `getUserMedia` camera
constraints and always selects the default camera. To preserve the
user's camera choice across platforms, all camera acquisition paths
(`CameraPreview.startPreview`, `call.joinCall(withCamera=true)`,
`call.toggleCamera`) pass through `buildCameraConstraints(deviceId)`
(see `src/client/src/lib/camera-constraints.ts`):

- **Desktop UA** (no match against `/iPhone|iPad|iPod|Android/i`):
  returns `{ deviceId }`.
- **Mobile UA**: enumerates `mediaDevices.enumerateDevices()`, finds
  the device label, maps label → `facingMode`:
  - `'user'` — label contains `front`, `facetime`, `user`, or `selfie`.
  - `'environment'` — label contains `back`, `rear`, `environment`,
    `wide`, `ultra`, or `telephoto`.
- **Ambiguous label**: fallback to `{ deviceId, facingMode: 'user' }`.
- **Label missing (permission not yet granted) or enumerate throws**:
  fallback to `{ deviceId }` (desktop path — best-effort).

This is the same module referenced by 45-video §45.6 "Camera
Constraints per Platform" — documented here for the Settings
preview-level audience.

**Permission state machine:** Four states — `'checking'` (initial),
`'granted'`, `'prompt'`, `'denied'`.

- On mount, `permissionState` is `'checking'`. Preview container shows
  `"checking permissions..."` text in `var(--text-muted)`.
- In a `useEffect`, query `navigator.permissions.query({ name: 'camera' })`:
  - Result `'granted'` → set state to `'granted'`, auto-start preview.
  - Result `'prompt'` → set state to `'prompt'`, show `[ ENABLE PREVIEW ]`
    button.
  - Result `'denied'` → set state to `'denied'`, show denial message.
  - Permissions API unavailable or query throws → treat as `'prompt'`.
- `[ ENABLE PREVIEW ]` button click calls `createLocalVideoTrack()` which
  triggers the browser permission prompt.
- The effect captures a `cancelled` flag and no-ops state updates after
  unmount.

**Auto-start coupling:** A separate `useEffect` watches
`[permissionState, isRunning, disabled, error, isRestarting]` (state, not
ref — see below). When all conditions are met (`granted`, not running, not
disabled, no error, not mid-restart), it calls `startPreview()`. This
decouples the permission check from the start call.

**Auto-stop triggers:** Same as voice test (tab switch, settings exit,
browser tab hidden via visibilitychange).

**Device change mid-preview (USB camera hot-swap support) — Normative**:
When `settings.videoCameraDeviceId` changes while the preview is running,
the preview MUST restart with a **500 ms delay** between `stopPreview()`
and the new `startPreview()`. The delay allows USB cameras to re-enumerate
after being released — without it, `createLocalVideoTrack()` on the new
device fails with "device in use" on Linux PipeWire.

The restart flow uses a **state-driven** (not ref-based) guard to avoid
stale closures and race conditions when the user rapidly switches devices:

1. `isRestarting: boolean` state (not ref). Refs don't trigger re-renders,
   so the auto-start effect cannot observe guard flips through a ref.
2. `runningDeviceIdRef: Ref<string | null>` tracks which deviceId the
   currently running preview was started with. Updated inside
   `startPreview` on success and cleared in `stopPreview`. Used as the
   anti-loop guard so the restart effect does not re-trigger when
   `isRunning` flips during the restart cycle.
3. Effect flow on `settings.videoCameraDeviceId` change:
   - If not running, skip.
   - If `runningDeviceIdRef.current === desiredDeviceId`, skip (already
     running the right device — avoids re-entering after a successful
     restart).
   - `setIsRestarting(true)`, `stopPreview()` (which clears
     `runningDeviceIdRef`).
   - `setTimeout(500ms)` → `setIsRestarting(false)`. The auto-start effect
     picks up the changed state and calls `startPreview()` which sets
     `runningDeviceIdRef` to the new deviceId.
4. Effect cleanup clears the pending setTimeout. If the user rapidly picks
   another device before the setTimeout fires, the cleanup clears it and
   a fresh effect run takes over — last-write-wins without racing.

The previous ref-based `isRestartingRef` approach had two bugs that were
fixed in CGL-008: (a) `isRunning` was captured as a stale closure because
it wasn't in the effect's deps, and (b) `isRestartingRef` as a ref didn't
re-trigger the auto-start effect when flipped, leaving a race window
where a fast device switch could bypass the guard.

### Mirror Self-View Toggle

- Checkbox: `"Mirror self-view"`.
- Default: ON.
- When ON: CSS `transform: scaleX(-1)` on the preview video element.
- Local-only -- other participants see the unmirrored feed.
- Persisted in localStorage key `video.mirrorSelfView`.

**Propagation to in-call self-preview:** The `VideoGrid` component reads
`video.mirrorSelfView` from localStorage via a `useMediaSettings()` hook
(see 70.9). The `VideoTile` component applies `transform: scaleX(-1)` to
the `<video>` element when `isLocal === true && mirrorSelfView === true`.

### Background Blur Toggle (Normative)

> **Source of truth split**: `45-video.md §45.7` is the canonical
> specification for the Background Blur feature (in-call AND preview
> code paths share the same implementation). This section describes
> only the Settings UI surface (the toggle control and its placement)
> plus the CameraPreview-specific application details. **For the
> blur module wrapper, BackgroundProcessor API, BLUR_RADIUS, asset
> paths, Firefox disable rationale, error surfacing, failure modes,
> and acceptance criteria, see `45-video.md §45.7`.**

#### Toggle Control (rendered by AudioVideoSettings.tsx)

- **Checkbox**: `"Background blur"`.
- **Default**: OFF.
- **Sublabel**: `"Blur camera background during calls and preview"`.
- **Persisted** in localStorage key `video.backgroundBlur` via the
  `useMediaSettings` hook.
- **Rendered location**: in the AudioVideoSettings component, in the
  Camera section (`0xB4`), NOT in the CameraPreview component itself.
  The CameraPreview component is the **applier** of the setting (it
  watches `settings.videoBackgroundBlur` and calls `setProcessor` /
  `stopProcessor` on its preview track), but the toggle UI lives in the
  parent AudioVideoSettings tab. This split lets the parent decide
  rendering order (toggle next to other camera settings) while the
  child reacts to the setting value.
- **Firefox**: hidden entirely when `navigator.userAgent` matches
  `/firefox/i`. No error message — feature simply does not appear.
  See `45-video.md §45.7 Firefox Disable` for rationale.

#### Blur Module Wrapper (Camera Preview Copy)

CameraPreview.tsx contains its own **separate copy** of the blur
module wrapper helpers (`getBlurModule`, `createBlurProcessor`,
`BLUR_RADIUS = 20`, `MEDIAPIPE_WASM_PATH`, `MEDIAPIPE_MODEL_PATH`,
`_blurModule` cache) — duplicated from `call.tsx`. This is intentional
short-term tech debt; both copies MUST stay in sync. See
`45-video.md §45.7 Module Duplication` for the full rationale and
the dedup follow-up plan.

#### Application in Camera Preview (Normative)

The Settings camera preview applies blur in two places:

1. **`startPreview()` initial apply** — when starting the preview AND
   `settings.videoBackgroundBlur === true`:
   ```ts
   const blur = await getBlurModule();
   if (blur && blur.supportsBackgroundProcessors()) {
     // Second arg `true` is showProcessedStreamLocally — without it,
     // the local self-view shows the raw camera while the LocalVideoTrack
     // publishes the blurred output.
     await videoTrack.setProcessor(createBlurProcessor(blur), true);
   }
   ```

2. **Mid-preview blur toggle `useEffect`** — when
   `settings.videoBackgroundBlur` flips while the preview is running:
   ```ts
   useEffect(() => {
     if (!isRunning || !trackRef.current) return;
     let cancelled = false;
     async function applyBlur() {
       const track = trackRef.current!;
       if (settings.videoBackgroundBlur) {
         const blur = await getBlurModule();
         if (cancelled) return;
         if (blur && blur.supportsBackgroundProcessors()) {
           await track.setProcessor(createBlurProcessor(blur), true);
           // CRITICAL: re-bind videoRef.srcObject (see below)
           if (videoRef.current) {
             videoRef.current.srcObject = new MediaStream([track.mediaStreamTrack]);
           }
         }
       } else {
         // stopProcessor is unconditional — even if blur was already off,
         // calling stopProcessor on a track without a processor is a no-op
         // (or throws a benign error caught silently).
         try { await track.stopProcessor(); } catch {}
         if (videoRef.current) {
           videoRef.current.srcObject = new MediaStream([track.mediaStreamTrack]);
         }
       }
     }
     applyBlur();
     return () => { cancelled = true; };
   }, [settings.videoBackgroundBlur, isRunning]);
   ```

   **Limitations of the `cancelled` flag**: it prevents state updates
   after unmount, but does NOT abort an in-flight `setProcessor` call.
   If the user toggles blur off → on → off rapidly, multiple
   `setProcessor` calls may queue and resolve in unexpected order. The
   spec accepts this trade-off because the final state still converges
   (the React effect re-runs on the latest setting value), and abortable
   processor calls are not part of the LiveKit API surface.

#### Re-Bind `videoRef.srcObject` (NORMATIVE — load-bearing)

After every `setProcessor()` AND `stopProcessor()` call in
CameraPreview, the `<video>` element's `srcObject` MUST be re-bound to
`new MediaStream([track.mediaStreamTrack])`. Without the re-bind, the
`<video>` element keeps showing the previously bound stream even though
the `LocalVideoTrack`'s `mediaStreamTrack` getter now returns the new
(processed or unprocessed) stream.

This is **CameraPreview-specific**. The in-call VideoGrid path does
NOT need this because LiveKit's `Track.attach()`/`Track.detach()`
lifecycle (used inside `livekit-client`'s VideoGrid handling)
transparently re-binds when the underlying stream swaps. Only the
explicit-DOM `<video>` element used by the Settings camera preview
needs the manual re-bind.

#### Application in Active Calls

The same blur apply logic runs in `CallProvider` (call.tsx) for the
in-call camera track. See `45-video.md §45.7 Call Store Integration`
for the full call-side normative spec including:
- The `state.blurEnabled` CallState field
- The `toggleBlur()` API
- Auto-apply on camera enable paths (joinCall with-camera, toggleCamera)
- The `[ BLUR ]` CallControls button
- Error logging via `console.error` (NOT silent `console.warn`) —
  this is the IT-1 incident lesson; the same loud-logging rule
  applies in CameraPreview.tsx, not just in call.tsx.

#### Failure Modes (Camera Preview surface)

| Failure | Handling |
|---|---|
| `getBlurModule()` returns `null` (Firefox or import failed) | Skip blur application silently. Camera preview continues with raw stream. The toggle UI should ideally be hidden if Firefox; for the import-failed path, the user sees the toggle but blur doesn't apply. Logged via `console.error`. |
| `supportsBackgroundProcessors()` returns `false` | Logged via `console.warn` with explicit reason (OffscreenCanvas/WebGL2/VideoFrame check). Preview continues without blur. |
| `setProcessor()` throws | Caught, `console.error` with context (e.g. `"[CameraPreview] Failed to apply blur:"`), preview continues without blur. State + localStorage NOT reverted on the preview side — the parent toggle owns that state, and the apply failure is non-fatal for the preview. |
| `stopProcessor()` throws | Caught silently (`try { ... } catch {}`). The most common cause is "no processor was active" which is harmless. |
| `videoRef.srcObject` re-bind missed (regression) | Settings camera preview shows stale stream; user thinks blur is broken. Reimplementer constraint — see Re-Bind subsection above. |

<!-- DIM-Map §70.7 Background Blur (Updated 2026-04-11 — Phase A catchup + Blur Delta items 1, 2, 3 + F-CSD-015/016/017/018)
  Completeness:        ✓ (toggle control + responsibility split, blur module wrapper duplication, 2 application paths in CameraPreview, videoRef.srcObject re-bind, cross-ref to 45-video §45.7 as SoT, 5 failure modes)
  Konsistenz:          ✓ (matcht 45-video.md §45.7, same BLUR_RADIUS=20, same MEDIAPIPE_*_PATH constants, same showProcessedStreamLocally=true semantics, no terminology drift)
  Implementierbarkeit: ✓ (exact useEffect with cancelled flag, exact setProcessor 2-arg signature, exact srcObject re-bind expression, error variant catch pattern)
  Interface-Vertraege: ✓ (LocalVideoTrack.setProcessor(processor, showProcessedStreamLocally), LocalVideoTrack.stopProcessor, LocalVideoTrack.mediaStreamTrack getter, MediaStream constructor)
  Abhaengigkeiten:     ✓ (@livekit/track-processors lazy-import via getBlurModule, MediaPipe @mediapipe/tasks-vision, navigator.userAgent for Firefox UA, useMediaSettings hook for video.backgroundBlur, useCall for isInCall)
-->

<!-- DIM-Map §70.7 Permission State Machine + Device Change Restart
  Completeness:        ✓ (4 states: checking/granted/prompt/denied, Permissions API fallback, USB hot-swap, isRestartingRef)
  Konsistenz:          Partial — 'checking' state is new; existing Failure Modes table still says "Permissions API unavailable → treat as prompt", needs aligning (fixed below)
  Implementierbarkeit: ✓ (useEffect pattern, 500ms delay explicit, event listener cleanup)
  Interface-Vertraege: ✓ (PermissionState enum, query({name: 'camera'}) return type, isRestartingRef as React ref)
  Abhaengigkeiten:     ✓ (navigator.permissions.query, createLocalVideoTrack, USB/PipeWire driver assumption)
-->

---

## 70.7a Troubleshooting (Hex 0xB5, Normative)

A Troubleshooting section appears at the bottom of the Audio/Video tab,
below the Camera section. HexLabel: `0xB5 TROUBLESHOOTING`. Layout:
single column, three subsections separated by box-drawing horizontal
rules, each with a problem statement and a recommended action.

**OS gating (v1.3)**: all three subsections render unconditionally on
every platform. No `navigator.userAgent` gating. The user self-selects
the relevant instructions. Rationale: UA sniffing has known false
positives (iPadOS reports as macOS; Linux Chromium can spoof), and the
subsections are short enough that showing all three is acceptable.
Earlier spec revisions specified per-OS gating — it was never wired.

### Subsection 1 — "Calls not connecting"

**Problem text**:
> If Huddle loads but calls don't connect, the issue is usually
> browser-specific WebRTC configuration.

**Action** (rendered as two short paragraphs, not a checklist):

- **Firefox**: open `about:config`, search for
  `media.peerconnection.enabled`, and set it to `true`.
- **Brave**: click the Shields icon in the address bar for this site
  and lower fingerprinting protection.

No automatic diagnostic.

### Subsection 2 — "Visualizer not seeing audio (Linux)"

**Problem text**:
> The audio visualizer (in calls) needs a PipeWire monitor source to
> capture the call audio mix. On Linux, this is set up by a
> user-scope systemd service. If the visualizer shows nothing during
> a call, the service is missing or stopped.

**Action**: a `copy command` button (lowercase, no `[ ]` chrome). On
click the handler builds an **inline shell recipe** and copies it to
the clipboard via `navigator.clipboard.writeText`. The recipe:

1. Writes `~/.local/bin/huddle-audio-capture.sh` — the idle watchdog
   wrapper (60s grace period + 30s idle timeout; uses `pw-link -ol`
   to detect consumers and `pw-loopback` to create the monitor
   source). Source of truth:
   `scripts/huddle-audio-capture-wrapper.sh`.
2. Writes `~/.config/systemd/user/huddle-audio-capture.service` —
   the systemd user unit that runs the wrapper.
3. Runs `systemctl --user daemon-reload` and
   `systemctl --user start huddle-audio-capture`.

No external `curl` / no `bash <(curl -fsSL …)` — the entire wrapper
and service content is embedded as heredocs in the copied recipe.
This is the T14 migration (commit `fd2bbe9`) — self-hosted instances
no longer need the origin to host a fetchable setup script, and the
recipe is auditable before the user pastes it into a terminal.

The button label stays static after click (no `[ COPIED ]` feedback
state). The user reloads Huddle after running the command.

### Subsection 3 — "Visualizer not seeing audio (Windows)"

**Problem text**:
> The audio visualizer needs Windows' Stereo Mix recording device to
> capture the call audio mix. By default Stereo Mix is disabled.

**Action**: static text paragraph (no button, no clipboard helper):

> press Win+R → type `mmsys.cpl` → Enter. Go to the Recording tab →
> right-click the empty area → Show Disabled Devices → right-click
> Stereo Mix → Enable. Reload the page.

Earlier spec revisions described an `[ OPEN SOUND CONTROL PANEL ]`
button using the `ms-settings:sound` URI — that was never wired.

### General Notes

The Troubleshooting section is **non-interactive observability** — it
doesn't run any diagnostic, just provides hand-tested solutions to
the three most common user-reported issues.

<!-- DIM-Map §70.7a Troubleshooting (Hex 0xB5, NEW 2026-04-11 from F-CSD-001)
  Completeness:        ✓ (3 subsections: connectivity, visualizer Linux, visualizer Windows; OS gating logic; copy-command button mechanism)
  Konsistenz:          ✓ (matcht HexLabel section pattern of other 70.x subsections)
  Implementierbarkeit: ✓ (exact button labels, exact bash command for setup-audio-capture.sh, ms-settings:sound URI for Windows)
  Interface-Vertraege: ✓ (Clipboard API write, navigator.userAgent OS detection, ms-settings: URI scheme for Windows)
  Abhaengigkeiten:     ✓ (scripts/setup-audio-capture.sh availability on the deployed origin, browser Clipboard API, Windows ms-settings: handler)
-->

---

## 70.8 Device Persistence & Call Integration

All device preferences are stored in localStorage:

| Key | Type | Default |
|-----|------|---------|
| `audio.inputDeviceId` | string | `""` (browser default) |
| `audio.outputDeviceId` | string | `""` (browser default) |
| `audio.inputGain` | number | `100` |
| `audio.outputVolume` | number | `100` |
| `audio.noiseSuppression` | boolean | `true` |
| `video.cameraDeviceId` | string | `""` (browser default) |
| `video.mirrorSelfView` | boolean | `true` |
| `video.backgroundBlur` | boolean | `false` |

### localStorage Serialization Format (Normative)

All values are serialized via `String(value)` on write and parsed on
read using the type-specific path matching the default value's type:

- **string**: stored verbatim, read verbatim.
- **number**: stored as `String(num)` (e.g. `"100"`), read via `Number(raw)`
  with `NaN` check (fall back to default if `Number.isNaN`).
- **boolean**: stored as `"true"` or `"false"` (literal strings), read via
  `raw === 'true'` strict equality. Note: `Boolean(raw)` would be wrong
  because `Boolean("false")` is `true`.

The serialization is deliberately simple — no JSON, no Base64, no
versioning. The schema is small enough that any format change can be
handled by reading both old and new keys for one release.

If a key is missing (`localStorage.getItem(key) === null`), the default
from the table above is used. The value is **not** lazily written —
defaults stay as `null` in storage until the user explicitly changes
them. This keeps the storage footprint zero for users who never open
Settings.

### Application to Calls (joinCall modifications)

When joining a call (`CallProvider.joinCall`), in this order:

1. **Before connect:** Read `audio.inputDeviceId`, `audio.noiseSuppression`,
   `video.cameraDeviceId` from localStorage.

2. **After `room.connect()`:** Call `room.switchActiveDevice('audiooutput', storedOutputDeviceId)` if a stored output device exists.

3. **Microphone enable:** Instead of `setMicrophoneEnabled(true)`, use:
   ```
   const audioTrack = await createLocalAudioTrack({
     deviceId: storedInputDeviceId || undefined,
     noiseSuppression: storedNoiseSuppression,
   })
   ```
   Then apply GainNode pipeline (see 70.3) to get `processedTrack`.
   Then `room.localParticipant.publishTrack(processedTrack)`.

4. **Camera enable (if withCamera):** Build camera constraints via
   `buildCameraConstraints` (iOS facingMode mapping, see §70.7) and
   apply the 1080p resolution preset (see 45-video §45.6):
   ```
   const camConstraints = await buildCameraConstraints(
     storedCameraDeviceId || undefined,
   );
   await room.localParticipant.setCameraEnabled(true, {
     ...camConstraints,
     resolution: VideoPresets.h1080.resolution,
   });
   ```
   The 1080p resolution preset is applied in addition to the device
   constraint. The same call pattern is used by `toggleCamera` on
   mid-call camera re-enable.

5. **Mirror self-view:** Read `video.mirrorSelfView` from localStorage.
   Applied by VideoGrid/VideoTile at render time (see 70.7), not in joinCall.

6. **Output volume:** NOT applied during calls (see 70.4 rationale).
   Only used in voice test loopback.

### Unavailable Device Handling

If a stored device ID is no longer in the `enumerateDevices()` result:
- **At call join:** Fall back to browser default silently. No error shown.
- **In Settings dropdown:** Show stored device as `"{storedLabel} (unavailable)"`
  if the ID does not match any current device. If no stored label available,
  show `"Stored device (unavailable)"`. The user can select a different device.

---

## 70.9 useMediaSettings Hook + getMediaSettings Non-Hook Export

A thin localStorage wrapper used wherever stored settings are consumed.
Prevents scattered `localStorage.getItem` calls across components.

```typescript
interface MediaSettings {
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
  audioInputGain: number;
  audioOutputVolume: number;
  audioNoiseSuppression: boolean;
  videoCameraDeviceId: string;
  videoMirrorSelfView: boolean;
  videoBackgroundBlur: boolean;
}

// React hook for components that need reactive updates
function useMediaSettings(): MediaSettings & {
  update: (key: keyof MediaSettings, value: string | number | boolean) => void;
};

// Non-hook export for non-React contexts (e.g. inside CallProvider methods)
export function getMediaSettings(): MediaSettings;
```

### `useMediaSettings()` (React hook)

- Reads from localStorage on mount via `useState(readFromStorage)`.
- `update(key, value)` writes to localStorage and triggers a re-render
  via `setSettings`.
- The returned `update` function MUST be wrapped in `useCallback` with
  an **empty deps array** (`[]`) to give it a **stable identity**
  across renders. Components that pass `update` as a prop or include
  it in `useEffect` deps depend on this stability — without it, the
  child re-renders on every parent render and effects re-run on every
  hook invocation.
- Reactive: when `update` is called, the hook returns the new
  settings object and consumers re-render.
- Used in: AudioVideoSettings tab (form bindings), VideoGrid (mirror
  reading).

### `getMediaSettings()` (non-hook export)

- A plain function that calls `readFromStorage()` and returns the
  current MediaSettings snapshot. NOT a React hook — does NOT use
  `useState`, does NOT subscribe, does NOT trigger re-renders.
- Use case: inside non-React code paths like `CallProvider.joinCall`
  where the settings need to be read at the moment of the call but no
  reactive subscription is desired (the call captures a snapshot of
  the settings, not a live subscription).
- **Why both**: `useMediaSettings` requires a React component context
  (you can't call hooks from imperative code). `joinCall` is an async
  imperative method on the Call store, not a hook caller. The non-hook
  export bridges that gap without forcing the call store to receive
  settings as parameters from every caller.
- Used in: CallProvider (joinCall, toggleCamera, toggleBlur — wherever
  the latest setting value is needed for an imperative API call).

Both surfaces read from the same `readFromStorage()` helper, so they
produce identical snapshots when called at the same time. The hook
gives reactive updates; the non-hook export gives a one-shot read.

This is a client-side-only module. No server interaction.

---

## Constraints

- MUST use `createLocalAudioTrack` / `createLocalVideoTrack` from `livekit-client`
  for preview tracks (voice test + camera preview). These work without a
  LiveKit server connection.
- MUST use `useMediaDeviceSelect` from `@livekit/components-react` for device
  enumeration dropdowns (all three device types: audioinput, audiooutput,
  videoinput).
- MUST NOT require a LiveKit server connection for device preview/test.
- MUST NOT change audio/video devices mid-call. Changes apply on next call join.
  When user changes settings while in a call, show inline note
  `"applies on next call join"` below the changed control.
- MUST NOT use `GainNode.gain.value = 0` as a mute substitute.
- MUST follow TTY design: `borderRadius: 0` everywhere, no drop shadows,
  IBM Plex Mono, square slider thumbs, box-drawing separators, HexLabel
  section headers.
- MUST persist all settings in localStorage via `useMediaSettings` hook.
  No server-side storage for device preferences.
- MUST auto-stop preview tracks on: tab switch, settings exit, browser tab
  hidden (visibilitychange). Tracks NOT auto-restarted on visibility return.
- MUST handle permission denial gracefully (show message, don't crash).
- Voice test and camera preview use **independent** track instances (separate
  `createLocalAudioTrack` and `createLocalVideoTrack` calls). They can run
  simultaneously without interference.

---

## Failure Modes

| Failure | Handling |
|---------|----------|
| Microphone permission denied (`'denied'` via Permissions API or `NotAllowedError`) | Show: `"microphone access denied -- check browser permissions"`. Voice test button disabled. Input device dropdown visible but non-functional. |
| Microphone permission not yet granted (`'prompt'` or Permissions API unavailable) | Voice test button enabled. Clicking it triggers browser permission prompt. If denied after prompt: fall back to denied handling above. |
| Camera permission denied | Show: `"camera access denied -- check browser permissions"`. Preview shows dark bg + message. |
| Camera permission not yet granted | Show `[ ENABLE PREVIEW ]` button. Click triggers permission prompt. |
| No audioinput devices found | Show: `"no microphone detected"`. Input device dropdown + voice test disabled. |
| No videoinput devices found | Show: `"no camera detected"`. Camera dropdown + preview disabled. |
| Output device controls unavailable (`setSinkId` not on `HTMLAudioElement.prototype`) | Hide entire output section (header, dropdown, volume slider). Show single-line note: `"output device selection not supported in this browser"`. |
| Stored device unavailable (unplugged) | In dropdown: show as `"(unavailable)"`. At call join: fall back to browser default silently. |
| getUserMedia fails (other) | Show error message below the relevant section. |
| Browser tab hidden while preview running | Auto-stop all preview tracks. Show `[ START TEST ]` / `[ ENABLE PREVIEW ]` buttons on return. |
| Permissions API unavailable | Treat as `'prompt'` -- show enable buttons, request on click. |
| Brave Shields blocks or delays `getUserMedia` (background label fetch) | 4-second timeout fires in the background fetch effect. Settings page remains functional. Device dropdowns show unlabeled entries using the deviceId-slice fallback (`Microphone {deviceId.slice(0,8)}`, `Speaker {deviceId.slice(0,8)}`, `Camera {deviceId.slice(0,8)}`). User can still select devices; persistence still works. |
| Camera busy (`NotReadableError`: another app has the camera) | Preview shows error message `"camera in use by another app -- close it and retry"`. A `[ RETRY ]` button appears next to the error. Click resets the error state and calls `startPreview()` again. Does not mark permission as denied. |
| Background blur module load fails (network / import crash) | `getBlurModule()` returns `null`, logs `console.error`. Camera preview/track continues without blur. The toggle remains visible (not Firefox), but clicking has no effect — see §70.7 Background Blur Failure Modes for the full Camera Preview surface table, and `45-video.md §45.7` for the call-side table. |
| `setProcessor(processor, true)` throws at runtime | Caught, logged via `console.error` with context, preview/track continues without blur. |
| `showProcessedStreamLocally` flag missing on setProcessor (regression) | Local self-view shows raw camera while published track is blurred. NO loud error — silent UX failure. **Reimplementer constraint**: always pass `true` as second arg to `setProcessor` for `LocalVideoTrack` in CameraPreview. See §70.7 + `45-video.md §45.7`. |
| `videoRef.srcObject` not re-bound after setProcessor | Settings camera preview shows the previously bound stream (raw or stale) regardless of current blur state. **Reimplementer constraint**: re-bind `videoRef.current.srcObject = new MediaStream([track.mediaStreamTrack])` after every setProcessor/stopProcessor in CameraPreview. |
| Firefox + background blur | Blur toggle is hidden entirely from the UI (`navigator.userAgent` check). No error shown — the feature does not appear. |
| User in active call attempts voice test or camera preview | Both controls disabled; in-call notice banner explains why ("voice test and camera preview disabled during active call"). Other settings remain interactive with per-setting "applies on next call join" `InCallNote`. |
| Voice test loopback `audio.play()` rejects | Inline error below loopback checkbox: `"loopback playback failed: {err.name}"` in `var(--error)`. Loopback preference stays ON for retry on next gesture. Audio element disposed. |
| Voice test start error variants | `NotAllowedError` → `"microphone access denied -- check browser permissions"` (+ sets `micDenied`); any other error → `err.message` verbatim (falling back to `"Failed to start voice test"`). Friendly mapping for `NotFoundError` / `NotReadableError` is future work (CGB-7001). |

---

## Acceptance Criteria

- [ ] AC-01: Settings overlay shows tab navigation `[ PROFILE ] [ AUDIO / VIDEO ] [ COLOR THEME ] [ ADMIN ]`
        with ARIA tab pattern (role=tablist, role=tab, aria-selected).
- [ ] AC-02: PROFILE tab contains all existing settings in existing layout
        (two-column grid, max-width 900px, unchanged).
- [ ] AC-03: AUDIO / VIDEO tab renders with HexLabel sections (0xB0-0xB4).
- [ ] AC-04: Input device dropdown lists available microphones via
        `useMediaDeviceSelect`. Selection persists to localStorage.
- [ ] AC-05: Input gain slider works 0-200%, value persists. >100% shows
        warning. GainNode pipeline applies gain to voice test audio.
- [ ] AC-06: Output device dropdown lists available speakers (entire section
        hidden if `setSinkId` unsupported). Selection persists to localStorage.
- [ ] AC-07: Output volume slider works 0-100%, value persists. Applied to
        voice test loopback audio element.
- [ ] AC-08: Noise suppression toggle works, value persists, default ON.
- [ ] AC-09: Voice test start creates local audio track with stored settings,
        shows live level meter with green/yellow/red zones.
- [ ] AC-10: Voice test loopback toggle plays mic audio (post-gain) to
        selected output device at stored output volume.
- [ ] AC-11: Voice test and camera preview auto-stop on tab switch, settings
        exit, and browser tab hidden (visibilitychange).
- [ ] AC-12: Camera dropdown lists available cameras. Selection persists.
- [ ] AC-13: Self-view shows live camera preview. Auto-starts if camera
        permission previously granted (Permissions API check). Shows
        `[ ENABLE PREVIEW ]` button otherwise.
- [ ] AC-14: Mirror toggle flips self-view preview AND in-call self-preview
        tile in VideoGrid. Value persists, default ON.
- [ ] AC-15: Stored input device, noise suppression, gain, output device, and
        camera device applied when joining a call (joinCall modifications).
- [ ] AC-16: Unavailable stored device shown as "(unavailable)" in dropdown,
        falls back to browser default at call join.
- [ ] AC-17: Permission denial (denied vs prompt) handled correctly per
        Failure Modes table.
- [ ] AC-18: TTY design: borderRadius 0, IBM Plex Mono, HexLabel headers,
        square slider thumbs.
- [ ] AC-19: Inline note `"applies on next call join"` shown when changing
        settings while in an active call.
- [ ] AC-20: Voice test and camera preview can run simultaneously without
        interference (independent track instances).
- [ ] AC-21: ADMIN tab visible only to admin users, uses warning color.
- [ ] AC-22: ESC key closes the settings overlay.
- [ ] AC-23: Settings overlay does not replace the underlying view.
- [ ] AC-24: All three device selection hooks are instantiated with
        `requestPermissions: false`. Settings page renders in first paint
        (no permission prompt blocks UI).
- [ ] AC-25: On tab mount, background label fetch runs when `audioinput`
        labels are empty. Uses `getUserMedia({audio: true})` (NOT video),
        4-second timeout, dispatches synthetic `devicechange` event on
        success. Effect is skipped when user is in an active call
        (`isInCall === true`).
- [ ] AC-26: Camera preview has four permission states: `'checking'`
        (initial), `'granted'`, `'prompt'`, `'denied'`. `'checking'` shows
        `"checking permissions..."` text. Auto-start only fires on
        `'granted'` state via a separate `useEffect`.
- [ ] AC-27: Camera device change mid-preview triggers restart with a
        500ms delay between `stopPreview()` and `startPreview()`. An
        `isRestartingRef` flag prevents the auto-start effect from racing
        the manual restart.
- [ ] AC-28: Background blur toggle persists to `video.backgroundBlur`.
        Default OFF. Toggle UI rendered by `AudioVideoSettings.tsx` (not
        CameraPreview). Applied to live preview via `track.setProcessor(processor, true)` /
        `track.stopProcessor()`. Hidden entirely on Firefox. **For full
        normative spec see `45-video.md §45.7`** — this section only
        documents the Settings UI surface and CameraPreview application path.
- [ ] AC-29: `@livekit/track-processors` is lazy-loaded via dynamic
        `import()` on first use. Module load failure does not crash the
        camera preview or call system. The CameraPreview blur module
        wrapper is a separate copy from the call.tsx wrapper (acknowledged
        tech debt — both must stay in sync).
- [ ] AC-30: Camera `NotReadableError` (device busy) shows inline error
        message with a `[ RETRY ]` button. Retry clears the error and
        calls `startPreview()` again. Does not transition permission state
        to denied.
- [ ] AC-31: Microphone (and Camera) device dropdown fallback labels for
        unlabeled devices use the format `"Microphone {device.deviceId.slice(0, 8)}"`
        / `"Camera {device.deviceId.slice(0, 8)}"` — NOT positional
        `"Microphone 1"` / `"Microphone 2"`.
- [ ] AC-32: Noise Suppression control uses ARIA switch pattern
        (`role="switch"` + `aria-checked={value}`), NOT a styled checkbox.
- [ ] AC-33: Voice Test and Camera Preview are both disabled (controls
        non-interactive) when the user is in an active call
        (`isInCall === true`). A notice banner between §70.5 and §70.6
        sections reads `"voice test and camera preview disabled during
        active call"` in `var(--text-muted)` only when `isInCall`.
- [ ] AC-34: Voice Test start error variants distinguishable by `err.name`
        (NotAllowedError → "microphone permission denied", NotFoundError →
        "no microphone found", NotReadableError → "microphone in use by
        another application", default → "voice test failed: {err.name}").
- [ ] AC-35: Voice Test loopback `audio.play()` rejection shows inline
        error `"loopback playback failed: {err.name}"` below the checkbox;
        loopback preference stays ON for retry.
- [ ] AC-36: Input gain slider updates the gain pipeline live during voice
        test (no test restart required).
- [ ] AC-37: §70.7 CameraPreview blur application MUST pass `true` as
        second arg to `setProcessor` (showProcessedStreamLocally) at both
        call sites (initial apply in startPreview + mid-preview useEffect).
- [ ] AC-38: §70.7 CameraPreview MUST re-bind `videoRef.current.srcObject`
        to `new MediaStream([track.mediaStreamTrack])` after every
        `setProcessor` AND `stopProcessor` call.
- [ ] AC-39: §70.7 CameraPreview blur module wrapper (`getBlurModule`,
        `createBlurProcessor`, `BLUR_RADIUS = 20`, `MEDIAPIPE_*_PATH`
        constants, `_blurModule` cache) is a separate copy from the
        equivalent in `call.tsx`. Both copies stay in sync — any change
        to one MUST be replicated to the other in the same commit.
- [ ] AC-40: §70.7a Troubleshooting section (HexLabel `0xB5`) renders 3
        OS-gated subsections: connectivity (always shown), visualizer
        Linux (Linux UA only, with `[ COPY SETUP COMMAND ]` button copying
        the bash one-liner), visualizer Windows (Windows UA only, with
        `[ OPEN SOUND CONTROL PANEL ]` button via `ms-settings:sound` URI).
- [ ] AC-41: localStorage values serialized via `String(value)`. Booleans
        stored as literal `"true"` / `"false"` strings. Numbers parsed
        with `Number(raw)` + `NaN` check fall-through to default. Missing
        keys (null) fall through to default; defaults are NOT lazily written.
- [ ] AC-42: `getMediaSettings()` exported as a non-hook function for
        non-React contexts (CallProvider methods). Reads from localStorage
        directly without subscription. `useMediaSettings()` is the React
        hook variant for components.
- [ ] AC-43: `useMediaSettings().update` is wrapped in `useCallback` with
        empty deps array `[]` for stable identity across renders.
