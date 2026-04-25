/**
 * Shared message utility functions used by messages.ts and search.ts.
 *
 * - batchResolveAuthors: batch-fetch built-in avatar data for message authors
 * - mapAttachments: convert DB attachment records to API response format
 * - aggregateReactions: group reactions by emoji for API response
 */

import type {
  AttachmentResponse,
  ReactionGroup,
  MessageAuthor,
  UserProfileResponse,
} from '@huddle/shared';
import { prisma } from './prisma.js';
import { attachmentUrl } from './uploads.js';

// ── Helper: batch resolve authors ───────────────────────

export async function batchResolveAuthors(
  authors: Array<{
    id: string;
    username: string;
    profile: {
      title: string;
      avatarKind: string;
      builtInAvatarId: string | null;
      portraitUrl: string | null;
    } | null;
  }>
): Promise<Map<string, MessageAuthor>> {
  const result = new Map<string, MessageAuthor>();

  // Collect all built-in avatar IDs for batch fetch
  const avatarIds = authors
    .map((a) => a.profile?.builtInAvatarId)
    .filter((id): id is string => id != null);

  const avatarMap = new Map<string, { imageUrl: string; label: string }>();
  if (avatarIds.length > 0) {
    const avatars = await prisma.builtInAvatar.findMany({
      where: { id: { in: [...new Set(avatarIds)] } },
      select: { id: true, imageUrl: true, label: true },
    });
    for (const avatar of avatars) {
      avatarMap.set(avatar.id, { imageUrl: avatar.imageUrl, label: avatar.label });
    }
  }

  for (const author of authors) {
    if (result.has(author.id)) continue;
    let profile: UserProfileResponse | null = null;
    if (author.profile) {
      const avatarEntry = author.profile.builtInAvatarId
        ? avatarMap.get(author.profile.builtInAvatarId) ?? null
        : null;
      profile = {
        title: author.profile.title,
        avatarKind: author.profile.avatarKind as 'built_in' | 'uploaded',
        builtInAvatarId: author.profile.builtInAvatarId,
        builtInAvatarUrl: avatarEntry?.imageUrl ?? null,
        builtInAvatarLabel: avatarEntry?.label ?? null,
        portraitUrl: author.profile.portraitUrl,
      };
    }
    result.set(author.id, {
      id: author.id,
      username: author.username,
      profile,
    });
  }

  return result;
}

// ── Helper: map DB attachments to response ──────────────

export function mapAttachments(
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }>
): AttachmentResponse[] {
  return attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    url: attachmentUrl(a.id, a.filename),
  }));
}

// ── Helper: aggregate reactions into groups ──────────────

export function aggregateReactions(
  reactions: Array<{ emoji: string; userId: string }>
): ReactionGroup[] | undefined {
  if (reactions.length === 0) return undefined;

  const groupMap = new Map<string, string[]>();
  for (const r of reactions) {
    const users = groupMap.get(r.emoji) ?? [];
    users.push(r.userId);
    groupMap.set(r.emoji, users);
  }

  return Array.from(groupMap.entries()).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    userIds,
  }));
}
