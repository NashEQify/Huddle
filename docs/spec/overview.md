intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Top-level index and global invariants governing all subsystems
  action: Defines priority rules, scope, cross-cutting invariants, and the table of contents for all spec files

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **Konsumiert** | 00-terminology, 10-domain, 15-auth, 20-notifications, 25-websocket, 30-chat, 35-uploads, 40-voice, 45-video, 50-screenshare, 60-sidebar, 65-welcome, 70-audio-settings, 75-user-settings, 80-admin, 90-persistence, 99-acceptance |

## Was diese Spec beschreibt

This is the top-level design specification index for Huddle. It defines the normative priority rules (this file wins on conflict), lists all topic spec files, and establishes the global invariants that every subsystem must respect. All product behavior flows from this spec and its referenced topic files.

---

# Huddle -- Design Specification v1 (Index)

This document defines all product behavior.
This spec defines application logic and UX rules.

If implementation conflicts with this spec, this spec wins.

## Normative Structure
- This file (`overview.md`) defines: priority rules, scope, global invariants, and the table of contents.
- Topic files under `docs/spec/` define detailed behavior for their area.
- Conflict resolution: `overview.md` > matching topic file > more specific rule wins.


## Table of Contents (Normative)
1. Terminology & Defaults: `docs/spec/00-terminology.md`
2. Domain Model: `docs/spec/10-domain.md`
3. Auth & Login: `docs/spec/15-auth.md`
4. Notifications & Activity: `docs/spec/20-notifications.md`
5. WebSocket Protocol: `docs/spec/25-websocket.md`
6. Chat & Conversations: `docs/spec/30-chat.md`
7. File & Image Uploads: `docs/spec/35-uploads.md`
8. Voice / Calls (LiveKit): `docs/spec/40-voice.md`
9. Video / Camera (LiveKit): `docs/spec/45-video.md`
10. Screenshare (LiveKit): `docs/spec/50-screenshare.md`
11. Sidebar: `docs/spec/60-sidebar.md`
12. Welcome Screen: `docs/spec/65-welcome.md`
13. Audio Controls & Settings: `docs/spec/70-audio-settings.md`
14. User Settings: `docs/spec/75-user-settings.md`
15. Admin Console: `docs/spec/80-admin.md`
16. Persistence: `docs/spec/90-persistence.md`
17. Audio Visualizer: `docs/spec/95-visualizer.md`
18. Acceptance Criteria: `docs/spec/99-acceptance.md`


## Global Invariants (Normative)

### A) Sidebar Primary Navigation (Chatrooms Buckets)
- The left sidebar has exactly two sections (see `60-sidebar.md`):
  - Chatrooms
  - Users
- Chatrooms contains group rooms only and uses membership buckets:
  - `joined`
  - `left`
  - `not_joined`
  - `discoverable` (rooms where the user has no membership record; display-only bucket, not a membership state)
- Within each Chatrooms bucket, sorting uses `last_activity_at` DESC (most recent first).

The `discoverable` bucket is a display classification in the sidebar, not a membership state in the domain model. Rooms where the user has no GroupMembership record and `discoverable = true` appear in this bucket.
- "Recent chats" is not a separate section. It is the ordering rule inside Chatrooms buckets.

**Direct Messages (DM Access):**
Direct conversations have no persistent sidebar section. They are accessed by
clicking a user in the Users section, which opens the DM conversation. Once a
DM is open, it remains the active view until the user navigates elsewhere.
There is no "recent DMs" list in v1. The Users section serves as the DM entry
point.


### B) Group Discovery vs Conversations
- Group rooms may exist in a directory (discoverable), but the directory is NOT the primary navigation.
- Rooms that are `not_joined` MUST NOT appear in Recent Chats by default.

### C) Membership State Model (Joined / Left / Not Joined)
- Group membership state is per user and per room:
  - `joined`: full access + participation
  - `left`: conversation remains visible in Recents; history remains visible; participation disabled until rejoin
  - `not_joined`: user has never joined; room opens in a gated view; no history visible
- Direct conversations are always effectively `joined` for both participants.

### D) "Leave" Semantics (Signal-like)
- Leaving a group chat does NOT delete it from Recents.
- When `left`, the conversation is read-only until rejoined.

### E) Calls & Media Rules
- All real-time media uses LiveKit.
- A conversation (room or DM) has two LiveKit rooms that work as a pair:
  - The **call room** (`call:{room_id}` / `call:dm:{direct_id}`) carries
    audio + optional camera + presence/speaking.
  - The **screenshare room** (`ss:room:{room_id}` / `ss:dm:{direct_id}`) is a
    dedicated companion room for screen capture only.
  - While sharing, the sharer holds both connections; each viewer opens its
    own connection to the screenshare room (not a subscription inside the
    call room). See `50-screenshare.md` §50.1a for the full two-room design.
- If a user clicks "Camera ON" while not in the call:
  - The app MUST show a one-click confirmation prompt ("Join call to enable camera"),
    then join the call room and enable camera. This friction is intentional --
    camera and microphone exposure requires deliberate user consent.
- If a user clicks "Start Screenshare" while not in the call:
  - The app MUST automatically join the call room first, then start
    screenshare (publishing to the screenshare room). No confirmation prompt --
    screenshare is a deliberate action with no privacy risk to the user.
- Leaving voice/call stops any active screenshare owned by that user (client-side
  enforced: ScreenshareProvider watches call state and stops local screenshare
  when activeScope transitions to null).
- Camera is OFF by default unless explicitly toggled ON by the user.

The asymmetry between camera (prompt) and screenshare (immediate) is intentional.

_Last Update: 2026-04-14 — retroactive drift-sync (Task 009 Batch 2): Invariant E rewritten to reflect the two-room (call + companion screenshare room) design; see `50-screenshare.md` §50.1a._

### F) Notifications & Unreads
- Notifications and unread indicators exist only for:
  - direct conversations
  - group conversations where the user is `joined`
- `left` and `not_joined` group rooms produce no notifications and show no unread indicators.

**Unread Indicator Mechanism (Normative):**
- Unread state is tracked server-side via read positions (`ReadPosition`
  model). Each user has a per-scope `lastReadAt` timestamp.
- On WebSocket connect the server computes which scopes have unread
  messages (messages with `createdAt > lastReadAt` and `authorId != userId`)
  and sends an `unread.init` event with those scope keys.
- An unread indicator is a dot (no number) shown on the room or user entry.
- A room becomes "unread" when a `message.new` WS event arrives for that
  room and the room is not the currently active view.
- A DM becomes "unread" when a `message.new` WS event (with `scopeType: 'direct'`)
  arrives for that direct conversation and it is not the currently active view.
- "Read" is defined as: the user opens (focuses) the room or DM. The dot
  clears immediately on navigation to that scope, and the client sends a
  `mark_read` message to the server to persist the read position.
- Unread state survives page reload (server-side persistence).
- `not_joined` and `left` rooms never show unread dots, even if messages
  arrive (per the existing rule above).
- DM call indicators (incoming call banner / user entry icon) are distinct
  from unread dots and are defined in `docs/spec/40-voice.md`.

**Tab Title Counter (Normative):**
- No unreads: `Huddle`
- With unreads: `(N) Huddle` where N is the total number of scopes with
  unread messages.

### G) DM Call -- Offline Guard
- A user MUST NOT be able to start a DM call to an offline user.
- The client checks presence state before initiating a DM call. If the other
  user is offline: show inline error `User is offline.` and do not start the call.
- This is enforced client-side via the presence store.

### H) Single Active Call Constraint
- A user can be in at most one active call at a time, across all scopes (room calls
  and direct calls).
- If a user attempts to join a second call (via any path -- call button, camera toggle,
  screenshare join, screenshare window join): show inline message `Leave current call first.`
  with a `[ GO TO CALL ]` link that navigates to the conversation scope of the active call.
- The app MUST NOT auto-leave the existing call. The user must explicitly leave first.

### I) LiveKit Room Name Patterns
All LiveKit room names follow these patterns:

| Scope              | Pattern                      |
|-------------------|------------------------------|
| Room Call          | `call:{room_id}`             |
| Room Screenshare   | `ss:room:{room_id}`          |
| DM Screenshare     | `ss:dm:{direct_id}`          |
| Direct Call        | `call:dm:{direct_id}`        |

These patterns are normative and referenced by `40-voice.md` and `50-screenshare.md`.

### J) Initial App State
After login or auto-login:
- No room or DM is selected
- Sidebar is visible and populated
- Main content area shows the Welcome Screen (see `65-welcome.md`)

## MVP Scope (Normative)
All items referenced in this v1 spec are required for the initial production feature set.
