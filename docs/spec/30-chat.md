intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Chat messaging UI and behavior for both group rooms and DMs
  action: Defines conversation header, active users strip, membership gating, message layout/grouping/pagination, emoji reactions, typing indicators, room creation, message collapse, deletion, editing, replies, context menus, URL linkification, @mentions, search, content guard, and chat font size

| | |
|---|---|
| **Layer** | Frontend |
| **Status** | aktuell |
| **spec_version** | 1.3.0 |
| **Konsumiert** | overview, 10-domain, 25-websocket, 35-uploads, 40-voice, 50-screenshare, 15-auth |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2): §30.20 Chat Font Size controls rewritten to Lucide `AArrowUp`/`AArrowDown` icons (F-CSD-3001 — prior stacked-glyph layout was never built). §30.5 emoji trigger and §30.12 hover icons switched from literal `☺`/`↩` glyphs to Lucide `SmilePlus`/`Reply` (F-CSD-3003). §30.14 URL linkification now correctly documents `https?://`-only regex (no bare `www.`), trailing-punctuation cleanup, and `border-bottom` visual style (F-CSD-3004/F-CSD-3016). §30.4 Scroll-to-Message documents two distinct highlight styles — search 2000ms accent-glow vs reply-quote 1500ms bg-elevated (F-CSD-3006). §30.16 search panel corrected to top-anchored (F-CSD-3007); `searching...` intermediate status added (F-CSD-3019); Ctrl+F lowercase-key caveat added (F-CSD-3012); search result attachments/reactions forward-compat note (F-CSD-3025). §30.4 Optimistic Send now covers F-CSD-067 file-bearing re-populate path (F-CSD-3008) and retry-row testid/border (F-CSD-3022). §30.1.3 password error codes `PASSWORD_REQUIRED`/`WRONG_PASSWORD` enumerated + `PATCH /api/rooms/:roomId/password` endpoint cross-ref added (F-CSD-3009/F-CSD-3024). §30.15 mention parser word-boundary rule + self-mention highlight documented (F-CSD-3010/F-CSD-3011). §30.3.1 `[ JOINING... ]` label-swap asymmetry vs §30.7 documented (F-CSD-3013). §30.11 reply-preview truncation clarified as 80-char slice (F-CSD-3014). §30.4 reconnect behavior aligned with 25-websocket §25.7 — no `/api/messages/since` in v1 (F-CSD-3015). §30.5 emoji picker `z-index: 10000` added (F-CSD-3017). §30.6 typing broadcast `excludeUserId` + reserved 20px height (F-CSD-3018). §30.21 Media Gallery backdrop documented, lightbox-ESC precedence, grid cell 10px middot format, `[ LOAD MORE ]` → `loading...` swap (F-CSD-3002/F-CSD-3020/F-CSD-3021). §30.9 tombstone `attachments: []` vs non-tombstone `undefined` distinction (F-CSD-3023). Tooltip wording for §30.20 updated to "Increase/Decrease font size" (no "chat" prefix) (F-CSD-3026). History: 2026-04-11 — T-004 Batch-1 pass. |

## Was diese Spec beschreibt

This spec defines the complete chat experience: how conversations are displayed (single-row header with inline avatars + participant strip, message list), how messages are sent/received/paginated (incl. optimistic send with retry + cursor-based history), emoji reactions (curated 22-codepoint allowlist, API + WS contract), typing indicators, room creation flow (with optional password), long message collapse, message deletion and editing (with time windows and admin overrides), reply threading, context menus, URL linkification, @mentions with autocomplete, full-text search (scoped only — no global sidebar entry), the content guard against system message spoofing, password-protected room join/rejoin flow, eager DM entity creation, and the chat font size adjustment feature (plus its backing `chatFontSize` store).

---

# 30. Chat & Conversations (Normative)

## 30.1 Conversation Header Layout

Every conversation (direct room or DM) renders a **single-row header** at
the top of the conversation pane. There is **no** separate "Active Users
Strip" row below the header — all header content (title, controls,
participant strip, active-user avatars, font-size buttons, membership CTA)
lives on one flex row.

> **Architectural note**: Earlier revisions of this spec described a
> two-row layout with a stand-alone `ActiveUsersStrip` component below
> the top bar. That layout was retired in favour of inline avatars in
> the single-row header. The `ActiveUsersStrip.tsx` file still exists
> in the codebase as dead legacy code (a comment in `RoomView.tsx`
> marks it as removed in use). Reimplementers should NOT resurrect it.

### 30.1.1 Room Header (group conversations)

Left-to-right composition (all items on a single flex row):

1. **Room name** — `var(--accent)` colour, `var(--font-mono)`,
   `var(--text-xl)`, `font-weight: 700`. Flex-shrink 0.
2. **Call timer** (`CallDurationTimer`) — visible to ALL viewers while an
   active call exists for this room, regardless of whether the viewer is
   a participant. Prefix `CALL`. Format + source owned by `40-voice.md`.
3. **Call controls** (`<CallControls>`) — visible only for `joined`
   members. Behaviour owned by `40-voice.md`.
4. **Screenshare controls** (`<ScreenshareControls>`) — visible only for
   `joined` members. Behaviour owned by `50-screenshare.md`.
5. **Search button** `[ SEARCH ]` — visible for `joined` AND `left`
   members. Opens the scoped search overlay (see §30.16). Hidden for
   `not_joined` users. `left` members retain read-only search (see
   §30.3.2).
6. **Call Participants Strip** (`<CallParticipantsStrip>`) — visible
   only while `activeCallForRoom.participants.length > 0`. Inline,
   horizontally scrollable, flex-shrinkable. Prefix literal text
   `IN CALL:` (`text-muted`, `text-xs`) followed by a row of
   participant name buttons. A click on another participant opens a
   context menu with `[ DM ]` and `[ MUTE ]` / `[ UNMUTE ]` items. A
   self-click does nothing. Muted participants render strike-through in
   `text-muted`; unmuted participants render in `var(--accent)`.
   See cross-ref `40-voice.md` for participant semantics + the
   `/api/livekit/mute-participant` endpoint contract.
7. **Active-user avatar strip** — inline, horizontally scrollable,
   prefixed by the uppercase label `active users:` in `text-muted`
   `text-xs`. Each entry is an `<InlineAvatar>` (28×28 px). See §30.2
   for the avatar chip contract. Hidden entirely when the list is
   empty.
8. **Chat font-size buttons** (`<ChatFontSizeButtons>`, see §30.20) —
   right-side group.
9. **Membership action** — right-most, contextual:
   - `joined`: `[ LEAVE ROOM ]` button (hover → `var(--error)` border).
   - `left`: `[ REJOIN ]` button (accent border/colour). If the room
     has a password (`room.hasPassword === true`), clicking `[ REJOIN ]`
     does NOT immediately call the API — it instead reveals an inline
     password prompt (see §30.1.3 Password-Protected Rooms).
   - `not_joined` / null: `[ JOIN ROOM ]` button. Same inline
     password-prompt behaviour when `hasPassword === true`.
   - `direct`: none (DMs have no join/leave).

**Red in-call border (Normative)**: while the current user is in a call
for THIS room (`callState.activeScope === this room`), the header
container receives `box-shadow: inset 0 0 0 2px var(--error)` as a
visual "you are in a call here" cue. This is the same red frame the
RoomView uses to mark the active call.

### 30.1.2 Direct (DM) Header

Left-to-right composition (single flex row):

1. **Avatar** (32×32 px, `var(--bg-input)` fallback). The container is
   `position: relative` so the overlay sub-elements can absolutely
   position on it.
2. **Online indicator** — an 8×8 px `var(--success)` square absolutely
   positioned at `bottom: -1px; left: -1px` of the avatar, visible only
   when the other user is online (`isUserOnline(otherUserId)` from
   `25-websocket.md` presence state). No border-radius (TTY aesthetic).
3. **Name + status block**:
   - Username — `var(--accent)`, `var(--text-lg)`, `font-weight: 700`.
   - Below it: small status line — `online` in `var(--success)` when
     online, `offline` in `var(--text-muted)` otherwise. `var(--text-xs)`.
4. **Call controls** (`<CallControls>`) — visible once `directId` is
   known (see §30.19 eager DM creation).
5. **Screenshare controls** (`<ScreenshareControls>`) — visible once
   `directId` is known.
6. **Search button** `[ SEARCH ]` — visible once `directId` is known
   (same gate — the scoped search endpoint needs `directId`).
7. **Chat font-size buttons** (`<ChatFontSizeButtons>`).

DMs have **no** membership CTA, no call timer prefix in the header,
and no active-user avatar strip (the DM is two participants — the
other user's avatar is already shown).

### 30.1.3 Password-Protected Rooms (Join / Rejoin Flow)

Rooms MAY be created with an optional password (see §30.7). When a
password is set, the server stores `room.hasPassword = true` and
requires the password as the `password` field on the join / rejoin
endpoints.

**Header inline password prompt**:
- When a user clicks `[ JOIN ROOM ]` or `[ REJOIN ]` in the header
  and the target room has `hasPassword === true`, the button collapses
  into an inline form:
  ```
  [password input 140px] [ OK ] [ X ]
  ```
- The password input is `type="password"`, 140 px wide, monospace,
  `var(--bg-input)` background, 1 px `var(--border-default)` border
  (or `var(--error)` on failure).
- `Enter` submits; `Escape` cancels and clears the input. Clicking
  `OK` submits; clicking `X` cancels.
- On server 403 / password-invalid, the border turns red and an
  error is shown next to the input. A successful response clears
  the prompt and transitions the membership state.

**MembershipGate full-page prompt**: When membership is `not_joined`
or `null` and the user opens the conversation, the content area
renders a centered empty state (see §30.3.1). If `hasPassword`, that
empty state also contains a 280 px wide password input above the
`[ JOIN ROOM ]` button; `Enter` submits, server errors render below
the input.

**API contract**: the password is sent to
`PATCH /api/rooms/:roomId/join` and `PATCH /api/rooms/:roomId/rejoin`
as `{ password: string }`. Argon2id verification is owned by
`15-auth.md` / `10-domain.md` (cross-reference — the domain spec may
still need to document the password field in the Room entity).

**Password error codes** (Normative): both endpoints return HTTP 403
with one of the following `error.code` values on password-gate
failure:

| Code | Trigger | Client behavior |
|------|---------|-----------------|
| `PASSWORD_REQUIRED` | Room has `hasPassword=true` but the request omitted a password. | Open the inline prompt / keep it open; show generic "password required". |
| `WRONG_PASSWORD` | A password was supplied but `argon2.verify` returned false. | Turn the input border `var(--error)`; show "incorrect password" next to the input. |

All other membership failures (`NOT_AUTHENTICATED`, `FORBIDDEN`,
`ROOM_NOT_FOUND`) propagate as-is.

**PATCH `/api/rooms/:roomId/password`** (creator or admin): lets the
room owner set, change, or remove a password post-creation. Body:
`{ password: string | null }` (null removes). See
`src/server/src/routes/rooms.ts` for the handler; `room.updated`
`{ roomId, hasPassword }` broadcasts the new state.

## 30.2 Inline Avatar Chip Semantics

The active-user avatar strip in the room header (§30.1.1 item 7) and
the sidebar user lists all render user avatars using the same contract.
Each chip includes:

- **Avatar image** — `avatarKind === 'uploaded'` → `portraitUrl`;
  otherwise `builtInAvatarUrl`; otherwise a fallback block showing the
  uppercase first letter of the username in `var(--text-muted)` over
  `var(--bg-input)`.
- **Display name** used as the `title` attribute:
  - `<username> "<title>"` when `profile.title` is non-empty.
  - `<username>` otherwise.
- **Speaking ring** — CSS class `avatar-speaking` when
  `useCall().isUserSpeaking(userId)` is `true`. The ring is a CSS glow
  effect attached to the class; see §30.2.2 below for timing ownership.
- **In-call mic overlay** — see §30.2.1.

### 30.2.1 In-Call Indicator on Avatars (Normative, Multi-Surface)

When a user is currently in ANY active call (room or DM), their avatar
displays a small microphone icon overlay positioned absolute at the
bottom-right corner. This is a "visible everywhere the user is listed"
signal — not scoped to a single component.

**Surfaces (MUST)**:
- Room header inline avatar strip (`InlineAvatar` in `RoomView`).
- Sidebar DM user list (`UsersSection` → `UserItem`).
- (Historical) `ActiveUsersStrip.tsx` — dead component, not used; if
  revived for any reason, MUST render the overlay.

**Overlay Spec**:
- Component: `<CallIndicatorOverlay size={size} title={`${username} is in a call`} />`.
- Size: 14 px on 48 px sidebar avatars, 10 px on 28 px inline header
  avatars (proportional ~¼ to ⅓ of avatar).
- Content: inline SVG mic icon, `fill: currentColor`.
- Colors: background `var(--bg-surface)`, border `1 px solid
  var(--border-default)`, icon colour `var(--accent)`. TTY aesthetic:
  no border-radius.
- Parent MUST wrap the avatar element in a `position: relative`
  container so the overlay absolutely positions
  (`bottom: -2 px; right: -2 px`).
- State source: `isUserInAnyCall(userId)` helper from the call store,
  which walks the `activeCalls` Map checking participant lists.

**Rationale**: The separate `CallParticipantsStrip` component shows who
is in a call ONLY from within the call view. Users outside a call (or
browsing the sidebar) still need to see "is this person in a call right
now" as a discoverability signal — hence the overlay on all user-avatar
surfaces.

### 30.2.2 Speaking Indicator (timing ownership)

- When a user produces audio input (`is_speaking === true`), the
  avatar chip receives the CSS class `avatar-speaking`, which renders
  an outer glow ring.
- **Timing ownership**: activation + decay timing is NOT enforced by
  any chat-level component. It is driven by
  `useCall().isUserSpeaking(userId)` in the call store; the chip simply
  reflects its current boolean. The call store applies a short decay
  (~300-600 ms) after speech stops. See `40-voice.md` for the
  authoritative speaking-state state machine.

<!--
DIM-Map §30.1 + §30.2 (refreshed 2026-04-11, T-004):
- Completeness: single-row header fully enumerated for room + DM
  including call timer, call participants strip, search button,
  font-size buttons, membership CTA with password prompt (F-CSD-001,
  F-CSD-002, F-CSD-003 applied).
- Konsistenz: retired "two-row" layout; cross-ref to 40-voice for
  CallParticipantsStrip; cross-ref to 50-screenshare for share
  controls; cross-ref to 25-websocket for presence.
- Implementierbarkeit: concrete pixel sizes, label literals, CSS
  variables, and red-border behaviour documented.
- Interface-Vertraege: MembershipGate API shape (`password?`),
  `PATCH /api/rooms/:roomId/join|rejoin` body contract referenced.
- Abhaengigkeiten: 10-domain (Room entity + password field),
  15-auth (Argon2id), 40-voice (call store + speaking state),
  25-websocket (presence).
-->


## 30.3 Group Membership Gating (Summary)

### 30.3.1 not_joined
- User cannot view message history.
- User cannot participate in call / camera / room-screenshare.
- The conversation content area is replaced by `MembershipGate`, which
  renders a centered block:
  ```
  [ 0x00 NOT A MEMBER ]
  ```
  - The `[ ` / ` ]` brackets and `0x00 ` are `var(--text-secondary)`;
    `NOT A MEMBER` is `var(--accent)`. IBM Plex Mono, `var(--text-sm)`.
  - Below the hex-label: a muted sub-line — `"This room is
    password-protected."` when `room.hasPassword === true`, otherwise
    `"Join this room to see messages and participate."`.
  - For password-protected rooms: a 280 px-wide password input
    (see §30.1.3) appears between the sub-line and the button. `Enter`
    submits; server errors render below the input in `var(--error)`.
  - A `[ JOIN ROOM ]` button (accent border) submits. **While the
    request is in-flight the button label swaps to `[ JOINING... ]`
    and the button is disabled.** This label-swap is intentional and
    distinct from the `CreateRoomDialog` submit button (§30.7), which
    explicitly does NOT swap — rationale: room-join is a blocking
    modal-like action while create-room dialog users can see the
    `opacity: 0.5` disabled state inline.
- The header strip is still rendered (title, font-size buttons, join
  button) — only the content area is replaced.

### 30.3.2 left (read-only)
- Message history is visible.
- **No** sending / reactions / uploads / call / camera / screenshare.
- The header `[ REJOIN ]` button is shown; if `hasPassword`, clicking
  it reveals the inline password prompt (§30.1.3).
- In place of the message input, the footer shows a centered banner:
  ```
  You left this room. Rejoin to send messages.
  ```
  (`var(--text-muted)`, monospace, centered, 1 px top border).
- **Scoped search stays available**: `left` members can still use
  `[ SEARCH ]` / `Ctrl+F` against their historical access to the room.
  The server allows search when `state !== 'not_joined'`. This matches
  read-only history access (see §30.16).

### 30.3.3 joined
- Full chat participation enabled (send, react, upload, reply, edit,
  delete own, call, camera, screenshare, search).

<!--
DIM-Map §30.3 (refreshed 2026-04-11, T-004 F-CSD-006/007/031):
- Completeness: left-banner text + not_joined hex-label empty state
  documented.
- Konsistenz: left members can search (was implicit in code, now
  explicit).
-->


## 30.4 Messages

### Storage & Delivery
- Messages are persistent, stored server-side.
- **Reconnect behavior**: v1 has no gap-recovery endpoint. On WS
  reconnect, the client does NOT diff missed messages — see
  25-websocket.md §25.7 for the actual reload-on-navigate behavior.
  The gap-recovery endpoint `GET /api/messages/since` is on the
  post-v1 backlog.
- Support: text, images, files, emoji reactions.
- File / image attachments are defined in `35-uploads.md`; see also the
  per-message display rules in §30.4 Attachments below.

### Pagination (REST Endpoint)

```
GET /api/messages?scopeType={room|direct}&scopeId={id}&before={isoTimestamp}&limit={N}
  Auth: [requireAuth]
  Response: { data: { messages: MessageResponse[], hasMore: boolean } }
```

Rules:
- **Initial load** (no `before`): returns the most recent `limit`
  messages.
- **Older pages**: client passes `before = messages[0].createdAt` (the
  ISO timestamp of the oldest loaded message) to fetch the next older
  page.
- `limit` is clamped server-side to `1..100`, default `50`.
- Server internally fetches `limit + 1` to compute `hasMore`. If
  `hasMore === false`, the client stops triggering load-more.
- Returned `messages` are in **chronological (oldest-first) order**
  within the page — the client appends older pages by prepending.
- Messages are accessible for `joined` + `left` room members; 403 for
  `not_joined`. For DMs, 403 if caller is not a participant.
- Each `MessageResponse` includes `author`, `attachments`, `reactions`,
  and an optional `replyTo` (see §30.11 for the reply-quote shape).

**Loading-more indicator**: when `isLoadingMore === true`, the message
list shows a small centered text `loading older messages...`
(`var(--text-muted)`, `var(--text-xs)`, `var(--font-mono)`) at the top.
Not shown once `hasMore === false`.

### Initial Load State

- While the initial fetch is in progress, the message area shows the
  literal text `loading...` centered, in `var(--text-muted)`,
  `var(--font-mono)`, `var(--text-sm)`. The earlier `[ LOADING... ]`
  box-drawing wrap is NOT used.

### Empty Conversation State

- **Room** with zero messages: `No messages yet. Say something.`
  centered, `var(--text-muted)`, `var(--font-mono)`, `var(--text-sm)`.
- **DM** with zero messages: `Send {otherUsername} a message.` centered,
  same styling. The DM variant is keyed on the `dmOtherUsername` prop
  of `<MessageList>` — rooms omit the prop and fall back to the room
  copy.

### Scroll Behavior (Normative)

Covers four distinct scroll events in the message list:

1. **Initial load**: once `isLoading === false` and there is at least
   one message, the list scrolls to the bottom instantly
   (`scrollIntoView()` without smooth behavior).
2. **New message arriving via WS**: the list smooth-scrolls to the
   bottom **only** if the user was already within 50 px of the bottom
   before the new message arrived (sticky-bottom heuristic). If the
   user had scrolled up to read history, the new message arrives
   silently and the viewport stays put.
3. **Prepend on load-more**: scroll position MUST be preserved so the
   user's currently-visible messages stay in the same place. Capture
   `scrollHeight` before the prepend; after React commits the new
   messages, compute `delta = newScrollHeight - oldScrollHeight` and
   add `delta` to `scrollTop`.
4. **Load-more trigger**: when the list's `scrollTop < 100 px` AND
   `hasMore` AND `!isLoadingMore`, the client calls `onLoadMore()`.

**Sticky-bottom tracking**: the client maintains a `wasAtBottomRef`
updated in the scroll handler — truthy when
`scrollHeight - scrollTop - clientHeight < 50`. The new-message effect
reads this ref to decide whether to auto-scroll.

### Scroll-to-Message (Normative)

Two entry points invoke scroll-to-message, with **two distinct
highlight styles** (intentionally different so users can tell which
action caused the jump):

- **Search navigation** (§30.16): clicking a search result closes the
  overlay, scrolls the target row to viewport center with smooth
  behaviour (`scrollIntoView({ behavior: 'smooth', block: 'center' })`),
  and applies a strong highlight — `background: var(--accent-glow)`,
  `transition: background 500ms`, auto-cleared after **2000ms**.
- **Reply quote click** (§30.11): clicking a quoted reply block scrolls
  the original message into view using the same smooth/center scroll,
  and applies a subtler highlight — `background: var(--bg-elevated)`,
  auto-cleared after **1500ms**. If the original is not currently
  loaded in the list, the action is a no-op (no recursive
  load-until-found).

### Message Display Layout

Messages use a flat list layout — no chat bubbles, no alignment-by-sender,
no left-margin timestamp column.

**Full message** (first in group or any un-grouped message), left-to-right:

- **Avatar** (32×32 px `MessageAvatar`) — flex-shrink 0.
- **Content block** (flex 1):
  - **Username line** — a flex row with:
    - `{author.username}` in `var(--accent)`, `var(--text-sm)`,
      `font-weight: 500`, `var(--font-mono)`;
    - followed inline by the timestamp in `var(--text-muted)`,
      `var(--text-xs)`, `var(--font-mono)`. Today: `HH:MM`; older:
      `{MonthName} {D}, {YYYY} {HH:MM}`;
    - followed by an optional `(edited)` or `(edited by admin)` marker
      (see §30.10).
    - Pending (optimistic) messages display the literal timestamp
      placeholder `sending...` in the same slot instead of a real time.
  - **Reply quote block** (if `msg.replyTo`) — see §30.11.
  - **Content text** (inside `CollapsibleText`, see §30.8) with
    `var(--chat-font-size)` sizing, `var(--font-mono)`, `line-height: 1.6`,
    `white-space: pre-wrap`, `word-break: break-word`.
  - **Attachments** (if any, hidden for tombstones) — see `35-uploads.md`
    for display, sizing, and lightbox behaviour. Clicking an image
    opens the full-screen lightbox (keyboard arrows cycle through all
    images in the current conversation view).
  - **Reactions** (if any) — see §30.5.
  - **Retry row** (only when `_error === true` on an optimistic message,
    see "Optimistic Send" below).

**Grouped (continuation) message** — consecutive messages from the same
author within a 2-minute window, excluding system messages and tombstones:

- Avatar and username line are **omitted**.
- The row is indented to align content with the full-message content
  column (`paddingLeft: calc(32px + var(--space-2))`).
- A timestamp is rendered absolutely positioned at the **left gutter**,
  `opacity: 0`, revealed on row hover via an opacity transition.
- Content, attachments, reactions, retry row follow the same rules.

**Tombstones never group** (see §30.9) — a tombstoned message is always
rendered as a full message to make the deletion visible even when it
falls mid-group.

### Message Grouping Rules (Normative)

Consecutive messages from the same user are grouped when ALL of:
- Neither is a system message.
- Neither is a tombstone.
- Same `authorId`.
- `curr.createdAt - prev.createdAt < 2 * 60 * 1000` (2 minutes).

When any rule fails, the current message renders as a full message
(avatar + username line).

### Date Separators

Between messages on different calendar days, show a date separator
rendered as:

```
------- {Month} {D}, {YYYY} --------
```

Literal ASCII hyphens (7 leading `-`, 8 trailing `-`). Centered,
`var(--text-muted)`, `var(--text-xs)`, `var(--font-mono)`. **Not**
em-dashes — the previous spec revision's em-dash reference was
incorrect.

### Optimistic Send (Normative)

Text-only messages are sent optimistically: they appear in the list
immediately with a client-generated `tempId` before the REST request
returns. File-bearing messages do NOT use the optimistic path (they
wait for the REST response before rendering).

**Pending state**:
- The optimistic message carries `_pending = true` and `_tempId`.
- Visual: the entire row renders at `opacity: 0.5`.
- The timestamp slot shows the literal string `sending...` instead of
  a formatted time.

**Success**: on REST success, the optimistic entry is replaced in-place
with the returned server `MessageResponse` (matched by `tempId`). The
WS `message.new` handler dedupes against optimistic entries — both by
server `id` and by `(authorId, pending flag)` — so the user never
sees the same message twice.

**Failure (text-only, optimistic path)**: on REST error, the
optimistic entry is marked `_error = true` and an inline row is
rendered directly below the message:
```
Failed to send [ retry ]
```
Both labels in `var(--error)`. The `[ retry ]` button carries
`data-testid="retry-button"` and `border: 1px solid var(--error)` (so
it visually matches the error status). It re-submits the original
content (including `_retryFiles` if any) and removes the failed
optimistic entry.

**Failure (file-bearing, non-optimistic path)**: file-bearing sends
do not create an in-list optimistic entry, so the retry surface is the
composer itself. On REST error, `RoomView.handleSendMessage` /
`DmView.handleSendMessage` re-throw the error; the composer's
`MessageInput.handleSubmit` catch block restores the text content and
pending files into the input (F-CSD-067 behavior). The user sees
their original content and attachments back in the composer and can
re-submit. No separate "Failed to send" row is rendered for file-
bearing failures.

### Time-Window Expired Inline Error (TimeExpiredError)

When a delete or edit attempt returns 403 because the 3-minute server
window has passed (see §30.9 / §30.10), the spec calls for a small
muted `time window expired` message next to the affected row that
fades after ~3 s.

> **Known code gap (documented, not blocking)**: The
> `TimeExpiredError` React component exists and the `expiredErrors`
> state is declared in `MessageList.tsx`, but no call site currently
> pushes a message ID into `expiredErrors` on 403. The UI affordance
> is therefore present in code but never activated at runtime. This
> is flagged for CGL follow-up. Reimplementers SHOULD wire up the
> 403 → `expiredErrors.add(messageId)` + 3 s auto-clear path.

### System Messages (display)

Events like `user joined the room`, `user left the room`,
`user rejoined the room` are rendered as centered, `text-muted`,
italic, `var(--text-xs)` system notifications — no avatar, no username
line, no context menu.

The client parses the action from the `::system::{action}` content
prefix. Known actions render as:
- `joined` → `{username} joined the room`
- `left` → `{username} left the room`
- `rejoined` → `{username} rejoined the room`

**Forward-compat fallback**: For any unknown action suffix, the client
renders `{username} {action}` verbatim (without `the room`). This lets
future server-side system messages show up in the UI without a client
code change.

See §30.18 for the persisted-message contract behind system messages.

### Attachments + Lightbox (Cross-Reference)

Attachment display (inline image previews, file rows with download
button, size formatting) is owned by `35-uploads.md`. Two chat-side
responsibilities to note:

- `<MessageList>` collects all image attachments across all currently
  loaded messages (via `collectAllImages()`, tombstones skipped) and
  passes them to `<Lightbox>` so the lightbox can show a running
  "N / M" counter and navigate with `ArrowLeft` / `ArrowRight` across
  the entire conversation.
- Clicking an image in a `<MessageAttachments>` row opens the
  lightbox at the clicked image's index. Lightbox closes on
  `Escape` or backdrop click; prev/next advance via keyboard arrows
  or click targets on the panel.

See `35-uploads.md` for attachment validation (type, size, count),
inline preview sizing, and the file-row composition. The chat-side
contract is limited to the click-to-open trigger and the image-list
collection.

### Character-Limit Warning Banner (Input)

When the `<MessageInput>` content exceeds `MAX_MESSAGE_LENGTH` (10000
chars), a red-bordered banner renders above the input row (full text:
see §30.7 Message Input). The `SEND` button is disabled while the
banner is visible. This is a client-side pre-check; the server also
enforces the 10000-char limit on `POST /api/messages` (400
`VALIDATION_ERROR`).

<!--
DIM-Map §30.4 (refreshed 2026-04-11, T-004 F-CSD-008/010/011/012/013/014/015/016):
- Completeness: pagination API, scroll behaviour, optimistic send,
  scroll-to-message highlight, message layout (avatar+inline
  timestamp), grouping rules, hyphen separators, system-message
  fallback, TimeExpiredError known-gap all documented.
- Implementierbarkeit: concrete magic numbers (50/100/500/2000 ms),
  CSS variables, component refs.
- Interface-Vertraege: GET /api/messages response shape + hasMore
  contract; cross-ref to /api/messages/since in 25-websocket.
-->


## 30.5 Emoji Reactions

### Emoji Set (Curated, Normative)

The app uses a fixed allowlist of **22** Unicode codepoints. The client
picker grid and the server-side validator MUST stay in sync — any
emoji outside this list is rejected with 400.

| Group    | Emojis |
|----------|--------|
| Core     | `👍`, `👎`, `❤️`, `😂`, `😭`, `🔥`, `💀` |
| Emotions | `😤`, `🤔`, `😎`, `🫡`, `🤡`, `😱` |
| Gaming   | `🎮`, `⚔️`, `🏆`, `🎯`, `💯` |
| Fun      | `🍆`, `🗿`, `👀`, `💩` |

Notes on encoding:
- `❤️` and `⚔️` MUST include the `U+FE0F` VARIATION SELECTOR-16 —
  the server allowlist matches the exact codepoint sequence including
  the selector. Reimplementers must not send bare `U+2764` / `U+2694`.

### Picker UI

- **Trigger**: small Lucide `SmilePlus` icon button rendered in the left
  gutter of a message on hover (see 05-icons.md §05.4 Message Hover
  Actions). 28x28 touch target with 14px icon (hover-affordance
  carve-out per 05.3). Color `var(--text-muted)`, accent on hover.
  Earlier spec revisions referenced a `☺` (U+263A) Unicode glyph;
  Lucide `SmilePlus` has been the shipped UI since T-033.
- **Panel**: `<EmojiPicker>` rendered via `createPortal` to
  `document.body` when an `anchorRef` is provided. `position: fixed`,
  `z-index: 10000`, 240 × 130 px (7-column × 3-row grid of 32 × 32 px
  emoji buttons). Container: `var(--bg-elevated)` background, `1 px`
  `var(--border-default)` border, `box-shadow: 0 4px 24px rgba(0,0,0,0.3)`,
  no border-radius.
- **Positioning**: opens below the trigger by default; auto-flips above
  if it would clip the viewport bottom; clamps 4 px from any viewport
  edge.
- **Hover state** on emoji buttons: `var(--bg-surface)` background.
- **Close triggers**: selection (a click on any emoji), click-outside
  (excluding the anchor trigger itself), or `Escape`.

### Rules

- Each user may react with up to **10 different** emojis per message.
  Attempts to add an 11th return 400 `VALIDATION_ERROR "Maximum 10
  reactions per message"`.
- No duplicate emoji per user per message — clicking the same emoji
  again toggles it off.
- **Aggregation**: same emoji from multiple users → single badge
  `{emoji} {count}` with the `userIds` list.
- **Display**: row of reaction badges below the message content (or
  preserved under a tombstone). Each badge:
  - `{emoji} {count}` — highlighted when the current user is among the
    `userIds`.
  - Click toggles the current user's reaction for that emoji.
- **Tombstone rule**: reactions are preserved on tombstoned messages
  and remain interactive (§30.9).

### API Endpoint (Normative)

```
POST /api/messages/:messageId/reactions
  Auth: [requireAuth]
  Body: { emoji: string }
  Rules:
    - emoji in the 22-codepoint allowlist → 400 VALIDATION_ERROR
      "Emoji not allowed" otherwise
    - Message must exist → 404 NOT_FOUND otherwise
    - Scope membership: joined room member OR DM participant →
      403 FORBIDDEN otherwise
    - Atomic toggle: if a reaction (messageId, userId, emoji) exists
      it is deleted (action='remove'); otherwise created
      (action='add'). A P2002 unique-constraint race is treated as
      idempotent 'add'.
    - Per-user cap: 10 distinct emojis per message. Exceeding returns
      400 VALIDATION_ERROR "Maximum 10 reactions per message".
  Response:
    { data: {
        action: 'add' | 'remove',
        reactions: ReactionGroup[]
    } }
```

Where `ReactionGroup = { emoji: string; count: number; userIds: string[] }`.
The server returns the **full** list of reaction groups for the
message (not a diff).

### WS Event `message.reaction`

```
message.reaction
  payload: {
    messageId: string,
    scopeType: 'room' | 'direct',
    scopeId: string,
    emoji: string,
    userId: string,        // the user who toggled
    action: 'add' | 'remove',
    reactions: ReactionGroup[]
  }
```

Scoping:
- `room` → broadcast, membership-filtered to joined members only
  (same invariant as `message.new` per CGL-002 scope expansion).
- `direct` → `sendToUser()` for each of the two DM participants.

### Reaction Removal

- User can remove own reaction by clicking the badge or re-selecting
  the emoji in the picker.
- If the resulting count reaches 0, the badge is removed from display.

<!--
DIM-Map §30.5 (refreshed 2026-04-11, T-004 F-CSD-017/018):
- Completeness: picker portal + positioning + grid, 22-emoji
  allowlist with VS-16 note, full API + WS contract.
- Konsistenz: allowlist is the SSOT; client picker MUST mirror the
  server list exactly.
- Interface-Vertraege: endpoint body/response shape, ReactionGroup
  type, WS event payload.
-->


## 30.6 Typing Indicators

### Scope

Typing indicators apply to both group room conversations and direct conversations. Scope is
identified by `{ scopeType: 'room' | 'direct', scopeId: string }` in WS events -- matching the
unified scope pattern used across the system.

**DM entity availability (updated 2026-04-11)**: Typing indicators
require a `scopeId` (the `direct_id`). The DirectConversation entity
is **eagerly created** on DM view open via `GET /api/direct/:otherUserId`
(see §30.19). This means typing indicators are available **immediately**
on entering a DM view — they are NOT gated on the first message being
sent. Earlier spec revisions stated the opposite; that was correct only
before the eager-creation endpoint existed.

### Client Behavior -- Sending

When the local user types in a message input:

1. On the **first keystroke** after idle: send `typing.start`
   `{ type: 'typing.start', payload: { scopeType, scopeId } }`

2. **Suppress subsequent keystrokes** -- do not send `typing.start` again while already in
   "typing" state for this scope.

3. **Debounce stop**: if no keystroke occurs for **3 seconds**, send `typing.stop`
   `{ type: 'typing.stop', payload: { scopeType, scopeId } }`
   and reset to idle state.

4. **Send as implicit stop**: when the user submits a message (send action), send `typing.stop`
   BEFORE sending the message. This ensures the indicator disappears before the message arrives
   for other participants.

5. **Scope switch**: if the user navigates to a different room or DM while in "typing" state,
   send `typing.stop` for the previous scope immediately.

### Server Behavior

The server maintains ephemeral in-memory state:

```
Map<scopeType + ':' + scopeId + ':' + userId, TimeoutHandle>
```

**On `typing.start`:**
- Record / refresh the timeout for this user+scope
- Broadcast `typing.update` to all OTHER users in scope:
  `{ type: 'typing.update', payload: { scopeType, scopeId, typingUserIds: string[] } }`
- Start / reset a **5-second server-side timeout** for this user+scope (fallback cleanup if
  `typing.stop` is never received, e.g. on disconnect)

**On `typing.stop` (or timeout expiry):**
- Remove user from typing state for this scope
- Broadcast updated `typing.update` to all other users in scope. The
  triggering user is excluded from the broadcast via `excludeUserId` —
  rooms via `broadcastToUsers(joinedMemberIds, msg, excludeUserId)`;
  DMs via `sendToUser(otherParticipant, msg)` (single-recipient path
  so the exclusion is automatic).

**On user disconnect:**
- Clear all typing state for that user across all scopes
- Broadcast `typing.update` for each affected scope

Note: `typing.update` carries the **full current list** of typing user IDs for the scope, not a
delta. This avoids sync issues if events are lost.

### Client Behavior -- Receiving

The client maintains `typingByScope: Record<scopeId, string[]>` state (list of user IDs
currently typing, per scope).

On receiving `typing.update`:
- Replace `typingByScope[scopeId]` with the received `typingUserIds`
- Filter out the local user's own ID before storing

### UI -- Typing Indicator Display

The typing indicator is displayed below the message list, above the message input. It is shown
only when `typingByScope[currentScopeId]` is non-empty.

Display rules (usernames resolved from the user list):

- 1 person typing: `{username} is typing...`
- 2 people typing: `{username1} and {username2} are typing...`
- 3+ people typing: `Several people are typing...`

Visual style:
- `text-muted` color
- Same font (IBM Plex Mono)
- No animation, no bouncing dots (TTY aesthetic)
- Height is reserved at `20px` with `line-height: 20px`; the indicator
  fades in/out without causing layout shift.

## 30.7 Room Creation

### Entry Point

A "Create Room" button is shown at the top of the Chatrooms sidebar
section. Label: `[ + NEW ROOM ]`.

### Create Room Dialog

Modal layout:
- **Container**: 400 px wide (max 90 vw), centered over a fixed
  full-viewport backdrop (`rgba(10, 10, 20, 0.7)` with
  `backdrop-filter: blur(4px)`), `z-index: 101`.
- **Backdrop click** closes the dialog.
- **Header**: hex-label `[ 0x09 CREATE ROOM ]` in `var(--text-secondary)`
  brackets + prefix with `CREATE ROOM` in `var(--accent)`,
  `var(--text-sm)`, `var(--font-mono)`.
- **Body** contains three fields followed by an error slot and the
  action buttons.

**Fields**:

| Field           | Required | Rules |
|-----------------|----------|-------|
| Room name       | yes      | 1–50 chars, trimmed non-empty. |
| Discoverable    | no       | Checkbox, default `true`. "Discoverable (visible in sidebar for all users)". |
| Password (opt.) | no       | Password input, max 64 chars. Empty = no password. If non-empty, min 4 chars (client-side); server hashes with Argon2id. Placeholder: `"Leave empty for no password"`. |

**Buttons**: `CANCEL` (plain border) on the left, `[ CREATE ]` (accent
border) on the right.

**Keyboard**:
- `Enter` (on any field) → submit.
- `Escape` → close dialog (via the input `onKeyDown` handlers).

**Form States (Normative — corrected 2026-04-11)**:
- On submit, `[ CREATE ]` becomes disabled and renders at
  `opacity: 0.5`; cursor changes to default. The label **stays**
  `[ CREATE ]` — there is NO `[ CREATING... ]` transitional label
  (earlier spec revisions described a label swap that was never
  implemented).
- The name field remains editable during submission (the dialog
  typically closes quickly on success; if the server rejects, the user
  can fix and retry without losing input).
- On success: dialog closes and the view navigates to the new room.
- On failure: the inline error slot above the buttons shows
  `var(--error)` text; the `[ CREATE ]` button re-enables.

### On Creation

- Server creates the Room entity (see `10-domain.md` §10.7).
- Creator is auto-joined in the same transaction.
- A `::system::joined` message for the creator is persisted atomically
  (§30.18).
- View navigates to the new room.
- Other clients receive `room.created` WS event and see the room in
  their sidebar (see `25-websocket.md`).

### Message Input

Text input at the bottom of the conversation view.
- Placeholder: `Type a message...` (or `Add a message (optional)...`
  when file chips are staged).
- Submit: `Enter` (Shift+Enter for a newline).
- Attachment button (`+F`) to the left of the input
  (see `35-uploads.md`).
- **Character-limit warning banner**: when `content.length >
  MAX_MESSAGE_LENGTH` (10000 chars), a red-bordered banner appears
  above the input showing `MESSAGE TOO LONG` on the left and
  `{length} / {max}` on the right. The `SEND` button is disabled
  while the content is over the limit.
- **Reply preview bar** (§30.11) and **drag-drop highlight zone**
  (see `35-uploads.md`) are also mounted above the input row.
- Optimistic send behaviour with deduplication (see §30.4 Optimistic
  Send and `25-websocket.md` §25.7).
- **Focus behaviour**: the textarea auto-focuses when a reply is
  activated and refocuses after a send completes
  (`requestAnimationFrame` delay so the disabled→enabled transition
  is observed).

<!--
DIM-Map §30.7 (refreshed 2026-04-11, T-004 F-CSD-019/020/021):
- Completeness: password field, backdrop + blur, hex-label header,
  form-state wording corrected (no CREATING swap), char-limit
  warning banner.
- Konsistenz: password storage cross-ref to 15-auth.md.
-->


## 30.8 Long Message Collapse

### Behavior
Messages exceeding ~3 lines are collapsed by default.

### Threshold
- `max-height: 4.8em` (3 lines at `line-height: 1.6`).
- Measurement: render with `max-height + overflow: hidden`. In
  `useLayoutEffect`, compare `scrollHeight > clientHeight`. If no
  overflow, remove the `max-height` constraint and hide the indicator.
- Indicator is initially hidden (rendered only after measurement
  confirms overflow). This prevents a flash of the expand control on
  short messages.
- Trailing whitespace is stripped from the content before measurement
  (`content.replace(/\s+$/, '')`) so trailing newlines in `pre-wrap`
  do not consume the visible rows inside the 4.8 em container.

### Expand/Collapse Control
- **Collapsed indicator**: the literal string `[...] ▼` (U+25BC BLACK
  DOWN-POINTING TRIANGLE) rendered on a new line below the clipped
  text, left-aligned.
- **Expanded indicator**: `▲` (U+25B2 BLACK UP-POINTING TRIANGLE) at
  the bottom-left of the full text.
- Style: `var(--text-muted)`, `var(--font-mono)`, `var(--text-xs)`.
  Clickable button (no border, no background).

### Visual Style
- Hard cut at `max-height`. **No gradient** (TTY rule: no gradients on surfaces).
- No animation (instant toggle).

### State
- Default: collapsed. Resets on page/chat reload. Client-side only.

### Interactions
- Collapse applies to text only. Attachments + reactions always visible.
- Applies to both first-in-group and continuation messages.
- **Tombstone messages are never collapsed.**
- **Reply quoted blocks are NOT part of collapsible text** (always visible).

## 30.9 Message Deletion

### Permissions

| Actor | Can delete | Time limit |
|-------|-----------|------------|
| Message author (non-admin) | Own messages only | Within 3 minutes of server `createdAt` |
| Admin | Any message | No limit |

**Membership gate:** Only `joined` members see delete option. `left` members cannot
delete even their own recent messages (consistent with no-send rule).

System messages (`::system::` prefix) are NOT deletable by anyone (client + server).

### Entry Point
Right-click (or long-press) -> context menu: `[ DELETE MESSAGE ]`
Shown only if user has permission. Absent otherwise.

### 3-Minute Window
- **Server-side** (hard): `now() - message.createdAt <= 3 minutes`. Rejects with 403.
- **Client-side** (soft): show option for `3 minutes 10 seconds` after `createdAt`
  (10-second grace for clock skew). If server returns 403, show inline error:
  `time window expired` (text-muted, fades after 3s).

### Confirmation
Inline in context menu:
```
Delete this message? [ YES ] [ NO ]
```

### Tombstone (Normative)
Deleted messages are soft-deleted. Display:
- **Message text**: replaced with `deleted message` in `text-muted`, italic.
- **Username and avatar**: preserved, always shown (even if message was grouped).
- **Emoji reactions**: preserved, still interactive.
- **Attachments**: hidden from display (DB records remain).
- **Timestamp**: preserved.
- **Reply quoted blocks** referencing this message: show `deleted message`.

**Tombstone breaks grouping:** A tombstone is always rendered as a "full message"
(avatar + username visible), never as a grouped continuation. This ensures the
deletion is visible.

### Data Model
Add to `Message` entity:
```prisma
deletedAt    DateTime?  @map("deleted_at")
deletedBy    String?    @map("deleted_by")
```

`deletedAt != null` = tombstone. Original content preserved in DB (audit).

### API Response
For tombstone messages, the API returns:
```typescript
{
  id, scopeType, scopeId, authorId, author,
  content: null,           // NOT the original text
  createdAt,
  deletedAt: string,       // ISO timestamp
  attachments: [],         // empty array (distinct from non-tombstone undefined)
  reactions: [...],        // preserved
  replyTo: { ... },        // preserved if present
  editedAt: null,          // cleared
}
```

**Attachments field representation (Normative):** Non-tombstone
messages with no attachments return `attachments: undefined` (the
field is omitted from the response object). Tombstone messages
explicitly return `attachments: []` (empty array). Clients MUST treat
both as "no attachments" when rendering; the distinction is purely a
server-side shape artifact.

### API Endpoint
```
DELETE /api/messages/:messageId
  Auth: [requireAuth]
  Rules (order matters):
    - Message not found → 404 NOT_FOUND
    - Message already tombstoned (deletedAt != null) →
      400 VALIDATION_ERROR "Message is already deleted"
    - System message (::system:: prefix) →
      400 VALIDATION_ERROR "System messages cannot be deleted"
    - Admin user → allowed (any message, any time; bypasses
      membership + time-window checks)
    - Non-admin, room-scope: author MUST currently be a `joined`
      member of the room (403 FORBIDDEN if `left` / `not_joined`).
    - Non-admin: caller MUST be the author.
    - Non-admin, 3-minute window: `now() - createdAt <= 180s`
      (server-side). 403 FORBIDDEN "time window expired" otherwise.
  Response: { data: { deleted: true, messageId: string } }
```

### WS Event
```
message.deleted
  payload: { messageId: string, scopeType: 'room' | 'direct', scopeId: string }
```
Scoping: `room` -> `broadcast()`. `direct` -> `sendToUser()` per participant.

Clients replace message content with tombstone display. No re-fetch needed.

## 30.10 Message Editing

### Permissions

| Actor | Can edit | Time limit |
|-------|---------|------------|
| Message author (non-admin) | Own messages only | Within 3 minutes of server `createdAt` |
| Admin | Any message | No limit |

**Membership gate:** Only `joined` members see edit option.

NOT editable: system messages (`::system::`), tombstone messages (`deletedAt != null`).

**Content guard:** Edited content MUST NOT start with `::system::`. Server rejects
with 400 if attempted. This prevents users from creating pseudo-system messages.

### Entry Point
Right-click -> context menu: `[ EDIT MESSAGE ]`
Same 3-minute window logic as deletion (client 3:10, server 3:00, graceful 403).

### Edit UI
On select:
- Message text becomes **inline editable textarea** (replaces static text).
- Pre-filled with current content.
- `[ SAVE ] [ CANCEL ]` below textarea.
- **Escape** key = cancel. Auto-resize textarea (same as MessageInput).

### Edit Indicator
- Author edit: `(edited)` in `text-muted` after timestamp.
- **Admin edit of another user's message**: `(edited by admin)` in `text-muted`
  after timestamp. This ensures transparency -- the displayed text is under the
  original author's name but visibly modified by admin.

### Data Model
Add to `Message` entity:
```prisma
editedAt     DateTime?  @map("edited_at")
editedBy     String?    @map("edited_by")
```

Content updated in-place. No edit history stored.

### API Endpoint
```
PATCH /api/messages/:messageId
  Auth: [requireAuth]
  Body: { content: string }
  Rules (order matters):
    - Message not found → 404 NOT_FOUND
    - Content missing / empty after trim →
      400 VALIDATION_ERROR "Content must not be empty"
    - Content length > 10000 (trimmed) → 400 VALIDATION_ERROR
    - Content starts with ::system:: → 400 VALIDATION_ERROR
      "Reserved message prefix" (content guard, §30.17)
    - Tombstone (deletedAt != null) →
      400 VALIDATION_ERROR "Deleted messages cannot be edited"
    - System message (existing ::system::) → 400 VALIDATION_ERROR
    - Admin user → allowed (any message, any time)
    - Non-admin, room-scope: author MUST currently be `joined`
      in the room (403 FORBIDDEN if `left`).
    - Non-admin: caller MUST be the author.
    - Non-admin, 3-minute window: `now() - createdAt <= 180s`
      (server-side). 403 FORBIDDEN "time window expired" otherwise.
  Response: { data: { message: MessageResponse } }
```

Server sets `editedAt = now()` AND `editedBy = requestingUserId` on
every successful edit. The returned `MessageResponse` includes both
fields. The admin-edit of another user's message is therefore
detectable by `editedBy !== authorId` — the client renders
`(edited by admin)` in that case (§30.10 Edit Indicator).

### WS Event
```
message.edited
  payload: {
    messageId: string,
    scopeType: 'room' | 'direct',
    scopeId: string,
    content: string,
    editedAt: string,
    editedBy: string
  }
```
Scoping: same as `message.deleted`.

**Edge case -- edit during delete:** If a `message.deleted` WS event arrives while
the user has the message open in edit mode, cancel the edit and show the tombstone.

### Effect on Replies
Editing a message does NOT live-update quoted blocks in replies. Quoted blocks
update on next page load (API returns fresh content). This is acceptable -- quoted
text is a snapshot hint, not a live reference.

## 30.11 Reply to Message

### Behavior
WhatsApp-style reply: a message references another message with a visual quote.
Flat replies only -- no nested threads.

### Entry Points
1. **Right-click** -> context menu: `[ REPLY ]`
2. **Reply icon** on message hover -- reply-arrow icon, left of content (per 30.4 layout).

Available for `joined` members on any message (including tombstones -- reply to
the fact that a message existed).

### Reply Mode
Activating reply shows a **preview bar** above the message input:
```
+- Replying to {username} -------------------------------- [x]
|  {first line of original message, truncated ~80 chars}
+----------------------------------------------------------
```
- Style: box-drawing border, `bg-elevated`, `font-mono`, `text-sm`.
- `[x]` cancels reply mode. **Escape** also cancels.
- If original is tombstone: show `deleted message` in the preview.
- Message input receives focus on reply activation.

### Sending a Reply
Message sent with `replyToId` = original message ID. Reply mode cleared after send.

Self-reply is allowed (user replies to own message).

### Reply Display in Message List (Normative — updated 2026-04-11)

The reply quoted block is rendered as a **left-bordered div**, not
ASCII box-drawing. The previous spec revision showed a
`+- / | / +------` ASCII frame that was never implemented.

Styling:
- Container: `border-left: 2px solid var(--border-default)`,
  `padding-left: var(--space-2)`, `margin-bottom: var(--space-1)`.
- Line 1 — original author: `{replyTo.author.username}` in
  `var(--text-muted)`, `var(--text-xs)`, `font-weight: 500`,
  `var(--font-mono)`.
- Line 2 — original content (truncated ~120 chars server-side):
  `var(--text-muted)`, `var(--text-sm)`, `var(--font-mono)`,
  `line-height: 1.4`.
- Tombstone original: the content line renders the literal string
  `deleted message` in italic; `replyTo.content` is `null` from the
  server for tombstones, so the client substitutes the literal.
- The container has `cursor: pointer` when an `onClickQuote` handler
  is provided.

Interaction:
- **Click quoted block**: scrolls to and briefly highlights the
  original message in the current view (see §30.4 Scroll-to-Message —
  mechanism is smooth scroll + center alignment + temporary background
  highlight).
- If the original is not currently loaded in the list, the click is a
  no-op (no recursive load-until-found). The earlier spec's "Original
  message not in view" tooltip was never implemented.
- The quoted block is NOT part of the collapsible text region (§30.8) —
  it is always visible even when the reply's own text is collapsed.

### Reply Preview Bar (above the input)

The reply preview bar above the message input uses the **same**
left-border pattern as the in-list quoted block, with a
`var(--bg-elevated)` background and a `var(--accent-dim)` left border
(accent hint instead of neutral border). Composition:

- Row 1: `Replying to {username}` in `var(--text-secondary)`
  `var(--text-xs)`.
- Row 2: first 80 characters of the original (simple character slice,
  newlines preserved — no `split('\n')[0]` pass), ellipsis on
  overflow, `var(--text-muted)`.
- `[x]` cancel button on the right. `Escape` on the input also
  cancels.
- Tombstone original: `deleted message` in place of the content row.

### Data Model
Add to `Message` entity:
```prisma
replyToId    String?   @map("reply_to_id")
replyTo      Message?  @relation("MessageReplies", fields: [replyToId], references: [id], onDelete: SetNull)
replies      Message[] @relation("MessageReplies")
```

`onDelete: SetNull` -- if replied-to message is hard-deleted (room cascade), the
reply's `replyToId` becomes null. Reply displays without a quoted block.

### API Changes
**POST /api/messages**: add optional `replyToId` to body.
- Must reference a message in the same scope (`scopeType` + `scopeId`). Cross-scope: 400.
- Referencing a non-existent message: 400.

**GET /api/messages** response includes `replyTo`:
```typescript
replyTo?: {
  id: string;
  authorId: string;
  author: { id: string; username: string; profile: ProfileResponse | null };
  content: string | null;  // truncated 120 chars, null if tombstone
  deletedAt?: string;
}
```

Server truncates `replyTo.content` to 120 characters. Server substitutes `null`
for tombstone messages.

### WS Event
No new event. `message.new` payload already includes full `MessageResponse`,
which now carries `replyTo`.

## 30.12 Message Layout -- Left-Aligned Interactive Elements

### Rule (Normative)
All message interactive elements are left-aligned. No elements float to
the right.

- **Emoji reaction trigger**: positioned left of the content block
  (between the avatar column and the text). Lucide `SmilePlus` icon
  (see 05-icons.md §05.4 Message Hover Actions). Earlier revisions
  referenced a `☺` (U+263A) Unicode glyph — Lucide migration (T-033)
  replaced it.
- **Reply icon**: left of the content block, next to the emoji
  trigger. Lucide `Reply` icon (see 05-icons.md §05.4). Earlier
  revisions referenced a `↩` (U+21A9) glyph — Lucide migration (T-033)
  replaced it.
- **Collapse arrow** (§30.8): bottom-left of collapsed text. Literal
  Unicode glyphs `▼` (U+25BC) collapsed / `▲` (U+25B2) expanded —
  intentionally NOT Lucide icons (see 05-icons.md §05.5 text retention
  rationale).

Both hover icons:
- Rendered absolutely at `top: 50%; left: 0; transform: translateY(-50%)`
  inside a `position: relative` message-content wrapper that extends
  its hover zone left (negative `margin-left` + matching `padding-left`)
  so the cursor can move to the icons without triggering `mouseleave`.
- Style: `font-size: 12 px`, `var(--bg-elevated)` background, `1 px`
  `var(--border-default)` border, no border-radius, `var(--font-mono)`.
- Colour: `var(--text-secondary)` default, transitions to
  `var(--accent)` on hover.
- On tombstone messages, only the reply icon is rendered (no emoji
  trigger, since reactions are preserved but tombstones cannot receive
  new reactions).

For grouped (continuation) messages the same hover icons render at the
same horizontal position using the avatar column space.

Layout must not jump / shift when the hover elements appear — the
absolute positioning plus the extended hover zone prevents layout
reflow.

## 30.13 Context Menu

### Singleton Rule
Only one context menu open at a time. Opening a new one closes any existing one.

### Rendering
`position: fixed`, React portal to `document.body` (escapes `overflow: hidden`).
Positioned at cursor/long-press coordinates, clamped to viewport bounds.

### Closing
Click-outside, `Escape`, scroll, or opening another menu.

### Style
Box-drawing border, `bg-surface`, `font-mono`, no border-radius.
Items: `text-primary`, hover: `bg-elevated`.
Destructive items (`DELETE`): `error` color on hover.

### Confirmation Variant
Destructive actions show inline confirmation replacing the menu item:
`{question} [ YES ] [ NO ]`. `YES` executes, `NO` closes menu.

### Context Menu Items per Message

| Item | Condition |
|------|-----------|
| `[ REPLY ]` | `joined` members, any message (incl. tombstone) |
| `[ EDIT MESSAGE ]` | Own + < 3:10 client-side, OR admin. Not system/tombstone. |
| `[ DELETE MESSAGE ]` | Own + < 3:10 client-side, OR admin. Not system. |

System messages (`::system::`): no context menu.

## 30.14 URL Linkification

URLs in message text are automatically detected and rendered as clickable links.

- Detection: regex `/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi` — matches
  `http://` and `https://` only. Bare `www.` URLs are **not** linkified
  (they render as plain text). Rationale: requiring an explicit scheme
  avoids false positives on ordinary prose.
- Trailing punctuation cleanup: `.,;:!?)` are trimmed from the end of
  the match so a sentence-final URL does not absorb the terminating
  punctuation into the link href.
- Rendering: `<a>` element with `color: var(--accent)`,
  `border-bottom: 1px solid var(--accent-muted)` (visual underline that
  transitions on hover — chosen over `text-decoration: underline` so
  the gap below text sits on a hairline accent rather than inheriting
  text-decoration color), `target="_blank"`, `rel="noopener noreferrer"`.
- Non-URL text is rendered as plain text (React nodes).
- Implemented via `linkifyText()` in `lib/linkify.tsx`.

## 30.15 @Mentions

Users can mention other users in messages using `@username` syntax.

### Input Behavior (Normative — detail refresh 2026-04-11)

- **Trigger rule**: typing `@` activates autocomplete **only** when the
  `@` is preceded by whitespace, a newline, or is at the very start of
  the input (position 0). This prevents mid-word triggering like
  inside an email address.
- **Query**: the substring from the `@` up to the cursor. Usernames
  may contain spaces (T-036), so the query continues across spaces
  as long as at least one known username matches the current prefix.
  The query is cancelled (autocomplete closes) on a newline, or when
  no candidate remains for the prefix.
- **Match**: case-insensitive **prefix** match against the known
  usernames list (passed to `<MessageInput>` as `knownUsernames`),
  sorted by length descending so longest matches win (necessary for
  usernames with spaces — "Frank G" must match before "Frank").
- **Dropdown**: rendered above the message input (same
  `var(--bg-elevated)` container, 1 px `var(--border-default)` border,
  no border-radius), `max-height: 200 px`, `overflow-y: auto`. Shows
  up to **8** suggestions.
- **Keyboard**:
  - `ArrowDown` / `ArrowUp` cycle through suggestions with wrap-around.
  - `Enter` or `Tab` accept the currently selected entry.
  - `Escape` cancels and closes the dropdown.
- **Mouse**: hovering a suggestion updates the selected index (keyboard
  and mouse share the same selection state).
- **Insertion**: the accepted mention is inserted as `@{username} `
  (with a trailing space) replacing the `@`-prefixed query text. The
  cursor is repositioned after the inserted text (incl. the trailing
  space).
- **Visual selection state**: the currently selected entry renders
  with `var(--bg-surface)` background and `var(--accent)` text.

### Display

- `@username` tokens in message text are rendered with
  `color: var(--accent)`, `font-weight: bold`.
- **Word-boundary rule**: the mention parser regex requires the
  `@username` token to be followed by whitespace, end-of-string, or a
  sentence-punctuation character (`.,!?;:`). Tokens followed by other
  letters/digits (e.g. `@alice123abc`) do NOT highlight. This prevents
  false-positive highlights on URLs and code-like prose.
- **Self-mention highlight**: when the mentioned username matches the
  current viewer's username, the rendered token additionally receives
  `background: var(--accent-glow)` + 2px horizontal padding (visual
  "you were mentioned" cue). No notification side-effect and no
  server-side tracking — the highlight is purely render-time.
- Mentions are parsed at render time via `parseMentions()` in
  `lib/mentions.tsx`, combined with URL linkification (§30.14) so each
  rendered message row goes through `renderEnrichedText(text,
  knownUsernames, currentUsername)`.
- **No server-side mention tracking or notification** — mentions are
  purely a visual affordance.

## 30.16 Message Search

Full-text search across messages in the currently open conversation.

### Entry Points (Normative — revised 2026-04-11)

- **`Ctrl+F` / `Cmd+F`** inside a `RoomView` / `DmView` intercepts the
  browser-native find-in-page via `event.preventDefault()` and opens
  the in-app search overlay. Rationale: the browser find is
  incompatible with the paginated / virtualized message list.
  **Implementation note**: the handler matches `e.key === 'f'`
  (lowercase only). A Shift-held `Ctrl+Shift+F` (which yields
  `e.key === 'F'` uppercase) or a Caps-Lock-active `Ctrl+F` will fall
  through to browser-native find — intentional, since those modifier
  combinations are not the primary search shortcut.
- **`[ SEARCH ]` button** in the conversation header (§30.1.1 item 5
  for rooms, §30.1.2 item 6 for DMs). Rooms: visible for `joined` and
  `left` members. DMs: visible once `directId` is known.

**Both entry points always open the overlay in scoped mode** for the
currently open conversation — the `scopeType` / `scopeId` are always
passed. There is **no global sidebar search entry**. The previous
spec revision referenced a `[ / SEARCH ]` button in the sidebar header
that was never built; the button does not exist in code. The server
endpoint supports unscoped (global) search, but no UI surface currently
exposes it.

> **Note for reimplementers**: if you want to add a global search
> entry in the future, the server-side is already there — wire a
> sidebar button that opens `<MessageSearch>` without `scopeType` /
> `scopeId`.

### Search Overlay (UI details)

- **Placement**: absolutely positioned inside the active
  conversation pane (not a global portal), covering the full
  conversation area, `z-index: 40`.
- **Background**: `rgba(10, 10, 20, 0.7)` with
  `backdrop-filter: blur(4px)`.
- **Panel**: top-anchored horizontally-centered (`margin: var(--space-8)
  auto 0` — a fixed top margin, not vertically centered), `max-width:
  640px`, `max-height: calc(100vh - 100px)`. Earlier spec revisions
  described the panel as "centered" vertically; the shipped layout is
  top-anchored so search results align with the header area.
- **Input row**: `[ SEARCH ]` hex-label marker brackets the input on
  the left; an `ESC` button on the right closes it. `Escape` on the
  window also closes.
- **Debounce**: 300 ms — the client waits 300 ms after the last
  keystroke before firing the server request.
- **Minimum query length**: 2 characters (client skips and server
  also enforces).
- **Pre-search state** (empty query): `search in this conversation`
  (scoped) or `search across all rooms` (global — not currently
  reachable).
- **Empty result**: `no results found`.
- **Intermediate status line** (during an in-flight query after the
  300ms debounce): `searching...` in `var(--text-muted)`.
- **Status line** (after a successful search): `{total} matching
  message(s)`; when `total > results.length` also shows
  `(showing N)`.
- **Result row composition**:
  - Author (`var(--accent)`).
  - Room context: `in #{roomName}` for room results, `[DM]` for DM
    results.
  - Relative time: `just now` (< 1 min), `Nm ago` (< 60 min),
    `Nh ago` (< 24 h), `Nd ago` (< 30 d), or `MMM D` for older.
  - Content snippet — up to 120 chars including ~30 chars of context
    before the match. Ellipsis (`...`) prefixed / suffixed when
    truncated. The match span is highlighted with `var(--accent)`
    colour, `font-weight: bold`, and `var(--accent-glow)` background.
  - Note: the server response includes `attachments` and `reactions`
    for each result, but the result row UI does NOT render them —
    they are kept in the payload for forward compatibility (and in
    case a result row grows to preview attachments / reactions later).
    Clients can safely ignore them.
- **Footer hint**: `ESC close   CLICK navigate to message`.
- **Click a result**: invokes `onNavigateToMessage(messageId,
  scopeType, scopeId)` — the parent closes the overlay and triggers
  a scroll-to-message (§30.4 Scroll-to-Message: smooth scroll,
  center align, 2 s accent-glow highlight).

### Server Endpoint

```
GET /api/messages/search?q={query}&scopeType={room|direct}
                        &scopeId={id}&limit=50&offset=0
  Auth: [requireAuth]
  Rules:
    - q length >= 2 else 400 VALIDATION_ERROR
    - limit clamped to 1..100, default 50
    - offset integer >= 0, default 0
  Response:
    { data: { messages: SearchResult[], total: number } }
```

`SearchResult extends MessageResponse` with:
- `roomName: string | null` — room name for context (null for DMs).
- `attachments` and `reactions` are populated (same shape as
  `/api/messages`).

Semantics:
- Case-insensitive substring match on message content (Prisma
  `contains` with `mode: 'insensitive'`).
- Results ordered by `createdAt` **descending** (newest first).
- Tombstones (`deletedAt != null`) are always excluded.
- **Scoped search** (`scopeType` + `scopeId` provided): searches
  within that single room (access check: `state !== 'not_joined'`)
  or DM (caller must be a participant).
- **Global search** (`scopeType` / `scopeId` omitted): server
  computes accessible scopes from `GroupMembership` where
  `state in [joined, left]` plus `DirectConversation` where the
  caller is a participant. If the caller has no accessible scopes,
  the server returns `{ messages: [], total: 0 }` without scanning.
- `total` is the full count of matching messages for the query (not
  capped to the returned page).

### Access Note for `left` Members

Consistent with §30.3.2, a `left` room member retains read-only
access to the room's message history and can therefore open search
against that room — both via `[ SEARCH ]` and `Ctrl+F`. The server
enforces this by allowing search when `membershipState !==
'not_joined'`.

<!--
DIM-Map §30.16 (refreshed 2026-04-11, T-004 F-CSD-028/029/030/031):
- Completeness: overlay dimensions, debounce, status line, relative
  time formats, highlight mechanics, server endpoint contract.
- Konsistenz: global-sidebar entry retracted (not implemented); left
  members search rule surfaced.
- Interface-Vertraege: result shape + ordering + access rules
  formalised.
-->


## 30.17 Content Guard

Server MUST reject message content starting with `::system::` on both create
and edit. Error: `400 VALIDATION_ERROR "Reserved message prefix"`.

This prevents users from creating pseudo-system messages or editing messages
to become system messages.

## 30.18 System Messages

Membership transitions (join, leave, rejoin) and room creation generate system messages stored as regular `Message` rows.

**Content format:** `::system::{action}` where action is `joined`, `left`, or `rejoined`.
- `authorId`: the user who performed the action
- `scopeType`: `room`
- `scopeId`: the room ID

**Room creation:** The creator's `::system::joined` message is created inside the same transaction as the Room and GroupMembership, ensuring atomicity.

**Client rendering:** Messages with content starting with `::system::` are rendered as centered, muted system notifications (not as chat bubbles). The client extracts the action from the content prefix and displays `{username} {action} the room`.

**These are persisted messages** -- they appear in chat history, survive page reload, and are included in message pagination.

**Immutability:** System messages cannot be deleted or edited by anyone (client hides context menu, server rejects with 400). See 30.9 and 30.10.

## 30.19 DM Creation: Eager Lookup + Sentinel Pattern

There are **two** code paths that can materialise a
`DirectConversation` entity. Both are race-safe via `P2002` handling.

### 30.19.1 Eager Creation on DM View Open

```
GET /api/direct/:otherUserId
  Auth: [requireAuth]
  Rules:
    - Self-lookup (otherUserId === caller.userId) →
      400 VALIDATION_ERROR "Cannot look up DM with yourself"
    - Creates the DirectConversation on demand if one does not
      already exist (race-safe via P2002 unique-constraint handling).
  Response: { data: { directId: string } }
```

This is invoked by the DM view as soon as the user navigates to a DM.
Creating the entity eagerly (instead of on first message) enables the
DM header to render call controls, screenshare controls, the search
button, and typing indicators **before** the first message is sent.

### 30.19.2 Sentinel Pattern on Message POST

When a client sends the first message to a user without having called
the eager-creation endpoint, the `scopeId` field uses a sentinel value:
`new:{otherUserId}`.

**Client behaviour**: sets `scopeId = 'new:' + otherUserId` when no
`directId` is known yet.

**Server behaviour** (`POST /api/messages`):
1. Detects the `new:` prefix in `scopeId`.
2. Extracts `otherUserId` via `scopeId.slice(4)`.
3. Validates the target user exists and is active.
4. Rejects self-DMs (400).
5. Finds or creates the DirectConversation (race-safe via P2002).
6. Uses the real `directConversation.id` as `actualScopeId` for
   message creation.
7. Returns `directId` in the response:
   `{ data: { message, directId } }`.

### 30.19.3 Participant Ordering

`DirectConversation` always stores the lexicographically smaller user
ID as `participantAId`. This ensures the unique constraint
`(participantAId, participantBId)` prevents duplicates regardless of
who initiates.

<!--
DIM-Map §30.19 (refreshed 2026-04-11, T-004 F-CSD-032):
- Completeness: two entry points documented (eager GET + sentinel
  POST), both race-safe.
- Konsistenz: typing-indicator gate (§30.6) updated to match.
-->


## 30.20 Chat Font Size

### Overview
Users can adjust the chat text size via stacked A↑ / A↓ buttons in the
room and DM headers (see §30.1.1 item 8, §30.1.2 item 7).

### Controls (Normative — revised 2026-04-24)

Two icon buttons rendered side-by-side in a flex row:

- **Increase button**: Lucide `AArrowUp` icon at `size=28` (see
  05-icons.md §05.4 Chat Font Size).
- **Decrease button**: Lucide `AArrowDown` icon at `size=28`.
- Touch-target carve-out: 36x36 per 05.3 (density-driven; see
  05-icons.md). Button chrome: no border-radius; transparent background;
  hover color transitions to `var(--accent)`.

**Tooltips** (both `title` attribute and `aria-label`):
- Increase: `"Increase font size"`.
- Decrease: `"Decrease font size"`.

Earlier spec revisions described a two-glyph stacked layout (`▲` +
serif `A` and serif `A` + `▼`) — that composition was never built. The
Lucide `AArrowUp` / `AArrowDown` icons have been the shipped UI since
T-033 (commit `ea0304d`, 2026-04-18). The "A-up / A-down" conceptual
naming is retained, but the normative visuals are the Lucide icons
referenced above.

### Range & Steps
- Minimum: 12 px
- Maximum: 24 px
- Step: 2 px
- Default: 14 px

### Implementation
- Applied via `--chat-font-size` CSS custom property on `<html>`
  (`document.documentElement.style.setProperty(...)`).
- Message text elements read this variable for their `font-size` (the
  `CollapsibleText` component and the inline-edit textarea both use
  `var(--chat-font-size)` directly).

### Persistence
- Stored in `localStorage` under key `huddle-chat-font-size` as a
  bare integer string (e.g. `"16"`).
- Loaded on app boot via `initChatFontSize()` which calls `read()` and
  applies the value to `<html>`.

## 30.21 Chat Font Size Store (`stores/chatFontSize.ts`)

The font-size feature is backed by a small non-hook module
(`src/client/src/stores/chatFontSize.ts`, 47 lines) that directly
manipulates a CSS variable on `<html>`. It deliberately does NOT use
React state — the store IS the DOM + localStorage.

### Contract

| Constant  | Value                       |
|-----------|-----------------------------|
| `STORAGE_KEY` | `'huddle-chat-font-size'` |
| `MIN_PX`  | `12`                        |
| `MAX_PX`  | `24`                        |
| `DEFAULT_PX` | `14`                     |
| `STEP_PX` | `2`                         |

### Exported Functions

- `initChatFontSize(): void` — call once on app boot; reads the
  stored value (or default) and applies it to `<html>` via
  `document.documentElement.style.setProperty('--chat-font-size',
  '{N}px')`.
- `getChatFontSize(): number` — reads the current value from
  `localStorage`; returns `DEFAULT_PX` if missing, NaN, or out of
  range (`< MIN_PX || > MAX_PX`).
- `increaseChatFontSize(): number` — bumps the value by `STEP_PX`
  (clamped to `MAX_PX`), writes it back to `localStorage`, applies
  it to `<html>`, and returns the new value.
- `decreaseChatFontSize(): number` — symmetric; `Math.max(value -
  STEP_PX, MIN_PX)`.

### Reimplementer Notes

- `read()` parses with `parseInt(stored, 10)` and rejects NaN + out
  of range, so corrupted localStorage never poisons the UI.
- There is no broadcast / event channel — `<ChatFontSizeButtons>`
  mirrors the value in local React state (`useState(getChatFontSize)`)
  and the button click handlers call `setSize(increaseChatFontSize())`
  to keep the mirror consistent. Other components read
  `var(--chat-font-size)` via CSS and do not need to re-render.
- The store is client-only; there is no server sync.

### Acceptance Criteria (Chat)

- [ ] Messages load paginated (50 initial, older on scroll-up) via
  `GET /api/messages?before=...&limit=50`; response includes
  `hasMore` boolean.
- [ ] Message grouping collapses consecutive same-user messages within
  2 minutes; system messages + tombstones break grouping.
- [ ] Date separators appear between messages on different days,
  rendered as `------- {Month} {D}, {YYYY} --------` (ASCII hyphens).
- [ ] Emoji picker shows the fixed curated set of 22 Unicode
  codepoints (matching server allowlist; `❤️` and `⚔️` with VS-16).
- [ ] Reactions can be added and removed by clicking; server enforces
  the 22-emoji allowlist, returns `action` + full `reactions` groups,
  broadcasts `message.reaction` membership-filtered (room) or per
  participant (DM).
- [ ] Reaction badges show count and highlight when current user has
  reacted.
- [ ] Reaction limit of 10 distinct emojis per user per message is
  enforced (client + server; server 400 with cap error on exceed).
- [ ] Room creation works from sidebar `[ + NEW ROOM ]` button with
  backdrop-blur modal, hex-label header, and optional password field.
- [ ] Created room auto-joins and navigates to room view.
- [ ] `[ CREATE ]` button does NOT swap to `[ CREATING... ]` during
  submission — only opacity + disabled state changes.
- [ ] Initial load shows `loading...` centered (not
  `[ LOADING... ]`).
- [ ] Empty room shows `No messages yet. Say something.`; empty DM
  shows `Send {otherUsername} a message.`
- [ ] Text-only messages send optimistically with `opacity: 0.5` and
  timestamp placeholder `sending...`; file-bearing messages skip the
  optimistic path.
- [ ] On REST failure, the optimistic entry shows a `Failed to send
  [ retry ]` inline row; clicking retry removes the failed entry and
  resends.
- [ ] Sticky-bottom scroll: new message auto-scrolls only when user
  was within 50 px of the bottom; load-more triggers at `scrollTop <
  100 px`.
- [ ] Password-protected room: `[ JOIN ROOM ]` / `[ REJOIN ]` in
  header reveals an inline 140 px password input (Enter submits,
  Escape cancels); MembershipGate also shows password input for
  not_joined state.
- [ ] `left` members see a centered `You left this room. Rejoin to
  send messages.` banner in place of the input and can still use
  `[ SEARCH ]` / Ctrl+F.

### Acceptance Criteria (Typing Indicators)

- [ ] First keystroke sends `typing.start`; subsequent keystrokes do not
- [ ] 3s of inactivity sends `typing.stop`
- [ ] Sending a message sends `typing.stop` before `message.new`
- [ ] Navigating away from scope sends `typing.stop` for previous scope
- [ ] Server auto-clears typing state after 5s timeout
- [ ] Server clears all typing state on user disconnect
- [ ] Indicator shows correct text for 1, 2, and 3+ typers
- [ ] Own user ID filtered from received `typingUserIds`
- [ ] Indicator area does not cause layout shift when appearing/disappearing
- [ ] Works in both room and DM conversations
- [ ] Typing indicators activate once `directId` is set (eager on
  DM view open via `GET /api/direct/:otherUserId`) — NOT gated on
  the first message being sent.

### Acceptance Criteria (Message Collapse -- 30.8)

- [ ] Messages > 3 lines collapsed with literal `[...] ▼`
  (U+25BC); expanded shows `▲` (U+25B2).
- [ ] Expand/collapse toggle works.
- [ ] No flash on mount (measure-then-show via `useLayoutEffect`).
- [ ] Trailing whitespace is stripped before measurement.
- [ ] No gradient, hard cut only.
- [ ] Tombstones never collapsed.
- [ ] Reply quoted blocks not part of collapsible area.
- [ ] Resets on reload.

### Acceptance Criteria (Message Deletion -- 30.9)

- [ ] Own messages: deletable within 3 min (non-admin, joined).
- [ ] Admin: any message, any time (bypasses membership + window).
- [ ] System messages: not deletable (client + server 400
  `"System messages cannot be deleted"`).
- [ ] Missing message: 404.
- [ ] Already-tombstoned message: 400
  `"Message is already deleted"`.
- [ ] Confirmation before delete.
- [ ] Tombstone: `deleted message`, username/avatar/reactions preserved.
- [ ] Tombstone breaks grouping (always full message).
- [ ] Attachments hidden on tombstone.
- [ ] `left` members cannot delete.
- [ ] Clock-skew grace: client 3:10, server 3:00, graceful 403 UI.
- [ ] WS scoping: room broadcast, DM sendToUser.

### Acceptance Criteria (Message Editing -- 30.10)

- [ ] Own messages: editable within 3 min (non-admin, joined).
- [ ] Admin: any message, any time.
- [ ] Missing message: 404.
- [ ] System / tombstone: not editable (400).
- [ ] Empty-after-trim content: 400
  `"Content must not be empty"`.
- [ ] Content length > 10000: 400.
- [ ] `::system::` prefix blocked on edit (content guard).
- [ ] Server sets `editedAt` AND `editedBy = requestingUserId` on
  every successful edit; `MessageResponse` includes both.
- [ ] Inline textarea with SAVE / CANCEL / Escape.
- [ ] Author edit: `(edited)` marker.
- [ ] Admin edit of other's message: `(edited by admin)` marker
  (detected via `editedBy !== authorId`).
- [ ] `message.deleted` during edit → cancel edit, show tombstone.
- [ ] WS scoping matches deletion.

### Acceptance Criteria (Reply -- 30.11)

- [ ] Reply via context menu `[ REPLY ]` + hover Lucide `Reply` icon.
- [ ] Reply preview bar above input with `[x]` cancel.
- [ ] Escape cancels reply mode.
- [ ] Quoted block rendered as a left-bordered div (2 px
  `var(--border-default)`), NOT ASCII box-drawing.
- [ ] Quoted block shows author + truncated text (120 chars
  server-side).
- [ ] Tombstone original: literal `deleted message` in quote.
- [ ] Click quote scrolls to original with smooth center scroll +
  temporary highlight (if loaded in current view; no-op otherwise).
- [ ] Cross-scope replies rejected (400).
- [ ] Self-reply allowed.
- [ ] `replyToId` FK with `onDelete: SetNull`.
- [ ] Quote not collapsible.
- [ ] Room cascade: `replyToId` nulled, reply shows without quote.

### Acceptance Criteria (Layout + Context Menu -- 30.12, 30.13)

- [ ] Emoji trigger Lucide `SmilePlus` + reply Lucide `Reply` icons
  positioned absolute-left of content, vertically centered.
- [ ] Collapse arrow at bottom-left (`▼` collapsed, `▲` expanded).
- [ ] No right-floating interactive elements.
- [ ] No layout jump on hover (grouped + full messages).
- [ ] Singleton context menu (portal, fixed, viewport-clamped).
- [ ] TTY styled (box-drawing, font-mono).
- [ ] Inline confirmation for destructive actions.
- [ ] Content guard: `::system::` blocked on create + edit.

### Acceptance Criteria (Chat Font Size -- 30.20 / 30.21)

- [ ] Stacked A↑ / A↓ buttons visible in room and DM headers,
  each a flex column with a 6 px triangle glyph and a serif `A` of
  the appropriate size.
- [ ] Tooltip + `aria-label` read `"Increase chat font size"` /
  `"Decrease chat font size"`.
- [ ] Font size adjusts in 2 px steps between 12 px and 24 px.
- [ ] Default font size is 14 px.
- [ ] Font size persisted in localStorage `huddle-chat-font-size`
  as a bare integer string.
- [ ] Font size applied via `--chat-font-size` CSS variable on
  `<html>` from `initChatFontSize()` on app boot.
- [ ] `getChatFontSize()` returns default on missing / NaN /
  out-of-range stored value.
- [ ] `increaseChatFontSize()` / `decreaseChatFontSize()` clamp to
  `MAX_PX` / `MIN_PX` and persist the new value.

### Acceptance Criteria (Conversation Header -- 30.1 / 30.2)

- [ ] Single-row header; no separate Active Users Strip row.
- [ ] Room header composition: title, call timer (when active),
  call controls (joined), screenshare controls (joined),
  `[ SEARCH ]` (joined/left), `CallParticipantsStrip` (when
  participants > 0), inline active-user avatars (prefixed
  `active users:`), font-size buttons, contextual membership CTA.
- [ ] DM header composition: avatar (with 8×8 online square),
  username + online/offline label, call controls, screenshare
  controls, `[ SEARCH ]`, font-size buttons — all gated on
  `directId` being set.
- [ ] `InlineAvatar` renders `CallIndicatorOverlay` when
  `isUserInAnyCall(userId)` is true (mic overlay 10 px on 28 px
  avatar).
- [ ] Red `inset 0 0 0 2px var(--error)` box-shadow on the room
  header while the current user is in a call for that room.
- [ ] Password-protected room: header join/rejoin button collapses
  into a 140 px inline password form (Enter submits, Escape
  cancels) instead of calling the API directly.

### Acceptance Criteria (Message Search -- 30.16)

- [ ] `[ SEARCH ]` button (joined/left rooms, DMs with directId)
  opens the scoped overlay; `Ctrl+F` / `Cmd+F` also open it.
- [ ] No global sidebar search entry (`[ / SEARCH ]` was never
  implemented).
- [ ] Overlay debounces input 300 ms; minimum query length 2.
- [ ] Pre-search state shows `search in this conversation`.
- [ ] Empty result state shows `no results found`.
- [ ] Status line: `{total} matching message(s)` with optional
  `(showing N)` when results page is capped.
- [ ] Result row: author, `in #{roomName}` (rooms) or `[DM]`,
  relative time, content snippet with highlighted match span
  (`var(--accent)` + `var(--accent-glow)`).
- [ ] Click a result closes the overlay, scrolls to and highlights
  the target message (smooth center scroll + 2 s
  `var(--accent-glow)` background fade).
- [ ] Footer hint: `ESC close   CLICK navigate to message`.
- [ ] Server search endpoint results ordered by `createdAt desc`;
  tombstones excluded; global-mode early return when caller has no
  accessible scopes.
- [ ] `left` members can use search against the historical room.

### Acceptance Criteria (DM Creation + Eager Entity -- 30.19)

- [ ] `GET /api/direct/:otherUserId` eagerly creates the
  DirectConversation (race-safe via P2002), returns
  `{ directId }`.
- [ ] Self-lookup returns 400.
- [ ] DM header call/screenshare/search controls render as soon as
  `directId` is known — before the first message.
- [ ] Sentinel `scopeId = 'new:{otherUserId}'` on `POST
  /api/messages` still works (first-message path).

## 30.21 Media Gallery

### Intent

Browse all shared images and files in a room or DM without scrolling
through chat history.

### Entry Point

`Image` icon button (lucide) in the room/DM header, next to the search
icon. Clicking opens the Media Gallery overlay.

### Overlay Layout

The gallery renders as a panel overlay — same pattern as MessageSearch:
fixed position, portal, on top of the chat area. ESC closes it (but
only when the in-gallery lightbox is not already open — nested ESC
first closes the lightbox, then a subsequent ESC closes the gallery).

**Backdrop**: `background: rgba(0, 0, 0, 0.6)` with no
`backdrop-filter` (no blur). Distinct from MessageSearch's
`rgba(10, 10, 20, 0.7)` + 4px blur — the gallery intentionally keeps
the chat area readable through a solid-dark scrim.

```
┌──────────────────────────────────────┐
│ [ MEDIA ]                        [X] │
│ ┌──────────┐ ┌──────────┐           │
│ │ IMAGES   │ │ FILES    │           │
│ └──────────┘ └──────────┘           │
│                                      │
│ (content based on active tab)        │
│                                      │
└──────────────────────────────────────┘
```

- Header: `[ MEDIA ]` hex-label + close button (X)
- Tab bar: `IMAGES` | `FILES` — toggle buttons, active tab has accent border
- Content: scrollable area below tabs

### Images Tab

Grid of image thumbnails. Each cell:
- Size: `120px × 120px`, `object-fit: cover`
- Grid: `repeat(auto-fill, 120px)`, `gap: var(--space-2)`
- Border: `1px solid var(--border-default)`
- Click → opens existing Lightbox
- Below thumbnail: `{username} · {relative-date}` in `10px` (hardcoded
  pixel size, not `var(--text-xs)`), `var(--text-muted)`, with a
  middot (`·`) separator between username and date.

Sorting: newest first (by `createdAt` DESC).

### Files Tab

List of non-image attachments. Each row:
- Filename (truncated with ellipsis, max 1 line)
- File size (formatted: KB/MB)
- Username who uploaded
- Date (relative: "2h ago", "Mar 30")
- Click → browser download (`<a href=... download>`)
- Row style: `padding: var(--space-2)`, `border-bottom: 1px solid var(--border-default)`
- Hover: `background: var(--bg-surface)`

Sorting: newest first.

### Backend API

```
GET /api/messages/media
  Query: scopeType (room|direct), scopeId, type (images|files), cursor?, limit?
  Response: { data: { items: MediaItem[], nextCursor: string | null } }
  Auth: Session-Cookie required, scope access check
```

**MediaItem:**
```typescript
interface MediaItem {
  id: string;           // attachment ID
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;          // serving URL
  authorUsername: string;
  createdAt: string;    // ISO timestamp
}
```

**Query logic:**
- Join `Attachment` → `Message` to get scope + author
- Filter: `Message.scopeType = :scopeType AND Message.scopeId = :scopeId`
- Filter: `Message.deletedAt IS NULL` (exclude deleted messages)
- Type filter:
  - `images`: `contentType LIKE 'image/%'`
  - `files`: `contentType NOT LIKE 'image/%'`
- Order: `Attachment.createdAt DESC`
- Pagination: cursor-based on `createdAt` (next page = items older than cursor)
- Default limit: 50, max: 100

**Access check:**
- Room scope: user must have membership (joined or left)
- Direct scope: user must be participantA or participantB
- Same logic as existing message access (see `35-uploads.md` §35.7)

### Pagination

- Initial load: first 50 items
- "Load more" button at bottom of list/grid when `nextCursor` is not null
- Button label: `[ LOAD MORE ]` idle; swaps to `loading...` while the
  request is in-flight (button disabled during load)
- No infinite scroll (explicit load)

### Empty States

- Images tab, no images: `"No images shared yet."`
- Files tab, no files: `"No files shared yet."`
- Both in `var(--text-muted)`, centered

### Styling

- **No border-radius** (TTY constraint)
- Font: `var(--font-mono)` throughout
- Background: `var(--bg-surface)`
- Border: `1px solid var(--border-default)`
- z-index: 60 (above content, below modals)
- Width: `min(500px, 95vw)`
- Height: `min(600px, 80vh)`
- Centered in viewport

### Acceptance Criteria (Media Gallery)

- [ ] AC-G01: Gallery button visible in room and DM headers
- [ ] AC-G02: Images tab shows thumbnail grid (120px cells)
- [ ] AC-G03: Files tab shows list with filename, size, author, date
- [ ] AC-G04: Click image thumbnail opens Lightbox
- [ ] AC-G05: Click file row triggers download
- [ ] AC-G06: Scope-correct: only shows media from active room/DM
- [ ] AC-G07: Auth-protected: membership check on API endpoint
- [ ] AC-G08: Pagination with "Load more" button
- [ ] AC-G09: Empty state messages for both tabs
- [ ] AC-G10: ESC closes gallery
- [ ] AC-G11: Design system compliant (no border-radius, monospace, CSS vars)
