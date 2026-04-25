/**
 * Admin Routes — User management, room management, system status
 *
 * All routes require is_admin: true.
 * See docs/spec/80-admin.md and docs/tech-spec.md Section 3.8.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { broadcast, getOnlineUserIds, removeAllConnectionsForUser } from '../ws/handler.js';
import { roomService } from '../lib/livekit.js';
import { validateRoomName } from '../lib/validation.js';

// ── Helper: generate temp password ────────────────────────

function generateTempPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[randomInt(chars.length)];
  }
  return result;
}

// ── Routes ────────────────────────────────────────────────

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const adminPreHandlers = [requireAuth, requireAdmin];

  // ── GET /api/admin/users ─────────────────────────────
  fastify.get(
    '/api/admin/users',
    { preHandler: adminPreHandlers },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          isAdmin: true,
          isActive: true,
          lastSeenAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return reply.send({ data: { users } });
    }
  );

  // ── POST /api/admin/users/:userId/reset-password ─────
  fastify.post(
    '/api/admin/users/:userId/reset-password',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { credentials: true },
      });

      if (!user || !user.credentials) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      // Admin can provide a custom temp password, otherwise auto-generate
      const body = request.body as { tempPassword?: string } | null;
      const customPw = typeof body?.tempPassword === 'string' ? body.tempPassword.trim() : '';
      if (customPw && (customPw.length < 8 || customPw.length > 64)) {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: 'Password must be 8-64 characters' },
        });
      }
      const tempPassword = customPw || generateTempPassword();
      const passwordHash = await argon2.hash(tempPassword);

      await prisma.credential.update({
        where: { userId },
        data: {
          passwordHash,
          mustChangePassword: true,
        },
      });

      return reply.send({ data: { tempPassword } });
    }
  );

  // ── PATCH /api/admin/users/:userId/deactivate ────────
  fastify.patch(
    '/api/admin/users/:userId/deactivate',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      // Prevent self-deactivation
      if (userId === request.userId) {
        return reply.status(400).send({
          error: { code: 'INVALID_ACTION', message: 'Cannot deactivate yourself' },
        });
      }

      // Deactivate user
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
        select: {
          id: true,
          username: true,
          email: true,
          isAdmin: true,
          isActive: true,
        },
      });

      // Revoke all sessions
      await prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Close WS connections
      removeAllConnectionsForUser(userId);

      // Broadcast offline
      broadcast({
        type: 'presence.offline',
        payload: { userId, lastSeenAt: new Date().toISOString() },
      });

      return reply.send({ data: { user: updatedUser } });
    }
  );

  // ── PATCH /api/admin/users/:userId/reactivate ────────
  fastify.patch(
    '/api/admin/users/:userId/reactivate',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { isActive: true },
        select: {
          id: true,
          username: true,
          email: true,
          isAdmin: true,
          isActive: true,
        },
      });

      return reply.send({ data: { user: updatedUser } });
    }
  );

  // ── PATCH /api/admin/users/:userId/admin ────────────
  fastify.patch(
    '/api/admin/users/:userId/admin',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.params as { userId: string };
      const { isAdmin } = request.body as { isAdmin?: boolean };

      if (typeof isAdmin !== 'boolean') {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: 'isAdmin (boolean) is required' },
        });
      }

      // Prevent self-demotion
      if (userId === request.userId && !isAdmin) {
        return reply.status(400).send({
          error: { code: 'INVALID_ACTION', message: 'Cannot remove your own admin status' },
        });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { isAdmin },
        select: {
          id: true,
          username: true,
          email: true,
          isAdmin: true,
          isActive: true,
        },
      });

      return reply.send({ data: { user: updatedUser } });
    }
  );

  // ── GET /api/admin/rooms ─────────────────────────────
  fastify.get(
    '/api/admin/rooms',
    { preHandler: adminPreHandlers },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const rooms = await prisma.room.findMany({
        select: {
          id: true,
          name: true,
          _count: { select: { memberships: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Check active calls via LiveKit — single listRooms call instead of per-room
      const activeCallRoomIds = new Set<string>();
      try {
        const lkRooms = await roomService.listRooms();
        for (const lkRoom of lkRooms) {
          if (lkRoom.name.startsWith('call:') && lkRoom.numParticipants > 0) {
            // Extract the room ID from "call:{roomId}"
            const roomId = lkRoom.name.slice(5);
            activeCallRoomIds.add(roomId);
          }
        }
      } catch {
        // LiveKit not available — all rooms show no active call
      }

      const roomList = rooms.map((room) => ({
        id: room.id,
        name: room.name,
        memberCount: room._count.memberships,
        hasActiveCall: activeCallRoomIds.has(room.id),
      }));

      return reply.send({ data: { rooms: roomList } });
    }
  );

  // ── PATCH /api/admin/rooms/:roomId ───────────────────
  // NOTE: room deletion is handled by the shared `DELETE /api/rooms/:roomId`
  // endpoint, which permits admin OR creator. No separate admin-only
  // delete endpoint — single auth path, smaller API surface.
  fastify.patch(
    '/api/admin/rooms/:roomId',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { roomId } = request.params as { roomId: string };
      const { name } = request.body as { name?: string };

      if (!name || typeof name !== 'string') {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: 'Name is required' },
        });
      }

      const trimmedName = name.trim();
      const nameError = validateRoomName(trimmedName);
      if (nameError) {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: nameError },
        });
      }

      const room = await prisma.room.findUnique({
        where: { id: roomId },
      });

      if (!room) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }

      const updatedRoom = await prisma.room.update({
        where: { id: roomId },
        data: { name: trimmedName },
      });

      // Broadcast room.updated
      broadcast({
        type: 'room.updated' as any,
        payload: { roomId, roomName: updatedRoom.name },
      });

      return reply.send({
        data: { room: { id: updatedRoom.id, name: updatedRoom.name } },
      });
    }
  );

  // ── POST /api/admin/calls/end ────────────────────────
  fastify.post(
    '/api/admin/calls/end',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { scopeType, scopeId } = request.body as {
        scopeType?: string;
        scopeId?: string;
      };

      if (!scopeType || !scopeId) {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: 'scopeType and scopeId are required' },
        });
      }

      const livekitRoomName =
        scopeType === 'room'
          ? `call:${scopeId}`
          : `call:dm:${scopeId}`;

      try {
        await roomService.deleteRoom(livekitRoomName);
        // room_finished webhook will broadcast call.ended
      } catch (err) {
        // Room may not exist
        request.log.warn({ err, livekitRoomName }, 'Failed to force-end call');
      }

      return reply.send({ data: { ok: true } });
    }
  );

  // ── GET /api/admin/system ────────────────────────────
  fastify.get(
    '/api/admin/system',
    { preHandler: adminPreHandlers },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const [totalUsers, totalRooms] = await Promise.all([
        prisma.user.count(),
        prisma.room.count(),
      ]);

      const onlineUsers = getOnlineUserIds().length;

      // Active calls and screenshares: list LiveKit rooms once
      let activeCalls = 0;
      let activeScreenshares = 0;
      try {
        const lkRooms = await roomService.listRooms();
        activeCalls = lkRooms.filter((r) => r.name.startsWith('call:')).length;
        activeScreenshares = lkRooms.filter((r) => r.name.startsWith('ss:')).length;
      } catch {
        // LiveKit not available
      }

      // Upload storage size (approximate)
      let uploadSizeBytes = 0;
      {
        const { execFileSync } = await import('child_process');
        const uploadDir = process.env['UPLOAD_DIR'] || '/data/uploads';
        try {
          const duOutput = execFileSync('du', ['-sb', '--', uploadDir], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          uploadSizeBytes = parseInt(duOutput.split('\t')[0], 10) || 0;
        } catch {
          // du failed — dir may not exist
        }
      }

      // DB size (PostgreSQL)
      let dbSizeBytes = 0;
      try {
        const result = await prisma.$queryRaw<
          Array<{ pg_database_size: bigint }>
        >`SELECT pg_database_size(current_database())`;
        dbSizeBytes = Number(result[0]?.pg_database_size ?? 0);
      } catch {
        // Fallback: unknown
      }

      return reply.send({
        data: {
          totalUsers,
          onlineUsers,
          totalRooms,
          activeCalls,
          activeScreenshares,
          uploadSizeBytes,
          dbSizeBytes,
        },
      });
    }
  );
}
