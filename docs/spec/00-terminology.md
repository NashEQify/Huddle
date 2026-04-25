intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Shared vocabulary and default behaviors referenced by all other specs
  action: Defines presence states, conversation types, membership model, sorting defaults, identity concepts, and the active users strip

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **Konsumiert** | overview |

## Was diese Spec beschreibt

This spec establishes the shared terminology used across all other spec files. It defines what "active" and "inactive" mean for users, the two conversation types (group room and direct), the membership state model for group rooms, sidebar sorting defaults, the identity triple (username, title, avatar), and the Active Users Strip component that appears in every conversation view.

---

# 00. Terminology & Defaults (Normative)

## 00.1 User Presence
- active user = authenticated and connected
- inactive user = not authenticated and/or not connected

## 00.2 Conversation Types
- Group room: named room; visible to all users.
- Direct conversation (DM): exactly two participants; opened via Users list; not listed under Chatrooms.

## 00.3 Membership State (Group Rooms Only)
Per user + per room:
- joined: view history + participate
- left: view history read-only; rejoin to participate
- not_joined: gated; cannot view history; must join first

## 00.4 Sorting Defaults for Chatrooms
- Bucket order: joined > left > not_joined
- Within bucket: last_activity_at DESC

## 00.5 Identity: Username, Title, Avatar
- username: unique handle (case-insensitive uniqueness)
- title: a user-configurable string displayed next to username in quotes
  - formatting: `<username> "<title>"`
- avatar: user image shown across UI
  - either built-in avatar (from a fixed pool)
  - or uploaded portrait

## 00.6 Active Users Strip
- Each conversation view shows active users as avatar chips.
- Call participation is indicated by a mic overlay on the avatar chip.
- Speaking is indicated by a glow ring when audio input is detected (see `40-voice.md`).
