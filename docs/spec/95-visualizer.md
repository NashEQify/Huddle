intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Winamp-style audio visualization as a hidden gimmick feature
  action: Defines the Milkdrop visualizer entry point, fullscreen experience, audio capture via output device monitor, preset management, auto-hide menu, keyboard controls, and cleanup behavior

| | |
|---|---|
| **Layer** | Frontend |
| **Status** | aktuell |
| **spec_version** | 1.3.0 |
| **Konsumiert** | overview, 70-audio-settings, 75-user-settings |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 9 findings applied): §95.3.4 `connectAudio(stream, externalContext?)` 2-arg signature + CGL-012 ownership-transfer documented (F-CSD-9501); §95.3.6 installer rewritten end-to-end (commit fd2bbe9) — clipboard recipe uses single-quoted heredocs (NOT `printf '%s\n'`), service `ExecStart` runs the wrapper, `start` (not `enable --now`), no `[Install]` section (F-CSD-9502/9505); new §95.3.6.1 "Idle Watchdog Wrapper" subsection documenting `IDLE_TIMEOUT`/`GRACE_PERIOD`/`CHECK_INTERVAL` + `pw-link -ol` consumer detection + exit-code semantics (F-CSD-9504); setup-script subcommands updated — no post-install enable/verify (F-CSD-9503). §95.5.1 copy-hint text corrected to "copied! paste in terminal — installs + starts with auto-shutdown." (F-CSD-9507). §95.6.6 incoming-call banner rewritten — Lucide `Phone`/`PhoneMissed` IconButtons (not bracket text); accept in-flight exit-fullscreen-THEN-accept ordering (F-CSD-9508/9509); caller-username fetch semantics documented (F-CSD-9510). New §95.8.4 beforeunload safety net (Brave+PipeWire mic-indicator rationale) (F-CSD-9511). History: 2026-04-14 — Task 009 Batch 2 retroactive sync. |

## Was diese Spec beschreibt

A hidden Winamp-style audio visualizer built into the Huddle app. Uses [Butterchurn](https://github.com/jberg/butterchurn), a WebGL 2.0 JavaScript port of [Milkdrop](https://en.wikipedia.org/wiki/MilkDrop) -- Winamp's legendary music visualization plugin that renders real-time reactive graphics driven by audio frequency data.

The primary use case is visualizing music playing on the user's computer (Spotify, YouTube, local files). Audio is captured from the **monitor source** (a loopback audio input that mirrors what plays through an output device) of the playback device already configured in Huddle's Audio Settings (spec 70, localStorage key `audio.outputDeviceId`). On Linux with PipeWire/PulseAudio, monitor sources are exposed automatically (with browser-specific caveats -- see 95.3.1 Strategy 0). On Windows, "Stereo Mix" serves the same purpose.

When monitor capture fails AND the user is currently in an active LiveKit call with remote participants, the visualizer transparently falls back to a **call-audio tap** (§95.3.7) — attaching to the `<audio id^="lk-audio-*">` elements LiveKit creates for remote tracks. This is a secondary path, not the primary use case, and is reported to the UI as `audioSource === 'call'`. When neither path produces audio, the user lands in the "No Audio" state (§95.5) with cross-platform setup hints.

A small waveform icon in the header opens a fullscreen visualization. The feature is a gimmick -- it must never impact the core app functionality.

Architecture decisions: D-016 (Butterchurn engine), D-017 (audio monitor capture -- user override of council), D-018 (curated presets).

---

# 95. Audio Visualizer (Normative)

## 95.1 Entry Point

A waveform icon button in the top header bar. Position: right side of the header, between the call indicator area and the "Huddle" brand span.

### 95.1.1 Icon Design

- Inline SVG: 5 vertical bars of varying height (`[40, 70, 100, 55, 80]`% of 20px container height). Bar width 3px, gap 2px.
- Idle state: `var(--text-muted)` fill color.
- Hover state: `var(--accent)` fill color, CSS transition 200ms on the `fill` property.
- No tooltip. The icon is intentionally cryptic -- discovery is part of the charm.
- No animation in idle state (zero CPU cost when not in use).
- On hover: trigger preload of the Butterchurn lazy chunk (`import('../../lib/visualizer/VisualizerEngine')`) so it is cached when the user clicks. This is a performance optimization, not a requirement -- the feature must work without preload. The preload runs once per session (guarded by a ref).

<!-- DIM-Map §95.1.2 click behavior
  Completeness:        ✓ (pre-fullscreen permission warm-up now described)
  Konsistenz:          ✓ (explains 95.3.1 label-unlock dependency)
  Implementierbarkeit: ✓ (fire-and-forget call, stop tracks immediately)
  Interface-Vertraege: ✓ (getUserMedia(audio:true) contract, error ignored)
  Abhaengigkeiten:     ✓ (depends on browser mediaDevices.getUserMedia)
-->

### 95.1.2 Click Behavior

1. **Pre-fullscreen permission warm-up (MUST)**: Before calling `requestFullscreen()` the click handler fires `navigator.mediaDevices.getUserMedia({ audio: true })` fire-and-forget. On resolve, all tracks are stopped immediately. On reject, the error is swallowed (the subsequent capture path still attempts on its own). Rationale: some browsers block permission prompts while a fullscreen element is active; warming permission outside fullscreen is what lets Firefox expose monitor-source labels later during enumerate (§95.3.1).
2. Click triggers `requestFullscreen()` on the visualizer container element.
   - The container is a lightweight `<div>` that is always in the DOM (rendered via React portal on `document.body`). Only Butterchurn and presets are lazy-loaded inside it.
   - The `requestFullscreen()` call MUST be synchronous within the click handler (browser user-gesture requirement). The warm-up in step 1 is non-blocking (promise fired, not awaited) so synchronicity is preserved.
3. Inside the now-fullscreen container:
   a. If Butterchurn is not yet loaded: show `[ LOADING VISUALIZER... ]` in `var(--text-muted)` on black background while the dynamic `import()` completes.
   b. Once loaded: initialize Butterchurn, start audio capture (95.3), begin rendering.
4. Canvas dimensions are set AFTER fullscreen is active (read `window.innerWidth` / `window.innerHeight` inside a `requestAnimationFrame` callback after `fullscreenchange` fires).

### 95.1.3 Fullscreen Container

- A `<div>` rendered via React portal on `document.body`.
- Contains: WebGL canvas (100% viewport) + auto-hide menu overlay.
- `z-index: 100000` (above all existing overlays: settings=102, lightbox=10000, emoji=10000).
- Background: `#000000`. Exception to design skill's "never pure black" rule -- documented here because visualizations need a true black canvas. The menu overlay uses `rgba(31, 31, 53, 0.85)` per design system.
- When fullscreen is active: most app overlays are below the fullscreen stacking context. However, incoming DM calls are surfaced inside the visualizer via a dedicated banner at the top of the fullscreen container (see 95.6.6). Ongoing calls continue in the background.
- The container `<div>` is always rendered in the DOM but with zero dimensions (`width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none`) when inactive. Not `display:none` -- some browsers reject `requestFullscreen()` on hidden elements. When active (`isActive` state is true), it becomes `position: fixed; inset: 0`. Butterchurn and presets are loaded via dynamic `import()` inside the active container.

---

## 95.2 Visualization Engine

<!-- DIM-Map §95.2 engine
  Completeness:        ✓ (extra declared module paths listed for completeness)
  Konsistenz:          ✓ (imports match declared subset; /lib/ paths declared but unused)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (VisualizerInstance exposes render/setRendererSize/connectAudio)
  Abhaengigkeiten:     ✓
-->

Butterchurn (npm: `butterchurn` + `butterchurn-presets`).

Neither package ships TypeScript declarations. Ambient type declarations in `src/client/src/types/butterchurn.d.ts` cover the following modules (imported modules marked IMPORTED; others are declared for completeness but not currently imported anywhere):

```typescript
declare module 'butterchurn' { ... }                                  // IMPORTED (95.2.1)
declare module 'butterchurn/dist/isSupported.min' { ... }             // IMPORTED (95.2.4)
declare module 'butterchurn/lib/isSupported.min' { ... }              // declared-only (require() path crashes in browsers)
declare module 'butterchurn-presets' { ... }                          // IMPORTED (95.4.1)
declare module 'butterchurn-presets/minimal' { ... }                  // declared-only
declare module 'butterchurn-presets/dist/minimal.min' { ... }         // IMPORTED (95.4.1)
declare module 'butterchurn-presets/lib/butterchurnPresetsMinimal.min' { ... }  // declared-only
```

The `VisualizerInstance` interface explicitly exposes `render()`, `setRendererSize()`, and `connectAudio(input: MediaStream | AudioNode)` signatures.

### 95.2.1 Initialization

```typescript
import butterchurn from 'butterchurn';

const visualizer = butterchurn.createVisualizer(audioContext, canvas, {
  width: canvas.width,
  height: canvas.height
});
visualizer.connectAudio(gainNode);     // connects to GainNode, NOT sourceNode
visualizer.loadPreset(presetObject, 0); // 0s blend for initial load
```

### 95.2.2 Render Loop

- Uses `requestAnimationFrame` with FPS throttling.
- Default FPS cap: 30 FPS.
- Throttle: track `lastRenderTime`. Skip frame if `now - lastRenderTime < 1000 / fpsCap`.
- Store the `requestAnimationFrame` ID in a ref for cleanup. On pause/resume (visibility), cancel the old ID and start a new loop -- do not reuse stale IDs.

### 95.2.3 Canvas Sizing

- Canvas dimensions set after fullscreen is active (`fullscreenchange` event triggers `requestAnimationFrame`, which reads `window.innerWidth` / `window.innerHeight`).
- `visualizer.setRendererSize(width, height)` called on resize.
- Listen to `resize` event for display changes (e.g., resolution switch).

### 95.2.4 Browser Support Check

- After Butterchurn is lazy-loaded, call its support check.
- Import path: `import isSupported from 'butterchurn/dist/isSupported.min'`. The `/lib/` path uses `require()` and crashes in browsers.
- If `!isSupported()`: show `[ VISUALIZER ERROR ] WebGL 2.0 not available` in the fullscreen container, exit fullscreen after 3 seconds.

---

<!-- DIM-Map §95.3 audio capture
  Completeness:        ✓ (monitor path, call-audio fallback, no-audio state all documented)
  Konsistenz:          ✓ (AudioSourceType = 'monitor' | 'call' | 'none' matches code)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (captureMonitorAudio, captureCallAudio, findMonitorSource signatures)
  Abhaengigkeiten:     ✓ (pw-loopback on Linux; LiveKit <audio> elements for call fallback)
-->

## 95.3 Audio Capture

The visualizer tries in order: (1) monitor/loopback capture of the output device configured in Huddle's Audio Settings (localStorage key `audio.outputDeviceId`, see spec 70), then (2) a **call-audio tap** fallback when the user is in an active LiveKit call with remote participants (§95.3.7), and finally (3) the "No Audio" state (§95.5) with cross-platform setup instructions.

The `AudioSourceType` in code is `'monitor' | 'call' | 'none'` — this is the authoritative state tag the UI reads (e.g. the auto-hide menu stays visible only when `'none'`).

**Note on the device picker**: earlier revisions of this spec described a fallback `[ SELECT AUDIO SOURCE ]` picker listing all `audioinput` devices. The current implementation does NOT render such a list — when monitor detection fails AND the call-tap fallback finds no `<audio id^="lk-audio-*">` elements, the "No Audio" state shows platform setup instructions instead (§95.5). The §95.3.4 that existed in v1.1.0 has been removed accordingly.

### 95.3.1 Monitor Source Detection

When the visualizer initializes (inside the fullscreen container, after Butterchurn loads):

1. Read `audioOutputDeviceId` from localStorage (`audio.outputDeviceId`). If empty string: use system default output.
2. Call `navigator.mediaDevices.enumerateDevices()`.
   - Device labels are available because the user has already granted microphone permission for calls.
   - If input device labels are empty (permission not yet granted): attempt a temporary `getUserMedia({ audio: true })` call to trigger permission, then enumerate again, then stop the temporary stream.
3. Find the selected output device in the `audiooutput` devices by `deviceId`. Get its `label`. If no specific output matched, fall back to the default output device.
4. Search `audioinput` devices for a monitor source. Match strategies (tried in order):
   0. Label contains `"huddle"` AND `"capture"` (case-insensitive) -- PipeWire
      virtual source created by `pw-loopback` with the name `Huddle_Audio_Capture`.
      This is the primary strategy on Linux for **all browsers**, not just
      Chromium. Initially the rationale was "Chromium doesn't expose monitor
      sources" — but in practice Firefox Snap/Flatpak packaging also fails
      to expose PipeWire monitor sources reliably. The named remap-source
      workaround is needed across the Linux browser landscape.
      See §95.3.6 for the setup script that creates this source.
   a. Label starts with `"Monitor of "` + exact output label match (PipeWire/PulseAudio convention). Works in Firefox which does expose monitor sources.
   b. Label contains `"monitor"` (case-insensitive) AND contains a significant substring of the output label (full label first, then first 20+ chars for truncated labels).
   c. Label matches `"Stereo Mix"` or `"What U Hear"` (case-insensitive) -- Windows loopback devices.
   d. Label contains `"loopback"` (case-insensitive) -- generic loopback devices.
   e. ANY `audioinput` device with `"monitor"` in the label (case-insensitive) -- last resort, always tried regardless of output label matching.
5. If match found: `getUserMedia({ audio: { deviceId: { exact: monitorDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`. All voice processing is explicitly disabled -- echo cancellation removes the output signal (it IS the "echo"), noise suppression kills non-voice frequencies, and auto gain control adjusts levels unpredictably.
6. If no match found OR `getUserMedia` throws for the matched monitor: try the **call-audio tap fallback** (§95.3.7). If that also returns null, enter "No Audio" state (§95.5) with cross-platform setup instructions (§95.5.1).

### 95.3.2 Failure Modes

| Condition | Behavior |
|-----------|----------|
| `audioOutputDeviceId` is empty | Use default output, search for any monitor source |
| No microphone permission (labels empty) | Request temporary permission, retry enumerate |
| Monitor source found but `getUserMedia` fails | Fall through to call-audio tap fallback (§95.3.7); if that also fails, enter "No Audio" state |
| No monitor/loopback device in device list | Fall through to call-audio tap fallback (§95.3.7); if that also fails, enter "No Audio" state |
| Call-tap fallback attempted but no `<audio id^="lk-audio-*">` elements present | Enter "No Audio" state (§95.5) with cross-platform setup instructions |
| Multiple monitor sources match | Use the first match (strategy order determines priority) |
| Output device label is truncated by browser | Substring matching (strategy b) handles partial labels |

### 95.3.3 Audio Pipeline

```
getUserMedia (monitor source)
  -> MediaStream
  -> audioContext.createMediaStreamSource(stream)
  -> GainNode (auto-gain adaptive, see below)
  -> AnalyserNode (fftSize: 2048)
  -> Butterchurn reads via connectAudio(gainNode)
```

Wire order: `sourceNode.connect(gainNode)`, `gainNode.connect(analyserNode)`. Butterchurn is connected to the `gainNode` (not the analyserNode) via `visualizer.connectAudio(gainNode)`.

**Auto-Gain Mechanism**: Different browsers and OS combinations attenuate monitor sources differently (Chromium on PipeWire attenuates ~10x). An adaptive auto-gain compensates:
- A `setInterval` runs every 2000ms.
- Each tick reads `Float32Array` time-domain data from the `AnalyserNode` and measures peak amplitude.
- If peak < 0.001: silence detected, no adjustment (avoids runaway gain).
- Target peak: 0.3. Gain range: 1 (min) to 50 (max).
- Smoothing: gain moves 30% toward the desired value per tick (avoids sudden jumps).
- Initial gain: 1.0 (neutral).

The audio is NOT routed to speakers (no `connect(audioContext.destination)`).

### 95.3.4 connectAudio() Switching Semantics

Engine signature:
```
connectAudio(stream: MediaStream, externalContext?: AudioContext): void
```

When called with a new `MediaStream`:

1. **First** disconnect the existing `sourceNode`, `gainNode`, and `analyserNode` (if any). Order: source → gain → analyser.
2. **Then** stop all tracks of the previous `MediaStream`: `currentStream.getTracks().forEach(t => t.stop())`.
3. **Then** create a fresh `MediaStreamSource` from the new stream, re-wire the gain/analyser chain, and call `visualizer.connectAudio(gainNode)`.

**External-context ownership transfer**: when the caller passes the
optional second argument `externalContext` (the call-tap path does
this with its own short-lived AudioContext — see §95.3.5), ownership
of that context transfers to the engine. The engine closes it in
`destroy()` (CGL-012 fix). On subsequent `connectAudio()` calls with
a DIFFERENT external context, the previous external context is
closed immediately to prevent leaks. If the caller does not pass an
externalContext, only the engine's own AudioContext is owned by the
engine.

**Order matters on PipeWire**: disconnecting audio nodes BEFORE stopping tracks avoids the scenario where `MediaStreamAudioSourceNode` still references a stopped stream and PipeWire keeps the source-output registered (corked but alive). The same order is mandated in the cleanup sequence (§95.8.2).

No `getDisplayMedia` (Tab Audio) path exists. No user-facing device picker exists — audio input selection is handled via `audio.outputDeviceId` (spec 70) plus the monitor detection strategies (§95.3.1) plus the call-tap fallback (§95.3.7).

### 95.3.5 AudioContext Management

- One **engine** AudioContext per visualizer session. Separate from LiveKit's internal AudioContext -- no sharing.
- When the call-tap fallback (§95.3.7) is taken, a **second** short-lived AudioContext is instantiated inside `captureCallAudio()` to merge LiveKit `<audio>` elements into one MediaStream. This tap-AudioContext is separate from the engine context and owns the ChannelMerger + MediaElementSource graph. The monitor-capture path uses only the engine AudioContext.
- Engine AudioContext is created once when the visualizer initializes.
- If the engine AudioContext starts in `'suspended'` state (autoplay policy): `audioContext.resume()` is called immediately (the user has already clicked, satisfying the user-gesture requirement).
- `audioContext.suspend()` on `visibilitychange` (hidden) for the engine context.
- `audioContext.resume()` on `visibilitychange` (visible) for the engine context.
- `audioContext.close()` on visualizer teardown (cleanup after fullscreen exit) for the engine context. The tap-AudioContext's lifecycle is tracked as a CODE-BUG (see ledger entry CGL-012) — current code does not close it on teardown; the spec acknowledges the gap but does not silently bless it.

### 95.3.6 Linux Setup Script (Normative)

A user-installable systemd user service creates the `Huddle_Audio_Capture`
PipeWire source that Strategy 0 looks for. The installer consists of two
artefacts that work together:

1. **Wrapper script** `scripts/huddle-audio-capture-wrapper.sh` — spawns
   `pw-loopback` with an idle watchdog (see §95.3.6.1).
2. **Setup helper** `scripts/setup-audio-capture.sh` — reference
   implementation of the install/uninstall/status flow.

Both the **No-Audio overlay** (§95.5) and the **Audio/Video Settings
page** (70-audio-settings §70.7a Subsection 2) expose a copy-to-clipboard
button that inlines the wrapper + service content as heredocs. The
clipboard recipe does NOT fetch from a remote URL (no `curl`), so
self-hosted instances work offline. Source of truth for the wrapper
content: `scripts/huddle-audio-capture-wrapper.sh`.

**Installation command format (Normative, verbatim as written to
clipboard by the UI):**

```
mkdir -p ~/.local/bin ~/.config/systemd/user && \
cat > ~/.local/bin/huddle-audio-capture.sh << 'WRAPPER'
... full wrapper content from scripts/huddle-audio-capture-wrapper.sh ...
WRAPPER
chmod +x ~/.local/bin/huddle-audio-capture.sh && \
cat > ~/.config/systemd/user/huddle-audio-capture.service << 'SVC'
[Unit]
Description=Huddle Audio Capture
After=pipewire.service
BindsTo=pipewire.service

[Service]
Type=simple
ExecStart=%h/.local/bin/huddle-audio-capture.sh
Restart=on-failure
RestartSec=3
Environment=HUDDLE_CAPTURE_IDLE_TIMEOUT=30
SVC
systemctl --user daemon-reload && \
systemctl --user start huddle-audio-capture
```

**Normative notes on the copy-paste command**:

- Uses **single-quoted heredocs** (`<< 'WRAPPER'` / `<< 'SVC'`) — single
  quotes around the delimiter disable variable/backtick expansion so the
  wrapper's `$PID`, `$idle`, `${NODE_NAME}`, and quoted-in-string
  `audio.position=[FL,FR]` literals survive unchanged. Tested across
  gnome-terminal, konsole, xterm, alacritty, tmux. The earlier
  `printf '%s\n' ...` single-line form specified in previous spec
  revisions was never the shipped UX — heredocs are the actual format.
- Service file uses `ExecStart=%h/.local/bin/huddle-audio-capture.sh`
  (the wrapper), not a direct `pw-loopback` invocation.
- The service is **started** (not `enable --now`). The idle watchdog
  inside the wrapper auto-stops `pw-loopback` after 30s of no browser
  consumer, so persistent auto-start on login is unnecessary — the
  user can manually `systemctl --user enable huddle-audio-capture`
  later if desired.
- No `[Install] WantedBy=` section is written by the copy-paste recipe.

#### 95.3.6.1 Idle Watchdog Wrapper (Normative)

The systemd service's `ExecStart` runs `scripts/huddle-audio-capture-
wrapper.sh`, which spawns `pw-loopback` and auto-stops it when no
browser consumer is connected. Rationale: OS-level recording indicators
(GNOME mic icon, KDE notification) only light up while the visualizer
is actually open, instead of staying lit across the whole session.

Parameters:
- `IDLE_TIMEOUT` (env, default `30` seconds) — inactivity threshold
  before shutdown.
- `GRACE_PERIOD` (constant, 60 seconds) — time after service start
  before idle polling begins (gives the user time to open the
  visualizer and make the browser connect).
- `CHECK_INTERVAL` (constant, 5 seconds) — poll cadence.

Consumer detection:
```
pw-link -ol 2>/dev/null | grep -q 'Huddle_Audio_Capture:playback'
```
A match means a downstream node (the browser's `getUserMedia`) is
linked to the virtual source, i.e. the visualizer is consuming audio.

Exit semantics:
- **Exit 0** = idle shutdown. Because the service's restart policy is
  `Restart=on-failure`, systemd does NOT respawn on exit 0 — the
  service stays stopped until the user reopens the visualizer and
  re-starts the service (or until a persistent enable has been set).
- **Exit 1** = `pw-loopback` crashed unexpectedly. systemd restarts
  after 3s (`RestartSec=3`).
- EXIT trap kills the child `pw-loopback` PID on wrapper shutdown so
  there is no orphan process.

**Setup-script interface (Normative)**:

`scripts/setup-audio-capture.sh` supports three subcommands:

| Subcommand | Behavior |
|-----------|----------|
| `install` (default) | Verifies `pw-loopback` is on PATH, `pipewire.service` is active, and the wrapper script is executable at the expected path. Writes `$SERVICE_FILE` with `ExecStart=${WRAPPER}`, `Environment=HUDDLE_CAPTURE_IDLE_TIMEOUT=30`, `Restart=on-failure RestartSec=3`. Runs `systemctl --user daemon-reload`, then prints manual-start instructions. Does NOT run `enable --now` — the user decides whether to one-shot (`systemctl --user start`) or auto-start on login (`systemctl --user enable`). |
| `uninstall` | Stops + disables the service, removes the service file, runs `daemon-reload`. Safe to run when not installed (no-op with friendly message). |
| `status` | Runs `systemctl --user status huddle-audio-capture.service --no-pager` and lists matching PipeWire nodes via `pw-cli list-objects \| grep -i huddle`. |

The installer no longer writes node-specific props like
`node.name=huddle_capture_in` or `audio.position=[FL,FR]` directly into
the service file — those literals now live inside the wrapper script's
`pw-loopback` invocation. Pre-flight aborts with a descriptive error
when dependencies (pw-loopback binary, running PipeWire) are missing.

### 95.3.7 Fallback: Active Call Audio (Normative)

When monitor capture fails (no monitor device found, or `getUserMedia` throws on the detected monitor device) AND the user is currently in an active LiveKit call, the visualizer falls back to tapping remote-participant audio:

1. Query `document.querySelectorAll<HTMLAudioElement>('audio[id^="lk-audio-"]')`. These are the `<audio>` elements LiveKit attaches to `document.body` for remote participant tracks (id pattern: `lk-audio-{participantId}`). If zero elements match, return `null` — no fallback available; fall through to "No Audio" state.
2. Create a **new** `AudioContext` (the tap-AudioContext — distinct from the engine's AudioContext, see §95.3.5).
3. Create a `ChannelMerger` with channel count = `max(audioEls.length, 2)`.
4. For each `<audio>` element:
   - Call `ctx.createMediaElementSource(el)` (fails with `InvalidStateError` if the element already has a source attached — in that case log a warning and skip).
   - Connect the source to the merger at input 0, channel 0.
   - **Also** connect the source to `ctx.destination` — this keeps the call audio audible to the user (the tap does not replace playback, it duplicates it).
   - Increment a success counter.
5. If the success counter is 0 (every source threw), close the tap-AudioContext and return `null`.
6. Create a `MediaStreamDestination`, connect the merger to it, and return `dest.stream`.

The returned `MediaStream` is passed to the engine via `engine.connectAudio(stream)`, and `audioSource` state is set to `'call'`. The menu UI reflects the connected state (menu auto-hides per §95.6 rather than staying pinned open).

**Invariants:**
- The call-tap preempts the "No Audio" state — neither the overlay nor the setup instructions render when `audioSource === 'call'`.
- Fallback is one-shot at visualizer open; it does not re-attempt if new participants join mid-session.
- The tap-AudioContext owns resources independent of the engine's AudioContext. Its cleanup is tracked as a known gap (ledger CGL-012 / F-CSD-198) — on visualizer teardown the engine currently closes only its own context.

**Failure modes:**

| Condition | Behavior |
|-----------|----------|
| No `<audio id^="lk-audio-*">` elements in DOM (no call / no remote participants) | Return `null`, caller enters "No Audio" state |
| All `createMediaElementSource` calls throw | Close tap-AudioContext, return `null` |
| At least one source succeeds | Merge successful sources, return stream, `audioSource = 'call'` |

---

## 95.4 Preset System

### 95.4.1 Curated Presets

- Source: `butterchurn-presets/dist/minimal.min` (~29 presets). The `/lib/` path uses `require()` and crashes in browsers.
- Dead presets (zero or near-zero audio reactivity) are filtered out. Current exclusion list:
  - `Flexi - alien fish pond`
  - `Geiss - Cauldron - painterly 2 (saturation remix)`
  - `martin - mandelbox explorer - high speed demo version`
  - `_Mig_085`
  - `Geiss - Thumb Drum`
- Stored in a single module (`visualizer-presets.ts`) that re-exports selected presets as a `Record<string, object>`, with a `presetNames` array and a `getPresetByIndex()` helper.
- Default preset: `ShadowHarlequin - LovelyShinySquares [ liquid starburst rmx ] - unchained + rovaster - luckless - martin - starfield sector`.
- Lazy-loaded together with Butterchurn via dynamic `import()`.

<!-- DIM-Map §95.4.2 auto-cycle
  Completeness:        ✓ (manual-pause 60s state visibility now described)
  Konsistenz:          ✓ (engineState.isCyclePaused contract)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (isCyclePaused reported to UI consumers)
  Abhaengigkeiten:     ✓
-->

### 95.4.2 Auto-Cycle

- Default: auto-cycle OFF. User enables via the cycle toggle button in the menu bar.
- Cycle enabled/disabled state is persisted in localStorage (`viz.cycleEnabled`).
- Cycle interval: configurable (30s, 1m, 2m, 5m). Default: 30 seconds. Persisted in localStorage (`viz.cycleInterval`).
- Blend time: 2.5 seconds (`visualizer.loadPreset(preset, 2.5)` -- Butterchurn handles smooth morphing). Initial preset load uses 0s blend (no morph on first render).
- Cycle order: sequential through the preset list, wrapping at end.
- When a preset is manually selected (arrow keys, picker): auto-cycle pauses for 60 seconds, then resumes (only if cycling was active before the manual navigation).

**Manual-pause state visibility (Normative):** during the 60-second manual-navigation pause, `engineState.isCyclePaused` reports `true` to UI consumers. Consequences:
- The cycle-toggle icon (§95.6.2 bullet 1) shows `var(--text-muted)` (paused color), not `var(--accent)`.
- The cycle-interval selector (§95.6.2 bullet 2) HIDES for the duration of the pause (it is gated on `!isCyclePaused`).
- After the 60s `setTimeout` fires, the engine flips `cyclePaused = false` BEFORE restarting the cycle timer, and re-notifies state. UI returns to its pre-pause appearance.

This is an intentional user-visible reflection of the internal suspension — the user sees "cycle off" for 60s after pressing arrow keys, then sees it "turn back on" automatically.

<!-- DIM-Map §95.4.3 preset navigation
  Completeness:        ✓ (' - ' separator, _solo_ sentinel, Various ordering rule documented)
  Konsistenz:          ✓ (case-insensitive grouping + original-casing display)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

### 95.4.3 Preset Navigation

- **Preset picker button**: a single centered button in the menu bar showing the current preset name. Bordered, `var(--text-secondary)` text, `var(--accent)` on hover. Max width 400px with text overflow ellipsis.
- **Preset picker panel**: opens upward from the bottom menu bar when the preset button is clicked. Accordion layout grouped by author:
  - Each author group has a clickable header row with a triangle indicator (rotates 90deg when expanded), the author name, and a preset count badge.
  - **Author extraction**: author is the substring of the preset name before the first ` - ` (space-hyphen-space) separator; the rest is the `shortName`. Presets with NO ` - ` separator are bucketed under an implicit `_solo_` sentinel key.
  - **Grouping**: case-insensitive (author keys are lowercased for the map), but the display name uses the original casing from the first preset in the group.
  - **Sorting & 'Various'**: author groups are collected in case-insensitive alphabetical order. Any author whose group has ≤ 1 preset is MERGED into a synthesized `Various` group (using the full preset name, not the shortName, as the display label). The `Various` group is appended AFTER all author-sorted groups (not merged into the alphabetical order).
  - Expanded groups show individual presets as clickable buttons. Active preset highlighted with `var(--accent)` text and `rgba(168, 216, 185, 0.10)` background.
  - Panel: centered horizontally (`left: 50%; transform: translateX(-50%)`), `min(520px, 88vw)` width, max height 60vh with overflow scroll, `rgba(22, 22, 40, 0.96)` background.
  - Click-outside backdrop closes the panel.
- **Keyboard shortcuts**: ArrowLeft / ArrowRight navigate to previous/next preset. Space toggles auto-cycle pause.

---

<!-- DIM-Map §95.5 no-audio state
  Completeness:        ✓ (actual lean UI described; no spurious device picker)
  Konsistenz:          ✓ (header text, button label, hint text match code)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (clipboard write + imperative hint mutation)
  Abhaengigkeiten:     ✓ (navigator.clipboard)
-->

## 95.5 No Audio State

When neither the monitor path nor the call-tap fallback (§95.3.7) produced an audio source (`audioSource === 'none'`):

- Butterchurn renders with zero audio input (Milkdrop presets have baseline ambient animations even without audio -- slowly morphing visuals).
- Centered column overlay, vertically + horizontally centered in the fullscreen container, with gap `var(--space-4)` between rows.
- **Header**: `[ NO AUDIO SOURCE ]` in `var(--text-muted)`, `var(--font-mono)`, `var(--text-lg)`.
- **Setup guidance block** (§95.5.1): a max-520px column showing both Linux and Windows setup hints simultaneously. No OS detection — the user picks the relevant one. Rationale: `navigator.userAgent` is unreliable (Firefox `privacy.resistFingerprinting` spoofs the UA, WSL/VPN setups report unexpectedly, cross-platform users may need either set).
- **Copy-status hint**: a persistent `<span id="visu-copy-hint">` at the bottom of the block, initially rendering `one-time setup, then reload` in `var(--text-xs)` / `var(--text-muted)`.
- The auto-hide menu stays visible (not auto-hidden) in this state, so controls remain accessible. The hide timer is cleared and not restarted while `audioSource === 'none'`.

There is NO scrollable device picker and NO per-input list. Users who need a different audio source install the platform-appropriate loopback (Linux: copy the setup command; Windows: enable Stereo Mix), then exit and re-open the visualizer for Strategy 0 / Strategy c to pick up the new source.

### 95.5.1 Setup Instructions (Normative)

The No Audio state displays setup hints for **both** Linux and Windows simultaneously.

**Linux row** (inline, single flex row):

- Label: lowercase `linux:` in `var(--font-mono)` / `var(--text-sm)` / `var(--text-secondary)`. No bracketed hex-style header, no explanatory paragraph. The label alone sits next to the copy button.
- **Copy command button**: bordered button labeled exactly `COPY SETUP COMMAND` (no surrounding brackets). Border `1px solid var(--accent)`, transparent background, `var(--accent)` text. On hover: `var(--accent)` background, `var(--bg-base)` text. 150ms transitions on `background` and `color`.
- On click: call `navigator.clipboard.writeText(cmd)` with the verbatim installation command from §95.3.6. On fulfilled promise, imperatively mutate `document.getElementById('visu-copy-hint').textContent` to `copied! paste in terminal — installs + starts with auto-shutdown.`. The hint text persists until the overlay is torn down — there is NO timed revert to the initial text. The click handler does nothing on clipboard rejection (no error UI).

**Windows row** (single-line hint):

- Lowercase inline text: `windows: enable "Stereo Mix" in sound settings` in `var(--font-mono)` / `var(--text-xs)` / `var(--text-muted)`. No Win+R / mmsys.cpl / numbered-step breakdown is rendered — the hint assumes the user knows how to navigate Windows sound settings.

**Copy-status hint span** (id `visu-copy-hint`): renders the initial string `one-time setup, then reload` in `var(--text-xs)` / `var(--text-muted)`. Mutated to `copied! paste in terminal — installs + starts with auto-shutdown.` on successful clipboard write (see Linux row). Shared across rows — lives beneath the Windows hint.

**No Mac section.** Mac's Core Audio does not expose system audio to browsers by default. Users on macOS must install a third-party virtual audio device (BlackHole, Loopback) and configure it as the Huddle output device in spec 70's Audio Settings; the monitor detection strategies (§95.3.1) then pick it up normally. No automatic setup path documented.

---

## 95.6 Auto-Hide Menu

### 95.6.1 Behavior

- Appears when the mouse moves.
- Disappears after 3 seconds of no mouse movement.
- When menu is hidden: mouse cursor is also hidden (`cursor: none` on container).
- When mouse moves: cursor and menu both reappear immediately.
- Menu stays permanently visible when in "No Audio" state (95.5).

### 95.6.2 Layout

Position: bottom of screen, full width, anchored to bottom edge. Height: 48px. Flex layout, centered items.

```
+----------------------------------------------------------------------+
|  [cycle toggle] [interval]  Preset Name Button        [ESC]          |
+----------------------------------------------------------------------+
```

Left-to-right:
1. **Cycle toggle button**: Unicode `U+27F3` (clockwise arrow) character. `var(--text-muted)` when cycle is paused, `var(--accent)` when active. Toggles auto-cycle on/off.
2. **Cycle interval selector** (visible only when `engineState.isCyclePaused === false`): bordered button showing current interval (e.g. `30s`, `1m`). Opens a dropup panel above with options: 30s, 1m, 2m, 5m. Selected option highlighted with `var(--accent)` and subtle background. During the 60-second post-manual-navigation pause (§95.4.2), `isCyclePaused` is `true` — the interval selector is hidden for that window and reappears when the engine auto-resumes. When the user explicitly toggles cycle OFF (the button in bullet 1), the selector is also hidden.
3. **Preset picker button** (centered): bordered button showing current preset name. Opens the accordion preset picker (95.4.3).
4. **Exit button** (absolute positioned, right edge): `[ESC]` in `var(--error)` color.

No `[SRC: ...]` source indicator in the menu bar. No `[ 0xVZ VISUALIZER ]` hex label.

### 95.6.3 Styling

- Background: `rgba(31, 31, 53, 0.85)`.
- Border-top: `1px solid var(--border-default)`.
- Border-radius: 0 (hard rule from design system).
- Font: `var(--font-mono)`, `var(--text-sm)`.
- Cycle toggle and interval: described in 95.6.2.
- Preset name button: `var(--text-secondary)`, `var(--accent)` on hover. Border: `1px solid var(--border-default)`.
- `[ESC]` exit: `var(--error)` color, no border, positioned `right: var(--space-4)`.

### 95.6.4 Animation

- Entry: slide-up from bottom (`translateY(100%)` to `translateY(0)`), 200ms ease-out, opacity 0 to 1.
- Exit: slide-down to bottom, 200ms ease-out, opacity 1 to 0.
- Uses CSS transitions on `transform` and `opacity`.

<!-- DIM-Map §95.6.6 incoming-call banner
  Completeness:        ✓ (connecting... intermediate state, disabled buttons documented)
  Konsistenz:          ✓ (accept-failure revert semantics specified)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (isAcceptingCall state, label swap, disabled flags)
  Abhaengigkeiten:     ✓ (acceptIncomingCall() flow)
-->

### 95.6.6 Incoming Call Banner

When an incoming DM call arrives while the visualizer is active:

- A banner appears at the top of the fullscreen container.
- Position: fixed to top, full-width, z-index above the canvas and menu.
- Background: `rgba(31, 31, 53, 0.95)`, border-bottom: `1px solid var(--warning)`.
- **Content**: the bracket-text tag `[ INCOMING CALL ]` +
  `{username} is calling...` + a green accept IconButton (Lucide
  `Phone`, `aria-label="Accept call"`) + a red decline IconButton
  (Lucide `PhoneMissed`, `aria-label="Decline call"`). Post-T-033
  Lucide migration — earlier spec revisions described text-labeled
  `[ ACCEPT ]` / `[ DECLINE ]` buttons, which are no longer shipped.
- **Caller-username resolution**: when `incomingDmCall` flips to
  non-null, the banner fetches `GET /api/users`, finds the user by
  `callerId`, and sets `incomingCallerUsername`. Until resolved, the
  banner renders the literal placeholder `someone is calling...`. The
  fetch is cancellation-guarded against fast-successive incoming
  calls. The fetch is the visualizer's own concern — it does not
  reuse the sidebar/DM-list cache (the visualizer portal is mounted
  independently of the app chrome).
- **Accept in-flight state**: when the user clicks the green accept
  IconButton, `isAcceptingCall` flips to `true`:
  - The accept IconButton is **unmounted** (replaced by a plain
    `<span>connecting...</span>` in `var(--text-muted)` — not a
    label-swap on the button).
  - The decline IconButton remains mounted but `disabled={true}`.
  - Immediately, `document.exitFullscreen()` is awaited (wrapped in
    try/catch) — this preempts the accept so the user leaves the
    visualizer before the call stack connects. The
    `fullscreenchange` handler fires the visualizer cleanup path
    (see §95.8.2).
  - THEN `acceptIncomingCall()` is awaited.
  - On success: `navigateToDm(callerId)`.
  - On failure: `isAcceptingCall` is reset to `false` — but by this
    point the visualizer has already torn down via the
    `fullscreenchange` cleanup, so the banner is no longer in the
    DOM. The failure path produces no visible revert inside the
    visualizer; any error UI is the call-store consumer's concern.
- **Decline**: clicking the red decline IconButton dismisses the
  banner and stays in the visualizer. Does not end the call.
- The auto-hide menu stays visible while the banner is showing.
- The banner disappears when: the user accepts (via the teardown
  path above), declines, the caller leaves, or `call.ended` is
  received.

---

## 95.7 Keyboard Controls (Fullscreen Only)

| Key | Action | `preventDefault()` |
|-----|--------|--------------------|
| `ESC` | Exit fullscreen (browser-native, cannot be intercepted). If preset picker or cycle dropup is open, closes that panel first. | Yes (only when closing an open panel — to swallow the fullscreen-exit this one press) |
| `Space` | Toggle auto-cycle pause/resume | Yes (to suppress page scroll) |
| `ArrowRight` | Next preset | **No** |
| `ArrowLeft` | Previous preset | **No** |

- `keydown` listener added when `isActive` state is true, removed when false.
- ESC closes open panels (picker, dropup) before triggering fullscreen exit -- panels are checked first with `preventDefault()`. If no panel is open, ESC is not intercepted and the browser-native fullscreen exit proceeds.
- Arrow keys do NOT call `preventDefault()`. During fullscreen the browser's default focus-step behavior on arrow keys is inert on a canvas-only document, so no explicit suppression is required.

---

## 95.8 Exit & Cleanup

### 95.8.1 Exit Triggers

- ESC key (browser-native fullscreen exit, or panel close if a panel is open).
- `[ESC]` button in menu (calls `document.exitFullscreen()`).
- Both converge on the `fullscreenchange` event handler.

### 95.8.2 Cleanup Sequence (NON-NEGOTIABLE)

Listen to `fullscreenchange`. When `document.fullscreenElement` is no longer the container:

1. Cancel `requestAnimationFrame` (using the stored animation frame ID).
2. Stop auto-gain interval timer.
3. Release Butterchurn references (set visualizer to null).
4. Disconnect audio nodes: `sourceNode.disconnect()`, `gainNode.disconnect()`, `analyserNode.disconnect()`. **Order matters on PipeWire: disconnect audio nodes BEFORE stopping MediaStream tracks.** If tracks are stopped while `MediaStreamAudioSourceNode` still holds a reference to the stream, PipeWire keeps the source-output registered (corked but alive) and the system microphone indicator stays lit.
5. Stop all MediaStream tracks: `currentStream.getTracks().forEach(t => t.stop())`.
6. Close AudioContext: `audioContext.close()` (fire-and-forget Promise -- important refs are already disconnected above).
7. Lose WebGL context: `canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()`.
8. Reset React state: `isActive`, `isLoading`, `error`, `audioSource`, `availableInputs`, `pickerOpen`, `cycleDropupOpen`, `presetList`, `expandedAuthors`, `menuVisible`, `engineState` all reset to initial values.

### 95.8.3 Tab Visibility

- `visibilitychange` event listener (added via React `useEffect`, cleaned up on unmount).
- `document.hidden === true`: engine `suspend()` -- cancels rAF, `audioContext.suspend()`.
- `document.hidden === false`: engine `resume()` -- `audioContext.resume()`, starts new render loop (new rAF ID stored).

### 95.8.4 Tab/Window Close Safety Net (Normative)

A `window.addEventListener('beforeunload', ...)` handler calls
`engineRef.current.destroy()` and nulls the ref — guaranteeing
MediaStream tracks stop and AudioContexts close even when React's
unmount lifecycle does not fire (hard tab close, window navigation,
renderer crash).

Rationale: Brave on Linux with PipeWire does not release
PipeWire source-outputs on React-only teardown; without this
handler, the system mic indicator stays lit after the tab is closed.
`destroy()` is idempotent and safe to call from `beforeunload` even
if a `fullscreenchange` cleanup already ran.

---

## 95.9 Persistence (localStorage)

<!-- DIM-Map §95.9 persistence
  Completeness:        ✓ (fpsCap UI-less escape-hatch explicitly noted)
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (localStorage keys + value spaces)
  Abhaengigkeiten:     ✓ (spec 70 audio.outputDeviceId)
-->

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `viz.lastPreset` | string | `DEFAULT_PRESET_NAME` | Name of last active preset |
| `viz.fpsCap` | `"30"` \| `"60"` | `"30"` | FPS cap for render loop. **Not user-configurable via UI** — there is no preference toggle or settings entry. This key is a devtools / localStorage-direct-edit escape hatch for high-refresh-rate displays; the default `"30"` is the deliberate choice to avoid GPU contention with WebRTC (§95.11). |
| `viz.cycleEnabled` | `"true"` \| `"false"` | `"false"` | Whether auto-cycle is active |
| `viz.cycleInterval` | ms string (e.g. `"30000"`) | `"30000"` | Auto-cycle interval in milliseconds |

- Read on visualizer open (in `VisualizerEngine` constructor), written on change.
- Missing keys use defaults silently.
- Audio source is derived from Huddle's existing `audio.outputDeviceId` setting (spec 70) -- not stored separately for the visualizer.

---

## 95.10 Lazy Loading & Isolation

### 95.10.1 Bundle Isolation

- Butterchurn, butterchurn-presets, and the visualizer engine module (`VisualizerEngine.ts`) are loaded via dynamic `import()`.
- The fullscreen container `<div>`, the menu overlay, the "No Audio" setup-instructions block, and the preset picker accordion are part of the main bundle (lightweight, no heavy dependencies).
- Zero Butterchurn bytes in the main app bundle.
- First open triggers the lazy load. Subsequent opens use the cached module.
- Preload on hover of the waveform icon: `import('../../lib/visualizer/VisualizerEngine')`. Runs once per session, guarded by a `useRef` flag.

### 95.10.2 Error Isolation

- All WebGL and audio operations wrapped in try/catch.
- Error during initialization: show `[ VISUALIZER ERROR ] {message}` in `var(--error)` in the fullscreen container, exit fullscreen after 3 seconds.
- Visualizer errors MUST NOT propagate to the main app. React `VisualizerErrorBoundary` wraps the visualizer portal content.

### 95.10.3 npm Dependencies

Add to `src/client/package.json`:
```json
{
  "dependencies": {
    "butterchurn": "^3.0.0-beta.4",
    "butterchurn-presets": "^3.0.0-beta.4"
  }
}
```

---

## 95.11 Constraints

- The visualizer is purely client-side. No server endpoints, no DB schema changes, no WebSocket events.
- No impact on existing app functionality. The feature is fully isolated.
- The waveform icon is always visible in the header (not gated on call status).
- Performance: FPS-capped at 30 by default to prevent GPU contention with WebRTC.
- Must work on Linux (PipeWire/PulseAudio) and Firefox.
- Two concurrent AudioContexts (visualizer + existing GainNode pipeline) may exist when in a call. Both are within browser limits.

---

## 95.12 Acceptance Criteria

- [ ] Waveform icon visible in header, correct position, hover effect works
- [ ] Click opens browser-native fullscreen
- [ ] Pre-fullscreen `getUserMedia({audio:true})` warm-up fires before `requestFullscreen()` (§95.1.2 step 1)
- [ ] Butterchurn loads and renders (visual output on canvas)
- [ ] On Linux with PipeWire: monitor source auto-detected (Strategy 0 Huddle_Audio_Capture or Strategy a/e), audio visualization reacts to music
- [ ] On Firefox: monitor source detection works (Strategy a "Monitor of" label matching)
- [ ] When monitor capture fails but user is in an active call with remote participants, the visualizer falls back to tapping LiveKit `<audio id^="lk-audio-*">` elements (`audioSource = 'call'`); the bottom menu reflects audio-connected state, not "No Audio"
- [ ] Auto-cycle defaults to OFF; user can enable via cycle toggle button
- [ ] Cycle interval selectable (30s, 1m, 2m, 5m) via dropup menu
- [ ] Cycle interval selector hides during the 60s manual-navigation pause (`engineState.isCyclePaused === true`), reappears on auto-resume
- [ ] Preset picker accordion opens from menu bar, grouped by author via first ` - ` separator, case-insensitive keys with original-casing display, `Various` group appended last for single-preset authors
- [ ] Arrow keys navigate presets without calling `preventDefault()`; Space toggles auto-cycle with `preventDefault()`
- [ ] Auto-hide menu appears on mouse move, hides after 3s
- [ ] Menu stays visible when no audio connected or incoming-call banner showing
- [ ] Cursor hidden when menu hidden
- [ ] ESC exits fullscreen cleanly; ESC closes an open panel first (with `preventDefault`) before triggering fullscreen exit
- [ ] `[ESC]` button exits fullscreen cleanly
- [ ] Incoming-call banner `[ ACCEPT ]` shows `connecting...` while in flight and disables both accept/decline buttons; reverts on acceptance failure
- [ ] After exit: no "screen sharing" browser indicator, no audio playing, no GPU usage (caveat: tap-AudioContext leak tracked as CGL-012 in code-gap ledger)
- [ ] Tab switch pauses rendering and audio processing
- [ ] Tab return resumes rendering
- [ ] "No Audio" state shows `[ NO AUDIO SOURCE ]` header (not the old `[ SELECT AUDIO SOURCE ]`)
- [ ] No Audio state shows BOTH Linux and Windows setup instructions simultaneously (no OS detection)
- [ ] No scrollable device picker list in No Audio state — users configure loopback via platform setup (setup command or Stereo Mix) then re-open the visualizer
- [ ] Linux row has a `COPY SETUP COMMAND` button (no surrounding brackets) that writes the §95.3.6 verbatim command to clipboard and imperatively updates `#visu-copy-hint` text to `copied! paste in terminal — installs + starts with auto-shutdown.` (no timed revert)
- [ ] Windows row is a single-line hint `windows: enable "Stereo Mix" in sound settings` (no numbered-step breakdown)
- [ ] Clipboard command's `node.description=Huddle_Audio_Capture` is the underscore form (not quoted with a space)
- [ ] Last preset, FPS cap, cycle enabled, and cycle interval persist across sessions (localStorage); `viz.fpsCap` has no in-app UI setter
- [ ] No impact on existing chat, call, or screenshare functionality
- [ ] Lazy loading: main bundle size unchanged
- [ ] Error boundary catches Butterchurn failures without crashing the app
- [ ] Audio capture constraints disable echoCancellation, noiseSuppression, autoGainControl (monitor path)
- [ ] `connectAudio()` switching order: disconnect nodes → stop old tracks → wire new stream (PipeWire correctness)
- [ ] Cleanup disconnects audio nodes before stopping MediaStream tracks (PipeWire correctness)
- [ ] Strategy 0 (label contains `"huddle"` AND `"capture"`) is the primary path on Linux for ALL browsers, not just Chromium
- [ ] `scripts/setup-audio-capture.sh` supports `install | uninstall | status` subcommands with dependency pre-flight (pw-loopback binary, PipeWire active) and post-install PipeWire-node verification

<!-- DIM-Map §95 Visualizer (aggregated, post T-009 drift-sync)
  Completeness:        ✓ (call-audio fallback §95.3.7, no-picker rewrite §95.5, setup script interface §95.3.6, fpsCap UI-less note §95.9, manual-pause visibility §95.4.2)
  Konsistenz:          ✓ (AudioSourceType 'monitor' | 'call' | 'none', header text and button label match code, §95.3.5 two-context acknowledgment ties to §95.3.7)
  Implementierbarkeit: ✓ (pre-fullscreen permission warm-up, connectAudio() ordering, tap-AudioContext lifecycle flagged via ledger ref)
  Interface-Vertraege: ✓ (engineState.isCyclePaused observable, isAcceptingCall flag, clipboard write contract, setup script subcommands)
  Abhaengigkeiten:     ✓ (LiveKit <audio id^="lk-audio-"> elements for call fallback, pw-loopback on Linux, navigator.clipboard for copy-button)

  Open/ledgered (not silent-encoded in spec):
  - CGL-012 tap-AudioContext leak on visualizer exit (F-CSD-198)
  - CGL-013 requestFullscreen() synchronous throw leaves 0×0 engine (F-CSD-180)
  - CGL-014 suspend() does not stop cycleTimer on tab hide (F-CSD-199)
  - CGL-015 startCycleTimer() fragile guard by cyclePaused (F-CSD-182)
-->

