import type { ScopeType } from './api.js';

// ── Room API Types ──────────────────────────────────────

export type MembershipState = 'joined' | 'left' | 'not_joined';

export interface RoomResponse {
  id: string;
  name: string;
  discoverable: boolean;
  hasPassword: boolean;
  lastActivityAt: string;
  membership: MembershipState | null;
  createdBy: string;
}

// ── User API Types ──────────────────────────────────────

export interface UserProfileResponse {
  title: string;
  avatarKind: 'built_in' | 'uploaded';
  builtInAvatarId: string | null;
  builtInAvatarUrl: string | null;
  builtInAvatarLabel?: string | null;
  portraitUrl: string | null;
}

export interface UserResponse {
  id: string;
  username: string;
  isActive: boolean;
  lastSeenAt: string | null;
  profile: UserProfileResponse | null;
}

// ── Message API Types ──────────────────────────────────

export interface MessageAuthor {
  id: string;
  username: string;
  profile: UserProfileResponse | null;
}

export interface AttachmentResponse {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
}

export interface MediaItem {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  authorUsername: string;
  createdAt: string;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface ReplyToResponse {
  id: string;
  authorId: string;
  author: { id: string; username: string; profile: UserProfileResponse | null };
  content: string | null; // truncated 120 chars, null if tombstone
  deletedAt?: string;
}

export interface MessageResponse {
  id: string;
  scopeType: ScopeType;
  scopeId: string;
  authorId: string;
  content: string | null; // null for tombstone messages
  createdAt: string;
  author: MessageAuthor;
  attachments?: AttachmentResponse[];
  reactions?: ReactionGroup[];
  deletedAt?: string;
  editedAt?: string;
  editedBy?: string;
  replyTo?: ReplyToResponse | null;
}

export interface SendMessageRequest {
  scopeType: ScopeType;
  scopeId: string;
  content: string;
  replyToId?: string;
}

// ── Membership API Types ────────────────────────────────

export interface MembershipResponse {
  roomId: string;
  userId: string;
  state: MembershipState;
  joinedAt: string | null;
  leftAt: string | null;
}
