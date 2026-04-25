import type { FastifyInstance } from 'fastify';
import type { ApiResponse, MembershipResponse } from '@huddle/shared';
import * as argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast, broadcastToUsers } from '../ws/handler.js';

// ── Helper: create system message ───────────────────────

async function createSystemMessage(
  scopeType: string,
  scopeId: string,
  authorId: string,
  action: string
) {
  return prisma.message.create({
    data: {
      scopeType,
      scopeId,
      authorId,
      content: `::system::${action}`,
    },
  });
}

// ── Helper: broadcast system message via WS ─────────────
//
// CGL-002 scope expansion: system messages like "user joined" live inside
// the room's message history and must be membership-filtered like any
// other room message. Only joined members receive them in real-time.
// Left/not_joined users can pull the history on their next visit.

async function broadcastSystemMessage(
  scopeType: string,
  scopeId: string,
  authorId: string,
  username: string,
  action: string
): Promise<void> {
  const msg = await createSystemMessage(scopeType, scopeId, authorId, action);

  const payload = {
    type: 'message.new' as const,
    payload: {
      id: msg.id,
      scopeType: msg.scopeType,
      scopeId: msg.scopeId,
      authorId: msg.authorId,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      author: {
        id: authorId,
        username,
        profile: null,
      },
    },
  };

  if (scopeType === 'room') {
    const joined = await prisma.groupMembership.findMany({
      where: { roomId: scopeId, state: 'joined' },
      select: { userId: true },
    });
    broadcastToUsers(joined.map((m) => m.userId), payload);
  } else {
    // direct scope fall-through (system messages are currently only for rooms,
    // but keep the branch safe for future)
    broadcast(payload);
  }
}

// ── Routes ──────────────────────────────────────────────

export async function membershipRoutes(fastify: FastifyInstance): Promise<void> {
  // PATCH /api/rooms/:roomId/join
  fastify.patch(
    '/api/rooms/:roomId/join',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { roomId } = request.params as { roomId: string };
      const userId = request.userId;

      // Check room exists
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }

      // Password check (admin bypasses)
      if (room.passwordHash !== null) {
        const requester = await prisma.user.findUnique({
          where: { id: userId },
          select: { isAdmin: true },
        });
        if (!requester?.isAdmin) {
          const providedPassword = (request.body as any)?.password;
          if (!providedPassword) {
            return reply.status(403).send({
              error: { code: 'PASSWORD_REQUIRED', message: 'This room requires a password' },
            });
          }
          const valid = await argon2.verify(room.passwordHash, providedPassword);
          if (!valid) {
            return reply.status(403).send({
              error: { code: 'WRONG_PASSWORD', message: 'Incorrect room password' },
            });
          }
        }
      }

      // Get current user for username
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      if (!user) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      // Check current membership
      const existing = await prisma.groupMembership.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });

      if (existing && existing.state === 'joined') {
        return reply.status(400).send({
          error: { code: 'ALREADY_JOINED', message: 'Already a member of this room' },
        });
      }

      const now = new Date();

      // Upsert membership
      const membership = await prisma.groupMembership.upsert({
        where: { roomId_userId: { roomId, userId } },
        create: {
          roomId,
          userId,
          state: 'joined',
          joinedAt: now,
        },
        update: {
          state: 'joined',
          joinedAt: now,
        },
      });

      // Update room lastActivityAt
      await prisma.room.update({
        where: { id: roomId },
        data: { lastActivityAt: now },
      });

      // Broadcast room.membership event
      broadcast({
        type: 'room.membership',
        payload: {
          roomId,
          userId,
          state: 'joined',
          username: user.username,
        },
      });

      // Create and broadcast system message via WS
      await broadcastSystemMessage('room', roomId, userId, user.username, 'joined');

      const data: MembershipResponse = {
        roomId: membership.roomId,
        userId: membership.userId,
        state: membership.state as 'joined' | 'left' | 'not_joined',
        joinedAt: membership.joinedAt?.toISOString() ?? null,
        leftAt: membership.leftAt?.toISOString() ?? null,
      };

      const response: ApiResponse<{ membership: MembershipResponse }> = {
        data: { membership: data },
      };

      return response;
    }
  );

  // PATCH /api/rooms/:roomId/leave
  fastify.patch(
    '/api/rooms/:roomId/leave',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { roomId } = request.params as { roomId: string };
      const userId = request.userId;

      // Check membership exists and is joined
      const existing = await prisma.groupMembership.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });

      if (!existing || existing.state !== 'joined') {
        return reply.status(400).send({
          error: { code: 'NOT_JOINED', message: 'Not a joined member of this room' },
        });
      }

      // Get username
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      if (!user) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      const now = new Date();

      // Update membership
      const membership = await prisma.groupMembership.update({
        where: { roomId_userId: { roomId, userId } },
        data: {
          state: 'left',
          leftAt: now,
        },
      });

      // Update room lastActivityAt
      await prisma.room.update({
        where: { id: roomId },
        data: { lastActivityAt: now },
      });

      // Broadcast room.membership event
      broadcast({
        type: 'room.membership',
        payload: {
          roomId,
          userId,
          state: 'left',
          username: user.username,
        },
      });

      // Create and broadcast system message via WS
      await broadcastSystemMessage('room', roomId, userId, user.username, 'left');

      const data: MembershipResponse = {
        roomId: membership.roomId,
        userId: membership.userId,
        state: membership.state as 'joined' | 'left' | 'not_joined',
        joinedAt: membership.joinedAt?.toISOString() ?? null,
        leftAt: membership.leftAt?.toISOString() ?? null,
      };

      const response: ApiResponse<{ membership: MembershipResponse }> = {
        data: { membership: data },
      };

      return response;
    }
  );

  // PATCH /api/rooms/:roomId/rejoin
  fastify.patch(
    '/api/rooms/:roomId/rejoin',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { roomId } = request.params as { roomId: string };
      const userId = request.userId;

      // Check membership exists and is left
      const existing = await prisma.groupMembership.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });

      if (!existing || existing.state !== 'left') {
        return reply.status(400).send({
          error: { code: 'INVALID_STATE', message: 'Can only rejoin a room you have left' },
        });
      }

      // Password check for rejoin (admin bypasses)
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (room && room.passwordHash !== null) {
        const requester = await prisma.user.findUnique({
          where: { id: userId },
          select: { isAdmin: true },
        });
        if (!requester?.isAdmin) {
          const providedPassword = (request.body as any)?.password;
          if (!providedPassword) {
            return reply.status(403).send({
              error: { code: 'PASSWORD_REQUIRED', message: 'This room requires a password to rejoin' },
            });
          }
          const valid = await argon2.verify(room.passwordHash, providedPassword);
          if (!valid) {
            return reply.status(403).send({
              error: { code: 'WRONG_PASSWORD', message: 'Incorrect room password' },
            });
          }
        }
      }

      // Get username
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      if (!user) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      const now = new Date();

      // Update membership
      const membership = await prisma.groupMembership.update({
        where: { roomId_userId: { roomId, userId } },
        data: {
          state: 'joined',
          joinedAt: now,
        },
      });

      // Update room lastActivityAt
      await prisma.room.update({
        where: { id: roomId },
        data: { lastActivityAt: now },
      });

      // Broadcast room.membership event
      broadcast({
        type: 'room.membership',
        payload: {
          roomId,
          userId,
          state: 'joined',
          username: user.username,
        },
      });

      // Create and broadcast system message via WS
      await broadcastSystemMessage('room', roomId, userId, user.username, 'rejoined');

      const data: MembershipResponse = {
        roomId: membership.roomId,
        userId: membership.userId,
        state: membership.state as 'joined' | 'left' | 'not_joined',
        joinedAt: membership.joinedAt?.toISOString() ?? null,
        leftAt: membership.leftAt?.toISOString() ?? null,
      };

      const response: ApiResponse<{ membership: MembershipResponse }> = {
        data: { membership: data },
      };

      return response;
    }
  );
}
