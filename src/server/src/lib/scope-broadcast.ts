/**
 * Scope-Aware Broadcast Helpers
 *
 * Per CGL-002 + scope-expansion pass (2026-04-10): the raw `broadcast()`
 * in ws/handler.ts is global — every connected user receives the message.
 * For a lot of events that's correct (presence, room metadata, sidebar
 * updates), but for scope-specific events we need to filter:
 *
 *  - **Room scope → global**: rooms are visible to everyone per Invariant A.
 *    Call/screenshare events are a "social cue" — the sidebar shows
 *    activity even to non-members so they can decide whether to join.
 *
 *  - **DM scope → targeted**: DMs are private. User C has no business
 *    knowing that user A and user B are on a call, screensharing, typing,
 *    or exchanging messages. Targeted send to the 2 DM participants.
 *
 * These helpers consolidate the scope→audience resolution in one place so
 * individual routes don't duplicate the logic.
 */

import type { WsMessage } from '@huddle/shared';
import { prisma } from './prisma.js';
import { broadcast, broadcastToUsers } from '../ws/handler.js';

// ── Call scope broadcast ────────────────────────────────

export type CallScopeLike = { type: 'room' | 'direct'; id: string };

/**
 * Broadcast a call-related event respecting scope audience rules.
 *
 *  - `scope.type === 'room'` → global (Invariant A: rooms visible to all)
 *  - `scope.type === 'direct'` → only the 2 DM participants
 *
 * `excludeUserId`, if provided, is skipped in both scope variants. Used to
 * avoid echoing an event back to the sender (e.g. `call.speaking`).
 */
export async function broadcastToCallScope(
  scope: CallScopeLike,
  message: WsMessage,
  excludeUserId?: string,
): Promise<void> {
  if (scope.type === 'room') {
    broadcast(message, excludeUserId);
    return;
  }
  const dm = await prisma.directConversation.findUnique({
    where: { id: scope.id },
    select: { participantAId: true, participantBId: true },
  });
  if (dm) {
    broadcastToUsers([dm.participantAId, dm.participantBId], message, excludeUserId);
  }
}

// ── Screenshare scope broadcast ─────────────────────────

export type ScreenshareInfoLike = { mode: 'room' | 'direct'; scopeId: string };

/**
 * Broadcast a screenshare-related event respecting scope audience rules.
 *
 *  - `mode === 'room'` → global (all users see the sidebar preview)
 *  - `mode === 'direct'` → only the 2 DM participants
 */
export async function broadcastToScreenshareScope(
  ssInfo: ScreenshareInfoLike,
  message: WsMessage,
): Promise<void> {
  if (ssInfo.mode === 'room') {
    broadcast(message);
    return;
  }
  const dm = await prisma.directConversation.findUnique({
    where: { id: ssInfo.scopeId },
    select: { participantAId: true, participantBId: true },
  });
  if (dm) {
    broadcastToUsers([dm.participantAId, dm.participantBId], message);
  }
}
