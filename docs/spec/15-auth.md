intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Authentication, authorization, and session management
  action: Defines username/password rules, login/signup UX, session lifecycle (cookies, auto-login, logout), login attempt limiting, forced password change, and the Schweinchen easter egg

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.2.0 |
| **Konsumiert** | overview, 10-domain, 25-websocket, 80-admin |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2): §15.3 login hard-caps clarified as pre-trim (F-CSD-1502); §15.5 Schweinchen sound routing corrected — only noise is lowpass-filtered, oscillator is summed unfiltered (F-CSD-1503), and "dispatch submit" clarified as direct `doLogin`/`doSignup` call not form re-submit (F-CSD-1504); §15.6/§15.7/§15.10 hex labels added (`0xFF LOGIN`, `0x01 SIGN UP`, `0xFE PASSWORD`) (F-CSD-1507); §15.6 sign-up switch control corrected to "create account" lowercase text-link (F-CSD-1505); §15.7 username regex text now includes SPACE (F-CSD-1501); §15.7 new "Operational failures" subsection documenting 503 `AVATAR_POOL_EMPTY` fail-fast (F-CSD-1506); §15.8 "four"→"five" invalid conditions (F-CSD-1508). History: 2026-04-14 — Task 009 Batch 2 retroactive drift-sync. |

## Was diese Spec beschreibt

This spec defines the complete authentication system: username rules (2-24 chars, unique), password rules (8-64 chars, Argon2id), login and signup UX flows, session management (Secure HttpOnly cookies with crypto-random IDs), auto-login behavior, login attempt limiting (5 attempts, 5 min lockout), the forced password change flow (after admin reset), logout, and the Schweinchen easter egg popup. No self-service password reset exists; admin handles resets. CSRF protection relies exclusively on `SameSite=Lax` plus the outer Cloudflare Access perimeter.

---

# 15. Auth & Login UX (Normative)

<!-- DIM-Map §15.1 Overview
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.1 Overview
- First-time users create an account via Sign up.
- Returning users log in.
- No email verification is required.
- Auto-login works via the session cookie: if a valid session cookie is
  present on app mount, the client auto-logs in via `GET /api/auth/session`
  (see §15.8). v1 does NOT maintain a separate "last user" record on the
  client — the cookie is the only persisted identity anchor.
- Auto-login is disabled only after explicit Logout (which revokes the
  server-side session and clears the cookie).

<!-- DIM-Map §15.2 Username
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.2 Username
- Required.
- Unique (case-insensitive). Canonicalization uses `username.toLowerCase()`; the
  stored canonical form is compared for uniqueness.
- Length: 2-24 characters.
- Allowed characters: alphanumeric, underscore, hyphen, space.
- Space rules:
  - No leading or trailing spaces (trim on input).
  - No consecutive spaces ("Frank  G" is invalid).
- `usernameCanonical`: `toLowerCase()`, spaces preserved
  ("Frank G" → "frank g"). Uniqueness check uses canonical form.
- No profanity/content filter.
- If taken: respond 409 `USERNAME_TAKEN` with message "Name already taken" and
  show it inline.
- The client mirrors the server regex for inline feedback; the server is the
  authoritative validator. A concurrent-signup unique-constraint race
  (Prisma error `P2002`) is caught and mapped to the same 409 `USERNAME_TAKEN`
  response so both the deterministic and the race path look identical to the
  client.

<!-- DIM-Map §15.3 Password Rules & Login Attempt Limiting
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.3 Password Rules (Normative)
Password must satisfy (on creation / change):
- min length: 8
- max length: 64
- allowed characters: any printable characters except control characters
- repeat password must match

Security:
- Password stored hashed using Argon2id.
- Never store plaintext password.

### Login-Time Hard Caps (DoS guard)

Before any DB or crypto work, `POST /api/auth/login` rejects absurdly-long
inputs as invalid credentials:
- if `username.length > 24` OR `password.length > 128` → respond 401
  `INVALID_CREDENTIALS` with the generic message "Invalid username or password".

The password login-time cap (128) is intentionally higher than the creation
cap (64) so that legacy or migrated credentials do not trip the guard for
otherwise-valid users. This is an early rejection, not part of the
credential rule set.

The 24-char username cap and the 128-char password cap are applied to the
RAW request strings before `trim()` / canonicalization. A padded username
that would otherwise canonicalize inside 24 chars is still rejected here —
intentional, since the cap exists purely as a cheap DoS guard against
absurdly-long inputs, not as a semantic rule.

### Login Attempt Limiting
- After 5 consecutive failed login attempts for the same username: lock the
  account for 5 minutes.
- The lockout response is HTTP 401 → HTTP 429 with body
  `{ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again in N minutes.' } }`
  where `N = ceil(remaining_lockout_ms / 60000)`. The number is computed
  dynamically from the remaining lockout interval; the client displays the
  message verbatim.
- Lockout is per-canonical-username (lowercased), stored in an in-memory map
  (`loginAttempts`), and resets on server restart.
- The lockout check runs BEFORE user lookup and password verification.
  Consequence: while locked, every request for that username — including
  ones with the correct password — receives 429 `TOO_MANY_ATTEMPTS`. A
  correct password during lockout does NOT short-circuit the lockout; only
  the natural 5-minute expiry (or any later successful login once the
  lockout has expired) clears it.
- Failed-attempt counter increments in exactly two cases:
  - (a) the username does not exist (via `recordFailedAttempt(usernameCanonical)`),
  - (b) the password does not match.
- Deactivated accounts do NOT increment the counter. Such logins instead
  return 401 `ACCOUNT_DEACTIVATED` with message "Account has been deactivated".
- On a successful login the in-memory attempt counter for that canonical
  username is cleared via `clearAttempts(usernameCanonical)` and
  `User.last_login_at` is set to `now()`.
- No general API rate limiting beyond this (trust-based group, Cloudflare Access
  filters first).

## 15.4 Email
- Required on Sign up.
- Basic format validation required.
- No email confirmation/activation required.

<!-- DIM-Map §15.5 Schweinchen Popup
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.5 The "Schweinchen" Popup (Troll Requirement)
Trigger: the entered username, lowercased, equals `"penis"` (so `Penis`,
`PENIS`, `penis` all match). Applies at each manual authentication action:
- Manual Login submit, and
- Sign up submit
- the app MUST show a blocking modal.

Modal chrome (follows the design system):
- Hex-label header: `[ 0x69 SCHWEINCHEN ALERT ]`
- An ASCII pig glyph is rendered above the main text in a `<pre>` block
  using the mono font (warning color).
- Elevated surface, border-radius 0, backdrop blur ~4 px, subtle shadow.
- Full-screen fixed overlay; z-index above all other UI.

Text:
- "Du bist ein kleines Schweinchen!"

Behavior:
- Modal blocks submit until dismissed.
- On clicking "OK":
  - play an "ekliger nasser Furz" sound (see Sound below);
  - close the modal;
  - then invoke the underlying `doLogin` / `doSignup` network call
    directly (NOT a re-submission of the form event, which would
    re-trigger the Schweinchen check and recurse) after a 200 ms
    `setTimeout` so the audio starts before navigation.

Sound:
- The sound is synthesized client-side via the Web Audio API. No audio
  file is shipped. The synthesis recipe is: a 0.8 s white-noise buffer
  (routed through a lowpass filter sweeping 400 → 100 Hz with Q = 5)
  summed with a sawtooth oscillator sweeping 80 → 40 Hz (unfiltered);
  each path has its own exponential gain envelope — noise 0.4 → 0.01,
  osc 0.3 → 0.01 — over the 0.8 s duration. The `AudioContext` is
  closed ~0.5 s after the tones end.
- If `AudioContext` is unavailable (or throws on construction) the failure
  is silently swallowed — the modal still dismisses and submit still runs.

Normative:
- Sound MUST be triggered by user gesture (OK click).
- Modal MUST NOT appear during auto-login.

<!-- DIM-Map §15.6 Login Screen
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.6 Login Screen

Header hex label: `[ 0xFF LOGIN ]`.

Fields:
- Username
- Password

Behavior:
- Pressing Enter in password field submits login.
- Invalid credentials: show generic error "Invalid username or password" and stay.
- Success: enter app.
- If `must_change_password` is set: redirect to forced password change screen
  (see `80-admin.md` Section 80.3).
- The form is always rendered with empty `username` / `password` fields; v1
  does not persist a "last user" anywhere on the client (see §15.8 and §15.9).

**Form States:**
- On submit: button disables, label changes from `LOGIN` to
  `authenticating...`. Both strings are uppercased by CSS `text-transform:
  uppercase`; the button itself carries no `[ ... ]` bracket chrome. Input
  fields become read-only (`disabled={submitting}`).
- On success: navigate to app (existing behavior).
- On failure: button re-enables, error message shown below the form in
  `var(--error)`. Input fields become editable.
- Inline error position: below the Password field, above the submit button.

**Field Error Borders (Login):**
- On failed login (invalid credentials, too many attempts): both Username and
  Password fields get `border-color: var(--error)`.
- Both fields go red simultaneously (generic error — no hint which field is wrong).
- Red border clears when the user edits either field (onChange).
- Focus ring: when a field has error AND receives focus, keep `border-color: var(--error)`
  (do not switch to accent). Box-shadow glow is suppressed during error state.
- On blur with active error: border stays `var(--error)`.

Controls:
- "create account" text-link (lowercase, `var(--text-secondary)`, accent
  on hover) under the submit button → switches the unauthenticated view
  to the Sign up screen.

<!-- DIM-Map §15.7 Sign up Screen
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.7 Sign up Screen

Header hex label: `[ 0x01 SIGN UP ]`.

Fields:
- Username
- Email
- Password
- Repeat password

**Form States:**
- On submit: button disables, label changes from `SIGN UP` to
  `creating account...`. Both strings are uppercased by CSS `text-transform:
  uppercase`; the button carries no `[ ... ]` bracket chrome. Input fields
  become read-only.
- Validation timing: client-side inline validation runs on every `onChange`
  AND on `onBlur` for all four fields:
  - username: `USERNAME_REGEX` (2-24 chars, `[a-zA-Z0-9_ -]`, no
    leading/trailing spaces after `trim()`, no consecutive spaces — see §15.2),
  - email: `EMAIL_REGEX` (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`),
  - password: length 8-64,
  - passwordRepeat: must equal password.
  The per-field error appears below the input and the input border turns
  `var(--error)`. The top-level form error (below the submit button) is
  separate and primarily carries server-side errors. Username uniqueness
  remains server-only.
- On success: navigate to app (existing behavior).
- On failure: button re-enables, error shown below relevant field.

**Field Error Borders (Signup):**
- Each field gets `border-color: var(--error)` individually when its validation fails.
- Triggers:
  - Username: invalid characters, too short/long, consecutive spaces (on change/blur),
    "Name already taken" (on submit, server response).
  - Email: invalid format (on change/blur).
  - Password: too short/long (on change/blur).
  - Repeat Password: mismatch (on blur of repeat field, on change of either password field).
- Red border clears when the user edits the affected field (onChange re-validates).
- On submit with "All fields are required": all empty fields get red border.
- Focus ring: when a field has error AND receives focus, keep `border-color: var(--error)`
  (do not switch to accent). Box-shadow glow is suppressed during error state.
- Inline error text below each field is retained (additive — border + text).

On successful sign up:
- user is logged in immediately
- server creates UserProfile defaults:
  - assigns a random title (from TitlePool)
  - assigns a random built-in avatar (from BuiltInAvatar pool)
- if this is the first user ever: set `is_admin: true`
- user enters main app

Concurrency & atomicity:
- The `userCount === 0 → isAdmin = true` check is performed INSIDE the same
  Postgres transaction (`prisma.$transaction`) as the nested
  `User` + `Credential` + `UserProfile` insert. This prevents a race where
  two concurrent first-ever signups could both observe `userCount === 0`
  and both become admins.
- A concurrent-signup unique-constraint violation on `usernameCanonical`
  (Prisma `P2002`) is caught and mapped to the same 409 `USERNAME_TAKEN`
  response as the deterministic pre-check (see §15.2).

**Operational failures (Normative):**

`POST /api/auth/signup` may also fail with:

- `503 AVATAR_POOL_EMPTY` — message `Signup unavailable — avatar gallery
  not seeded. Contact an administrator.` Thrown before the
  `User` / `Credential` / `UserProfile` transaction when `BuiltInAvatar`
  is empty. This is an operator-side misconfiguration, not a user-input
  error; the client surfaces it as a top-level form error. See
  `10-domain.md` §10.2 BuiltInAvatar and the seed contract in
  `75-user-settings.md`. Rationale: guarantees every User row is created
  with `avatar_kind='built_in'` paired with a valid `built_in_avatar_id`,
  so clients never have to render a built-in-with-null avatar. Resolves
  CGL-023 / F-CSD-147.

<!-- DIM-Map §15.8 Sessions & Auto-Login
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.8 Sessions & Auto-Login
- Session stored as HTTP session cookie (see Cookie requirements below).
- **Session ID generation**: `crypto.randomBytes(32).toString('base64url')` --
  cryptographically random, 256-bit entropy. NOT CUID or any predictable ID.
  This is critical for session security: predictable session IDs allow session
  hijacking even behind Cloudflare Access.
- On app start the client calls the session endpoint (see below):
  - if session valid -> auto-login
  - if `must_change_password` -> redirect to forced password change
  - else -> show login screen (always rendered with empty fields;
    v1 does NOT persist a last-used username on the client).

### Auto-Login Endpoint

`GET /api/auth/session` (cookie-authed, no separate auth header).

Success (200):
```
{ "data": { "user": {...}, "profile": {...} | null, "mustChangePassword": boolean } }
```

Failure (401) — one response shape covers all five invalid conditions:
```
{ "error": { "code": "UNAUTHORIZED", "message": "No valid session" } }
```

401 is returned when ANY of the following is true:
- the session cookie is missing,
- the session row is missing (e.g. deleted by cleanup),
- `Session.revokedAt IS NOT NULL` (logged out),
- `Session.expiresAt < now()` (expired),
- the owning `User.isActive` is false (deactivated).

Cookie requirements:
- `HttpOnly` — unconditional.
- `SameSite=Lax` — unconditional.
- `Secure` — set only when `process.env.NODE_ENV === 'production'`. In
  development the cookie is issued without `Secure` so it works over
  `http://localhost`.
- `Path=/`.
- `maxAge` = `SESSION_EXPIRY_DAYS * 24 * 60 * 60` seconds (30 days), matching
  the server-side `expiresAt`.

### CSRF Model (Normative)

CSRF protection relies exclusively on the `SameSite=Lax` cookie attribute
plus the outer Cloudflare Access perimeter. No CSRF token, double-submit
cookie, or custom-header check is implemented by the app. This is a
deliberate simplification for the private, trust-based group. Any
future introduction of cross-site state-changing flows MUST be accompanied
by re-introducing a token mechanism (see decisions.md).

### Session Lifetime

Session lifetime: 30 days from creation. The cookie `maxAge` matches the
server-side `expiresAt`.

A session is invalid if ANY of:
- `Session.expiresAt < now()`,
- `Session.revokedAt IS NOT NULL` (set by logout; see §15.9),
- `User.isActive === false` (admin deactivation).

In all three cases the server responds 401 `UNAUTHORIZED` (endpoints use
the shared `requireAuth` middleware; message is "Not authenticated" there,
or "No valid session" on `GET /api/auth/session`) and the client
transitions to the logged-out state.

### WebSocket Authentication (Cross-Ref)

The WebSocket upgrade at `GET /ws` is authenticated using the same session
cookie as HTTP. The upgrade handler calls `validateSessionFromRequest`; on
missing/invalid session the server closes the socket with close code
`4001` and reason `Unauthorized` before sending any frame. See
`25-websocket.md` for the full close-code taxonomy.

### Session Cleanup

The server runs a periodic session cleanup interval (every 24 hours) that
deletes session rows matching `expiresAt < now()` OR `revokedAt IS NOT NULL`
— i.e. both expired AND revoked rows are swept so logged-out entries do
not accumulate. Cleanup also runs once on server startup. Deleted counts
are logged at `info` level only when `deleted > 0`. The interval is
cleared on `SIGTERM` / `SIGINT` before `fastify.close()` to avoid leaked
timers.

<!-- DIM-Map §15.9 Logout
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.9 Logout
- Logout exists inside the app.
- Endpoint: `POST /api/auth/logout`. Gated by `requireAuth`; unauthenticated
  callers receive 401.
- On logout the server:
  - sets `Session.revokedAt = now()` for the current session (best-effort:
    if the row is missing the `prisma.session.update` rejection is caught
    and silently swallowed);
  - clears the session cookie (`clearCookie(COOKIE_NAME, { path: '/' })`);
  - responds 200 with `{ data: { ok: true } }` unconditionally on the
    authenticated path.
- On logout the client calls the endpoint, then clears in-memory auth state
  (`clearAuth`) and returns to the login screen. v1 does NOT persist a
  "last user" anywhere, so there is no local storage to clear.

<!-- DIM-Map §15.10 Password Reset
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->
## 15.10 Password Reset

Self-service password reset is not available. Users who forget their password
contact an admin, who resets it via the Admin Console (see `80-admin.md`
Section 80.3).

There is no forgot-password link on the login screen. No email-based reset flow.
This is a deliberate simplification for a private, trust-based group.

### Forced Password Change Flow

Header hex label: `[ 0xFE PASSWORD ]` with info line "your password was
reset by an admin. set a new password to continue."

The post-reset forced change is exposed as `POST /api/auth/change-password`
(auth required). The server:
- reads `Credential.mustChangePassword` for the current user;
- if `false`/missing, refuses with 403 `FORBIDDEN` and message
  "Password change is not required" — i.e. there is no general self-service
  change endpoint, this gate is the only path;
- validates `newPassword` length 8-64 and `newPassword === newPasswordRepeat`
  (same rules as §15.3);
- hashes the new password with Argon2id and updates `Credential.passwordHash`
  and sets `Credential.mustChangePassword = false`;
- responds 200 with `{ data: { ok: true } }`.

### Admin Reset Temp Password (Cross-Ref)

Normative text lives in `80-admin.md` §80.3. Summary for auth-surface
completeness:
- Admin may supply an explicit `tempPassword` on `POST /api/admin/users/:userId/reset-password`
  (bounded to 8-64 chars, same rules as §15.3).
- If omitted, the server generates a 12-character temp password drawn
  uniformly from `[A-Za-z0-9]` via `crypto.randomInt` (no symbols).
- In both cases the credential is updated with the new hash and
  `mustChangePassword = true`, which funnels the user through the forced
  change flow above on their next login.
