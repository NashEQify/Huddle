intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: User-configurable identity and appearance settings
  action: Defines avatar/portrait selection, inline header title editing, email change, password change, color themes, and the user.updated WS broadcast

| | |
|---|---|
| **Layer** | Frontend / Backend |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 10-domain, 15-auth, 25-websocket, 70-audio-settings, 80-admin |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 5 findings applied + 1 CGL resolved): §75.2.1 gallery immediate-save + inline success indicator (F-CSD-7503); new §75.2.2a Avatar Crop UI documenting T-031 `ImageCropModal` (drag + zoom 1–10× + Apply/Skip/Cancel) (F-CSD-7501); new §75.2.2b Client-Side Pre-Upload Resize documenting T-030 `resizeImage` pipeline (F-CSD-7502); §75.2.2 max-size clarification — server cap is defense-in-depth since client resizes first; §75.7 theme list extended to 10 (Paper + Frost, commit 63ae718, first light themes) with 2-column-by-5-rows grid (F-CSD-7505); §75.7 persistence documents legacy-key migration shim `hangout-theme` → `huddle-theme` (commit d8bde90, F-CSD-7506 resolved); AC bullets updated accordingly. F-CSD-7507 (high-contrast preview swatch) remains a code cosmetic flag. History: 2026-04-14 — Task 009 Batch 2 retroactive sync.

## Was diese Spec beschreibt

This spec defines user-configurable identity and appearance settings: avatar selection (built-in gallery or uploaded portrait), inline header title editing, email change (password-gated), password change, and the 10-theme color scheme system. It also defines the `user.updated` WS event that broadcasts profile changes to all connected clients for live UI updates.

---

# 75. User Settings (Normative)

This file defines user-configurable identity settings:
- avatar / portrait
- title (inline header editing only -- not in Settings Profile tab)
- email
- password
- color themes

## 75.1 Settings Screen Entry

<!-- DIM-Map §75.1 Settings Screen Entry
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Settings are accessible from:
1. The header dropdown menu (click user avatar -> "Settings")
2. The Settings button in the header (next to the title randomize button)

Settings render as an **overlay modal** on top of the current view, not as a
full page. The underlying chat/room view remains visible but not interactive.

**Navigation state.** The settings overlay has its own entry in the navigation
store: `activeView.type === 'settings'` with `activeView.tab` in
`{ 'profile', 'audio-video', 'appearance', 'admin' }`. Tab switches inside the
overlay mutate this navigation state (they do not just toggle local state).
Closing the overlay navigates the main content area to the **Welcome Screen**
(see `65-welcome.md`) — it does **not** return to the previously active
room or DM.

**Tabs (enumerated, in header order):**

| Tab label           | `activeView.tab` | Visibility          | Cross-ref               |
|---------------------|------------------|---------------------|-------------------------|
| `PROFILE`           | `profile`        | always              | 75.2, 75.4, 75.5        |
| `AUDIO / VIDEO`     | `audio-video`    | always              | `70-audio-settings.md`  |
| `COLOR THEME`       | `appearance`     | always              | 75.7                    |
| `ADMIN`             | `admin`          | only `user.isAdmin` | `80-admin.md`           |

The `ADMIN` tab uses the `var(--warning)` color accent on its active-state
treatment (the three non-admin tabs use `var(--accent)`).

**Closing the overlay.** Three mechanisms close the overlay; all of them
navigate to the Welcome Screen:
- `ESC` key (global `keydown` listener installed while the overlay is open).
- Clicking the backdrop (the region outside the overlay panel).
- Clicking the sticky `X` close button in the top-right corner of the overlay panel.

**Focus handling (v1 limitation, tracked separately).** The overlay does
**not** currently implement a focus trap, automatic initial focus on the
PROFILE tab button, or focus restoration to the trigger on close. The
accessibility gap is tracked in the Code Gap Ledger and is not codified as
intended behavior here. Implementers of v1 MUST NOT rely on focus-trap
semantics.

Settings changes apply immediately.

## 75.2 Avatar / Portrait

<!-- DIM-Map §75.2 Avatar / Portrait
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

A user can set their avatar in two ways:

### 75.2.1 Choose built-in avatar
- User can choose from the built-in avatar gallery.
- Gallery layout: 5x5 fixed grid, 80x80px per avatar.
- Avatars are 256x256 PNG images (not SVG).
- Gallery initial pool (normative initial set, can be extended):
  1) Nico Bellic
  2) JC Denton
  3) Link
  4) Mario
  5) Donkey Kong
  6) Doomguy
  7) Master Chief
  8) Minecraft Steve
  9) Sonic
  10) Lara Croft
  11) Scorpion
  12) Ken (Street Fighter)
  13) Ryu (Street Fighter)
  14) Chun-Li
  15) Solid Snake
  16) Crash Bandicoot
  17) Tracer
  18) Luigi
  19) Princess Peach
  20) Yoshi
  21) Pac-Man
  22) Gordon Freeman
  23) Guybrush Threepwood
  24) Geralt of Rivia
  25) Pikachu

Avatar files are stored at `src/client/public/avatars/{slug}.png` (build-time
seed source). At runtime, each `BuiltInAvatar` DB row carries an `imageUrl`
field; the client uses the URL from the API response, not a hardcoded path.

**API — list available built-in avatars:**

```
GET /api/settings/avatars
  Auth: Session-Cookie required
  Response 200: { data: { avatars: Array<{ id, label, imageUrl }> } }
  Sort order: label ascending.
```

**Default assignment on signup (normative):**
- On first successful sign-up, the server picks a random row from
  `BuiltInAvatar` and stores its id as `UserProfile.builtInAvatarId` with
  `avatarKind = 'built_in'`.
- The gallery MUST be seeded (see `90-persistence.md`). If the
  `BuiltInAvatar` table is empty, signup is rejected with HTTP 503
  `AVATAR_POOL_EMPTY` — see `15-auth.md` §15.7 and `10-domain.md` §10.2.

**Gallery selection interaction:** Clicking a gallery tile immediately
PATCHes `/api/settings/profile` with `{ builtInAvatarId: avatarId }`
(no confirmation step). A transient `avatar updated` success indicator
is shown inline below the gallery in `var(--success)`.

### 75.2.2 Upload portrait

- **Client-allowed formats**: PNG, JPEG, WebP.
- **Max size**: 1 MB (defense-in-depth server cap; see §75.2.2b — the
  client resizes >1 MB images before upload so the server cap is
  rarely the user-facing limit).
- **Server validation (two-layer)**:
  1. `Content-Type` header MUST be one of `image/png`, `image/jpeg`, `image/webp`.
  2. The server reads the file bytes and verifies the magic-byte signature:
     - PNG: `89 50 4E 47`
     - JPEG: `FF D8 FF`
     - WebP: `52 49 46 46` (RIFF header)
  Both the declared `Content-Type` and the detected magic MUST match an
  allowed format. Mismatch → HTTP 400 `VALIDATION_ERROR`.
- **Processing pipeline (server)**:
  1. Center-crop to a square of side `min(width, height)`.
  2. Resize to **256×256**.
  3. Re-encode as **WebP at quality 85**.
- **Storage**: `{UPLOAD_DIR}/portraits/{userId}.webp`. Re-upload overwrites
  the previous file for that user (the filename is fixed per user).
- **Database side-effects**: `avatar_kind` is set to `uploaded` and
  `portrait_url` is set to `/api/uploads/portraits/{userId}.webp`.
- **Switching back to built-in** at any time via `PATCH /api/settings/profile`
  with a `builtInAvatarId`.
- **Serving endpoint**:
  ```
  GET /api/uploads/portraits/:filename
    Auth: Session-Cookie required
    Filename MUST equal its `path.basename` and MUST end in `.webp` (anti-path-traversal).
    Response headers: `X-Content-Type-Options: nosniff`, `Content-Type: image/webp`.
    404 if the file does not exist, 400 if the filename fails the sanity check.
  ```

**API — upload portrait:**

```
POST /api/settings/portrait
  Auth: Session-Cookie required
  Body: multipart/form-data with a single file field
  Response 200: { data: { profile: { title, avatarKind, builtInAvatarId, portraitUrl } } }
  Errors: 400 VALIDATION_ERROR (missing file, wrong mime, wrong magic, oversize).
```

### 75.2.2a Avatar Crop UI (Client — T-031)

After file selection, the client does NOT upload directly. Instead it
opens `<ImageCropModal>` (see `src/client/src/components/chat/
ImageCropModal.tsx`; shared with the 35-uploads attachment flow):

- **Fixed aspect**: `fixedAspect={1}` (square); the aspect selector is
  hidden.
- **Crop engine**: `react-easy-crop` with drag-to-position and a
  vertical zoom slider (min `1`, max `10`, step `0.1`).
- **Three exit actions**:
  - **APPLY**: canvas-crops the image to the selected area and calls
    `uploadPortrait` on the cropped file. PNG sources are exported as
    PNG (no quality loss); other sources are re-encoded at q0.92 in
    their original MIME.
  - **SKIP**: uploads the original (un-cropped) file.
  - **CANCEL**: discards the file, no upload.
- **Keyboard**: `Esc` = cancel, `Enter` = apply.
- **Backdrop click**: cancels.

### 75.2.2b Client-Side Pre-Upload Resize (T-030)

Between the crop modal exit and the POST, the file runs through
`resizeImage()` (see `src/client/src/lib/imageResize.ts`; shared with
35-uploads §35.11):

- Files ≤ 1 MB or `image/gif` or non-image pass through unchanged.
- Otherwise the image is loaded into an `HTMLImageElement`, target
  dimensions are capped at `MAX_DIMENSION = 2048` px and the iOS
  canvas pixel limit of 16 megapixels (`16_777_216`).
- Quality-reduction loop: JPEG/WebP start at q=0.92 and step down by
  0.05 until ≤ 1 MB or `MIN_QUALITY = 0.5`. PNG source tries PNG
  first; if still >1 MB, falls back to JPEG at q=0.85 (GIF transparency
  is lost, which is accepted for portrait use — transparent PNGs
  above 1 MB are rare).
- When a resize transcodes to a different format (PNG → JPEG), the
  filename extension is rewritten via `/\.[^.]+$/ → '.jpg'`.
- The resized `File` is then POSTed to `/api/settings/portrait`.

The server's 1 MB cap is defense-in-depth; users rarely hit it
because `resizeImage` always produces a file ≤ 1 MB when possible.

## 75.3 Title

### 75.3.1 Display format
- Title is displayed next to username in quotes:
  - `<username> "<title>"`
- If title is empty, UI shows only `<username>` in chat/sidebar contexts.
  The header's inline-edit affordance shows `(no title)` as placeholder text
  when `profile.title` is empty.

### 75.3.2 Inline Title Editing in Header

<!-- DIM-Map §75.3.2 Inline Title Editing
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Title editing is available **only** via the inline header edit — there is no
title field in the Settings Profile tab. The user clicks their title in the
header bar to edit it inline. The title text becomes an editable input field.

**Discoverability (actual v1 behavior):** On hover of the title text in the
header bar, the text color changes to `var(--accent)` (and back to
`var(--text-primary)` on mouseleave). The cursor is `pointer`. A native
browser tooltip (`title="Click to edit title"`) is set on the element. No
pencil icon or other SVG adornment is rendered — hover affordance is pure
color change.

**Keyboard and blur behavior:**
- Pressing **Enter** saves the new title (`PATCH /api/settings/profile`).
- Pressing **Escape** cancels the edit and reverts to the previous title.
- **Blurring the input** (clicking outside, Tab-out) also saves — `onBlur` is
  wired to the same save handler as Enter.
- If the trimmed title is empty OR longer than 40 characters, `saveTitle`
  **silently cancels**: the input closes and the previous title is restored
  with no API call and no error toast. This applies to both Enter and blur.

**Randomize button (immediate-save):**
- The randomize button (circular arrow icon) is rendered to the right of
  the title in the header (NOT inside the inline edit input).
- Clicking it executes a single-click immediate-save sequence:
  1. `GET /api/settings/random-title` → `{ data: { title: string } }`.
  2. If the returned title is a non-empty string, immediately
     `PATCH /api/settings/profile` with `{ title }`.
  3. The profile updates and the server broadcasts `user.updated` to all
     connected clients.
- No edit-mode confirmation is required; the change is visible immediately
  to the user and to all other clients.

**Constraints (all enforced server-side):**
- Title length: 1–40 characters (inclusive), after `trim()`.
- Allowed characters: any printable characters except control characters.
- No password required to change title.

**Failure modes:**

| Case                          | Client response                     | Server response                |
|------------------------------|--------------------------------------|--------------------------------|
| Empty/over-length title      | Silent cancel, no API call           | (no request sent)              |
| Randomize with empty TitlePool | No profile patch                    | 200 `{ data: { title: '' } }`  |
| Network error on PATCH       | Input closes; previous title remains | n/a                             |

### 75.3.3 Random title button

Next to the inline title input, a randomize icon is shown.
Clicking it assigns a random title from the TitlePool.

**TitlePool requirements (normative):**
- The seeded pool contains ~450 curated titles.
- Categories include:
  - gaming references (including early 90s classics)
  - historical/nobility titles (e.g., "Graf", "Ihre Hoheit")
  - ironic / smart witty titles (e.g., "Seine Erlauchtheit")

**User-submitted titles and 200-entry cap:**
- When a user saves a custom title via `PATCH /api/settings/profile`, the
  server checks `count(TitlePoolEntry where source='user')`.
- If that count is `< 200`, and no existing `TitlePoolEntry` with the exact
  same title already exists, the new title is inserted with `source='user'`
  and becomes eligible for future random selection.
- If the cap is already reached (`>= 200`), the user's title still saves
  successfully against their profile — only the pool insertion is skipped.
- Duplicate titles (same exact `title` string in the pool, regardless of
  source) are skipped.

**Random-title API:**

```
GET /api/settings/random-title
  Auth: Session-Cookie required
  Response 200: { data: { title: string } }
```

- If the pool is non-empty, returns a uniformly random entry's `title`.
- If the pool is **empty**, returns `{ data: { title: '' } }` with status 200
  (not an error). The client treats empty-string as a no-op and does not
  patch the profile.

**Default assignment:**
- On first successful sign-up, assign a random title automatically from
  the seeded pool.

## 75.4 Email Address Change

<!-- DIM-Map §75.4 Email Address Change
  Completeness:        ✓
  Konsistenz:          Partial — uniqueness enforcement relies on DB-level constraint (no friendly error); see CGL
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

- User can change their email address in Settings.
- Changing email requires current password verification.

**Workflow:**
1. User enters new email
2. User enters current password
3. Submit → server validates password and updates email

**API:**

```
PATCH /api/settings/email
  Auth: Session-Cookie required
  Body: { email: string, currentPassword: string }
  Response 200: { data: { user: { id, username, email, isAdmin } } }
  Errors:
    400 VALIDATION_ERROR — missing email, missing password, or email fails format regex
    401 INVALID_PASSWORD  — current password wrong
    401 UNAUTHORIZED      — no credential row (should not happen in normal flow)
```

**Email format validation (server-side):**
- Regex: `^[^\s@]+@[^\s@]+\.[^\s@]+$` — a loose structural check. This is the
  only content validation; no DNS / MX lookup.
- No length ceiling beyond whatever the underlying column allows.
- No case normalization is performed.
- **Uniqueness:** the `User.email` column has a unique constraint at the DB
  level, but the route does not explicitly pre-check uniqueness. A duplicate
  email surfaces as a DB-constraint error from Prisma (generic 500). This
  rough edge is tracked in the Code Gap Ledger.

**No WS broadcast.** Email changes are **NOT** emitted via `user.updated`.
Email is not part of the WS user profile payload; other clients only see
the new email after a manual refresh of data that includes the email (e.g.,
`/api/users`). See 75.8.

Other settings (title/avatar) do not require password.

## 75.5 Password Change

<!-- DIM-Map §75.5 Password Change
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     15-auth §15.3 (password rules)
-->

User can change their password in Settings.

**Workflow:**
1. User enters current password
2. User enters new password
3. User enters new password again (repeat)
4. Submit → server validates current password, applies password rules,
   hashes with `argon2id`, and updates the stored hash.

Password rules from `15-auth.md` Section 15.3 apply to the new password.
The server currently enforces 8–64 characters as the length rule; any
additional complexity rules from 15-auth apply as documented there.

**API:**

```
PATCH /api/settings/password
  Auth: Session-Cookie required
  Body: { currentPassword: string, newPassword: string, newPasswordRepeat: string }
  Response 200: { data: { ok: true } }
  Errors:
    400 VALIDATION_ERROR  — missing field, new password not 8-64 chars, or repeat mismatch
    401 INVALID_PASSWORD  — current password wrong
    401 UNAUTHORIZED      — no credential row
```

On success the server does NOT broadcast any WS event; the password change is
purely a server-side credential update.

**Form states (actual v1 UI behavior):**
- On submit: button text changes to `saving...` (lowercase, no brackets);
  button color dims to `var(--text-muted)` with `var(--border-default)` border;
  button is disabled.
- On success: a persistent status line below the form shows
  `password changed` in `var(--success)`. There is no fade timer — the
  message remains until the form is changed. Button re-enables.
- On failure: the same status line slot shows the API error message in
  `var(--error)`. The error is a generic status line below the form — it is
  NOT placed inline below the specific offending field. Button re-enables.

## 75.6 Acceptance Criteria (User Settings)

- [ ] User can select a built-in avatar from the gallery (listed via `GET /api/settings/avatars`)
- [ ] User can upload a portrait (PNG/JPEG/WebP, ≤1 MB, center-cropped, resized to 256×256, re-encoded as WebP q85)
- [ ] Portrait upload rejects files whose magic bytes don't match the declared MIME
- [ ] User can switch between built-in and uploaded avatar
- [ ] Inline title editing in header works (Enter saves, Escape cancels, blur saves)
- [ ] Empty or >40-char titles silently cancel without API call
- [ ] Title randomize button in header performs a single-click immediate-save
- [ ] `GET /api/settings/random-title` returns `{ title: '' }` when the TitlePool is empty
- [ ] Custom titles are added to the TitlePool on save (capped at 200 `source='user'` entries; duplicates skipped)
- [ ] Email change requires current password (PATCH `/api/settings/email`) and does NOT broadcast `user.updated`
- [ ] Password change requires current password + new password + repeat; success response is `{ data: { ok: true } }`
- [ ] Settings Profile tab shows Avatar, Email, and Password only (no title field)
- [ ] Settings render as overlay; closing the overlay (ESC, backdrop, or panel X button) navigates to Welcome
- [ ] Settings tabs: `PROFILE`, `AUDIO / VIDEO`, `COLOR THEME`, and `ADMIN` (admins only; `--warning` accent)

## 75.7 Color Themes

<!-- DIM-Map §75.7 Color Themes
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     styles/theme.css
-->

### Overview

10 color schemes are available. The user selects a theme in Settings → COLOR THEME tab.

### Available Themes

| Theme id          | Label              | Description                                  |
|-------------------|--------------------|----------------------------------------------|
| `default`         | Terminal Mint      | Mint/Sage on dark blue-grey (default)        |
| `amber`           | Amber Console      | Warm CRT monitor feel with amber tones       |
| `arctic`          | Arctic             | Cool blue-white, high readability            |
| `high-contrast`   | High Contrast      | Maximum readability, strong black/white      |
| `lavender`        | Lavender Dusk      | Soft purple evening tones                    |
| `rose`            | Rose Terminal      | Warm pink/rose tones                         |
| `monochrome`      | Monochrome         | Pure black & white, no color accents         |
| `norton`          | Norton Commander   | Classic DOS blue, nostalgic NC aesthetic     |
| `paper`           | Paper              | Warm off-white, dot-matrix printer aesthetic — first light theme (commit 63ae718) |
| `frost`           | Frost              | Cool blue-white, morning ice — second light theme (commit 63ae718) |

All eight previous themes are dark; `paper` and `frost` are the first
light themes shipped.

### Theme Selector UI

Displayed as a 2-column grid of theme cards (one row per theme pair — 5
rows at 10 themes) in the COLOR THEME settings tab.
Each card shows:
- A preview color swatch (representative accent color of the theme)
- Theme name
- Short description

Clicking a card applies the theme instantly.

### Implementation

- CSS attribute `data-theme` on the `<html>` element.
- Each non-default theme id corresponds to a `[data-theme="<id>"]` rule set
  in `src/client/src/styles/theme.css` that overrides the CSS custom
  properties (colors, backgrounds, accents).
- **Default theme (Terminal Mint) is identified by theme id `'default'`**
  and is applied by **removing** the `data-theme` attribute from `<html>`.
  The base (no-attribute) CSS already carries the Terminal Mint values —
  there is intentionally **no** `[data-theme="terminal-mint"]` rule in
  the stylesheet. The legacy phrasing `data-theme="terminal-mint"` from
  earlier spec drafts is NOT implemented.
- Switching themes is a pure CSS variable override — no page reload, no
  React re-render of the tree required (apart from the theme-selector UI
  reflecting the active card).

### Persistence

- Stored in `localStorage` under key `huddle-theme` as the raw theme id string.
- **Legacy-key migration shim (commit `d8bde90`)**: on app start, if
  `huddle-theme` is missing AND the legacy key `hangout-theme` is
  present, the provider reads the legacy value and writes it to
  `huddle-theme` once, then deletes the legacy entry. Pre-rename
  installs therefore keep their chosen theme without user action.
  F-CSD-7506 resolved.
- On app start, the `ThemeProvider` initializes its React state from
  `localStorage.getItem('huddle-theme')` (post-migration). If the
  stored value is not a known theme id (not in `THEMES`), the provider
  falls back to `'default'`.
- The theme is applied to `<html>` inside a `useEffect` that runs **after**
  the first React render commit — there is no pre-mount inline script in
  `index.html`. For non-default themes, a brief flash of Terminal-Mint
  styles on first paint is therefore possible. This is a known v1
  limitation, not intended behavior to build against.
- `setTheme(id)` is a no-op for any `id` not present in `THEMES` (unknown
  ids are silently rejected; state and `localStorage` are not mutated).
- No server-side storage — theme is per-browser.

### Acceptance Criteria (Color Themes)

- [ ] 10 color themes available in Settings → COLOR THEME tab
- [ ] Theme ids are exactly: `default`, `amber`, `arctic`, `high-contrast`, `lavender`, `rose`, `monochrome`, `norton`, `paper`, `frost`
- [ ] Default theme (`default`) applies by removing `data-theme` from `<html>` (no `[data-theme="terminal-mint"]` rule)
- [ ] Non-default themes apply by setting `<html data-theme="<id>">`
- [ ] Theme selector displays as a 2-column grid with one row per theme
      pair (5 rows at 10 themes), each card showing preview + name +
      description
- [ ] Clicking a theme card applies it instantly (no reload)
- [ ] Theme persisted in `localStorage` key `huddle-theme` (with a
      one-shot migration from legacy `hangout-theme` key, commit
      `d8bde90`)
- [ ] Unknown stored value falls back to `default`; unknown `setTheme(id)` is no-op
- [ ] All UI elements respect theme CSS variables

## 75.8 user.updated WS Event

<!-- DIM-Map §75.8 user.updated WS Event
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     25-websocket §25.5
-->

When a user changes their profile (title, avatar kind, built-in avatar,
portrait), the server broadcasts a `user.updated` WS event:

```
user.updated
  payload: {
    userId: string,
    profile: {
      title: string,
      avatarKind: 'built_in' | 'uploaded',
      builtInAvatarUrl: string | null,
      portraitUrl: string | null
    }
  }
```

**Broadcast scope.** This is a **global** broadcast — every currently
connected, authenticated WS client receives the event, regardless of whether
they share a room or DM with the changed user. It is **not** room-scoped.

**Emitting endpoints.** Only two server routes emit `user.updated`:
- `PATCH /api/settings/profile` (title and/or built-in avatar change)
- `POST /api/settings/portrait` (portrait upload)

The email (`PATCH /api/settings/email`) and password (`PATCH /api/settings/password`)
routes do NOT emit `user.updated` (email is not part of the payload; password
is not a user-visible property).

**Payload resolution rules:**
- `builtInAvatarUrl` is the **resolved image URL** of the user's current
  built-in avatar (looked up from `BuiltInAvatar.imageUrl`), not the id.
  Clients do not need to round-trip the id → URL lookup.
- On a portrait upload (transition to `avatarKind='uploaded'`), the WS
  payload sets `builtInAvatarUrl: null` unconditionally — even though the
  DB may still retain the user's previous `builtInAvatarId` as a fallback.
  The WS payload describes the **currently active** avatar, not the fallback.
- `portraitUrl` is `null` when `avatarKind='built_in'` or when no portrait
  has ever been uploaded; it is the `/api/uploads/portraits/{userId}.webp`
  path when `avatarKind='uploaded'`.

**Client side-effects.** Other users' sidebar entries, active user strips,
message author displays, and any other place that renders
`{avatar, title, username}` update in place on receipt — no page reload,
no refetch.

See `25-websocket.md` Section 25.5 (User Events) for the event catalog entry.
