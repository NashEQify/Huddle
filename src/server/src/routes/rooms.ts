import type { FastifyInstance } from 'fastify';
import type { ApiResponse, RoomResponse, MembershipState } from '@huddle/shared';
import * as argon2 from 'argon2';
import { unlink } from 'fs/promises';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../ws/handler.js';
import { getAbsolutePath } from '../lib/uploads.js';
import { validateRoomName } from '../lib/validation.js';
import { roomService } from '../lib/livekit.js';

export async function roomRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/rooms
  // Returns all discoverable rooms + all rooms where the user has a membership
  fastify.get(
    '/api/rooms',
    { preHandler: requireAuth },
    async (request, _reply) => {
      const userId = request.userId;

      // Fetch all rooms that are either discoverable OR where the user has a membership
      const rooms = await prisma.room.findMany({
        where: {
          OR: [
            { discoverable: true },
            { memberships: { some: { userId } } },
          ],
        },
        include: {
          memberships: {
            where: { userId },
            select: { state: true },
          },
        },
        orderBy: { lastActivityAt: 'desc' },
      });

      const data: RoomResponse[] = rooms.map((room) => {
        const membership = room.memberships[0];
        return {
          id: room.id,
          name: room.name,
          discoverable: room.discoverable,
          hasPassword: room.passwordHash !== null,
          lastActivityAt: room.lastActivityAt.toISOString(),
          membership: membership
            ? (membership.state as MembershipState)
            : null,
          createdBy: room.createdBy,
        };
      });

      const response: ApiResponse<{ rooms: RoomResponse[] }> = {
        data: { rooms: data },
      };

      return response;
    }
  );

  // POST /api/rooms
  // Create a new room. Creator is auto-joined.
  fastify.post(
    '/api/rooms',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId;
      const body = request.body as { name?: string; discoverable?: boolean; password?: string };

      // Validate name (length + control-char rejection per spec 10.3)
      const name = body.name?.trim();
      if (!name) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Room name must be 1-50 characters',
          },
        });
      }
      const nameError = validateRoomName(name);
      if (nameError) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: nameError },
        });
      }

      // Validate and hash password if provided
      let passwordHash: string | null = null;
      if (body.password && body.password.trim().length > 0) {
        const pw = body.password.trim();
        if (pw.length < 4 || pw.length > 64) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Password must be 4-64 characters',
            },
          });
        }
        passwordHash = await argon2.hash(pw, { type: argon2.argon2id });
      }

      const discoverable = body.discoverable !== false; // default true

      const now = new Date();

      // Create room + auto-join creator in a transaction
      const room = await prisma.$transaction(async (tx) => {
        const newRoom = await tx.room.create({
          data: {
            name,
            discoverable,
            passwordHash,
            createdBy: userId,
            lastActivityAt: now,
          },
        });

        // Auto-join creator
        await tx.groupMembership.create({
          data: {
            roomId: newRoom.id,
            userId,
            state: 'joined',
            joinedAt: now,
          },
        });

        // System message: creator joined
        await tx.message.create({
          data: {
            scopeType: 'room',
            scopeId: newRoom.id,
            authorId: userId,
            content: '::system::joined',
          },
        });

        return newRoom;
      });

      // Broadcast room.created via WS
      broadcast({
        type: 'room.created',
        payload: {
          id: room.id,
          name: room.name,
          discoverable: room.discoverable,
          hasPassword: room.passwordHash !== null,
          lastActivityAt: room.lastActivityAt.toISOString(),
          createdBy: userId,
        },
      });

      const response: ApiResponse<{
        room: {
          id: string;
          name: string;
          discoverable: boolean;
          hasPassword: boolean;
          lastActivityAt: string;
        };
      }> = {
        data: {
          room: {
            id: room.id,
            name: room.name,
            discoverable: room.discoverable,
            hasPassword: room.passwordHash !== null,
            lastActivityAt: room.lastActivityAt.toISOString(),
          },
        },
      };

      return reply.status(201).send(response);
    }
  );

  // DELETE /api/rooms/:roomId
  // Hard-delete room. Allowed for admin OR room creator.
  fastify.delete(
    '/api/rooms/:roomId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { roomId } = request.params as { roomId: string };
      const userId = request.userId;

      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { id: true, createdBy: true },
      });

      if (!room) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }

      // Permission check: admin OR creator
      const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      const isAdmin = requester?.isAdmin === true;
      const isCreator = room.createdBy === userId;

      if (!isAdmin && !isCreator) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only the room creator or an admin can delete this room' },
        });
      }

      // Per spec 80.5 Delete Sequence steps 1-2: force-end the LiveKit
      // call + screenshare rooms BEFORE the DB transaction. Best-effort;
      // errors swallowed (the LiveKit room may not exist, which is fine).
      // Without this, active calls + screenshares lingered on the LiveKit
      // server after the DB row was removed (F-CSD-5002 / F-CSD-8002).
      //
      // C-002: Differentiate error severity. "not found" = benign (the
      // LiveKit room already ended naturally or never existed) → debug.
      // Other errors (LiveKit unreachable, auth failures) = incident that
      // can leave orphan LK rooms accumulating → error. We still proceed
      // with the DB-delete either way: blocking room deletion when LiveKit
      // is down would be worse UX than orphan LK rooms (which an operator
      // can cleanup manually once alerted by the .error log).
      //
      // F-CA-R1: The LiveKit TwirpError shape (livekit-server-sdk/dist/
      // TwirpRPC.ts) populates `err.status` unconditionally from the HTTP
      // response code but only populates `err.code` when the response's
      // Content-Type is strictly equal to "application/json". Proxies or
      // SDK variants that emit "application/json; charset=utf-8" break the
      // equality check and leave .code undefined — that's why the prior
      // single-path (code/regex) check was brittle. Checking .status === 404
      // first gives us the most reliable signal; .code and the regex
      // fallback remain for defense-in-depth against future SDK shape
      // changes.
      const isLivekitNotFound = (err: unknown): boolean => {
        const status = (err as { status?: number })?.status;
        const code = (err as { code?: string })?.code;
        return status === 404 || code === 'not_found' || /not.?found/i.test(String(err));
      };
      try {
        await roomService.deleteRoom(`call:${roomId}`);
      } catch (err) {
        if (isLivekitNotFound(err)) {
          request.log.debug({ roomId }, 'LiveKit call room not found on delete (expected)');
        } else {
          request.log.error({ err, roomId }, 'LiveKit call room delete failed — possible LiveKit outage');
        }
      }
      try {
        await roomService.deleteRoom(`ss:room:${roomId}`);
      } catch (err) {
        if (isLivekitNotFound(err)) {
          request.log.debug({ roomId }, 'LiveKit screenshare room not found on delete (expected)');
        } else {
          request.log.error({ err, roomId }, 'LiveKit screenshare room delete failed — possible LiveKit outage');
        }
      }

      // Query attachment file paths before deleting
      const attachments = await prisma.attachment.findMany({
        where: {
          message: { scopeType: 'room', scopeId: roomId },
        },
        select: { storagePath: true },
      });
      const filePaths = attachments.map((a) => a.storagePath).filter(Boolean);

      // Hard-delete in transaction: messages (cascade handles reactions+attachments in DB), memberships, room
      //
      // C-003: Handle P2025 RecordNotFound idempotently. A double-click on
      // the delete button (or any concurrent DELETE) will race: the second
      // request hits `prisma.room.delete` after the first already removed
      // the row → P2025 thrown → Fastify default error handler returns 500.
      // From the client's perspective the delete already succeeded, so a
      // 500 is misleading. Treat P2025 as idempotent success instead.
      try {
        await prisma.$transaction([
          prisma.message.deleteMany({ where: { scopeType: 'room', scopeId: roomId } }),
          prisma.groupMembership.deleteMany({ where: { roomId } }),
          prisma.room.delete({ where: { id: roomId } }),
        ]);
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
          // RecordNotFound — concurrent delete already removed the row.
          // File cleanup is skipped (the winning request has already
          // handled that side).
          //
          // F-CA-R2: Broadcast `room.deleted` even on the idempotent path.
          // If the winning request's broadcast was lost (client crash,
          // socket mid-rotation, network blip at the exact instant the
          // winner fanned out), sidebars on other clients can be left
          // showing a stale room entry forever. The client-side reducer
          // for `room.deleted` is idempotent (removes by roomId; already
          // absent = no-op), so re-broadcasting here is harmless at worst
          // and self-healing at best.
          request.log.info({ roomId }, 'Room already deleted (P2025) — returning idempotent success');
          broadcast({
            type: 'room.deleted',
            payload: { roomId },
          });
          const idempotentResponse: ApiResponse<{ deleted: true }> = {
            data: { deleted: true },
          };
          return idempotentResponse;
        }
        throw err;
      }

      // Delete files from disk (best-effort, ignore errors)
      for (const storagePath of filePaths) {
        unlink(getAbsolutePath(storagePath)).catch(() => {});
      }

      // Broadcast room.deleted
      broadcast({
        type: 'room.deleted',
        payload: { roomId },
      });

      const response: ApiResponse<{ deleted: true }> = {
        data: { deleted: true },
      };

      return response;
    }
  );

  // GET /api/rooms/:roomId/members
  // Returns all members of a room (for ActiveUsersStrip filtering)
  fastify.get(
    '/api/rooms/:roomId/members',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { roomId } = request.params as { roomId: string };

      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { discoverable: true },
      });
      if (!room) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }
      if (!room.discoverable) {
        const membership = await prisma.groupMembership.findUnique({
          where: { roomId_userId: { roomId, userId: request.userId } },
        });
        if (!membership || membership.state === 'not_joined') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Access denied' },
          });
        }
      }

      const memberships = await prisma.groupMembership.findMany({
        where: { roomId },
        select: { userId: true, state: true },
      });

      return {
        data: {
          members: memberships.map((m) => ({
            userId: m.userId,
            state: m.state,
          })),
        },
      };
    }
  );

  // PATCH /api/rooms/:roomId/password
  // Set, change, or remove room password. Allowed for admin OR room creator.
  fastify.patch(
    '/api/rooms/:roomId/password',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { roomId } = request.params as { roomId: string };
      const userId = request.userId;

      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { id: true, createdBy: true },
      });

      if (!room) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Room not found' },
        });
      }

      // Permission check: admin OR creator
      const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      const isAdmin = requester?.isAdmin === true;
      const isCreator = room.createdBy === userId;

      if (!isAdmin && !isCreator) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only the room creator or an admin can manage the password' },
        });
      }

      const body = request.body as { password?: string | null };

      let passwordHash: string | null = null;

      if (body.password && body.password.trim().length > 0) {
        const pw = body.password.trim();
        if (pw.length < 4 || pw.length > 64) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Password must be 4-64 characters',
            },
          });
        }
        passwordHash = await argon2.hash(pw, { type: argon2.argon2id });
      }

      await prisma.room.update({
        where: { id: roomId },
        data: { passwordHash },
      });

      const hasPassword = passwordHash !== null;

      // Broadcast room.updated
      broadcast({
        type: 'room.updated',
        payload: { roomId, hasPassword },
      });

      const response: ApiResponse<{ hasPassword: boolean }> = {
        data: { hasPassword },
      };

      return response;
    }
  );
}
