import type { FastifyInstance } from 'fastify';
import type { WsMessage } from '@huddle/shared';

import { validateSessionFromRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  addConnection,
  removeConnection,
  broadcast,
  broadcastToUsers,
  sendToUser,
  getOnlineUserIds,
  isUserOnline,
  type WsConnection,
} from './handler.js';
import {
  handleTypingStart,
  handleTypingStop,
  clearTypingForUser,
} from './typing.js';
import { handleCallForceEnd, handleDmCallDecline } from '../routes/livekit.js';
import { broadcastToCallScope } from '../lib/scope-broadcast.js';

// ── Heartbeat ────────────────────────────────────────────
// Server sends ping every 30s. If no pong within 10s, close.

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

interface HeartbeatState {
  pingTimer: ReturnType<typeof setInterval>;
  pongTimer: ReturnType<typeof setTimeout> | null;
}

const heartbeats = new Map<WsConnection, HeartbeatState>();

function startHeartbeat(ws: WsConnection): void {
  const state: HeartbeatState = {
    pingTimer: setInterval(() => {
      if (ws.readyState !== ws.OPEN) {
        stopHeartbeat(ws);
        return;
      }

      ws.ping();

      // Start pong timeout
      state.pongTimer = setTimeout(() => {
        ws.close(4002, 'Pong timeout');
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS),
    pongTimer: null,
  };

  ws.on('pong', () => {
    if (state.pongTimer) {
      clearTimeout(state.pongTimer);
      state.pongTimer = null;
    }
  });

  heartbeats.set(ws, state);
}

function stopHeartbeat(ws: WsConnection): void {
  const state = heartbeats.get(ws);
  if (state) {
    clearInterval(state.pingTimer);
    if (state.pongTimer) clearTimeout(state.pongTimer);
    heartbeats.delete(ws);
  }
}

// ── Unread Computation ───────────────────────────────────

async function computeUnreadScopes(userId: string): Promise<string[]> {
  const unreadScopes: string[] = [];

  // 1. Get all ReadPositions for this user
  const readPositions = await prisma.readPosition.findMany({
    where: { userId },
  });
  const rpMap = new Map<string, Date>();
  for (const rp of readPositions) {
    rpMap.set(`${rp.scopeType}:${rp.scopeId}`, rp.lastReadAt);
  }

  // 2. Check joined rooms for unread messages
  // TODO: batch this — currently one count per scope. Could use raw SQL with
  // LATERAL joins or UNION to check all scopes in a single query, but Prisma's
  // groupBy cannot apply per-row WHERE conditions (per-scope read positions).
  const joinedMemberships = await prisma.groupMembership.findMany({
    where: { userId, state: 'joined' },
    select: { roomId: true },
  });

  // Run all room unread counts in parallel
  const roomCountResults = await Promise.all(
    joinedMemberships.map(async ({ roomId }) => {
      const lastRead = rpMap.get(`room:${roomId}`);
      const whereClause: Record<string, unknown> = {
        scopeType: 'room',
        scopeId: roomId,
        authorId: { not: userId },
        deletedAt: null,
      };
      if (lastRead) {
        whereClause.createdAt = { gt: lastRead };
      }
      const count = await prisma.message.count({ where: whereClause });
      return { roomId, count };
    })
  );

  for (const { roomId, count } of roomCountResults) {
    if (count > 0) {
      unreadScopes.push(`room:${roomId}`);
    }
  }

  // 3. Check direct conversations for unread messages
  const directConversations = await prisma.directConversation.findMany({
    where: {
      OR: [
        { participantAId: userId },
        { participantBId: userId },
      ],
    },
  });

  // Run all DM unread counts in parallel
  const dmCountResults = await Promise.all(
    directConversations.map(async (dm) => {
      const lastRead = rpMap.get(`direct:${dm.id}`);
      const otherUserId = dm.participantAId === userId ? dm.participantBId : dm.participantAId;
      const whereClause: Record<string, unknown> = {
        scopeType: 'direct',
        scopeId: dm.id,
        authorId: { not: userId },
        deletedAt: null,
      };
      if (lastRead) {
        whereClause.createdAt = { gt: lastRead };
      }
      const count = await prisma.message.count({ where: whereClause });
      return { otherUserId, count };
    })
  );

  for (const { otherUserId, count } of dmCountResults) {
    if (count > 0) {
      unreadScopes.push(`dm-user:${otherUserId}`);
    }
  }

  return unreadScopes;
}

// ── Mark Read Handler ────────────────────────────────────

async function handleMarkRead(
  userId: string,
  scopeType: 'room' | 'direct',
  scopeId: string,
): Promise<void> {
  // Validate access
  if (scopeType === 'room') {
    const membership = await prisma.groupMembership.findUnique({
      where: { roomId_userId: { roomId: scopeId, userId } },
    });
    if (!membership || membership.state !== 'joined') return;
  } else if (scopeType === 'direct') {
    const dm = await prisma.directConversation.findUnique({
      where: { id: scopeId },
    });
    if (!dm) return;
    if (dm.participantAId !== userId && dm.participantBId !== userId) return;
  }

  // Upsert read position
  await prisma.readPosition.upsert({
    where: {
      userId_scopeType_scopeId: { userId, scopeType, scopeId },
    },
    update: { lastReadAt: new Date() },
    create: { userId, scopeType, scopeId, lastReadAt: new Date() },
  });
}

// ── WebSocket Plugin ─────────────────────────────────────

export async function wsPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.get('/ws', { websocket: true }, async (socket, request) => {
    // Cast to our minimal WsConnection interface
    const ws = socket as unknown as WsConnection;

    // ── Auth: validate session cookie ──
    const userId = await validateSessionFromRequest(request);
    if (!userId) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    request.log.info({ userId }, 'WebSocket connected');

    // ── Register connection ──
    addConnection(userId, ws);

    // ── Send presence.sync to the new client ──
    // Include all users so the client knows who is online/offline
    const allUsers = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, lastSeenAt: true },
    });

    const onlineIds = new Set(getOnlineUserIds());

    const syncMessage: WsMessage = {
      type: 'presence.sync',
      payload: {
        users: allUsers.map((u) => ({
          userId: u.id,
          isActive: onlineIds.has(u.id),
          lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
        })),
      },
    };

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(syncMessage));
    }

    // ── Send unread.init to the new client ──
    try {
      const unreadScopes = await computeUnreadScopes(userId);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'unread.init',
          payload: { unreadScopes },
        }));
      }
    } catch (err) {
      request.log.error({ err, userId }, 'Failed to compute unread.init');
    }

    // ── Broadcast presence.online to everyone else ──
    broadcast(
      { type: 'presence.online', payload: { userId } },
      userId
    );

    // ── Start heartbeat ──
    startHeartbeat(ws);

    // ── Message handler ──
    ws.on('message', (raw: Buffer | string) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        const message = JSON.parse(text) as WsMessage;
        request.log.debug({ type: message.type, userId }, 'WS message received');

        // Route client-to-server messages
        const payload = message.payload as Record<string, unknown>;

        if (message.type === 'typing.start') {
          const scopeType = payload.scopeType as string;
          const scopeId = payload.scopeId as string;
          if (scopeType && scopeId) {
            handleTypingStart(userId, scopeType, scopeId).catch((err) => {
              request.log.error({ err, userId }, 'typing.start handler error');
            });
          }
        } else if (message.type === 'typing.stop') {
          const scopeType = payload.scopeType as string;
          const scopeId = payload.scopeId as string;
          if (scopeType && scopeId) {
            handleTypingStop(userId, scopeType, scopeId).catch((err) => {
              request.log.error({ err, userId }, 'typing.stop handler error');
            });
          }
        } else if (message.type === 'call.speaking') {
          // Relay speaking state — server authoritative, NEVER trust client userIds.
          // Per spec 25-websocket §25.5: "the server MUST overwrite any client-
          // provided userId with the authenticated session's userId before
          // broadcasting. This prevents spoofing..."
          //
          // Outgoing payload is ALWAYS per-user (userId = authenticated session).
          // Client sends { scope, isSpeaking }; legacy clients may send
          // { scope, speakingUserIds: [...] } — in that case we derive isSpeaking
          // from whether the array is non-empty.
          //
          // Scope-aware (CGL-002 expansion): room scope → global (social cue),
          // DM scope → only the 2 DM participants (privacy).
          const p = message.payload as Record<string, unknown>;
          const isSpeaking =
            typeof p.isSpeaking === 'boolean'
              ? p.isSpeaking
              : Array.isArray(p.speakingUserIds) && p.speakingUserIds.length > 0;
          const scope = p.scope as { type: 'room' | 'direct'; id: string } | undefined;
          if (scope && (scope.type === 'room' || scope.type === 'direct')) {
            broadcastToCallScope(
              scope,
              {
                type: 'call.speaking',
                payload: {
                  scope,
                  userId, // server-injected from authenticated session, cannot be spoofed
                  isSpeaking,
                },
              },
              userId, // sender doesn't need its own echo
            ).catch((err) => {
              request.log.error({ err, userId }, 'call.speaking broadcast error');
            });
          }
        } else if (message.type === 'call.force_end') {
          const scope = payload.scope as { type: string; id: string } | undefined;
          if (scope) {
            handleCallForceEnd(userId, { scope }).catch((err) => {
              request.log.error({ err, userId }, 'call.force_end handler error');
            });
          }
        } else if (message.type === 'dm.call.decline') {
          const directId = payload.directId as string | undefined;
          const callerId = payload.callerId as string | undefined;
          if (directId && callerId) {
            handleDmCallDecline(userId, { directId, callerId }).catch((err) => {
              request.log.error({ err, userId }, 'dm.call.decline handler error');
            });
          }
        } else if (message.type === 'mark_read') {
          const scopeType = payload.scopeType as string;
          const scopeId = payload.scopeId as string;
          if (scopeType && scopeId && (scopeType === 'room' || scopeType === 'direct')) {
            handleMarkRead(userId, scopeType, scopeId).catch((err) => {
              request.log.error({ err, userId }, 'mark_read handler error');
            });
          }
        }
      } catch {
        request.log.warn({ userId }, 'Invalid WS message format');
      }
    });

    // ── Disconnect handler ──
    ws.on('close', async () => {
      request.log.info({ userId }, 'WebSocket disconnected');

      stopHeartbeat(ws);
      removeConnection(userId, ws);

      // Clear all typing state for this user
      await clearTypingForUser(userId).catch((err) => {
        request.log.error({ err, userId }, 'clearTypingForUser error');
      });

      // Update last_seen_at in DB
      const now = new Date();
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { lastSeenAt: now },
        });
      } catch (err) {
        request.log.error({ userId, err }, 'Failed to update last_seen_at');
      }

      // Broadcast presence.offline to remaining clients
      broadcast({
        type: 'presence.offline',
        payload: { userId, lastSeenAt: now.toISOString() },
      });
    });

    // ── Error handler ──
    ws.on('error', (err: Error) => {
      request.log.error({ userId, err }, 'WebSocket error');
      ws.close(4003, 'Internal error');
    });
  });
}

// Re-export handler utilities for use by other modules
export { broadcast, broadcastToUsers, sendToUser, getOnlineUserIds, connections, isUserOnline, removeAllConnectionsForUser } from './handler.js';
