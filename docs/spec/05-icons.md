intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Icon system replacing text-label buttons throughout the UI
  action: Defines icon library, style rules, IconButton component pattern, complete button-to-icon mapping, tooltip and accessibility requirements, and explicit text-retention list

| | |
|---|---|
| **Layer** | Cross-Cutting (Design System) |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 30-chat, 40-voice, 45-video, 50-screenshare, 60-sidebar |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2): user-decision F-CSD-0514 encoded (room join/leave/rejoin stay as bracketed text; `DoorOpen`/`DoorClosed` mandate removed — brackets are the normative pattern). T-032/T-035/T-036 icon surfaces added to 05.4 (`Image` media gallery, `Maximize2`/`Minimize2` expanded video, `MessageSquare` chat-overlay toggle, `X` chat-overlay close). Touch-target acceptance carved out for overlay + hover affordances (05.3). `PhoneCall` row removed — code uses `Phone` for both Start/Join. Sidebar Search claim dropped (05.4 Search). Text-retention list extended (`[ IGNORE ]`, `[ retry ]`, `▼`/`▲`, `X` ASCII cancel). Findings applied: F-CSD-0501..F-CSD-0523 (23 total). |

## Was diese Spec beschreibt

This spec defines the icon system that replaces bracket text buttons (`[ MIC ]`, `[ SHARE SCREEN ]`, etc.) with SVG icons. It covers the icon library choice, visual style rules, the IconButton component pattern, the complete mapping of every interactive bracket button to a specific icon, and the explicit list of elements that remain text.

---

# 05. Icon System (Normative)

## 05.1 Icon Library

**Lucide Icons** (`lucide-react`).

- License: MIT (ISC)
- Style: Outline, consistent stroke width, geometric
- React: Tree-shakeable named imports (`import { Mic } from 'lucide-react'`)
- No full-bundle import. Each icon is imported individually.

Rationale: Outline style is the closest match to the terminal aesthetic.
Lucide is the maintained fork of Feather Icons with a larger icon set.
Tree-shaking keeps the bundle small (~1-2 KB per icon used).

## 05.2 Icon Style Rules

All icons follow these visual rules:

| Property | Value | Reason |
|----------|-------|--------|
| `strokeWidth` | `1.5` | Lucide default, matches IBM Plex Mono weight |
| `size` | `18` (default) | Fits inside 36-44px touch targets with padding |
| `color` | `currentColor` | Inherits from parent — uses CSS variables |
| `fill` | `none` | Outline only. No filled icons. |

**Color inheritance:**
- Default state: `var(--text-primary)`
- Muted/inactive: `var(--text-muted)`
- Destructive: `var(--error)`
- Active/accent: `var(--accent)`
- Specific overrides defined per button in the mapping table

**No border-radius.** Icon buttons follow the global `border-radius: 0` rule.

**Context-menu size convention.** Icons inside `ContextMenu` rows render at
`size=16` (not the default 18) — an established tighter rhythm for menu
rows. Toolbar icons keep the default 18.

## 05.3 IconButton Component Pattern

Every icon button follows this pattern:

```tsx
<button
  aria-label="Descriptive label"
  title="Descriptive label"
  style={{
    minWidth: '44px',
    minHeight: '44px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    padding: 'var(--space-2)',
  }}
>
  <LucideIcon size={18} />
</button>
```

### Accessibility

- **`aria-label`**: MUST on every icon button. Describes the action, not the icon.
  Example: `aria-label="Mute microphone"`, not `aria-label="Microphone icon"`.
- **`title`**: Same text as `aria-label`. Provides native browser tooltip on hover.
  No custom tooltip component — `title` attribute is sufficient for this app.
  **Known limitation:** `title` does not appear on touch devices. Acceptable
  for this desktop-primary app (~15 users, all on desktop). Touch is secondary.
- **Disabled state**: Native `disabled` attribute (blocks click events) +
  `cursor: not-allowed`, `color: var(--text-muted)`, `opacity: 0.5`.
  IconButton applies both `disabled` (native, blocks activation) and
  `aria-disabled` (redundant SR announcement) — both set when disabled;
  `aria-disabled` is omitted otherwise. Do NOT use `aria-disabled="true"`
  alone — it does not prevent activation.

### Touch Targets

- Minimum: `44px x 44px` (WCAG 2.5.8 Target Size).
- Achieved via `min-width`/`min-height` + padding, not by scaling the icon.
- On desktop with mouse: visual footprint can be smaller (icon + padding),
  but the clickable area remains 44px minimum.
- **Documented exceptions** (carve-outs where 44x44 would harm the surface):
  - **Overlay buttons over media** (32x32): `ScreensharePreview` inline
    overlay (`PictureInPicture2`, `Maximize`) and `IncomingCallBanner`
    (`Phone`). A 44x44 footprint would obscure the underlying content.
  - **Message hover affordances** (28x28 with 14px icons): in-message
    `Reply` and `SmilePlus` triggers. Rationale: 44x44 per message would
    multiply row height and destroy chat density. Hover actions only
    appear on mouse hover (desktop-primary app); touch interaction falls
    back to the context menu via long-press.
  - **Chat font size toggle** (36x36 with 28px icons): `AArrowUp`/
    `AArrowDown` live inside a fixed header chip group; 36x36 fits the
    row height without overwhelming surrounding text buttons.
  - **Chat overlay close** (small-footprint X, 16px icon): expanded-video
    chat overlay header close — overlay-scoped, density-driven.

### Focus State

- **`focus-visible`**: `outline: 2px solid var(--accent)`, `outline-offset: -2px`.
- Applied via a global CSS rule (`button:focus-visible { ... }` in
  `src/client/src/index.css`), not inline on IconButton — React inline
  `style` cannot express pseudo-class selectors, so the rule must live
  in a global stylesheet.
- Only on keyboard navigation (`focus-visible`), not on mouse click.
- Ensures keyboard users can see which button is focused.

### Hover State

- Background: `var(--bg-elevated)` on hover.
- Transition: `background 150ms, color 150ms`. Color transitions along
  with background so the disabled-color swap and accent-toggle
  animations are smooth.
- No border-radius on hover background (TTY constraint).

### Active (Toggled) State

For toggle buttons (MIC, CAM, BLUR):
- **Active (on)**: `color: var(--accent)`
- **Inactive (off)**: `color: var(--text-muted)`, icon switches to "off" variant

## 05.4 Button-to-Icon Mapping

### Call Controls (`CallControls.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ MIC ]` | `Mic` | "Mute microphone" | `var(--accent)` | Active state |
| `[ MIC OFF ]` | `MicOff` | "Unmute microphone" | `var(--text-muted)` | Muted state |
| `[ CAM ]` | `Camera` | "Turn off camera" | `var(--accent)` | Active state |
| `[ CAM OFF ]` | `CameraOff` | "Turn on camera" | `var(--text-muted)` | Off state |
| `[ BLUR ]` | `Sparkles` | "Toggle background blur" | `var(--accent)` when on, `var(--text-muted)` when off | Weak metaphor — no better Lucide icon exists. Tooltip essential. |
| `[ LEAVE CALL ]` | `PhoneOff` | "Leave call" | `var(--error)` | Always red |
| Start / Join call (dropdown trigger) | `Phone` | Label switches: "Start call" (no active call) or "Join call" (existing call) | `var(--accent)` | One icon serves both states; no separate `PhoneCall` icon. Distinction is by label only. |
| Expand / Collapse video | `Maximize2` / `Minimize2` | "Expand video" / "Collapse video" | `var(--accent)` when expanded else `var(--text-muted)` | Visible only when in call AND at least one camera is active (T-035). |
| Chat overlay toggle | `MessageSquare` | "Show chat" / "Hide chat" | `var(--accent)` when open else `var(--text-muted)` | Visible only while video is expanded (T-036). Distinct semantic surface from the DM-navigation `MessageSquare` in the participant-strip context menu — same icon, different context. |

### Screenshare Controls (`ScreenshareControls.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ SHARE SCREEN ]` | `MonitorUp` | "Share screen" | `var(--text-primary)` | |
| `[ STOP SHARE ]` | `MonitorX` | "Stop sharing" | `var(--error)` | |

The entire `ScreenshareControls` component returns `null` on devices
without `navigator.mediaDevices.getDisplayMedia` — primarily iOS (all
browsers) and some older Android. Rationale: no point showing a button
that will immediately fail on press. Device detection, not feature flag.

### Screenshare Preview (`ScreensharePreview.tsx`)

Two distinct surfaces, each with its own icon set.

**Inline preview overlay** (rendered in-chat as a thumbnail with overlay
buttons):

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ EXPAND ]` | `PictureInPicture2` | "Open screenshare window" | `var(--text-primary)` | Distinct from Fullscreen. 32x32 touch target (overlay carve-out — see 05.3). |
| `[ FULLSCREEN ]` | `Maximize` | "Fullscreen" | `var(--text-primary)` | Browser fullscreen. 32x32 touch target. |

**Screenshare window header** (popup/secondary window):

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ FULLSCREEN ]` | `Maximize` | "Fullscreen" | `var(--text-primary)` | Same icon as preview — reuse by design. |
| `[ CLOSE ]` | `X` | "Close screenshare window" | `var(--text-primary)` | Window header close. |

### Incoming Call Overlay (`IncomingCallOverlay.tsx`)

Fullscreen-modal for an incoming DM call.

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ ACCEPT ]` | `Phone` | "Accept call" | `var(--success)` | Icon + "Accept" text (critical action, color-blind safety) |
| `[ DECLINE ]` | `PhoneMissed` | "Decline call" | `var(--error)` | Icon + "Decline" text (distinct icon from Accept) |

### Incoming Call Banner (`IncomingCallBanner.tsx`)

In-chat banner shown in a DM when the other participant starts a call
(distinct surface from the fullscreen overlay above).

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| Join call | `Phone` | "Join call" | `var(--success)` | 32x32 touch target (overlay carve-out — see 05.3). |
| `[ IGNORE ]` | — (text) | — | `var(--text-muted)` | Text button, not Lucide — see 05.5. |

### Room Header Actions (`RoomView.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ JOIN ROOM ]` / `[ REJOIN ]` / `[ LEAVE ROOM ]` | — (text) | — | — | **Normative: bracketed text, not icons.** Room join/leave/rejoin are strong commit actions — bracketed uppercase text is more discoverable, less error-prone than a toggled door icon, and consistent with the TTY aesthetic. See 05.5 text retention. |
| Search messages | `Search` | "Search messages" | `var(--text-muted)` | Header action; see Search section below. |
| Media gallery | `Image` | "Media gallery" | `var(--text-muted)` | Opens modal listing images + files in the conversation (T-032). |
| `[ DM ]` (participant menu) | `MessageSquare` | "Direct message" | `var(--text-primary)` | Context menu on participant right-click in `CallParticipantsStrip`. |
| `[ MUTE ]` (participant menu) | `UserX` | "Mute user" | `var(--text-primary)` | Remote mute — distinct from local Mic. |
| `[ UNMUTE ]` (participant menu) | `User` | "Unmute user" | `var(--text-muted)` | Remote unmute. |

### DM Header Actions (`DmView.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| Search messages | `Search` | "Search messages" | `var(--text-muted)` | Header action. |
| Media gallery | `Image` | "Media gallery" | `var(--text-muted)` | Same pattern as Room header (T-032). |

### Chat Overlay Header (`RoomView.tsx`, expanded-video mode)

Shown inside the expanded-video chat overlay.

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| Close chat overlay | `X` | "Close chat overlay" | `var(--text-muted)` | `size=16`; overlay-scoped. Cross-ref: the same surface is opened by the `MessageSquare` toggle in Call Controls. |

### Membership Gate (`MembershipGate.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ JOIN ROOM ]` / `[ JOINING... ]` | — (text) | — | — | **Normative: bracketed text, not an icon.** Consistent with room header join pattern above. |

### Message Context Menu (`MessageList.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ REPLY ]` | `Reply` | "Reply" | `var(--text-primary)` | |
| `[ EDIT MESSAGE ]` | `Pencil` | "Edit message" | `var(--text-primary)` | |
| `[ DELETE MESSAGE ]` | `Trash2` | "Delete message" | `var(--error)` on hover | Destructive |

Context menu items show icon + text label side by side:
`{Icon} Reply`, `{Icon} Edit message`, `{Icon} Delete message`.
This differs from toolbar buttons (icon only) — context menus keep text
for discoverability since they are not always visible.

### Message Hover Actions (`MessageList.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| Reply icon | `Reply` | "Reply to message" | `var(--text-muted)` | Left of content. 28x28 touch target with 14px icon (hover-affordance carve-out — see 05.3). |
| Reaction icon | `SmilePlus` | "Add reaction" | `var(--text-muted)` | Left of content. Same 28x28 carve-out as Reply. |

### Room Context Menu (`ChatroomSection.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ DELETE ROOM ]` | `Trash2` | "Delete room" | `var(--error)` on hover | Destructive |

Same pattern as message context menu: icon + text label.

### Sidebar Header (`ChatroomSection.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ + NEW ROOM ]` | `Plus` + "NEW" text | "Create new room" | `var(--accent)` | Hybrid: icon + short label (Plus alone loses "room" context) |

### Search (`RoomView / DmView`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| `[ / SEARCH ]` | `Search` | "Search messages" | `var(--text-muted)` | Lives in Room and DM headers only. No Search icon in the Sidebar. |

### Chat Font Size (`RoomView.tsx / DmView.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| A-up | `AArrowUp` | "Increase font size" | `var(--text-primary)` | 36x36 touch target with 28px icon (density carve-out — see 05.3). |
| A-down | `AArrowDown` | "Decrease font size" | `var(--text-primary)` | Same carve-out as A-up. |

### Settings / Audio Preview (`AudioVisualizer.tsx`)

| Current Label | Icon (Lucide) | `aria-label` | Color | Notes |
|---------------|---------------|--------------|-------|-------|
| Test accept | `Phone` | "Accept call" | `var(--success)` | Non-primary surface — reuses call-control icons for user recognition in the audio-test preview. |
| Test decline | `PhoneMissed` | "Decline call" | `var(--error)` | Same rationale as test accept. |

Icons from this mapping may be reused in non-primary surfaces (settings
audio test, admin preview) without separate entries; they mimic the main
surface for user recognition.

## 05.5 Explicit Text Retention

These elements MUST remain text. They are not buttons or are part of the
TTY identity:

| Element | Reason |
|---------|--------|
| Hex-Labels `[ 0x10 CHATROOMS ]` | TTY identity, section headers |
| Bucket headers `── JOINED ──` | TTY separators |
| Indicators `[SS]`, `[PW]` | Status badges, not interactive (T-037 replaces [SS] with icon later) |
| Muted badge `[M]` in VideoGrid | In-tile badge, not a button |
| Username badge `[ username ]` in VideoGrid | In-tile label |
| `[ CREATE ]` / `[ CREATING... ]` | Form submit button in dialog |
| `[ SAVE ]` / `[ CANCEL ]` | Form buttons in edit mode |
| `[ YES ]` / `[ NO ]` | Confirmation buttons in context menu |
| `[ YES, TAKE OVER ]` | Confirmation button — screenshare takeover modal |
| `[ JOIN ROOM ]` / `[ JOINING... ]` / `[ REJOIN ]` / `[ LEAVE ROOM ]` | **Room membership commit actions.** Bracketed text is more discoverable and less error-prone than a toggled door icon; also consistent with the TTY aesthetic. User-decision 2026-04-24 (F-CSD-0514). |
| `[ IGNORE ]` | Incoming-call banner dismiss — text for clarity, consistent with Accept/Decline icon+text pattern. |
| `[ retry ]` | Message send-failure recovery — inline-error affordance tightly bound to the error status text; an icon would lose the "retry" verb. Lowercase, intentional. |
| `[ GO TO CALL ]` | Navigation link with text context |
| `[ LOADING... ]` | Status text |
| `connecting...` | Status text |
| `waiting for {username}...` | Status text |
| Call duration `[ CALL 3:42 | 4 in call ]` | Info display |
| `▼` / `▲` (unicode triangles) | Collapsible long-message expand/collapse toggles. Chosen over Lucide `ChevronDown`/`ChevronUp` to inherit text-rendering rhythm with the message body and avoid a second visual weight inside the message card. |
| ASCII `X` in header password prompt | Inline password-prompt cancel button. The prompt itself is text-based (input + OK); adding a single Lucide icon to an otherwise all-text control strip would be visually inconsistent. Note: the screenshare-window and chat-overlay close buttons still use the Lucide `X` icon — the ASCII `X` is specific to the password-prompt cancel. |

**Rule:** If it's a **toolbar/control action** (always visible, frequently used) → icon.
If it's a **form action, confirmation, status display, identity element, or strong
commit action like room join/leave** → text.

## 05.6 Spec Amendments

This spec supersedes button label definitions in the following specs:

- **40-voice.md**: Call control labels (40.3, 40.6, 40.8)
- **50-screenshare.md**: Screenshare control labels (50.2, 50.3)
- **60-sidebar.md**: Room creation button, context menu labels (60.3, 60.4)
- **30-chat.md**: Context menu labels, hover action labels (30.12, 30.13);
  media gallery icon (`Image`) added in T-032.
- **45-video.md**: Expanded-video chat overlay and expand/collapse toggle
  icons (`Maximize2`, `Minimize2`, `MessageSquare`, `X`) added in
  T-035/T-036. Badges stay text.

Existing specs retain their behavioral definitions. Only the visual
representation of buttons changes from text to icon. All behavior
(click actions, state transitions, guards) remains as defined in the
original specs.

## 05.7 Acceptance Criteria

- [ ] Lucide Icons installed, tree-shakeable imports only
- [ ] Every icon button from 05.4 uses the documented Lucide icon
- [ ] Every icon button has `aria-label` and `title`
- [ ] Touch targets >= 44px on all icon buttons EXCEPT documented
      exceptions in 05.3 (overlay buttons over media, in-message hover
      affordances, chat font size toggle, chat overlay close)
- [ ] Hover state: `var(--bg-elevated)` background, transition
      `background 150ms, color 150ms`
- [ ] Toggle buttons show active/inactive color states
- [ ] Context menu items show icon + text (not icon-only); menu icons
      use `size=16`, toolbar icons use default `size=18`
- [ ] Destructive buttons use `var(--error)` color
- [ ] No border-radius on any button or hover state
- [ ] Text retention list (05.5) elements unchanged (including
      `[ JOIN ROOM ]` / `[ REJOIN ]` / `[ LEAVE ROOM ]` as bracketed
      text — normative, not icons)
- [ ] Hex-labels, form buttons, indicators remain text
- [ ] No full-bundle Lucide import (tree-shaking verified)
- [ ] Icons render correctly in all themes (dark + light)
- [ ] `focus-visible` outline on all icon buttons (keyboard nav) —
      applied via global CSS
- [ ] Disabled buttons use native `disabled` attribute (plus redundant
      `aria-disabled`)
- [ ] Incoming call overlay: Accept/Decline show icon + text label
- [ ] `+ NEW` hybrid button (icon + text) for room creation
- [ ] Screenshare controls return null on devices without
      `getDisplayMedia` (iOS / older Android)
