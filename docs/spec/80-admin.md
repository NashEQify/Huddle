intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Administrative capabilities for user and room management
  action: Defines admin role assignment, password reset, user deactivation, room deletion, force-end call, room rename, system status, and the Admin Console UI as a tab within the settings overlay

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **spec_version** | 1.3.0 |
| **Konsumiert** | overview, 10-domain, 15-auth, 25-websocket, 30-chat, 40-voice, 60-sidebar, 70-audio-settings |
| **Last Update** | 2026-04-24 — retroactive drift-sync (Phase B B-2, 10 findings + 2 CGLs resolved): §80.3 TempPasswordBox now documents above-frame uppercase warning + inline COPY/DISMISS buttons + `copied` status + below-frame `var(--error)` warning (F-CSD-8001); §80.6 force-end call UI now confirms via `confirm()` — CGL-021 resolved (F-CSD-8003); §80.6 WS `call.force_end` payload shape now explicitly nested `{ scope: { type, id } }` — differs from HTTP flat shape (F-CSD-8004); §80.7 Konsistenz flipped to ✓ — CGL-003 resolved via `validateRoomName` / `containsForbiddenControlChars` (F-CSD-8005); §80.2 In-App Admin Promote/Demote UI now documents `confirm()` dialog and button color mapping (F-CSD-8007); §80.2 Users table columns and action-button labels enumerated (F-CSD-8008); §80.5 Rooms table columns and actions enumerated (F-CSD-8009); §80.9 new action-feedback banner subsection (5s auto-clear, exception for temp password) (F-CSD-8006); §80.9 new data-loading subsection (parallel fetch on mount, force-end re-fetches Rooms, optimistic local state updates otherwise) (F-CSD-8010). History: 2026-04-14 — Task 009 Batch 2 retroactive sync. |

## Was diese Spec beschreibt

This spec defines all administrative capabilities. The Admin Console is a tab within the Settings overlay, visible only to admin users. It covers admin role assignment (first signup auto-admin, promote/demote), password reset (temporary password with forced change), user deactivation/reactivation, room deletion (with file cleanup), force-ending calls, room renaming, and a system status overview. Admin-only message deletion/editing permissions are defined in `30-chat.md`.

---

# 80. Admin Console (Normative)

## 80.1 Access

The Admin Console is a **tab within Settings** (`/settings/admin`), visible
only to users with `is_admin: true`.

Non-admin users do not see the ADMIN tab. The tab uses `var(--warning)` color
for its label and border to visually distinguish it from other settings tabs.

## 80.2 Admin Role

<!-- DIM-Map §80.2 Admin Role
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

### Assignment

- `is_admin` is a boolean flag on the User entity (default: `false`)
- The first user to sign up is automatically assigned `is_admin: true`.
  The check uses `prisma.user.count() === 0` inside the signup
  transaction (protects against races where two simultaneous signups
  both become admin).
- **Edge case (by design)**: the trigger is "zero users in the system",
  NOT "no admin currently exists". If the sole admin is later
  deactivated or demoted and then a brand-new user signs up while no
  admin exists, that user is NOT auto-promoted (because `userCount > 0`).
  Admin status must then be restored via direct DB access.
- Additional admins are promoted/demoted via the Admin Console (see below)

### In-App Admin Promote/Demote

Admins can promote or demote other users via the Admin Console:

```
PATCH /api/admin/users/:userId/admin
  Auth: [requireAuth, requireAdmin]
  Body: { isAdmin: boolean }
  Rules:
    - Cannot demote self (prevents lock-out): 400 INVALID_ACTION
      "Cannot remove your own admin status"
    - Target user must exist: 404 NOT_FOUND otherwise
    - Body must contain `isAdmin: boolean`: 400 INVALID_INPUT otherwise
  Response: { data: { user: { id, username, email, isAdmin, isActive } } }
```

UI: Toggle button per user row in the Admin Console Users section
(`[ MAKE ADMIN ]` on non-admins with `var(--accent)` border;
`[ REMOVE ADMIN ]` on admins with `var(--warning)` border). Clicking
opens a browser-native `confirm()` dialog (`"make admin this user?"`
or `"remove admin from this user?"`). Cancelling short-circuits;
confirming sends the PATCH.

**Propagation semantics:** no WS broadcast is sent on admin toggle.
`requireAdmin` middleware re-reads `is_admin` from the DB on every
admin-gated request. Effect on the affected user:
- Admin-only endpoints start returning 403 immediately (promotion also
  takes effect immediately for the next API call).
- The user's existing session is NOT invalidated; non-admin endpoints
  continue to work.
- The UI only reflects the change after a page reload or the next
  affected API call, since no push event is sent.

### Admin Users Listing

```
GET /api/admin/users
  Auth: [requireAuth, requireAdmin]
  Response: { data: { users: AdminUser[] } }
    AdminUser: { id, username, email, isAdmin, isActive, lastSeenAt, createdAt }
    Order: createdAt ASC (oldest first)
```

Used by the Admin Console Users tab to render the user table.

**UI** — Users table columns (left to right): `Username`, `Email`,
`Admin` (`yes` in `var(--warning)` / `no` in `var(--text-muted)`),
`Active` (`active` in `var(--success)` / `deactivated` in
`var(--error)`), `Created` (localized date from `createdAt`),
`Actions`. `lastSeenAt` is returned by the API but not surfaced in
v1. Row count header above the table reads `"{n} users total"`.
Action buttons per row: `[ RESET PW ]`, `[ DEACTIVATE ]` /
`[ REACTIVATE ]` (only for non-admin rows — see 80.4),
`[ MAKE ADMIN ]` / `[ REMOVE ADMIN ]` (see 80.2).

### Permissions

Admin-only actions:
- Promote / demote other users to admin (80.2)
- Reset another user's password (80.3)
- Deactivate / reactivate a user account (80.4)
- Delete a room (80.5) -- also available to room creator via sidebar context menu
- Force-end a call (80.6)
- Rename a room (80.7)
- View system status (80.8)
- Delete any message, any time (see `30-chat.md` 30.9)
- Edit any message, any time (see `30-chat.md` 30.10)
- Bypass room passwords on join/rejoin (see `10-domain.md` 10.3)

Non-admin actions available to all users:
- See who is online (Users section, Welcome Screen)
- See active calls (Welcome Screen, Sidebar indicators)
- Delete own messages within 3 minutes of creation (see `30-chat.md` 30.9)
- Edit own messages within 3 minutes of creation (see `30-chat.md` 30.10)
- Delete own rooms via sidebar context menu (see `60-sidebar.md` 60.3)

## 80.3 Password Reset (Admin-Initiated)

<!-- DIM-Map §80.3 Password Reset
  Completeness:        Partial (temp-password UI deviation tracked in Code Gap Ledger CGL-019)
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Workflow:
1. Admin navigates to Settings -> ADMIN tab -> Users
2. Admin finds user (list or search)
3. Admin clicks "Reset Password"
4. **Prompt dialog** (rendered via browser-native `window.prompt()`),
   two lines separated by a blank line:

   ```
   Reset password for {username}?

   Enter a temporary password (8+ chars) or leave empty to auto-generate:
   ```

   - **Cancel** (null input): no API call, dialog dismissed.
   - **Empty input** (after trim): auto-generate a random 12-char
     alphanumeric password (legacy behavior).
   - **Custom input** (1-7 chars): show browser-native
     `alert("Password must be at least 8 characters.")`, do not call
     the API, dialog closes (no re-prompt).
   - **Custom input** (8+ chars): send to server as `tempPassword` field
     in request body. Server validates 8-64 character length and uses it
     as-is (no transformation).
5. Temporary password is displayed to the admin ONCE (not stored in plaintext)

**Temp password display:**
- An uppercase label `"TEMPORARY PASSWORD — shown ONCE, copy it now"`
  is rendered in `var(--warning)` ABOVE the box-drawing frame.
- The password itself is shown in a monospace box with box-drawing
  border, `var(--text-primary)` on `var(--bg-elevated)`.
- Below the frame, `[ COPY ]` and `[ DISMISS ]` buttons are rendered
  inline. A transient `copied` / `copy failed — select manually`
  status appears next to the `[ COPY ]` button after activation
  (auto-clears after 2s).
- A second warning `"Warning: this password cannot be retrieved
  later."` is rendered in `var(--error)` at the right edge of the
  button row.

6. Server sets a `must_change_password` flag on the user's credentials
7. Admin communicates the temporary password to the user out-of-band

### API Contract (Password Reset)

```
POST /api/admin/users/:userId/reset-password
  Auth: [requireAuth, requireAdmin]
  Body (optional): { tempPassword?: string }
    - If tempPassword provided: MUST be 8-64 characters. Server rejects
      with 400 otherwise. Password is hashed via Argon2id and stored.
    - If tempPassword omitted or empty: server auto-generates a 12-char
      alphanumeric password.
  Response: { data: { tempPassword: string } }
    - Always returns the password that was set (either the custom one or
      the generated one), so the UI can display it to the admin.
```

**Server MUST set `must_change_password` regardless of whether the
password was custom or auto-generated.** The user's first login after
the reset always goes through the Forced Password Change screen.

### Forced Password Change

When `must_change_password` is true:
- On next login, user is redirected to a "Set New Password" screen
- Fields: New Password, Repeat Password (no current password required)
- Password rules from `15-auth.md` Section 15.3 apply
- On success: `must_change_password` is cleared, user enters app
- User cannot skip or dismiss this screen

**Context message:** The screen shows `"your password was reset by an admin. set a new password to continue."` (lowercase, no "please") above the form fields.

**Form States:**
- On submit: button disabled, label changes to `saving...` (lowercase, no brackets). Input fields receive the `disabled` attribute.
- On validation failure (e.g., too short, mismatch, missing fields): a single top-level error message in `var(--error)` is rendered above the submit button. No per-field inline error. The button re-enables.
- On success: `changePassword()` clears the `mustChangePassword` flag in the auth store. `<App>` re-routes to the main app on its next render (no explicit redirect call).

## 80.4 User Deactivation

<!-- DIM-Map §80.4 User Deactivation
  Completeness:        Partial (UI-level confirmation dialog absent; tracked in Code Gap Ledger CGL-020)
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓ (WS presence.offline, 25-websocket)
-->

Admin can deactivate a user account:
- Deactivated users cannot log in
- Active sessions are revoked immediately (`Session.revokedAt = now()` for all non-revoked sessions of the target user)
- All WS connections of the target user are closed server-side via `removeAllConnectionsForUser(userId)` (see `25-websocket.md`)
- User appears as offline to others. The server broadcasts a WS
  `presence.offline` event with payload `{ userId, lastSeenAt: <now ISO> }`
  so connected clients update their presence store immediately.
- User's data (messages, profile) remains intact

Admin can reactivate a deactivated user:
- User can log in again with existing credentials
- No data loss
- No WS broadcast on reactivate (the user appears online again when they
  next establish a WS connection).

### API Contracts (Deactivation)

```
PATCH /api/admin/users/:userId/deactivate
  Auth: [requireAuth, requireAdmin]
  Rules:
    - Target user must exist: 404 NOT_FOUND otherwise
    - Cannot deactivate self: `userId === request.userId` →
      400 INVALID_ACTION "Cannot deactivate yourself"
    - Server does NOT block deactivating other admins (only self is blocked)
  Response: { data: { user: { id, username, email, isAdmin, isActive } } }

PATCH /api/admin/users/:userId/reactivate
  Auth: [requireAuth, requireAdmin]
  Rules:
    - Target user must exist: 404 NOT_FOUND otherwise
  Response: { data: { user: { id, username, email, isAdmin, isActive } } }
```

### UI

- Toggle button per user row: `[ DEACTIVATE ]` when `isActive` is true,
  `[ REACTIVATE ]` when false.
- The toggle is rendered ONLY for non-admin rows (`!user.isAdmin`).
  Admin rows do not expose the control, so deactivating another admin
  through the UI is not possible — the admin must be demoted first.
  (The server endpoint itself does permit deactivating another admin;
  the restriction is UI-only.)

## 80.5 Room Deletion

<!-- DIM-Map §80.5 Room Deletion
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓ (single DELETE /api/rooms/:roomId; duplicate admin-only path is a code issue tracked in CGL-011)
  Abhaengigkeiten:     ✓ (LiveKit, attachment storage, WS broadcast)
-->

Admin OR room creator can delete a room. The Admin Console and the
sidebar context menu both flow through the same unified endpoint.

- **Confirmation** (rendered via browser-native `confirm()`):
  `"Delete room '{name}'? This cannot be undone."`
- Deletes: room entity, all memberships, all messages in the room (hard cascade)

### Delete Sequence (Normative)

1. Force-end LiveKit call room `call:{roomId}` (best-effort; errors swallowed).
2. Force-end LiveKit screenshare room `ss:room:{roomId}` (best-effort).
3. Query all `Attachment.storagePath` values for messages in the room.
4. DB transaction: `deleteMany` messages → `deleteMany` memberships → `delete` room.
5. **After the DB commit**, fire-and-forget `unlink()` for each collected
   file path. Failures are swallowed (best-effort disk cleanup).
6. Broadcast WS event `room.deleted` with payload `{ roomId }`.

All users viewing the room are navigated to the Welcome Screen on
receiving `room.deleted`.

### API

```
DELETE /api/rooms/:roomId
  Auth: [requireAuth]
  Rules:
    - Admin: allowed
    - Creator (room.createdBy === userId): allowed
    - Otherwise: 403 FORBIDDEN
  Response: { data: { deleted: true } }
  Errors:
    403 -- not authorized
    404 -- room not found
```

This is the single source-of-truth endpoint. Both entry points below
MUST use it.

### Admin Rooms Listing

```
GET /api/admin/rooms
  Auth: [requireAuth, requireAdmin]
  Response: {
    data: {
      rooms: Array<{
        id: string,
        name: string,
        memberCount: number,      // _count.memberships
        hasActiveCall: boolean,   // derived from LiveKit listRooms()
      }>
    }
  }
  Order: createdAt ASC
```

`hasActiveCall` is computed by a single LiveKit `listRooms()` call:
a room is flagged `true` if a LiveKit room named `call:{roomId}` exists
with `numParticipants > 0` (avoids O(N) per-room `listParticipants()`).

**UI** — Rooms table columns (left to right): `Name` (clickable —
see 80.7 inline edit), `Members` (from `memberCount`), `Active Call`
(`yes` in `var(--accent)` / `no` in `var(--text-muted)`), `Actions`.
Row count header reads `"{n} rooms total"`. Action buttons per row:
`[ END CALL ]` (only when `hasActiveCall === true`, `var(--warning)`
border — see 80.6) and `[ DELETE ]` (`var(--error)` border — see
80.5 for the confirmation dialog).

Entry points:
- Settings -> ADMIN tab -> Rooms section (uses `DELETE /api/rooms/:roomId`)
- Sidebar -> right-click room entry -> `[ DELETE ROOM ]` (see `60-sidebar.md` 60.3)

## 80.6 Force-End Call (Admin Only)

<!-- DIM-Map §80.6 Force-End Call
  Completeness:        ✓  (CGL-021 resolved — native confirm() dialog now wired)
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓ (LiveKit Admin API, WS call.ended)
-->

Admin can force-end any active ROOM call from the Admin Console Rooms
tab:
- The Rooms tab lists ALL rooms. For each row, a derived column shows
  `Active Call: yes | no` (computed via the single `listRooms()` call
  described in 80.5 — efficient, avoids O(N) `listParticipants()`).
- **Participant count is NOT rendered in the UI.** Only the boolean
  `hasActiveCall` is surfaced.
- An `[ END CALL ]` button is rendered on rows where `hasActiveCall`
  is true. Clicking it opens a browser-native `confirm()` with text
  `"Force-end the active call in '{roomName}'?\n\nAll participants
  will be disconnected."` Confirming POSTs
  `/api/admin/calls/end` with `scopeType: 'room'` and the room id;
  cancelling short-circuits (CGL-021 resolved).
- **DM calls cannot be force-ended from the Admin Console UI.** The
  server endpoint below accepts `scopeType: 'direct'`, but no UI control
  surfaces it in v1.

On force-end:
- Server calls LiveKit Admin API (`deleteRoom`) to close the room
- WS event `call.ended` broadcast to all participants
- Participants see "Call ended" in their UI

### HTTP API

```
POST /api/admin/calls/end
  Auth: [requireAuth, requireAdmin]
  Body: { scopeType: 'room' | 'direct', scopeId: string }
  Rules:
    - Admin check only. No scope-membership check on the HTTP path.
  Response: { data: { ok: true } }
```

### WS Message (`call.force_end`)

Alternative path: clients may send a `call.force_end` WS message.

**Payload shape (nested, NOT flat)**:

```
{ scope: { type: 'room' | 'direct', id: string } }
```

Note: this differs from the HTTP endpoint which uses flat
`{ scopeType, scopeId }`. Reimplementers must not copy the HTTP shape
to the WS payload.

Server handling:

**Admin-Only Enforcement (Normative):** The server checks BOTH
conditions on the sender's session and silently drops the message
if either fails:

1. `is_admin === true`, AND
2. Scope-membership on the sender:
   - `scope.type: 'room'` → sender's `GroupMembership.state === 'joined'`
   - `scope.type: 'direct'` → sender is one of the two DM participants

This is stricter than the HTTP path: an admin who is not a joined member
of a room can force-end via HTTP but NOT via the WS message.

Note: There is no non-admin "End Call for All" button. Group calls end
when the last participant leaves (LiveKit `empty_timeout: 60s`). DM calls
end when either participant leaves (see `40-voice.md` 40.9).

## 80.7 Room Rename

<!-- DIM-Map §80.7 Room Rename
  Completeness:        ✓
  Konsistenz:          ✓  (CGL-003 resolved — control-char rejection enforced by `validateRoomName` / `containsForbiddenControlChars` on both create and rename)
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

Admin can rename any room:
- **Inline edit UI** (Rooms tab): clicking the room-name cell turns it
  into an `<input>` with autofocus and the current name pre-filled.
  `Enter` commits; `Escape` cancels without saving; an adjacent `OK`
  button also commits. Clicking outside the cell does NOT commit — only
  `Enter` or `OK`.
- Room name validation: 1-50 characters after trim, must reject control
  characters (`\n`, `\r`, `\t`, NUL, etc.) per `10-domain.md` 10.3.
- WS event `room.updated` broadcast: `{ roomId, roomName }`
- All users viewing the room see the updated name immediately

### API

```
PATCH /api/admin/rooms/:roomId
  Auth: [requireAuth, requireAdmin]
  Body: { name: string }
  Validation:
    - Trimmed `name` must be non-empty and <= 50 chars
    - Control characters MUST be rejected (spec intent; see 10-domain 10.3)
  Response: { data: { room: { id, name } } }
  WS broadcast on success: room.updated { roomId, roomName }
```

## 80.8 System Status

<!-- DIM-Map §80.8 System Status
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓ (`du` binary, pg_database_size)
-->

The Admin Console shows a system overview (counts only, no per-call or
per-share detail). Data is fetched on Admin Console load — manual refresh
is sufficient for admin use; no real-time updates.

### API

```
GET /api/admin/system
  Auth: [requireAuth, requireAdmin]
  Response: {
    data: {
      totalUsers:         number,  // prisma.user.count() — includes deactivated
      onlineUsers:        number,  // getOnlineUserIds().length — WS-connected userIds
      totalRooms:         number,  // prisma.room.count()
      activeCalls:        number,  // LiveKit rooms whose name starts with `call:`
                                   // (matches BOTH group calls `call:{roomId}` AND
                                   //  DM calls `call:dm:{directId}`)
      activeScreenshares: number,  // LiveKit rooms whose name starts with `ss:`
      uploadSizeBytes:    number,  // `du -sb` on UPLOAD_DIR env (default /data/uploads)
      dbSizeBytes:        number,  // pg_database_size(current_database())
    }
  }
```

### UI (System Tab)

Rendered as a simple label/value table:
- Total Users / Online Users
- Total Rooms
- Active Calls — **count only** (no per-call room-name or participant-count breakdown in v1)
- Active Screenshares — count
- Upload Storage — bytes (formatted)
- Database Size — bytes (formatted)

### Implementation Notes

- `uploadSizeBytes` is computed by spawning `du -sb -- <UPLOAD_DIR>`
  via `execFileSync` (synchronous). `UPLOAD_DIR` is read from
  `process.env.UPLOAD_DIR`, falling back to `/data/uploads`. The
  synchronous call blocks the Node event loop while `du` walks the
  tree. Acceptable at the expected scale (~5-15 users, small upload
  volume).
- `activeCalls` currently overcounts if a DM call is active alongside
  a group call, because both match the `call:` prefix. In v1 this is
  acceptable — the number is informational.

## 80.9 Admin Console UI

<!-- DIM-Map §80.9 Admin Console UI
  Completeness:        ✓
  Konsistenz:          ✓
  Implementierbarkeit: ✓
  Interface-Vertraege: ✓
  Abhaengigkeiten:     ✓
-->

The Admin Console follows the same TTY aesthetic as the rest of the app:
- Box-drawing borders, IBM Plex Mono, no border-radius
- Header: `[ 0xAD ADMIN CONSOLE ]` rendered with `var(--warning)` on
  the title, matching the hex-label convention used elsewhere in the app.
- **Sections (three tabs)**: Users, Rooms, System. There is NO separate
  Calls tab. Force-end call is surfaced as a per-row `[ END CALL ]`
  action inside the Rooms tab (on rows where `hasActiveCall` is true;
  see 80.6).
- Simple table layouts for lists
- No pagination in v1 (user count is ~5-15, room count is small)

**Action feedback banner** — After successful admin actions
(deactivate / reactivate, admin toggle, room delete / rename, force-
end call), a single-line status banner is rendered below the header
in `var(--accent)` on `var(--bg-elevated)` with a bottom border in
`var(--accent-muted)`. Messages auto-clear after 5 seconds via
`setTimeout`. Exception: the `"Password reset for {username}..."`
message persists until the TempPasswordBox is dismissed (the reset
flow owns its own surface; see 80.3).

**Data loading** — On Admin Console mount, the client fires the three
list endpoints in parallel:
`Promise.all([GET /api/admin/users, GET /api/admin/rooms,
GET /api/admin/system])`. A single `loading...` placeholder is shown
until all three resolve. No WS-driven updates; no per-tab lazy
fetch. After a successful force-end call, the Rooms list is
re-fetched (to refresh `hasActiveCall`). After a room delete, the
local rooms state drops the row without a re-fetch. After
deactivate / reactivate / admin-toggle, the local users state is
patched in place without a re-fetch.

## 80.10 Acceptance Criteria

- [ ] Admin Console visible only to admin users (as ADMIN tab in Settings)
- [ ] Non-admin cannot access admin tab (tab hidden + server-side check)
- [ ] Password reset generates temp password and sets must_change_password flag
- [ ] Forced password change screen blocks app access until completed
- [ ] User deactivation revokes sessions and prevents login
- [ ] User reactivation restores login ability
- [ ] Room deletion removes room, memberships, messages with confirmation
- [ ] Force-end call closes LiveKit room and notifies participants
- [ ] Room rename broadcasts update to all connected clients
- [ ] System status shows storage and user metrics
- [ ] First signup gets is_admin: true automatically
- [ ] ADMIN tab uses warning color for label and border
