/**
 * Typing Indicators — Ephemeral server-side state
 *
 * Maintains a Map of { scopeKey -> Set<userId> } with per-entry timeouts.
 * On typing.start: add user, broadcast typing.update, start/reset 5s timeout.
 * On typing.stop or timeout: remove user, broadcast typing.update.
 * On disconnect: clear all typing state for that user.
 */

import { broadcastToUsers, sendToUser } from './handler.js';
import { prisma } from '../lib/prisma.js';

// ── State ────────────────────────────────────────────────

// Key format: `${scopeType}:${scopeId}:${userId}`
const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Track which scope keys each user has active typing in
const userScopeKeys = new Map<string, Set<string>>();

const TYPING_TIMEOUT_MS = 5_000;

// ── Helpers ──────────────────────────────────────────────

function scopeKey(scopeType: string, scopeId: string, userId: string): string {
  return `${scopeType}:${scopeId}:${userId}`;
}

function scopePrefix(scopeType: string, scopeId: string): string {
  return `${scopeType}:${scopeId}:`;
}

/**
 * Get all user IDs currently typing in a given scope.
 */
function getTypingUserIds(scopeType: string, scopeId: string): string[] {
  const prefix = scopePrefix(scopeType, scopeId);
  const userIds: string[] = [];
  for (const key of typingTimeouts.keys()) {
    if (key.startsWith(prefix)) {
      const userId = key.slice(prefix.length);
      userIds.push(userId);
    }
  }
  return userIds;
}

/**
 * Broadcast typing.update to all users in scope except the triggering user.
 *
 * CGL-002 scope expansion: typing indicators are membership-scoped. Non-
 * members of a room have no business knowing who's typing in a room they
 * can't see messages in. DMs go to both participants only (already correct).
 *
 *  - DM scope: send to both participants
 *  - Room scope: send only to joined members (excluding the typing user)
 */
async function broadcastTypingUpdate(
  scopeType: string,
  scopeId: string,
  excludeUserId?: string
): Promise<void> {
  const typingUserIds = getTypingUserIds(scopeType, scopeId);

  const message = {
    type: 'typing.update' as const,
    payload: { scopeType, scopeId, typingUserIds },
  };

  if (scopeType === 'direct') {
    // For DMs, send to both participants
    try {
      const dm = await prisma.directConversation.findUnique({
        where: { id: scopeId },
        select: { participantAId: true, participantBId: true },
      });
      if (dm) {
        if (dm.participantAId !== excludeUserId) {
          sendToUser(dm.participantAId, message);
        }
        if (dm.participantBId !== excludeUserId) {
          sendToUser(dm.participantBId, message);
        }
      }
    } catch {
      // Best effort
    }
  } else {
    // For rooms, send only to joined members
    try {
      const joined = await prisma.groupMembership.findMany({
        where: { roomId: scopeId, state: 'joined' },
        select: { userId: true },
      });
      broadcastToUsers(joined.map((m) => m.userId), message, excludeUserId);
    } catch {
      // Best effort
    }
  }
}

// ── Public API ───────────────────────────────────────────

/**
 * Handle typing.start from a user.
 */
export async function handleTypingStart(
  userId: string,
  scopeType: string,
  scopeId: string
): Promise<void> {
  // Membership/participation check
  if (scopeType === 'room') {
    const membership = await prisma.groupMembership.findUnique({
      where: { roomId_userId: { roomId: scopeId, userId } },
      select: { state: true },
    });
    if (!membership || membership.state !== 'joined') return;
  } else if (scopeType === 'direct') {
    const dm = await prisma.directConversation.findUnique({
      where: { id: scopeId },
      select: { participantAId: true, participantBId: true },
    });
    if (!dm || (dm.participantAId !== userId && dm.participantBId !== userId)) return;
  }

  const key = scopeKey(scopeType, scopeId, userId);

  // Clear existing timeout if any (reset the timer)
  const existing = typingTimeouts.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // Track this scope key for the user
  if (!userScopeKeys.has(userId)) {
    userScopeKeys.set(userId, new Set());
  }
  userScopeKeys.get(userId)!.add(key);

  // Set the 5-second server-side timeout
  const timeout = setTimeout(async () => {
    typingTimeouts.delete(key);
    userScopeKeys.get(userId)?.delete(key);
    await broadcastTypingUpdate(scopeType, scopeId, userId);
  }, TYPING_TIMEOUT_MS);

  typingTimeouts.set(key, timeout);

  // Broadcast updated typer list
  await broadcastTypingUpdate(scopeType, scopeId, userId);
}

/**
 * Handle typing.stop from a user.
 */
export async function handleTypingStop(
  userId: string,
  scopeType: string,
  scopeId: string
): Promise<void> {
  const key = scopeKey(scopeType, scopeId, userId);

  const existing = typingTimeouts.get(key);
  if (existing) {
    clearTimeout(existing);
    typingTimeouts.delete(key);
    userScopeKeys.get(userId)?.delete(key);

    // Broadcast updated typer list
    await broadcastTypingUpdate(scopeType, scopeId, userId);
  }
}

/**
 * Clear all typing state for a disconnected user.
 * Called from the WS disconnect handler.
 */
export async function clearTypingForUser(userId: string): Promise<void> {
  const keys = userScopeKeys.get(userId);
  if (!keys || keys.size === 0) return;

  // Collect affected scopes before clearing
  const affectedScopes: Array<{ scopeType: string; scopeId: string }> = [];

  for (const key of keys) {
    const timeout = typingTimeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      typingTimeouts.delete(key);
    }

    // Parse scope from key: `scopeType:scopeId:userId`
    const firstColon = key.indexOf(':');
    const lastColon = key.lastIndexOf(':');
    if (firstColon !== -1 && lastColon !== firstColon) {
      const scopeType = key.slice(0, firstColon);
      const scopeId = key.slice(firstColon + 1, lastColon);
      affectedScopes.push({ scopeType, scopeId });
    }
  }

  userScopeKeys.delete(userId);

  // Broadcast updated typer lists for all affected scopes
  for (const { scopeType, scopeId } of affectedScopes) {
    await broadcastTypingUpdate(scopeType, scopeId);
  }
}
