export type WsEventType =
  | 'presence.sync'
  | 'presence.online'
  | 'presence.offline'
  | 'message.new'
  | 'message.reaction'
  | 'message.deleted'
  | 'message.edited'
  | 'typing.start'
  | 'typing.stop'
  | 'typing.update'
  | 'call.started'
  | 'call.ended'
  | 'call.joined'
  | 'call.left'
  | 'call.participants'
  | 'call.muted'
  | 'call.camera'
  | 'call.speaking'
  | 'call.force_end'
  | 'screenshare.started'
  | 'screenshare.ended'
  | 'screenshare.takeover'
  | 'room.created'
  | 'room.membership'
  | 'room.deleted'
  | 'room.updated'
  | 'dm.call.incoming'
  | 'dm.call.decline'
  | 'dm.call.declined'
  | 'user.updated'
  | 'unread.init'
  | 'mark_read';

export interface WsMessage<T = unknown> {
  type: WsEventType;
  payload: T;
}

// ── Presence Payloads ────────────────────────────────────

export interface PresenceUserEntry {
  userId: string;
  isActive: boolean;
  lastSeenAt: string | null;
}

export interface PresenceSyncPayload {
  users: PresenceUserEntry[];
}

export interface PresenceOnlinePayload {
  userId: string;
}

export interface PresenceOfflinePayload {
  userId: string;
  lastSeenAt: string;
}

// ── Message Payloads ────────────────────────────────────

export interface MessageNewPayload {
  id: string;
  scopeType: string;
  scopeId: string;
  authorId: string;
  content: string;
  createdAt: string;
  author: {
    id: string;
    username: string;
    profile: {
      title: string;
      avatarKind: 'built_in' | 'uploaded';
      builtInAvatarId: string | null;
      builtInAvatarUrl: string | null;
      portraitUrl: string | null;
    } | null;
  };
}

// ── Message Deletion / Edit Payloads ────────────────────

export interface MessageDeletedPayload {
  messageId: string;
  scopeType: 'room' | 'direct';
  scopeId: string;
}

export interface MessageEditedPayload {
  messageId: string;
  scopeType: 'room' | 'direct';
  scopeId: string;
  content: string;
  editedAt: string;
  editedBy: string;
}

// ── Reaction Payloads ───────────────────────────────────

export interface MessageReactionPayload {
  messageId: string;
  scopeType: string;
  scopeId: string;
  emoji: string;
  userId: string;
  action: 'add' | 'remove';
  /** Updated reaction groups for the message */
  reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
}

// ── Room Membership Payloads ────────────────────────────

export interface RoomMembershipPayload {
  roomId: string;
  userId: string;
  state: 'joined' | 'left' | 'not_joined';
  username: string;
}

// ── Call Payloads ──────────────────────────────────────

export interface CallScope {
  type: 'room' | 'direct';
  id: string;
}

export interface CallParticipant {
  userId: string;
  isMuted: boolean;
  isSpeaking: boolean;
  hasCamera: boolean;
}

export interface CallStartedPayload {
  scope: CallScope;
  startedBy: string;
}

export interface CallEndedPayload {
  scope: CallScope;
}

export interface CallJoinedPayload {
  scope: CallScope;
  userId: string;
}

export interface CallLeftPayload {
  scope: CallScope;
  userId: string;
}

export interface CallParticipantsPayload {
  scope: CallScope;
  participants: CallParticipant[];
}

export interface CallMutedPayload {
  scope: CallScope;
  userId: string;
  isMuted: boolean;
}

export interface CallCameraPayload {
  scope: CallScope;
  userId: string;
  hasCamera: boolean;
}

/** Per-user speaking state update.
 *
 * Server authoritatively injects `userId` from the authenticated session —
 * clients cannot spoof other users' speaking state. Each broadcast announces
 * ONE user's speaking state transition (true = started speaking, false =
 * stopped). Receivers aggregate into their local speakingMap without decaying
 * other users (unlike the earlier full-set replace semantic).
 *
 * Per spec 25-websocket §25.5: "the server MUST overwrite any client-provided
 * userId with the authenticated session's userId before broadcasting".
 */
export interface CallSpeakingPayload {
  scope: CallScope;
  userId: string;
  isSpeaking: boolean;
}

export interface CallForceEndPayload {
  scope: CallScope;
}

// ── DM Call Decline Payloads ─────────────────────────────

export interface DmCallDeclinePayload {
  directId: string;
  callerId: string;
}

export interface DmCallDeclinedPayload {
  directId: string;
  declinedBy: string;
}

// ── Screenshare Payloads ────────────────────────────────

export interface ScreenshareStartedPayload {
  mode: 'room' | 'direct';
  scopeId: string;
  userId: string;
  sourceRoomId?: string;
  sourceRoomName?: string;
}

export interface ScreenshareEndedPayload {
  mode: 'room' | 'direct';
  scopeId: string;
  userId: string;
}

/** Targeted event sent ONLY to the prior publisher when a new user takes over
 *  the screenshare slot for the same (mode, scopeId). The prior publisher's
 *  client reacts by unpublishing + disconnecting its local screenshare Room.
 *  Per spec 50-screenshare §4: "previous screenshare is ended first".
 *  Emitted by the server BEFORE the `screenshare.started` broadcast for the
 *  new publisher, so only the prior publisher (not all clients) learns that
 *  their share has been superseded. */
export interface ScreenshareTakeoverPayload {
  mode: 'room' | 'direct';
  scopeId: string;
  /** Identity of the new publisher who took over. Informational. */
  takenOverBy: string;
}

// ── Room Update Payloads ──────────────────────────────

export interface RoomUpdatedPayload {
  roomId: string;
  roomName?: string;
  hasPassword?: boolean;
}

// ── User Update Payloads ──────────────────────────────

export interface UserUpdatedPayload {
  userId: string;
  profile: {
    title: string;
    avatarKind: 'built_in' | 'uploaded';
    builtInAvatarUrl: string | null;
    portraitUrl: string | null;
  };
}

// ── Unread Payloads ────────────────────────────────────

export interface UnreadInitPayload {
  /** Scope keys that have unread messages, e.g. ["room:abc123", "dm-user:def456"] */
  unreadScopes: string[];
}

export interface MarkReadPayload {
  scopeType: 'room' | 'direct';
  scopeId: string;
}
