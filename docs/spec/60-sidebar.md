intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Left sidebar navigation containing chatroom list and user list
  action: Defines the two sidebar sections (Chatrooms with membership buckets, Users with presence), their display rules, sorting, context menus, room creation entry point, unread/call indicators, and DM access pattern

| | |
|---|---|
| **Layer** | Frontend |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 10-domain, 25-websocket, 30-chat, 40-voice, 50-screenshare |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 10 findings + 2 CGLs resolved): §60.2 persistence validation contract precised (F-CSD-6001); §60.3 Create Room button corrected to Lucide `Plus` + `NEW` uppercase text (F-CSD-6002); §60.3 room font-size corrected to `text-lg` (F-CSD-6003); §60.3 active-row highlight composition clarified — `1px accent-dim` outer + `3px accent` left override (F-CSD-6004); §60.3 context-menu item rewritten to `Delete room` + Lucide `Trash2` + inline `confirmQuestion` (F-CSD-6005); §60.4 ring-sound ownership moved to `IncomingCallOverlay` (F-CSD-6007; F-CSD-046 resolved in commit dbc4e4e); §60.4 `[CALL]` token add/clear paths now cover both `call.ended` (reverse-index path) and `call.left` scope=direct (F-CSD-6009); §60.4 empty-state text corrected to `No users` (F-CSD-6008); §60.6 Focus Management marked implemented — CGL-018/F-CSD-118 resolved; AppShell `useEffect` on `activeView` with rAF scheduling (F-CSD-6010); §60.7 Mobile drawer auto-close on `activeView` change documented (F-CSD-6011). CGLs resolved: CGL-009/F-CSD-113 (incomingCallers wipe — `incomingByDirectRef`), CGL-016/F-CSD-116 (avatar border-radius 0). History: 2026-04-14 — Task 009 Batch 2 retroactive sync. |

## Was diese Spec beschreibt

This spec defines the left sidebar, the primary navigation element. It contains exactly two sections: Chatrooms (group rooms organized into membership buckets with activity-based sorting) and Users (online/offline user list serving as DM entry point). The spec covers section layout, collapsibility, reordering, room display with indicators ([SS], [PW], unread dots, live call duration timer), room context menus (delete), user display with presence, in-call overlay and incoming-call text token, and the DM access pattern (click user to open DM).

---

# 60. Sidebar (Normative)

## 60.1 Sections

<!-- DIM-Map §60.1 Sections
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Exactly 2 sidebar sections:
1) Chatrooms
2) Users

Both sections:
- collapsible
- reorderable (drag header toggle control)

Between the two rendered sections the sidebar draws a horizontal box-drawing
separator (a row of `─` characters, approximately 25 chars wide) in
`var(--border-default)`, `var(--font-mono)`, `var(--text-xs)`, with
`lineHeight: 1` and horizontal padding matching section padding. The separator
is rendered only between sections, not above the first or below the last.

## 60.2 Reordering UX

<!-- DIM-Map §60.2 Reordering UX
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

- Drag a section header vertically to reorder.
- Reorder triggers when moved above/below another section header (HTML5
  native drag-and-drop via `draggable`, `dragstart`, `dragover`, `drop`).
- Persist order per user (local persistence sufficient).

**Header semantics:** The entire section header serves as both the collapse
toggle (click) and the drag source (HTML5 `draggable`). There is no separate
drag handle or dedicated grab area — the `+`/`-` glyph in front of the hex
label is purely decorative.

**Visual affordance:** Header uses `cursor: pointer` statically. No
hover-state cursor swap to `grab`, no `grabbing` cursor while dragging, and
no `opacity` change on the dragged element — the drag is functional via the
browser's native drag-and-drop ghost image only.

**Persistence:** Two localStorage keys back the sidebar state:
- `sidebar-section-order` — JSON array of section ids (`['chatrooms','users']`
  or reverse). Validation: accepted only if the parsed value is an
  array whose length equals the default AND whose elements are the
  full set of known section ids (no duplicates, no unknown ids).
  Any other shape falls back to the default order.
- `sidebar-section-collapsed` — JSON object `{ chatrooms: boolean, users: boolean }`.
  The payload is `JSON.parse`d without shape validation; unknown-id
  entries are ignored at lookup time (`undefined` → treated as
  expanded). Collapse state is persisted across reloads along with
  order.

## 60.3 Chatrooms Section (Group Rooms Only)

<!-- DIM-Map §60.3 Chatrooms Section
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

### Create Room Button

A small button is shown centered at the top of the Chatrooms section,
above the first bucket. Composition: Lucide `Plus` icon (size=14)
followed by uppercase text `NEW`; chrome: 1px `var(--accent)` border,
transparent background, `var(--text-xs)` monospace, `letter-spacing:
0.05em`, no border-radius. `aria-label` + `title` = `"Create new room"`.
Clicking opens the room creation flow (see `30-chat.md` Section 30.7).

### Buckets (top to bottom):
1) Joined
2) Left
3) Not joined
4) Discoverable (rooms with no membership record for this user)

Each bucket has an explicit header label using box-drawing characters:
- `── JOINED ──`
- `── LEFT ──`
- `── NOT JOINED ──`
- `── DISCOVERABLE ──`

Labels use box-drawing dash characters (`──`), `text-muted` color,
uppercase, with letter-spacing.

Sorting:
- within each bucket: last_activity_at DESC

Display:
- show room name at `text-lg` font size
- joined: unread dot allowed (see overview.md Invariant F)
- left/not_joined: no unread dots
- active screenshare: `[SS]` indicator in `text-muted` next to room name
  (see `50-screenshare.md`)
- password-protected room: `[PW]` indicator in `text-muted` next to room name,
  alongside existing `[SS]` indicator if both apply
- active-row highlight: inactive rows have a `1px solid var(--border-default)`
  outer border for vertical rhythm; the currently viewed room renders with
  a `1px solid var(--accent-dim)` outer border PLUS a `3px solid var(--accent)`
  left-edge override, background `var(--bg-elevated)`, text color
  `var(--accent)` at font-weight 700.
- active call: if the room has any active call (regardless of the current
  user's own participation), a live MM:SS call duration timer is rendered
  next to the room name in `var(--accent-dim)`, `var(--text-xs)`,
  `var(--font-mono)`. See §60.5.

Both `[PW]` and `[SS]` indicators expose a tooltip via the native HTML
`title` attribute:
- `[SS]` → `title="Screenshare active"`
- `[PW]` → `title="Password-protected"`

No custom-styled tooltip component is rendered; tooltip visuals are whatever
the browser renders for `title` (system font, default delay, no box-drawing
border).

**Loading / empty states:**
- While `GET /api/rooms` is pending: the bucket list is replaced with the
  text `loading...` in `var(--text-muted)`, `var(--text-xs)`.
- If zero rooms are returned: the text `No rooms yet` in the same styling.

**Refresh triggers:** The ChatroomSection re-fetches `/api/rooms` on each of
the following WS events:
- `room.created`
- `room.membership`
- `room.deleted`
- `room.updated`

### Room Context Menu

Right-click on a room entry → context menu. On touch devices no explicit
long-press handler is registered; whether a long-press opens the menu
depends entirely on the browser's native `contextmenu` emulation and may be
unreliable on mobile.

| Item | Icon | Label | Condition |
|------|------|-------|-----------|
| Delete room | Lucide `Trash2` | `Delete room` (plain text, destructive styling via `destructive: true` — `var(--error)` color on hover) | Room creator (`room.createdBy === userId`) OR admin |

Confirmation is **inline** via the context menu's `confirmQuestion`
mechanism — not a separate modal overlay.

**Suppression:** If the viewer has no eligible menu items (i.e. neither
admin nor room creator), the right-click handler early-returns. No context
menu opens at all — there is no empty menu and no fallback affordance.

**Confirmation:**
```
Delete "{roomName}"?
```

**Behavior on confirm:**
- `DELETE /api/rooms/:roomId` (see `80-admin.md` 80.5 for endpoint details).
- Permission: admin OR room creator. Otherwise 403.
- Server: hard-deletes room, memberships, messages (DB cascade handles
  reactions + attachment DB rows). After the DB transaction commits, the
  server queries all attachment `storagePath` entries and best-effort
  unlinks each file from disk via `fs/promises.unlink`; unlink errors are
  swallowed so that a missing/unlinkable file does not surface to the client.
- Active call force-ended. Active screenshares from room force-ended.
- WS `room.deleted` broadcast: `{ roomId }`.
- All clients: room removed from sidebar. Users viewing the room navigate
  to Welcome Screen.
- **Deleter navigation:** The initiating client navigates to Welcome as
  soon as the HTTP `DELETE` response returns 2xx (if the deleted room was
  the active view). The subsequent WS `room.deleted` broadcast then arrives
  and re-runs the same navigation idempotently — already on Welcome, no
  observable change.

**RoomResponse amendment:** Must include `createdBy: string` so the client can
determine if the current user is the room creator.

## 60.4 Users Section

<!-- DIM-Map §60.4 Users Section
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

- Each user entry consists of an avatar (48×48px) plus a stacked text region
  of up to three lines:
  - Line 1: `<username>`
  - Line 2: `<title>` in `text-muted`, `text-xs` (omitted if title is empty).
    Title is shown without quotes in the sidebar, unlike the header format.
  - Line 3: last-seen time in `text-muted`, `text-xs`, rendered only for
    offline users (see Online/Offline Indicator below). Omitted for online
    users.
  - If both title and last-seen are absent, only line 1 is shown.
- Current user is hidden from the Users section. The user sees only other users.
- Active (online) users first, then inactive (offline); within each group A→Z by username.

### Online/Offline Indicator
- Active users: a small 8×8 square in `var(--success)` is positioned as an
  absolute overlay at the bottom-left corner of the avatar
  (`bottom: -2px; left: -2px`). It is rendered as a square (no
  border-radius), not a dot, and it overlaps the avatar corner rather than
  sitting as a standalone element beside the avatar.
- Inactive users: no square; show last seen time below the title/display
  name in `text-muted`:
  - Less than 1 hour: `{N}m ago`, with `N = Math.max(1, diffMinutes)` — i.e.
    the minimum displayed value is `1m ago`. For a user who went offline
    within the last 60 seconds the display still reads `1m ago`; `0m ago`
    is never shown.
  - Less than 24 hours: `{N}h ago`
  - Older: date only (e.g., `Mar 15`)
  - See `25-websocket.md` Section 25.6 for the presence mechanism.

### Dynamic User Discovery

On receiving a `presence.online` event for an unknown userId (not in the local
user list), the client re-fetches the full user list from the server. This
handles the case where a new user signs up and comes online — existing clients
see them appear in the Users section without needing a page reload.

### Profile Update Propagation

On `user.updated` WS events (see `25-websocket.md`), the Users section
merges the updated `profile` payload into local state in place — no full
re-fetch is issued. Merged fields: `title`, `avatarKind`, `builtInAvatarUrl`,
`portraitUrl`. The affected user's row updates avatar and title live; the
online/offline bucket position is unaffected by this merge.

### Interaction
- Clicking a user opens/focuses direct conversation with that user.

### Unread DM Indicator
- If a DM has unread messages (per overview.md Invariant F): show unread dot on
  the user entry.

### In-Call Indicator (Avatar Overlay)

If another user is currently in any active call — room call or direct call,
regardless of the viewer's own call state — the sidebar renders a small
mic-icon overlay at the bottom-right of that user's avatar
(`CallIndicatorOverlay`):
- 14×14px, `var(--bg-surface)` background, `1px solid var(--border-default)`,
  centered mic glyph SVG in `var(--accent)`.
- Tooltip via native `title`: `"{username} is in a call"`.

This "any call" semantic is intentional: viewers see who is reachable in
conversation elsewhere without the viewer themselves needing to be joined.
The indicator is NOT scoped to "direct call with current user".

### Incoming DM Call Indicator

If the other user has started a DM call and the current user has not joined
or ignored it, the sidebar renders a pulsing text token `[CALL]` in the
user's row in `var(--accent)`, `var(--text-xs)`, `var(--font-mono)`, with a
CSS animation `pulse 1.5s ease-in-out infinite`, and native
`title="Incoming call"`. The `[CALL]` text token is visually distinct from
the mic-icon avatar overlay (which sits on the avatar itself).

See `40-voice.md` Section 40.8 for the voice-call flow details.

**`[CALL]` token add/clear paths:**
- **Add**: on `dm.call.incoming` WS events, UsersSection records the
  caller in an `incomingCallers` set. A reverse-index
  `incomingByDirectRef` maps `directId → callerId` for later clears.
- **Clear path A** — `call.ended` with `scope.type === 'direct'`:
  uses the reverse-index to find the caller and removes it from
  `incomingCallers`.
- **Clear path B** — `call.left` with `scope.type === 'direct'`:
  clears the token for `data.userId` directly. This covers cases
  where the caller rescinds before anyone joins and `call.ended` may
  not fire.

**Ring sound playback:** UsersSection does **NOT** own ring-sound
playback. On `dm.call.incoming` it only updates `incomingCallers` so
the `[CALL]` token renders. Ring audio is started exclusively by
`IncomingCallOverlay` via `startCallRingLoop()` (looping, not
one-shot) and stopped in its cleanup. The overlay mounts on
`dm.call.incoming` regardless of the active view, preserving audible
coverage. Resolved F-CSD-046 in commit `dbc4e4e` — earlier spec
revisions incorrectly placed ring ownership in the sidebar and led
to duplicate ring playback.

**Loading / empty states:**
- While `GET /api/users` is pending: `loading...` in `var(--text-muted)`,
  `var(--text-xs)`.
- If zero other users are returned: a short muted `No users` message.

## 60.5 Call Indicator Semantics

<!-- DIM-Map §60.5 Call Indicator Semantics
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Two distinct indicator sites exist:

- **Chatrooms list (room scope):** For any room with an active call, the
  room row renders a live MM:SS call duration timer in `var(--accent-dim)`,
  `var(--text-xs)`, `var(--font-mono)`, next to the room name. The timer is
  rendered regardless of the current user's membership in that call — this
  is intentional so viewers can see ongoing activity without joining.
- **Users list (direct / room scope):** For any user currently participating
  in any active call (room or DM, any scope), the user's avatar receives the
  mic-icon overlay described in §60.4. This indicator is driven by
  `isUserInAnyCall(userId)` from the call store and is not restricted to
  "current user is in the same call".

The prior "speaker icon when current user is joined" baseline is superseded
by the two rules above. Neither indicator is gated on the current user's
own call participation.

## 60.6 Focus Management (Normative)

<!-- DIM-Map §60.6 Focus Management
  Completeness:        ✓
  Konsistenz:          ✓ (CGL-018 resolved — focus management implemented in AppShell)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

- On room/DM navigation (sidebar click): focus moves to the message
  input field (`textarea[data-message-input]`).
- On Welcome Screen navigation (e.g., after room deletion, after
  closing a view): focus moves to the first focusable child
  (`button, a[href], [tabindex]:not([tabindex="-1"])`) inside the first
  `[data-sidebar-section]`. If no focusable descendant exists, the
  section itself receives `tabIndex=-1` as a fallback and is focused.
- `activeView.type === 'settings'` is skipped — the settings overlay
  owns focus per CGL-017 / 75-user-settings.md.
- This ensures keyboard users can immediately start typing after
  selecting a conversation.

**Implementation**: single `useEffect` in `AppShell.tsx` keyed on
`activeView`; focus dispatch is scheduled via `requestAnimationFrame`
so the focus target has mounted by the time `.focus()` runs. CGL-018 /
F-CSD-118 resolved — earlier spec revisions documented this as an
open CODE-BUG, but the behavior is now wired in `AppShell.tsx:78-110`.

## 60.7 Mobile Behavior

<!-- DIM-Map §60.7 Mobile Behavior
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

On viewports with `max-width: 768px` the sidebar transforms from an inline
left column into a fixed drawer:

- Sidebar width: 280px; position: fixed; z-index: 50.
- Entry/exit uses a CSS transform/translate transition; the drawer slides
  in from the left when opened.
- A backdrop element (`sidebar-backdrop` class, `rgba(10, 10, 20, 0.5)`,
  z-index: 49, full viewport) is rendered behind the drawer while open.
- Clicking the backdrop invokes the `onMobileClose` prop supplied by
  `AppShell`, closing the drawer.
- The drawer also **auto-closes on any `activeView` change**
  (`useEffect(() => setIsSidebarOpen(false), [activeView])`). Selecting
  a room or DM from the drawer navigates and slides the drawer out as
  a single action — users don't need a second tap to dismiss.
- Mobile open/close state is owned by `AppShell`, not persisted — it resets
  to closed on reload.

Desktop viewports (≥ 768px) do not render the backdrop and do not apply
the drawer transform; the sidebar is a static inline column (width 240px
from `60.1` — see `Sidebar.tsx` styling).

## 60.8 Failure Modes

<!-- DIM-Map §60.8 Failure Modes
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

| Failure | Detection | Effect | Mitigation |
|---|---|---|---|
| `GET /api/rooms` fails | `api.get` returns non-ok | Room list stays empty / shows prior state | `loading...` during fetch; WS events later retrigger fetch |
| `GET /api/users` fails | `api.get` returns non-ok | User list shows prior state | `presence.*` events retrigger fetch when unknown userIds arrive |
| `DELETE /api/rooms/:id` fails | HTTP error | No navigation, room stays in list | User can retry via context menu; error logged client-side |
| Attachment file unlink fails after delete | `fs.unlink` throws | Ignored (swallowed) | DB state remains consistent; orphan files may remain on disk |
| localStorage key parse fails | `JSON.parse` throws | Falls back to default section order / collapsed state | Safe — `try/catch` wraps both loads |
| `presence.online` for unknown userId | Handler checks local cache | Full `/api/users` refetch | Built-in recovery path |
| `dm.call.incoming` ring sound fails to play | Browser audio policy (autoplay) | Indicator still shown, no audio | Visual `[CALL]` pulse remains; call flow unaffected |
| Long-press on mobile does not open context menu | Browser native `contextmenu` emulation | Mobile users cannot access delete-room action via touch | Known gap — desktop (right-click) fully functional; touch path relies on browser emulation only |
