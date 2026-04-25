intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Camera video rendering within calls (group room and DM)
  action: Defines camera preconditions, UX rules (off by default, join-call prompt), VideoGrid layout (count-based responsive CSS Grid, tile anatomy, speaking/muted indicators, DM strip mode, visual polish with aspect ratio, spacing, scrollbar, badges)

| | |
|---|---|
| **Layer** | Frontend |
| **Status** | aktuell |
| **spec_version** | 1.4.0 |
| **Konsumiert** | overview, 40-voice, 70-audio-settings |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 10 findings): §45.2 Join dropdown corrected — single Phone icon (not split button) with "Join (audio only)" / "Join with camera" labels (F-CSD-4501/4502); §45.3 UI Behavior now enumerates the full in-call control row including connection-quality indicator, timer, blur, expand, chat-overlay (F-CSD-4503); §45.6 new "Camera Constraints per Platform" subsection documenting iOS/Android facingMode fallback via `buildCameraConstraints` (F-CSD-4508, HIGH) — supersedes the original CGL-005 desktop-only approach; AC-32 rewritten; new AC-43; §45.7 `.tflite` Content-Type dev-middleware documented (F-CSD-4504) + AC-28b; §45.7 Failure Modes row clarified for `supportsBackgroundProcessors()=false` in `toggleBlur` — documents current flip-to-false behavior and the intentional divergence from auto-apply-on-enable (F-CSD-4505); §45.5 new "Narrow-Viewport Override" subsection documenting `@media (max-width: 500px)` single-column grid (F-CSD-4506) + AC-42; new AC-E16 for RoomView/VideoGrid eligibility-logic duplication (F-CSD-4507). History: 2026-04-11 — Batch 1 T-004 findings + Blur Delta. |
| **Earlier Updates** | 2026-04-10 — Camera join UX rewritten as dropdown (modal removed), `toggleCamera` preserves deviceId on re-enable, blur self-hosts MediaPipe assets (no CDN), `BackgroundProcessor` API with `assetPaths` |

## Was diese Spec beschreibt

This spec defines how camera video is rendered within calls. It covers camera preconditions (must be in call or prompted to join), UX rules (camera off by default, deliberate toggle), and the VideoGrid component (responsive CSS Grid layout based on participant count, tile anatomy with username/muted badges and speaking indicator, self-preview sorting, DM strip mode, 16:9 aspect ratio, container styling, scrollbar, badge improvements).

---

# 45. Camera Video (LiveKit) (Normative)

Camera video runs inside the room call session (see `40-voice.md`).

## 45.1 Preconditions
- Camera is allowed only if:
  - user is in a joined room, AND
  - user is in the call (or chooses to join call).

## 45.2 UX Rules
- Camera is OFF by default.
- Users explicitly toggle camera on/off.
- Toggling camera OFF stops publishing immediately.

### Join With Camera — Dropdown Flow (Normative)

Enabling camera while NOT yet in the call is expressed via a dedicated
dropdown item on the Join Call control — **not a modal prompt**. The
`CallControls` component exposes a single Lucide `Phone` icon button
that opens a dropdown with two options:

```
[ Phone icon ▾ ]
  └─ Join (audio only)
  └─ Join with camera
```

Clicking the icon opens the dropdown. Both options require a dropdown
selection — there is no split-button primary-action; the icon itself
does not directly start the call. Selecting "Join (audio only)" calls
`joinCall(scope, withCamera=false)`; selecting "Join with camera"
calls `joinCall(scope, withCamera=true)`, which enables the camera as
part of the join sequence.

The one-click friction for enabling camera is the **dropdown selection
itself** — the user cannot accidentally enable camera because they must
explicitly pick the "Join with camera" option. This satisfies the
"deliberate user consent" principle from overview.md Invariant E without
requiring a separate modal confirmation step.

**Anti-Pattern — Modal Prompt (Removed)**: Earlier designs used a
modal `CameraJoinPrompt` component with `[ JOIN CALL ] [ CANCEL ]`
buttons and backdrop dismissal. That flow was **never wired in** at
the code level — `setShowCameraJoinPrompt(true)` was never called
because the dropdown item became the actual UX. The dead Modal
component was removed in the CGL-004 cleanup pass (2026-04-10).

Spec reimplementers MUST NOT re-introduce a separate camera-join Modal
unless there is a new explicit design decision to do so. The dropdown
is the documented UX.

**Dismissal**:
- The dropdown closes on outside click or picking any item.
- **Note**: Escape-key dismissal is NOT currently wired up. The dropdown
  has no `onKeyDown` handler. Adding Escape support is a low-effort
  follow-up if user feedback shows it's missed; until then, click-outside
  is the only keyboard-free dismissal path. Earlier drafts of this spec
  asserted Escape support — that was aspirational, not implemented.
- Selecting "Join with camera" and then failing to join (e.g. camera
  device busy) falls through to the standard call failure handling —
  `joinCall` returns `{ ok: false, reason }`, the dropdown closes,
  and an inline error message is shown.

## 45.3 UI Behavior

When **NOT** in the call, `CallControls` renders (in order):
- Participant count badge (`"{n} in call"`, hidden when count is 0).
- Join Call icon (Phone) + dropdown (see §45.2).

When **in** the call, `CallControls` renders (in order):
- **Connection Quality Indicator** (green/yellow dot + tooltip; or
  inline `"Reconnecting..."` text in `var(--error)` while
  `connectionState === Reconnecting`) — see 40-voice §40.6.
- **Call Duration Timer** (`"CALL mm:ss"`, starts at `joinedAt`) —
  see 40-voice §40.6.
- **Mute** / **Camera** toggles — always present.
- **Blur** toggle — visible only when camera is ON (see §45.7).
- **Expand** toggle — visible when in call AND at least one camera is
  active (see §45.8).
- **Chat Overlay** toggle — visible only when Expand mode is active
  (see §45.8).
- **Leave Call** button — always last.

Video tiles:
- shown only for participants with camera ON.

If nobody has camera ON:
- show compact call controls (no empty grid requirement).

## 45.4 Failure Handling

- If camera permission/device fails on join-with-camera:
  - The user still joins the call audio-only (call does NOT fail).
  - The error is **logged silently** to `console.error` with context
    (e.g. `"[Call] Camera enable failed:", err`). No inline UI banner,
    no toast.
  - The CallControls Camera button remains in the OFF state. The user
    can retry via the toggle.
  - Rationale: a camera failure on join is recoverable — the call works,
    audio is what matters. Surfacing a banner mid-call would be more
    disruptive than the silent failure. The console-log is the
    diagnostic surface for the rare case where it matters.
- If camera permission/device fails on mid-call toggle:
  - Same: silently logged, button stays OFF, audio call unaffected.
- If background blur fails to apply:
  - camera continues publishing without blur
  - **Loud** `console.error` with context (NOT silent — see §45.7
    Error Surfacing for the IT-1 incident rationale why blur failures
    must be loud while camera-enable failures stay silent)
  - see §45.7 for details

---

## 45.6 Camera Quality (Normative)

### Resolution Default

Camera MUST publish at **1080p** (1920x1080) by default, not LiveKit's default
720p preset. Use `VideoPresets.h1080.resolution` when calling
`setCameraEnabled(true, {...})` or publishing the camera track.

Rationale: 720p is insufficient for modern displays when sharing camera on
desktop. The bitrate cost (~3-4 Mbps at h1080 vs ~1.7 Mbps at h720) is
acceptable for small trusted groups (5-15 users, typically 2-4 concurrent
camera streams).

### adaptiveStream + dynacast (Normative)

Both `adaptiveStream: true` AND `dynacast: true` MUST be enabled on the
Room configuration:

```ts
room = new Room({
  adaptiveStream: true,
  dynacast: true,
  // ... other options
});
```

- **`adaptiveStream`**: degrades subscription quality on the receive
  side when bandwidth is insufficient. Never hurts on good connections,
  protects users on weak links.
- **`dynacast`**: dynamic simulcast — LiveKit pauses publishing of
  unused simulcast layers (e.g. nobody is subscribed to the highest
  layer because no recipient has a large viewport for that participant).
  Reduces upload bandwidth on the publisher side without quality loss
  for actual viewers.

Both are independent layers of bandwidth optimization (one receive-side,
one send-side). Both are enabled.

The **camera still publishes at 1080p** when bandwidth allows.
`adaptiveStream` controls subscription quality on the receive side, not
publish resolution. `dynacast` only affects simulcast layer activation,
not the configured publish target.

### VideoEncoding (optional)

Huddle does not override `videoEncoding` — LiveKit's default encoder
settings for h1080 are sufficient. If future Huddle versions need
fine-grained control (e.g. bitrate caps for low-bandwidth networks):
add explicit `videoEncoding: { maxBitrate, maxFramerate }` in the
publish options. Default: not set, LiveKit decides.

### Camera Constraints per Platform (Normative)

The stored `videoCameraDeviceId` (from 70-audio-settings) is translated
by `buildCameraConstraints(deviceId)` in
`src/client/src/lib/camera-constraints.ts` before being passed to
LiveKit's `setCameraEnabled(true, { ..., resolution })` /
`createLocalVideoTrack({ ... })`:

- **Desktop** (UA does not match `/iPhone|iPad|iPod|Android/i`):
  returns `{ deviceId }`. WebRTC on Chromium / Firefox / Safari-macOS
  honors deviceId selection.
- **Mobile** (UA matches the regex): WebKit (iOS) ignores `deviceId`
  constraints for camera capture; Android Chromium support is
  inconsistent across OEMs. The function enumerates
  `mediaDevices.enumerateDevices()`, finds the matching `videoinput`,
  and maps its label to a `facingMode`:
  - Front (`'user'`): label contains `front`, `facetime`, `user`, or
    `selfie`.
  - Rear (`'environment'`): label contains `back`, `rear`,
    `environment`, `wide`, `ultra`, or `telephoto`.
  Fallback to pass-through `{ deviceId }` when the label is missing
  (camera permission not yet granted) or the keyword lookup is
  ambiguous — best-effort.

All three camera-entry paths call `buildCameraConstraints`:
`joinCall(withCamera=true)`, `toggleCamera(on)`, and
`CameraPreview.startPreview`. Resolution
(`VideoPresets.h1080.resolution`) is applied on top of these
constraints. Supersedes the earlier CGL-005 desktop-only fix (which
passed `deviceId` directly).

<!-- DIM-Map §45.6 Camera Quality
  Completeness:        ✓ (default resolution, adaptiveStream rationale, future videoEncoding note)
  Konsistenz:          ✓ (matcht 40-voice VoicePresets convention)
  Implementierbarkeit: ✓ (exact preset reference VideoPresets.h1080.resolution)
  Interface-Vertraege: ✓ (LiveKit Room config API, setCameraEnabled options)
  Abhaengigkeiten:     ✓ (livekit-client VideoPresets, LiveKit SFU adaptiveStream support)
-->

---

## 45.7 Background Blur (Normative)

Background blur is an optional feature that blurs the camera's background
during a call using `@livekit/track-processors` with MediaPipe
`selfie_segmenter` for background segmentation.

### User Control (two surfaces)

1. **Settings toggle**: Persistent preference in the Audio/Video Settings
   Camera section. See `70-audio-settings.md` §Background Blur Toggle for
   the full spec including Firefox-disable logic and lazy-loading.

2. **In-Call toggle**: `[ BLUR ]` button in `CallControls`. Visible only
   when camera is currently enabled (no blur toggle for disabled camera).
   - Active (blur ON): `accent` color border + text.
   - Inactive (blur OFF): `text-muted` color.
   - Clicking toggles the blur processor on the active camera track AND
     updates `settings.videoBackgroundBlur` in localStorage.
   - Firefox: button is hidden entirely (same UA-check as settings toggle).

### Self-Hosted MediaPipe Assets (Normative)

**All MediaPipe runtime assets MUST be served from the same origin as
the app — no external CDN fetches**. This is load-bearing for reliable
blur activation across Brave Shields, strict networks, and offline dev
environments. External fetches (jsdelivr, storage.googleapis.com) fail
silently in these scenarios, and the previous spec allowed them —
which caused an incident (IT-1, 2026-04-10) where blur "did nothing"
on the user's primary browser (Brave) for weeks with no error surface.

**Assets served locally**:

```
/mediapipe/wasm/vision_wasm_internal.wasm          (~9 MB, SIMD)
/mediapipe/wasm/vision_wasm_internal.js            (~210 KB glue)
/mediapipe/wasm/vision_wasm_nosimd_internal.wasm   (~9 MB, fallback)
/mediapipe/wasm/vision_wasm_nosimd_internal.js     (~210 KB glue)
/mediapipe/selfie_segmenter.tflite                  (~244 KB, float16 model)
```

**Build-time sourcing**:

- The `.tflite` model is committed to the repo under
  `src/client/public/mediapipe/` (stable, small, downloaded once from
  Google Cloud Storage).
- The WASM files are **NOT** committed — they live under
  `node_modules/@mediapipe/tasks-vision/wasm/` from the
  `@livekit/track-processors` dependency and are copied into
  `src/client/public/mediapipe/wasm/` by a Vite plugin
  (`copyMediapipeWasm` in `src/client/vite.config.ts`) on every dev
  start and production build. This keeps the repo size small while
  ensuring build output always has the right WASM version matching
  the installed `@mediapipe/tasks-vision`.
- `.gitignore` entry: `src/client/public/mediapipe/wasm/`.
- **`.tflite` Content-Type dev middleware**: the Vite dev server
  additionally installs a middleware that sets
  `Content-Type: application/octet-stream` for any request URL ending
  in `.tflite`. Vite's built-in MIME table has no `.tflite` entry, so
  without the override the response has no Content-Type header and
  some strict fetch loaders reject it. Production serves the file
  from the static output where the reverse-proxy (Caddy/Nginx)
  handles MIME.

### BackgroundProcessor API (Normative)

Code MUST use the new `BackgroundProcessor({ mode, ..., assetPaths })`
API — NOT the deprecated `BackgroundBlur(radius)` convenience. The
deprecated convenience function does not expose the `assetPaths` option,
which we need to point MediaPipe at the local files instead of the
CDN defaults.

**Blur radius**: `BLUR_RADIUS = 20` is the current normative value.
Stored as a module-level const in both call.tsx and CameraPreview.tsx.

Rationale (empirically tuned, 2026-04-10/11):
- `10` (LiveKit default in the deprecated convenience) — barely
  visible, "doesn't look blurred"
- `15` — noticeable but still permissive of background detail
- `20` — current setting. Recognizable shapes still visible (so the
  user knows the camera is working), but room layout / text /
  identifiable objects are clearly obscured. Strong blur.
- `25+` — would start to hide that the camera is even pointing at a
  person. Avoided.

If a future change targets a different default, update `BLUR_RADIUS`
in BOTH files (or dedup first; see Module Duplication note below).

Construction pattern (helper `createBlurProcessor`):

```ts
const MEDIAPIPE_WASM_PATH = '/mediapipe/wasm';
const MEDIAPIPE_MODEL_PATH = '/mediapipe/selfie_segmenter.tflite';
const BLUR_RADIUS = 20;

function createBlurProcessor(mod, blurRadius = BLUR_RADIUS) {
  return mod.BackgroundProcessor(
    {
      mode: 'background-blur',
      blurRadius,
      assetPaths: {
        tasksVisionFileSet: MEDIAPIPE_WASM_PATH,
        modelAssetPath: MEDIAPIPE_MODEL_PATH,
      },
    },
    'background-blur',
  );
}
```

**`setProcessor` Second Argument — `showProcessedStreamLocally=true`
(NORMATIVE, load-bearing)**:

When applying the processor to a `LocalVideoTrack`, code MUST pass
`true` as the second argument to `setProcessor`:

```ts
await camTrack.setProcessor(createBlurProcessor(blur), true);
//                                                 ↑
//                                  showProcessedStreamLocally
```

Without this flag, LiveKit binds the local self-view to the **raw**
camera track, while remote participants receive the **blurred** track.
The user looking at their own preview would see "blur doesn't work"
(unblurred self) even though the published track to others IS blurred.
This is exactly the symptom encountered after IT-1 (CDN self-host) was
already fixed — the asset path was correct, the MediaPipe segmentation
graph was running, but the local self-view binding was wrong.

The flag MUST be passed at **all 5 call sites**:
- `call.tsx` `joinCall` (with-camera path)
- `call.tsx` `toggleCamera` (re-enable path)
- `call.tsx` `toggleBlur`
- `CameraPreview.tsx` `startPreview` (initial apply when settings.blur=true)
- `CameraPreview.tsx` mid-preview blur toggle `useEffect`

For the CameraPreview surfaces, applying the flag is necessary but
not sufficient: see the **Re-Bind videoRef.srcObject** subsection
below.

**Module Duplication (Acknowledged Tech Debt)**:

The blur module wrapper (`getBlurModule`, `createBlurProcessor`,
`BLUR_RADIUS`, `MEDIAPIPE_*_PATH` constants, `_blurModule` cache) is
currently **duplicated as separate copies** in both `call.tsx` and
`CameraPreview.tsx`. This is intentional in the short term — both
files have their own `_blurModule` cache (so each file lazy-loads
independently the first time blur is touched in that surface), and
the two files duplicate the helper function.

Earlier drafts of this spec asserted "All blur call sites MUST use
this shared helper". That was the desired end state, not the
implemented state. Reimplementers should be aware that:

- The two copies MUST stay in sync (both `BLUR_RADIUS`, both
  `MEDIAPIPE_*_PATH`, both `assetPaths` config).
- Dedup is a known follow-up — the helpers should eventually be
  extracted to `src/client/src/lib/blur.ts` (or similar) and imported
  by both call sites. Tracked as tech debt; not blocking launch.
- Until dedup: any change to blur configuration (radius, asset paths,
  processor mode) MUST be applied in both files in the same commit.

Inline `BackgroundBlur(radius)` calls (the deprecated convenience)
remain forbidden — both files MUST use the local `createBlurProcessor`
helper, not the deprecated convenience.

### Re-Bind videoRef.srcObject after setProcessor (Normative — CameraPreview only)

In the Settings Camera Preview surface (`CameraPreview.tsx`), the
`<video>` element's `srcObject` MUST be re-bound to the
`LocalVideoTrack`'s `mediaStreamTrack` after every `setProcessor` AND
`stopProcessor` call. Without the re-bind, the `<video>` element keeps
showing the **previously bound stream** even though the
`LocalVideoTrack`'s `mediaStreamTrack` reference has changed to point
at the new (processed or unprocessed) stream.

```ts
await track.setProcessor(createBlurProcessor(blur), true);
// Re-bind: the LocalVideoTrack.mediaStreamTrack getter now returns
// the processed stream, but the video element is still attached to
// the previous MediaStream. Re-attach to pick up the new track.
if (videoRef.current) {
  videoRef.current.srcObject = new MediaStream([track.mediaStreamTrack]);
}
```

The same re-bind MUST happen after `stopProcessor()` to switch the
preview back to the raw camera feed.

This is **not** needed in the in-call code path (`call.tsx`), because
LiveKit's VideoGrid component manages the `<video>` attachment via
its own `Track.attach()`/`Track.detach()` lifecycle, which transparently
re-binds when `setProcessor` swaps the underlying stream. Only the
explicit-DOM `<video>` element used by the Settings Camera Preview
needs the manual re-bind.

### Call Store Integration

The `CallProvider` owns the blur application logic via:

1. A `toggleBlur()` method exposed through the call context
2. A `state.blurEnabled: boolean` field in CallState (React state)
3. **Auto-apply** of the current blur setting on every camera-enable
   path

**`state.blurEnabled` field**:

`CallState` has a `blurEnabled: boolean` field that mirrors
`localStorage['video.backgroundBlur']`. This is the React-state half
of the blur preference — components that need to render conditionally
based on blur state (e.g. CallControls' active/inactive `[ BLUR ]`
border styling) read from React state, not localStorage. The two are
kept in sync: every blur state mutation MUST update both
`setBlurEnabled(...)` AND `localStorage.setItem('video.backgroundBlur', ...)`
in the same operation, and every revert (on failure) MUST revert both.

```ts
// Sync write:
setBlurEnabled(true);
localStorage.setItem('video.backgroundBlur', 'true');

// On failure: revert both
catch (err) {
  setBlurEnabled(currentBlur);
  localStorage.setItem('video.backgroundBlur', String(currentBlur));
  console.error('[Call] toggleBlur failed:', err);
}
```

This is the failure-path consistency rule — there must be NO state
where React-side `state.blurEnabled` and localStorage disagree.

**`toggleBlur(): Promise<void>` behavior**:

- If the local participant has an active camera track:
  - Read current blur state from `state.blurEnabled` (or
    `settings.videoBackgroundBlur`).
  - If OFF → lazy-import `@livekit/track-processors`, check
    `supportsBackgroundProcessors()`, build processor via
    `createBlurProcessor(blur)` (uses `BLUR_RADIUS=20`), call
    `track.setProcessor(processor, true)` (note the `true` second arg
    — see BackgroundProcessor API section), update both
    `state.blurEnabled` and `localStorage` to `true`.
  - If ON → call `track.stopProcessor()`, update both to `false`.
- If no active camera track: update `state.blurEnabled` and
  `localStorage` only (applies on next camera enable via the auto-apply
  mechanism below).
- On any failure: catch, log via `console.error` with context, revert
  BOTH `localStorage` AND `state.blurEnabled` to the previous value.

**Auto-apply on Camera Enable (Normative)**:

Every code path that enables the camera in-call MUST check the current
blur setting and apply the processor if blur is ON. This applies to:

1. **`joinCall(scope, withCamera=true)`**: after the camera track is
   published as part of the join sequence, if `state.blurEnabled` is
   `true`, immediately fetch the camera track and call `setProcessor`
   with `showProcessedStreamLocally=true`.
2. **`toggleCamera`** (mid-call re-enable): same flow — after
   `setCameraEnabled(true)` returns, if blur is ON, apply the processor.
3. **`toggleBlur`**: described above.

Without auto-apply, the user toggling blur ON before entering a call
(via Settings) would see the setting "stick" but blur not actually
applied until they manually toggled it again in CallControls. Auto-apply
makes the setting cross-session and cross-camera-toggle persistent
without requiring user re-action.

Failure during auto-apply follows the same path as `toggleBlur` failure:
loud console.error, camera continues unblurred, both state and
localStorage remain at previous value (the auto-apply does NOT flip the
setting if the apply fails — the user-intent of "blur on" stays, but
the current camera session fails to honor it for diagnostic visibility).

### Lazy Loading (MUST)

`@livekit/track-processors` MUST be lazy-loaded via dynamic
`import('@livekit/track-processors')`. Top-level import was previously
crashing the entire call store at module load time (early library
versions had import-time issues). Main bundle size dropped ~150 KB
after switching to lazy import.

The dynamic import is wrapped in a cached loader:

```ts
let _blurModule: {
  BackgroundProcessor: typeof import('@livekit/track-processors').BackgroundProcessor;
  supportsBackgroundProcessors: typeof import('@livekit/track-processors').supportsBackgroundProcessors;
} | null = null;

async function getBlurModule() {
  if (isFirefox) return null;
  if (!_blurModule) {
    try {
      const mod = await import('@livekit/track-processors');
      _blurModule = {
        BackgroundProcessor: mod.BackgroundProcessor,
        supportsBackgroundProcessors: mod.supportsBackgroundProcessors,
      };
    } catch (err) {
      console.error('[Call] Failed to load @livekit/track-processors:', err);
      return null;
    }
  }
  return _blurModule;
}
```

Call sites MUST handle `null` return gracefully (blur simply doesn't
activate, camera continues unblurred).

### Firefox Disable (MUST)

Background blur MUST be disabled on Firefox. `@livekit/track-processors`
background segmentation on Firefox falls back to CPU and freezes the
tab ("slow script" warning, UI unresponsive).

Implementation: `const isFirefox = /firefox/i.test(navigator.userAgent);`.
`getBlurModule()` returns `null` immediately on Firefox. The `[ BLUR ]`
button in CallControls is hidden. The settings toggle is hidden
(see 70-audio-settings.md).

### Error Surfacing (Normative)

Blur failures MUST be logged loudly so a user or diagnostician can see
what went wrong in DevTools. The previous spec allowed silent
`console.warn` which was a contributing factor to incident IT-1 (blur
broken for weeks without error signal).

- Module load failure → `console.error('[Call] Failed to load
  @livekit/track-processors:', err)`
- `supportsBackgroundProcessors()` returns false → `console.warn` with
  explicit reason ("OffscreenCanvas/WebGL2/VideoFrame check failed")
- `setProcessor()` throws → `console.error` with context ("Failed to
  apply background blur on join:" / "... on camera re-enable:" / "...
  toggle:")

Silent degradation is forbidden.

### Failure Modes

| Failure | Handling |
|---|---|
| `@livekit/track-processors` import fails | `getBlurModule()` returns `null` with `console.error`. Call continues without blur. |
| `createBlurProcessor()` throws at construction | Caught, `console.error` with context, state+localStorage reverted to previous, call continues. |
| `track.setProcessor(processor, true)` throws | Caught, `console.error` with context, blur state stays OFF, camera track continues publishing unblurred, state+localStorage BOTH reverted in same operation. |
| `supportsBackgroundProcessors()` returns `false` in `toggleBlur` (user clicked Blur ON in-call but browser capability check fails) | Logged `console.warn` with explicit reason. Camera publishes without blur. **Current (v1.3) behavior**: both `localStorage['video.backgroundBlur']` and `state.blurEnabled` are set to `false` (not left at the user's new intent). Rationale: an explicit in-call click expresses "try it now"; if the browser truly can't do it, the UI reflects reality rather than leaving a setting that cannot be honored. Note: the auto-apply-on-camera-enable path (§45.7 "Auto-apply on Camera Enable") preserves user intent instead — they diverge intentionally. |
| Firefox detected | Blur feature UI hidden entirely. No runtime attempt. |
| MediaPipe WASM/model fetch 404 or fails | Surfaces as `setProcessor()` throw → caught, logged. Self-host fix means this should only happen in truly broken deployments. |
| `showProcessedStreamLocally` flag missing (regression) | Local self-view shows raw camera, remote sees blurred. Symptom: "blur doesn't work for me" while others see it correctly. NO loud error — would surface only via user complaint. **Reimplementer constraint**: always pass `true` as second arg to setProcessor for LocalVideoTrack. |
| CameraPreview srcObject not re-bound after setProcessor | Settings camera preview shows previously-bound stream (raw or stale processed) regardless of current blur state. Symptom: "blur in settings preview is wrong/lagging". **Reimplementer constraint**: re-bind `videoRef.current.srcObject` after every setProcessor/stopProcessor call in CameraPreview.tsx. |
| State/localStorage divergence on failure | Catch-block MUST set BOTH `setBlurEnabled(currentBlur)` AND `localStorage.setItem('video.backgroundBlur', String(currentBlur))`. Setting only one creates a divergence that persists across reloads. |

### Acceptance Criteria

- [ ] AC-19: Background blur toggle exists in Settings (see 70-audio-settings.md §Background Blur Toggle) and persists to `video.backgroundBlur` localStorage key
- [ ] AC-20: `[ BLUR ]` button in CallControls is visible only when camera is ON
- [ ] AC-21: Clicking `[ BLUR ]` toggles blur state on active camera track AND updates BOTH `state.blurEnabled` (React state) AND `localStorage['video.backgroundBlur']` in the same operation
- [ ] AC-22: `@livekit/track-processors` is loaded via dynamic `import()` — no top-level import
- [ ] AC-23: On Firefox, blur button in CallControls is hidden entirely; blur is never applied
- [ ] AC-24: Blur failures are logged via `console.error` with explicit context — NOT silent `console.warn`
- [ ] AC-25: Auto-apply: when camera is enabled (joinCall with-camera, toggleCamera re-enable), if `state.blurEnabled === true`, the processor is applied immediately on the new camera track via `setProcessor(createBlurProcessor(blur), true)`
- [ ] AC-26: Blur uses `BackgroundProcessor({ mode: 'background-blur', blurRadius: 20, assetPaths: {...} })` API — NOT the deprecated `BackgroundBlur(radius)` convenience
- [ ] AC-27: MediaPipe assets are served from `/mediapipe/wasm/` and `/mediapipe/selfie_segmenter.tflite` (same origin) — no `jsdelivr.net`, no `storage.googleapis.com` fetches at runtime
- [ ] AC-28: A Vite build plugin copies `node_modules/@mediapipe/tasks-vision/wasm/*` into `src/client/public/mediapipe/wasm/` at dev + build time
- [ ] AC-29: `src/client/public/mediapipe/wasm/` is gitignored; `selfie_segmenter.tflite` is committed
- [ ] AC-30: On blur failure, both `state.blurEnabled` AND `localStorage['video.backgroundBlur']` are reverted to the previous value in the same catch block (no divergence)
- [ ] AC-31: The Modal `CameraJoinPrompt` component is removed; the camera join UX is a dropdown item in `CallControls`
- [ ] AC-32: `toggleCamera` on re-enable calls `buildCameraConstraints(videoCameraDeviceId)` which returns `{ deviceId }` on desktop and `{ facingMode }` on mobile (via device-label keyword lookup in `src/client/src/lib/camera-constraints.ts`). User's camera choice is preserved across off/on toggles on both platforms. Supersedes the earlier CGL-005 desktop-only fix.
- [ ] AC-33: `BLUR_RADIUS = 20` is the normative blur strength (empirically tuned 2026-04-10/11). Defined as module-level const in BOTH call.tsx and CameraPreview.tsx.
- [ ] AC-34: All 5 `setProcessor` call sites pass `true` as the second argument (`showProcessedStreamLocally`): joinCall(with-camera), toggleCamera(re-enable), toggleBlur, CameraPreview.startPreview, CameraPreview mid-preview useEffect. Without this flag, local self-view shows raw camera while remote sees blurred — silent UX failure.
- [ ] AC-35: CameraPreview.tsx re-binds `videoRef.current.srcObject` to `new MediaStream([track.mediaStreamTrack])` after every `setProcessor` AND `stopProcessor` call. The in-call VideoGrid path does NOT need this because LiveKit's Track.attach()/detach() handles re-binding transparently.
- [ ] AC-36: `state.blurEnabled: boolean` field in CallState is the React-state half of the blur preference, kept in sync with `localStorage['video.backgroundBlur']` on every mutation
- [ ] AC-37: Blur module wrapper (`getBlurModule`, `createBlurProcessor`, `BLUR_RADIUS`, `MEDIAPIPE_*_PATH` constants) is currently duplicated as separate copies in both `call.tsx` and `CameraPreview.tsx` (acknowledged tech debt; dedup is a follow-up). Both copies MUST stay in sync — any change to one MUST be replicated to the other in the same commit.

<!-- DIM-Map §45.7 Background Blur (Updated 2026-04-11 — Blur Delta + F-CSD-012/013/014/015)
  Completeness:        ✓ (two UI surfaces, BLUR_RADIUS=20 with rationale, BackgroundProcessor API + assetPaths, showProcessedStreamLocally=true MUST at 5 call sites, videoRef re-bind for CameraPreview, module duplication acknowledged, call store API + state.blurEnabled + auto-apply, lazy load, Firefox disable, 9 failure modes, 19 ACs)
  Konsistenz:          ✓ (matcht 70-audio-settings.md blur subsection (post-Phase-A-catchup), same terminology, same BLUR_RADIUS const, same MEDIAPIPE_*_PATH constants)
  Implementierbarkeit: ✓ (exact API: getBlurModule signature, createBlurProcessor with default arg, BLUR_RADIUS const, setProcessor 2-arg signature, stopProcessor, toggleBlur return type, srcObject re-bind code example, auto-apply path enumerated)
  Interface-Vertraege: ✓ (toggleBlur(): Promise<void>, getBlurModule(): Promise<{...} | null>, BackgroundProcessor constructor signature, LocalVideoTrack.setProcessor(processor, showProcessedStreamLocally) signature, state.blurEnabled: boolean field)
  Abhaengigkeiten:     ✓ (@livekit/track-processors lazy-import, MediaPipe @mediapipe/tasks-vision, navigator.userAgent, localStorage, React state via setBlurEnabled)
-->

<!-- DIM-Map §45.5 VideoGrid Tile Anatomy + Track Subscription (Updated 2026-04-11 — F-CSD-005/006/007/008/009)
  Completeness:        ✓ (tile container styles incl bg-input + overflow:hidden, video element styles incl mirror + muted, username badge full styling + [ you ] self-label, [M] muted badge with error color, 8-event RoomEvent set, 3-gate eligibility filter)
  Konsistenz:          ✓ (matcht 30-chat ActiveUsersStrip terminology, references 40-voice §40.10 for audio handling separation)
  Implementierbarkeit: ✓ (exact CSS property names + values, exact RoomEvent names, exact filter expression with three conjuncts)
  Interface-Vertraege: ✓ (LiveKit RoomEvent enum members, RemoteTrackPublication.isMuted, MediaStreamTrack.readyState enum)
  Abhaengigkeiten:     ✓ (livekit-client RoomEvent, browser MediaStreamTrack API, CSS variables theme.css)
-->

---

## 45.5 VideoGrid

### When the Grid Renders

The VideoGrid renders inside a room view (not DM view) when at least one
participant in the current call has camera enabled. If no one has camera
enabled, the VideoGrid is not rendered (zero height, no placeholder).

### CSS Approach

The VideoGrid uses a mix of inline styles (dynamic values) and CSS classes
(pseudo-elements, at-rules) in `src/client/src/styles/theme.css`.

CSS class prefix: `.video-grid-*` (e.g., `.video-grid-container`,
`.video-grid-tile`).

### Grid Container

The VideoGrid has an **outer container** wrapping the grid:

- **Background:** `var(--bg-surface)` -- distinct from the chat area (`var(--bg-base)`).
- **Padding:** `var(--space-2)` (8px) around the inner grid.
- **Bottom border:** `1px solid var(--border-default)`.
- The container establishes the dark "stage" that tiles sit on.

### Grid Layout Rules by Participant Count

"Participants" here means users with camera currently enabled.
All layouts use CSS Grid with `1fr` columns. No `calc()` formulas -- grid
handles gap distribution automatically.

| Camera-on count | Layout | CSS Grid |
|---|---|---|
| 1 | Single tile, centered | `grid-template-columns: 1fr`, tile `max-width: 640px`, `justify-self: center` |
| 2 | Two tiles side by side | `grid-template-columns: 1fr 1fr` |
| 3-4 | 2x2 grid | `grid-template-columns: 1fr 1fr` |
| 5-6 | 2x3 grid | `grid-template-columns: 1fr 1fr` |
| 7-8 | 2x4 grid, scrollable | `grid-template-columns: 1fr 1fr` |
| 9+ | 3-column grid, scrollable | `grid-template-columns: 1fr 1fr 1fr` |

- **Gap:** `var(--space-2)` (8px) between tiles.
- **1-4 tiles:** No maxHeight constraint (aspect-ratio determines height).
- **5+ tiles:** `maxHeight: 500px` with `overflowY: auto`.

**Narrow-Viewport Override (Normative):** On viewports `<= 500px` wide,
the grid collapses to a single column (`grid-template-columns: 1fr`)
regardless of participant count — implemented via
`@media (max-width: 500px) { .video-grid-inner { grid-template-columns:
1fr !important } }` in `theme.css`. Rationale: a 2-column grid at
<500px leaves each tile under 240px wide and the [M] / username badges
overlap the video. Single-column stacking combined with the existing
`maxHeight: 500px` + vertical scroll (for count ≥5) keeps all tiles
legible. The `!important` is required because the per-count
`gridTemplateColumns` is set inline on `.video-grid-inner`.

Self-preview (local user's own camera) is always shown as the first tile,
top-left, regardless of join order.

### 16:9 Aspect Ratio

All grid-mode tiles maintain 16:9 aspect ratio:

- Use `aspect-ratio: 16/9` CSS property on each tile.
- Video element: `object-fit: cover` -- fills the 16:9 container, cropping excess.
- No fixed `height` or `maxHeight` on grid-mode tiles. Aspect ratio + container
  width determine tile height naturally.

**`@supports` fallback:** In `theme.css`:
```css
.video-grid-tile {
  aspect-ratio: 16 / 9;
}
@supports not (aspect-ratio: 16 / 9) {
  .video-grid-tile {
    height: 200px;
  }
}
```

### Tile Anatomy

Each tile contains:

**Tile container** (the outer `<div>`):
- `position: relative` (anchor for absolute-positioned overlays)
- `background: var(--bg-input)` — dark slot color shows through if the
  video isn't yet attached or has black bars
- `overflow: hidden` — clips the speaking-indicator inset box-shadow
  and prevents overflow from oversize video frames
- `border: 1px solid var(--border-default)` (always visible, see Tile
  Borders section)
- `box-shadow` toggles for speaking state (see Tile Borders)
- `transition: box-shadow 200ms` for smooth speaking on/off

**Video element**:
- `width: 100%`, `height: 100%`
- `object-fit: cover` — fills the 16:9 tile, crops excess (preserves
  aspect within tile)
- `display: block`
- `autoPlay`, `playsInline`
- `muted={info.isLocal}` — local self-preview is always muted (no
  audio echo); remote videos are NOT muted (audio is handled separately
  via `<audio>` elements per `40-voice §40.10`, but defaultMuted state
  on `<video>` is false for non-local)
- Mirror transform when local + `mirrorSelfView` setting is ON:
  `transform: scaleX(-1)`

**Username badge** — bottom-left, `[ username ]` format:
- Position: `absolute`, `bottom: var(--space-2)`, `left: var(--space-2)`
- `font-family: var(--font-mono)` (IBM Plex Mono)
- `font-size: var(--text-xs)`
- `color: var(--text-muted)`
- `background: rgba(26, 26, 46, 0.8)`
- `padding: 2px 6px`
- `letter-spacing: 0.02em`
- **Self-label**: when `info.isLocal === true`, the badge shows
  `[ you ]` (literal "you"), NOT the username. This is intentional —
  the user knows their own name; "you" is a clearer self-pointer in
  the grid context.
- Remote tiles show `[ {username} ]`.
- `data-testid="username-badge"`

**Muted badge** — bottom-right, shown only when `info.isMuted === true`:
- Position: `absolute`, `bottom: var(--space-2)`, `right: var(--space-2)`
- Content: literal `[M]` (NOT `[ MUTED ]`, NOT a microphone icon)
- `font-family: var(--font-mono)`
- `font-size: var(--text-xs)`
- `color: var(--error)` — red, drawing eye attention
- `background: rgba(26, 26, 46, 0.8)`
- `padding: 2px 6px`
- `data-testid="muted-badge"`

### Tile Borders & Speaking Indicator

- **Tile border (idle):** `1px solid var(--border-default)` -- always visible.
- **Tile border (speaking):** Idle border stays. Additionally, apply
  `box-shadow: inset 0 0 0 2px var(--accent)` for the speaking highlight.
  This renders inside the border-box, is not clipped by `overflow: hidden`,
  and causes no layout shift. Transition: `box-shadow 200ms`.

Note: `outline` is NOT used because it renders outside the border-box and
would be clipped by the tile's `overflow: hidden`. The `box-shadow` constraint
in the Constraints section is limited to decorative drop shadows -- the
inset box-shadow for speaking indication is explicitly allowed.

No border-radius on any element (TTY constraint).
No drop shadows.
No loading spinners -- if track not yet attached, tile shows dark background.

### Scrollbar Styling

In `theme.css` via CSS class `.video-grid-container--scrollable`:
```css
.video-grid-container--scrollable::-webkit-scrollbar {
  width: 6px;
}
.video-grid-container--scrollable::-webkit-scrollbar-track {
  background: var(--bg-input);
}
.video-grid-container--scrollable::-webkit-scrollbar-thumb {
  background: var(--accent-muted);
}
```
Firefox: `scrollbar-width: thin; scrollbar-color: var(--accent-muted) var(--bg-input);`

### Track Subscription (Normative)

The VideoGrid maintains its `tracks` array by subscribing to a SET of
LiveKit RoomEvents and re-running its track-collection logic on each
event. The complete event set is:

```ts
room.on(RoomEvent.TrackSubscribed, updateTracks);
room.on(RoomEvent.TrackUnsubscribed, updateTracks);
room.on(RoomEvent.TrackPublished, updateTracks);
room.on(RoomEvent.TrackUnpublished, updateTracks);
room.on(RoomEvent.LocalTrackPublished, updateTracks);
room.on(RoomEvent.LocalTrackUnpublished, updateTracks);
room.on(RoomEvent.TrackMuted, updateTracks);
room.on(RoomEvent.TrackUnmuted, updateTracks);
```

All eight events are needed:

- `TrackSubscribed` / `TrackUnsubscribed`: remote camera availability
- `TrackPublished` / `TrackUnpublished`: remote participant publishes
  or stops camera (separate from subscription state)
- `LocalTrackPublished` / `LocalTrackUnpublished`: local user enables
  / disables camera
- `TrackMuted` / `TrackUnmuted`: camera muted state changes (so the
  tile updates its `[M]` badge — see Tile Anatomy)

`updateTracks` re-walks the participant list, collecting eligible
camera tracks. The cleanup function (`useEffect` return) calls
`room.off(...)` for every registered handler.

**Track Eligibility Filter**:

Each candidate camera publication MUST pass three gates before being
included as a tile:

```ts
if (
  pub?.track?.mediaStreamTrack &&
  !pub.isMuted &&
  pub.track.mediaStreamTrack.readyState === 'live'
) {
  // include in tracks array
}
```

1. **`pub.track.mediaStreamTrack` exists**: track is published and
   the underlying MediaStreamTrack is hydrated.
2. **`!pub.isMuted`**: track is not muted (LiveKit's track-level
   mute, not the participant's mic mute — for camera, this is "is the
   camera turned off currently").
3. **`mediaStreamTrack.readyState === 'live'`**: the underlying browser
   MediaStreamTrack is in `'live'` state, not `'ended'`. Tracks can
   transition to `'ended'` without LiveKit firing a clean unsubscribe
   in some edge cases (device unplug, OS audio service crash). The
   readyState check is the definitive "is this track actually
   producing frames" gate.

Without all three gates, the tile would render but show black or
frozen content, breaking the user's mental model of "tile = live
camera".

### Camera Off -- Tile Behavior

When a participant turns camera off:
- Their tile is removed from the grid immediately.
- Grid re-flows to the appropriate layout for the new count.
- If camera-on count reaches 0, VideoGrid unmounts entirely.

### Self-Preview when Not in Call

If the local user is not in the call, there is no self-preview. VideoGrid
only renders for the active call scope.

### DM Calls

VideoGrid does not render as a full grid in DM view. Camera tiles in DM
calls are shown in a simplified strip above the message area (max 2 tiles).

- Layout: `display: grid`.
  - 1 tile: `grid-template-columns: 1fr`, tile `max-width: 400px` (not fullscreen).
  - 2 tiles: `grid-template-columns: 1fr 1fr`.
- Gap: `var(--space-2)`.
- Tiles use `aspect-ratio: 16/9` (same CSS class `.video-grid-tile` as grid mode).
- Tile border: `1px solid var(--border-default)` (always visible).
- Speaking: `box-shadow: inset 0 0 0 2px var(--accent)` (same as grid mode).
- Outer container: `var(--bg-surface)` background, `var(--space-2)` padding,
  centered via `justify-content: center`.
- Bottom border: `1px solid var(--border-default)` on outer container.

Tile anatomy is identical to grid mode.

### Constraints

- MUST NOT add `border-radius` to any element (TTY constraint).
- MUST NOT add decorative `box-shadow` / `drop-shadow` to any element.
  The `inset box-shadow` for speaking indication is explicitly allowed.
- MUST NOT change the track subscription or LiveKit event logic.
- MUST NOT change the self-preview sorting logic (isLocal first).
- MUST NOT change the mirror self-view behavior.
- Changes are CSS/layout only. No functional behavior changes.

### Failure Modes

| Failure | Handling |
|---------|----------|
| `aspect-ratio` not supported (very old browser) | Fallback via `@supports` in CSS: tiles use fixed height 200px. |
| Single tile too wide on very wide screens | `max-width: 640px` + `justify-self: center` on tile. |
| Scrollbar invisible on macOS (overlay scrollbar) | CSS scrollbar styling provides visible thin scrollbar. |

### Acceptance Criteria

- [x] AC-01: VideoGrid does not render when zero participants have camera enabled
- [x] AC-02: Self-preview is always tile 0
- [x] AC-03: Speaking indicator (accent border) updates in real time
- [x] AC-04: Camera-off participant is removed immediately, grid re-flows
- [x] AC-05: Username label uses `[ {username} ]` format for remote tiles, `[ you ]` literal for the local self-tile (NOT the local user's actual username)
- [x] AC-06: DM call shows simplified strip, not full grid
- [ ] AC-07: Grid outer container has `var(--bg-surface)` bg + `var(--space-2)` padding + bottom border
- [ ] AC-08: Gap between tiles is `var(--space-2)` (8px)
- [ ] AC-09: Every tile has `1px solid var(--border-default)` border always visible
- [ ] AC-10: Speaking tile has `box-shadow: inset 0 0 0 2px var(--accent)` without layout shift
- [ ] AC-11: Grid-mode tiles have `aspect-ratio: 16/9` (with @supports fallback to 200px)
- [ ] AC-12: Layout matches count-to-layout table (1→centered, 2-8→2col, 9+→3col)
- [ ] AC-13: 5+ tiles: scrollable grid, maxHeight 500px, styled scrollbar
- [ ] AC-14: Username badge: `font-family: var(--font-mono)`, `font-size: var(--text-xs)`, `color: var(--text-muted)`, `letter-spacing: 0.02em`, `background: rgba(26,26,46,0.8)`, `padding: 2px 6px`, offset `var(--space-2)`
- [ ] AC-15: Muted badge: literal `[M]` content, `color: var(--error)` (red), same `font-family: var(--font-mono)` + `font-size: var(--text-xs)` + `background: rgba(26,26,46,0.8)` + `padding: 2px 6px` as username badge
- [ ] AC-16: DM strip: gap 8px, container bg+padding, tile borders
- [ ] AC-17: No border-radius, no decorative drop shadows
- [ ] AC-18: Self-preview mirror works (from audio-settings mirror toggle)
- [ ] AC-38: Tile container has `background: var(--bg-input)` and `overflow: hidden` (latter required to clip the inset speaking box-shadow and prevent overflow from oversize video frames)
- [ ] AC-39: Local self-tile uses `<video muted={true}>` to prevent audio echo; remote tiles use `<video muted={false}>` (audio is handled separately via `<audio>` elements per `40-voice §40.10`)
- [ ] AC-40: VideoGrid subscribes to all 8 RoomEvents: TrackSubscribed, TrackUnsubscribed, TrackPublished, TrackUnpublished, LocalTrackPublished, LocalTrackUnpublished, TrackMuted, TrackUnmuted
- [ ] AC-41: Track eligibility filter requires all three gates: `pub.track.mediaStreamTrack` exists AND `!pub.isMuted` AND `pub.track.mediaStreamTrack.readyState === 'live'`

## 45.8 Expanded Video Mode

### Intent

During video calls with 2+ cameras, the VideoGrid shares vertical space with
the message list — tiles become small and faces hard to see. Expanded mode
gives the video call maximum screen area while keeping chat accessible via
an optional overlay.

### Scope

Applies to **Room calls only**. DM calls use strip mode (max 2 tiles) and
don't need expansion — the strip is already compact and the message area
remains usable.

### Toggle Button

A new **Expand** icon button is added to CallControls, visible only when
the user is in a call AND at least one camera is active (including own).

- Icon: `Maximize2` (lucide) when collapsed, `Minimize2` when expanded.
- Position: between the blur toggle and the leave button.
- Color: `var(--accent)` when expanded, `var(--text-muted)` when collapsed.
- Label: "Expand video" / "Collapse video".

Keyboard: `Escape` exits expanded mode. No keyboard shortcut to enter
(avoids accidental activation).

### Layout — Expanded

When expanded mode is active, the content area inside MembershipGate changes:

```
Content Area (flex: 1, position: relative, overflow: hidden)
├─ ScreensharePreview (flexShrink: 0, unchanged)
├─ VideoGrid (flex: 1, fills remaining vertical space)
├─ [MessageList — hidden]
├─ [TypingIndicator — hidden]
├─ [MessageInput — hidden]
├─ [Read-only banner — hidden]
└─ ChatOverlay (position: absolute, right: 0, conditional)
```

- VideoGrid receives `expanded={true}` prop. In this mode:
  - Outer container gets `flex: 1` and `display: flex; flexDirection: column`.
  - Inner grid gets `flex: 1` to fill vertical space.
  - `maxHeight` constraint is removed (no 500px cap).
  - Tiles grow proportionally to fill available space.
  - Grid layout rules (column count by participant count) remain unchanged.
- MessageList, MessageInput, TypingIndicator, and the read-only banner get
  `display: none` (DOM preserved, no unmount — scroll position survives).

### Chat Overlay

A toggle to show the chat panel overlaid on top of the expanded video grid.

**Toggle button:** `MessageSquare` icon (lucide), added to CallControls,
visible only when expanded mode is active.

- Color: `var(--accent)` when overlay open, `var(--text-muted)` when closed.
- Position: after the expand button.
- Label: "Show chat" / "Hide chat".

**Overlay panel:**

```
ChatOverlay (position: absolute)
├─ top: 0, right: 0, bottom: 0
├─ width: 340px
├─ background: rgba(26, 26, 46, 0.92)
├─ border-left: 1px solid var(--border-default)
├─ z-index: 20
├─ display: flex, flexDirection: column
│
├─ Header (flexShrink: 0)
│  └─ "[ CHAT ]" label + close button (X)
│
├─ MessageList (flex: 1, overflow: auto)
│
├─ TypingIndicator (flexShrink: 0)
│
└─ MessageInput (flexShrink: 0)
```

- The overlay is a sibling of VideoGrid, not a child — positioned absolutely
  within the content area container (which needs `position: relative`).
- The overlay does NOT resize or reflow the VideoGrid. It floats on top.
- The MessageList and MessageInput in the overlay are the SAME components
  used in normal mode (same props, same room context). They are rendered
  conditionally: either in the normal flow (non-expanded) or in the overlay
  (expanded + overlay open).
- When the overlay is closed and expanded mode is active, the chat components
  are not rendered (hidden via `display: none` in normal position, overlay
  not mounted).
- Background uses `rgba(26, 26, 46, 0.92)` — the base color at 92% opacity.
  This keeps video faintly visible behind the chat while maintaining text
  readability.

**Slide-in animation:**
- Entry: `transform: translateX(100%) → translateX(0)`, `transition: transform 200ms ease-out`.
- Exit: reverse. Use CSS transition, not JS animation.

### State

Two boolean states, local to RoomView (not in a global store):

```typescript
const [videoExpanded, setVideoExpanded] = useState(false);
const [chatOverlayOpen, setChatOverlayOpen] = useState(false);
```

- `videoExpanded` defaults to `false`. Set via toggle button.
- `chatOverlayOpen` defaults to `false`. Only relevant when `videoExpanded`
  is `true`. Auto-resets to `false` when `videoExpanded` becomes `false`.
- Both reset to `false` when the call ends (activeScope changes or
  connectionState becomes Disconnected).

No persistence. Fresh on each call.

When the user navigates to a different room or DM, `videoExpanded` and
`chatOverlayOpen` reset to `false` (RoomView unmounts and remounts with
new roomId key — React handles this automatically).

### Auto-Exit

Expanded mode exits automatically when:
1. User leaves the call (leaveCall or disconnect).
2. All cameras turn off (camera-on count drops to 0, VideoGrid would unmount).

Expanded mode does NOT auto-activate. Manual toggle only.

### DM View

No changes. DM calls use strip mode and are unaffected by this feature.

### Mobile

On mobile the sidebar is already hidden. Expanded mode fills the full
viewport width (minus nothing). The chat overlay uses `width: min(340px, 85vw)`
to avoid covering the entire screen on narrow devices.

### Failure Modes

| Failure | Handling |
|---------|----------|
| Overlay wider than viewport (very narrow screen) | `width: min(340px, 85vw)` caps it. |
| User ESC while chat overlay open | Closes overlay first. Second ESC exits expanded mode. |
| Call ends while expanded + overlay open | Both states reset to false. Normal layout restores. |
| Camera count drops to 0 while expanded | Exit expanded mode (VideoGrid would unmount anyway). |
| Screenshare active + expanded | ScreensharePreview stays above VideoGrid (unchanged position, flexShrink: 0). |

### Acceptance Criteria

- [ ] AC-E01: Expand button visible in CallControls when in call and ≥1 camera active
- [ ] AC-E02: Clicking expand toggles VideoGrid to fill content area
- [ ] AC-E03: MessageList/Input hidden in expanded mode (not unmounted)
- [ ] AC-E04: Chat overlay button visible only in expanded mode
- [ ] AC-E05: Chat overlay appears as right-side panel (340px, semi-transparent bg)
- [ ] AC-E06: Chat overlay does not reflow VideoGrid (absolute positioning)
- [ ] AC-E07: Can read and send messages in chat overlay
- [ ] AC-E08: ESC closes overlay first, then exits expanded mode on second press
- [ ] AC-E09: Expanded mode auto-exits when call ends
- [ ] AC-E10: Expanded mode auto-exits when all cameras turn off
- [ ] AC-E11: ScreensharePreview remains visible in expanded mode
- [ ] AC-E12: Slide-in animation on overlay (200ms ease-out)
- [ ] AC-E13: No border-radius, no decorative shadows (TTY constraint)
- [ ] AC-E14: Mobile: overlay width capped at 85vw
- [ ] AC-E15: State resets on call end (no stale expanded state)
- [ ] AC-E16: RoomView camera-count uses the same 3-gate filter
      (`mediaStreamTrack && !isMuted && readyState==='live'`) as
      VideoGrid.tsx, subscribed to the same 8 RoomEvents — keeping
      `hasCameras` in sync with the grid. Acknowledged duplication;
      follow-up work could extract into a shared `useCameraCount`
      hook.
- [ ] AC-28b: Dev server sets `Content-Type: application/octet-stream`
      for `.tflite` responses via Vite `configureServer` middleware.
- [ ] AC-42: On viewports `<= 500px` wide, `.video-grid-inner`
      `grid-template-columns` is forced to `1fr` via `@media`.
- [ ] AC-43: `src/client/src/lib/camera-constraints.ts` exports
      `buildCameraConstraints(deviceId)` with desktop-deviceId /
      mobile-facingMode branching via
      `MOBILE_UA_RE = /iPhone|iPad|iPod|Android/i`.
