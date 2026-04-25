intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Initial landing screen shown when no conversation is selected
  action: Defines the Welcome Screen layout (terminal MOTD format), dynamic content (system status, last login, MOTD quote, tips), the MotdPool entity with seeded quotes, error/loading states, URL mapping, and fallback routing

| | |
|---|---|
| **Layer** | Frontend |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 10-domain, 25-websocket, 75-user-settings |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 3 CGLs resolved + frontend version): §65.2 header version literal replaced by Vite `__APP_VERSION__` define (commit a94bdd0, F-CSD-6501); §65.2 `boxShadow` drop-shadow violation resolved — CGL-024 closed; §65.3 Last Login rewritten against schema — `previousLoginAt` column + transactional rotation (CGL-004 resolved in commit ceb9211); §65.3 Active Calls / Screenshares populated via `roomService.listRooms()` (CGL-022 resolved); §65.5 Acceptance Criteria aligned — snapshot-only semantics for active-counters documented. DIM-Map Konsistenz bumped to ✓. History: 2026-04-14 — Task 009 Batch 2 retroactive sync (welcome-as-fallback URL, card structural note, conditional title suffix, mutually-exclusive numeric vs `none`, conditional MOTD, first-login em-dash, local-tz format, `onlineCount` wire-unused, `totalUsers` = active-only, server-side tip selection, tip pool list, 131 seed quotes with `source`, new §65.2a and §65.6 sections). |

## Was diese Spec beschreibt

This spec defines the Welcome Screen, a terminal-style MOTD (Message of the Day) display that appears in the main content area when no room or DM is selected and as the default fallback for any URL that does not match `/room/:id`, `/dm/:userId`, or `/settings(/:tab)`. It shows the app brand, last login timestamp, system status (online users, active calls, screenshares), a random gaming quote from the MotdPool, and a random tip. The sidebar remains functional alongside it. The MotdPool contains seeded quotes (131 in v1); there is no user-facing quote submission mechanism in v1.

---

# 65. Welcome Screen (Normative)

<!-- DIM-Map §65.1 When It Renders
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

## 65.1 When It Renders

The Welcome Screen renders in the main content area when no room or DM is
selected. It is the **default fallback view**: any URL that does not match
`/room/:roomId`, `/dm/:userId`, or `/settings(/:tab)` resolves to Welcome.

Concrete entry points:

- After login / auto-login (initial state at `/`)
- After closing a DM or room view without navigating to another
- Any unknown / mistyped URL (`/foo/bar`, empty path, etc.)
- Browser back / forward navigation that lands on `/` or an unmatched path

The sidebar remains fully functional alongside the Welcome Screen.

### URL and Navigation

- Welcome view maps to URL `/`.
- Navigation state is synced to the URL via `history.pushState`; browser
  back / forward is supported via `popstate`. The URL → ActiveView mapping
  is cross-cutting and implemented once in the navigation store (shared
  with 60-sidebar, 75-user-settings, etc.).

<!-- DIM-Map §65.2 Layout
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

## 65.2 Layout

**Schematic** terminal MOTD (Message of the Day) diagram — the `+---|`
envelope is **illustrative only**, not rendered literally as ASCII
characters:

```
+--------------------------------------------------+
|  Huddle v{VERSION} (from __APP_VERSION__)        |
|  Last login: {date} {time}                       |
|                                                  |
|  Welcome back, {username} "{title}"              |
|                                                  |
|  ── SYSTEM STATUS ──                             |
|  Users online: {n}/{total}                       |
|  Active calls: {n}                               |
|  Screenshares: {n}                               |
|                                                  |
|  ── MOTD ──                                      |
|  "{quote}"                                       |
|              — {attribution}                     |
|                                                  |
|  Tip: Click a room to start chatting.            |
+--------------------------------------------------+
```

### Rendering Details

- The outer card is a centered `<div>` with `maxWidth: 600px`, a 1px solid
  border (`--border-default`), `border-radius: 0`, and padding. It is
  **not** rendered as literal `+---|` characters.
- Only the inner section separators are drawn with box-drawing characters:
  `── SYSTEM STATUS ──` and `── MOTD ──` (U+2500 HORIZONTAL BAR).
- All text uses IBM Plex Mono (`--font-mono`).
- Colors follow the TTY design system (mint/sage on dark, `--accent` for
  brand/user emphasis, `--text-secondary` for chrome, `--text-muted` for
  tips / loading, `--error` for errors).
- The card does NOT use a drop shadow (per CLAUDE.md design rule).
  CGL-024 resolved — earlier revisions included a `boxShadow` that
  violated the TTY design-rule "no drop shadows on panels".

### Header Literal

- The header shows `Huddle v{VERSION}`. The version is read from a
  Vite build-time `__APP_VERSION__` define (wired in `vite.config.ts`
  from `package.json`; commit `a94bdd0`). Bumping the workspace
  version in `package.json` flows through to the Welcome header on
  the next build — no hand-edited literal.

### Welcome Line

- Format: `Welcome back, {username} "{title}"`.
- If the user has no title set (`profile.title` null or empty), the
  quoted title suffix is omitted entirely: `Welcome back, {username}`.
  No placeholder / fallback title is rendered.

### Active Calls / Screenshares Rendering

- The `{n} | none` notation in the schematic diagram is choice notation,
  not a literal separator. Rendering is mutually exclusive:
  - `Active calls: {n}` when `n > 0`
  - `Active calls: none` when `n == 0`
  - Same rule for Screenshares.

### MOTD Section (Conditional)

- If no MOTD quote is available (empty pool or fetch returned null),
  the entire `── MOTD ──` block (separator + quote body + attribution)
  is omitted. The Header, Welcome line, System Status, and Tip still
  render.

<!-- DIM-Map §65.2a Error / Loading States
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

## 65.2a Error / Loading States

The Welcome Screen fetches `GET /api/welcome` once on mount.

- **Loading** (before response arrives): the card renders only the
  literal text `loading...` in `--text-muted`, smaller font. No spinner
  (per design rule "no loading spinners" — the text placeholder is the
  alternative).
- **Error** (request fails): the card renders only the literal text
  `error: failed to load welcome data` in `--error` color. No automatic
  retry, no retry button in v1; the user may reload the page or navigate
  away and back to trigger a new fetch.
- **Cancellation**: the fetch is guarded by a cancellation flag; if the
  component unmounts before the response arrives, the result is
  discarded.

<!-- DIM-Map §65.3 Dynamic Content
  Completeness:        ✓
  Konsistenz:          ✓ (CGL-004 resolved in ceb9211 — previousLoginAt rotation; CGL-022 resolved — LiveKit listRooms populates active calls/screenshares)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

## 65.3 Dynamic Content

### System Status

- **Users online**:
  - The displayed online count is read from the client-side presence
    store (`usePresence().onlineUserIds.size`), which updates in real-time
    via WebSocket presence events.
  - The server returns an `onlineCount` field in `WelcomeData` for
    completeness, but the client currently ignores it and always renders
    the live presence-store count. The server field is effectively dead
    on the wire; either removing it or keeping it as a snapshot-fallback
    is acceptable — the client contract is "presence store wins".
  - **Total users** (`{total}`) is `prisma.user.count({ where: { isActive: true } })`
    — i.e. only non-deactivated users. Deactivated accounts are excluded
    from both the numerator (they cannot be online) and the denominator.
- **Active calls**: Total count of active calls (numeric), or `none`
  if zero. Computed server-side by `roomService.listRooms()` and
  counting LiveKit rooms whose name starts with `call:`. If the
  LiveKit query fails, the server logs a warning and falls back to
  `0` (degraded mode, not normative).
- **Screenshares**: Total count of active screenshares. Same LiveKit
  listRooms query — rooms whose name starts with `ss:` are counted.
  Same failure fallback.

CGL-022 resolved — both counters are now populated from the live
LiveKit registry. The values are snapshot-at-page-load; the "real-time
update" criterion from §65.5 is met for online users (WS presence)
but is snapshot-only for active calls and screenshares (next refresh
on navigate-away-and-back to Welcome).

### Last Login

`Last login` shows the timestamp of the user's **previous session**
start (not the current one). Stored server-side on the User entity.

- **Schema**: The User row has two timestamp columns — `lastLoginAt`
  (current session start, written on every login) and
  `previousLoginAt` (the value of `lastLoginAt` before the rotation —
  i.e. the start of the previous session). See `10-domain.md` §10.1.
- **Wire field**: `WelcomeData.lastLoginAt` is the ISO string of the
  User's `previousLoginAt` column (not `lastLoginAt` — the field name
  is historical; the value is the previous session). The server
  performs the lookup in `routes/welcome.ts`.
- **Format**: `YYYY-MM-DD HH:MM` in the user's local browser timezone.
  Seconds are omitted. The client performs the formatting.
- **First login ever** (`previousLoginAt == null`, transmitted as
  `lastLoginAt: null`): the client renders the literal
  `Last login: never — welcome aboard` using U+2014 em-dash (rendered
  client-side, not server-provided).

CGL-004 resolved in commit `ceb9211` — login handler now transactionally
copies `lastLoginAt → previousLoginAt` before writing the new
`lastLoginAt`, so the Welcome Screen reads a stable prior-session value.

### MOTD Quote

A random quote selected on each Welcome Screen load from the MotdPool.

- **Selection**: server returns a random quote via `GET /api/welcome`
  (this is a dedicated endpoint, not an initial-app-state bundle).
- **Implementation note** (non-normative): the server performs
  `prisma.motdQuote.count()` then `findMany({ take: 1, skip: random_offset })`
  — two DB queries per welcome load. No server-side caching, no
  client-side caching — a fresh quote is fetched on each Welcome mount.
- **Empty pool**: returns `null`; client omits the MOTD section
  entirely (see 65.2).

### Tips

A single tip is shown, randomly selected from the server-side tip pool.

- **Selection**: server picks a uniform-random tip via `Math.random()` on
  every `GET /api/welcome` request.
- **Rotation**: the client fetches once per mount; the tip does **not**
  rotate while the Welcome Screen remains mounted. A new tip is shown
  when the user navigates away and back, or reloads the page.

**v1 tip pool** (10 tips, authoritative source is the `TIPS` constant in
`src/server/src/routes/welcome.ts`):

- `Click a room to start chatting.`
- `Click a user to send a direct message.`
- `Press Ctrl+V to paste a screenshot into chat.`
- `Drag files onto the chat area to upload.`
- `Your title is displayed next to your name — change it in Settings.`
- `Use Shift+Enter for multi-line messages.`
- `Join a call by clicking the call button in a room.`
- `You can share your screen in a room by clicking the Share Screen button.`
- `The admin can reset your password if you forget it.`
- `Emoji reactions: hover over a message and click the reaction icon.`

<!-- DIM-Map §65.4 MotdPool
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓ (cross-ref 90-persistence.md)
-->

## 65.4 MotdPool

The MotdPool consists of seeded quotes only. There is no user-facing quote
submission mechanism in v1.

- **Seeded quotes**: 131 iconic gaming quotes shipped with the app in the
  v1 seed (`prisma/seed-data/motd-quotes.json`). The 131 value is the v1
  target; future seeds may adjust within the ~100-150 range.

### Seeded Quote Categories

- Classic game quotes (pre-2000s through modern)
- In-game dialogue and catchphrases
- Loading screen tips (ironic / meta)
- Gaming culture references

### Persistence

The `MotdQuote` persistence entity (see also `90-persistence.md`):

| Field         | Type                      | Constraints                |
|---------------|---------------------------|----------------------------|
| `id`          | string (cuid / uuid)      | Primary key                |
| `text`        | `VARCHAR(200)`            | Required, max 200 chars    |
| `attribution` | `VARCHAR(60)`             | Required, max 60 chars     |
| `source`      | string, default `"seed"`  | Tags origin of the row     |

- **Attribution format**: the character or game name, e.g.
  `"GLaDOS, Portal"` or `"Loading Screen, Skyrim"`.
- **Re-seeding**: the seed script deletes only rows where
  `source = 'seed'` before re-inserting, so rows with any other `source`
  tag survive re-seed. This is infrastructure for future non-seed
  sources; in v1 no non-seed source exists and no UI writes quotes.

### Random Selection

Server implementation (non-normative): `prisma.motdQuote.count()` followed
by `prisma.motdQuote.findMany({ take: 1, skip: Math.floor(Math.random() * count) })`.
Returns `null` when the pool is empty.

<!-- DIM-Map §65.5 Acceptance Criteria
  Completeness:        ✓
  Konsistenz:          ✓ — active-call and screenshare counters now populated from LiveKit listRooms (CGL-022 resolved); snapshot-only semantics clarified in the AC.
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

## 65.5 Acceptance Criteria

- [ ] Welcome Screen shown when no room/DM is active AND as the fallback
      for any URL that does not match `/room/:id`, `/dm/:userId`, or
      `/settings(/:tab)`.
- [ ] Online count updates in real-time via the presence store.
- [ ] Active-call and screenshare counters are populated at page load
      from `roomService.listRooms()` (CGL-022 resolved). Snapshot-only
      — does not update in real-time until the user navigates away
      and back to Welcome.
- [ ] MOTD quote is random and changes on page reload / Welcome remount.
- [ ] `Last login` shows the **previous** session's timestamp (not the
      current one), formatted `YYYY-MM-DD HH:MM` in local browser time.
      CGL-004 resolved — `previousLoginAt` column + transactional
      rotation on login.
- [ ] First-time login shows `Last login: never — welcome aboard`.
- [ ] Welcome line renders without the title suffix when
      `profile.title` is null or empty.
- [ ] Active Calls / Screenshares render as a numeric count when `> 0`
      and as the literal `none` when `== 0` (mutually exclusive).
- [ ] The MOTD section is omitted entirely when no quote is available.
- [ ] The card uses IBM Plex Mono, 1px solid border, no border-radius,
      no drop shadow (CGL-024 resolved).
- [ ] Header version string uses Vite `__APP_VERSION__` define, not a
      hardcoded literal.
- [ ] Loading and error states render as documented in 65.2a.
- [ ] Tip is shown from the v1 tip pool (10 tips), one per mount; no
      in-mount rotation.

<!-- DIM-Map §65.6 Failure Modes
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

## 65.6 Failure Modes

| Condition                                              | Behavior                                                                                       |
|--------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `GET /api/welcome` fails (network / 5xx)               | Card renders `error: failed to load welcome data` in `--error`. No retry, no fallback content. |
| Component unmounts before fetch resolves               | Result discarded via `cancelled` flag; no state update, no console error.                       |
| `WelcomeData.lastLoginAt` is `null`                    | Client renders `Last login: never — welcome aboard` (U+2014 em-dash).                           |
| `profile.title` is `null` or empty string              | Welcome line renders without the quoted title suffix.                                            |
| MotdPool is empty / `motdQuote` is `null`              | Entire MOTD section (header + body) is omitted; other sections render normally.                 |
| `activeCalls == 0` / `activeScreenshares == 0`         | Displayed as the literal `none`, not `0`.                                                        |
| User not authenticated (cookie missing / expired)      | `requireAuth` rejects the `/api/welcome` request; standard auth-redirect flow applies (15-auth).|
| Navigation to unknown URL                              | Resolves to Welcome (default fallback); URL is preserved in history unless app rewrites it.     |
