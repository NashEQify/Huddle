intent_chain:
  vision: Private selfhosted Discord/Signal-Alternative for a small group of friends
  operational: Cross-cutting acceptance criteria consolidating all spec areas
  action: Lists the key acceptance criteria for every feature area (profile, calls, chat, uploads, WS, notifications, welcome screen, admin, presence, DM, screenshare, TTY aesthetic, color themes, chat font size, room passwords, header layout) as a summary checklist

| | |
|---|---|
| **Layer** | Cross-Cutting |
| **Status** | aktuell |
| **Konsumiert** | overview, 10-domain, 15-auth, 20-notifications, 25-websocket, 30-chat, 35-uploads, 40-voice, 45-video, 50-screenshare, 60-sidebar, 65-welcome, 70-audio-settings, 75-user-settings, 80-admin, 90-persistence |

## Was diese Spec beschreibt

This spec consolidates key acceptance criteria across all feature areas into a single summary view. Individual spec files contain detailed acceptance criteria for their area; this file provides the cross-cutting checklist. It covers profile defaults, active users strip, user settings, calls, DM calls, screenshare, chat, uploads, WebSocket resilience, notifications, welcome screen, admin console, room creation, presence, DM conversations, mobile responsiveness, TTY aesthetic, color themes, chat font size, room passwords, and header layout.

---

# 99. Acceptance Criteria (v1) (Normative)

This file consolidates key acceptance criteria across all specs.
Individual spec files contain detailed acceptance criteria for their area.
This file provides the cross-cutting and summary view.

## 99.1 Profile defaults on first sign-up
- On successful sign-up, user receives:
  - random title from TitlePool
  - random built-in avatar from the built-in gallery (256x256 PNG)
- User can change title and avatar immediately after first login.
- First user to sign up receives `is_admin: true`.

## 99.2 Active Users Strip
- Every conversation view (direct and group) shows an Active Users Strip at the top.
- Each active user shows:
  - avatar image (built-in PNG or uploaded portrait)
  - display name including title in quotes when present
- If user is in the call for that conversation:
  - avatar chip has mic overlay icon bottom-right
- When a user speaks (audio input detected):
  - avatar chip shows an outer glow ring (CSS animation, relayed via WS
    to all clients -- not just call participants).

## 99.3 Title (inline header edit only)
- Title editing is available only via inline header edit (not in Settings Profile tab).
- Title is displayed as `<username> "<title>"`.
- Randomize icon exists next to inline title; clicking assigns a random title.
- Saving a custom title adds it to the TitlePool.

## 99.4 User Settings: avatar
- User can choose a built-in avatar from the gallery (5x5 grid, 80px).
- User can upload portrait (PNG/JPEG/WebP, <= 1 MB), which is cropped to square and stored.
- User can switch between built-in and uploaded avatar at any time.

## 99.5 User Settings: email change requires password
- Changing email requires entering current password.
- Title/avatar changes do not require password.

## 99.6 User Settings: password change
- User can change password in Settings.
- Requires current password + new password + repeat new password.
- Password rules from `15-auth.md` apply.

## 99.7 Calls: speaking indicators
- Speaking state is derived from LiveKit audio levels by call participants.
- Speaking state is relayed via WS (`call.speaking`) to ALL connected clients.
- This drives avatar glow in the Active Users Strip for all viewers.

## 99.8 Auth rules
- Password: min 8 max 64; Argon2id
- Login attempt limiting: 5 failed attempts -> 5 minute lockout per username
- Sessions: Secure HttpOnly cookies; auto-login until explicit logout
- No self-service password reset; admin resets via Admin Console

## 99.9 Call rules
- Join Call dropdown: audio-only vs join with camera; mic unmuted by default
- Camera toggle prompts to join call first if not in call (one-click confirmation,
  intentional friction per overview.md Invariant E)
- Starting screenshare auto-joins call (no prompt, per overview.md Invariant E)
- Leaving call stops active screenshare (client-side enforced)
- Single active call constraint: cannot join two calls simultaneously
- Ghost call cleanup: LiveKit empty_timeout 60s
- Audio uses webAudioMix mode (bypasses autoplay policy)
- Mic track published with source: Microphone, mute via publication.mute()

## 99.10 DM call rules
- DM call to offline user is prevented ("User is offline." error)
- DM call leave = end (server deletes LiveKit room on participant_left)
- Incoming DM call shows global overlay with Accept/Decline and ring sound
- Screenshare is available in DM calls (ss:dm:{direct_id})

## 99.11 Screenshare rules
- Room screenshare: one per room, takeover with confirmation
- DM screenshare: one per conversation, takeover with confirmation
- Sidebar shows [SS] indicator for rooms with active screenshare
- Screenshare preview shown at top of chat view (room and DM)
- Screenshare window opens via EXPAND button
- Screenshare quality targets 1080p (ScreenSharePresets.h1080fps30, contentHint: detail)
- Viewer Room uses adaptiveStream: false (always receives full quality)
- getDisplayMedia called immediately in click handler (user gesture timing)

## 99.12 Chat rules
- Messages load paginated: 50 initial, older on scroll-up
- Consecutive same-user messages within 2 minutes are grouped
- Date separators between messages on different days
- Curated emoji set (~21 emojis), flat grid picker
- Reactions: max 10 per user per message, toggleable, aggregated with counter
- URL linkification: clickable links in message text
- @Mentions: autocomplete dropdown, visual highlight in messages
- Message search: Ctrl+F, server-side substring search, scoped to conversation

## 99.13 File uploads
- Upload via button, drag & drop, clipboard paste
- Max 10 MB per file, max 5 files per message
- Content-type whitelist with magic byte validation
- Images: inline preview, lightbox on click
- Other files: download row with filename + size
- Auth-protected file serving

## 99.14 WebSocket & Resilience
- WS authenticates via session cookie on upgrade
- Reconnect with exponential backoff (1s-30s)
- Optimistic message sending with retry on failure
- Message queue during disconnect (in-memory, max 50)
- Missed message recovery via REST after reconnect
- Connection status banner during disconnect
- Reconnection banner shows `[ CONNECTION LOST ] reconnecting...` during disconnect
- Banner shows `[ CONNECTED ]` and auto-dismisses after 2 seconds on reconnect
- LiveKit and WS are independent -- partial disconnect does not break everything

## 99.15 Notifications & Unreads
- Server-side read positions (ReadPosition model) -- survives reload
- unread.init on WS connect, mark_read on scope navigation
- Unread dot on room/user entries in sidebar
- Tab title counter: `(N) Huddle`
- Notification sound on new message (Web Audio API synthesized, descending tone)
- Browser notifications for incoming DM calls only (not for messages)
- DM call ring loop (continuous until resolved)

## 99.16 Welcome Screen
- Shown when no room/DM is selected (initial state after login)
- Terminal MOTD format with system status, gaming quote, tips
- System status: online users (live via presence), active calls (count), screenshares (count)
- No user-facing MOTD quote submission (seeded pool only)

## 99.17 Admin Console
- Accessible only to admin users (as ADMIN tab within Settings overlay)
- Password reset: generates temp password, forces change on next login
- User deactivation/reactivation
- Room deletion (with confirmation)
- Force-end any call
- Room rename
- System status overview

## 99.18 Room creation
- Any authenticated user can create rooms
- Room name: 1-50 characters
- Creator is auto-joined, view navigates to new room
- Other clients see new room via WS event

## 99.19 Presence
- Online = WS connected; offline = WS disconnected
- Last seen shown for offline users (relative time)
- Full presence sync on connect/reconnect
- Real-time online/offline broadcast

## 99.20 DM conversations
- Accessed via Users section click
- DirectConversation entity created eagerly on DM view open
- DM calls: voice + camera + screenshare

## 99.21 Mobile Responsiveness
- Hamburger menu at 768px breakpoint
- Sidebar shows as overlay on mobile
- Responsive layout throughout

## 99.22 TTY Aesthetic (cross-cutting)
- IBM Plex Mono everywhere
- border-radius: 0 on all elements
- No chat bubbles, no drop shadows on panels, no loading spinners
- Box-drawing borders and separators
- Hex-labels for section headers
- Mint/Sage (#a8d8b9) on dark blue-gray (#1a1a2e) as default theme
- Sidebar `[SS]`/`[PW]` indicators have tooltips on hover
- Settings overlay implements focus trap

## 99.23 Color Themes
- 10 color themes available (Terminal Mint, Amber Console, Arctic, High Contrast,
  Lavender Dusk, Rose Terminal, Monochrome, Norton Commander, Paper, Frost)
- Theme selector in Settings -> COLOR THEME tab (2x5 grid with previews)
- Persisted in localStorage `huddle-theme`
- Instant CSS variable switch, no page reload
- Default theme: Terminal Mint

## 99.24 Chat Font Size
- A-up/A-down buttons in room and DM headers
- Range: 12px-24px, step 2px, default 14px
- Applied via `--chat-font-size` CSS variable on `<html>`
- Persisted in localStorage `huddle-chat-font-size`

## 99.25 Room Passwords
- Optional room password (4-64 chars, Argon2id hashed)
- Password checked on join and rejoin
- Admin bypasses password check
- Creator and admin can set/change/remove password via `PATCH /api/rooms/:roomId/password`
- `[PW]` indicator in sidebar for password-protected rooms

## 99.26 Header Layout
- Header contains: avatar + username + inline-editable title + randomize button +
  Settings button + call indicator
- Avatar click opens dropdown menu (Settings, Abmelden/Logout)
- Red border on header when user is in an active call
  (`box-shadow: inset 0 0 0 2px var(--error)`)
- Brand text "Huddle" displayed at far right of header
