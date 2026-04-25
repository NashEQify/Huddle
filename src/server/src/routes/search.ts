/**
 * Message Search Routes
 *
 * GET /api/messages/search — Full-text search across messages
 */

import type { FastifyInstance } from 'fastify';
import type {
  ApiResponse,
  MessageResponse,
} from '@huddle/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import {
  batchResolveAuthors,
  mapAttachments,
  aggregateReactions,
} from '../lib/message-utils.js';

// ── Routes ──────────────────────────────────────────────

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/messages/search?q=<query>&scopeType=room&scopeId=<id>&limit=50&offset=0
  fastify.get(
    '/api/messages/search',
    { preHandler: requireAuth },
    async (request, reply) => {
      const query = request.query as {
        q?: string;
        scopeType?: string;
        scopeId?: string;
        limit?: string;
        offset?: string;
      };

      const searchQuery = query.q?.trim();
      if (!searchQuery || searchQuery.length === 0) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Search query "q" is required' },
        });
      }

      if (searchQuery.length < 2) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Search query must be at least 2 characters' },
        });
      }

      const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 100);
      const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);

      const scopeType = query.scopeType;
      const scopeId = query.scopeId;

      // Build where clause based on scope
      interface WhereClause {
        content: { contains: string; mode: 'insensitive' };
        deletedAt: null;
        scopeType?: string;
        scopeId?: string | { in: string[] };
      }

      const where: WhereClause = {
        content: { contains: searchQuery, mode: 'insensitive' },
        deletedAt: null,
      };

      if (scopeType && scopeId) {
        // Scoped search: single room or DM
        if (scopeType !== 'room' && scopeType !== 'direct') {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'scopeType must be "room" or "direct"' },
          });
        }

        // Check access
        if (scopeType === 'room') {
          const membership = await prisma.groupMembership.findUnique({
            where: { roomId_userId: { roomId: scopeId, userId: request.userId } },
          });
          const state = membership?.state ?? 'not_joined';
          if (state === 'not_joined') {
            return reply.status(403).send({
              error: { code: 'FORBIDDEN', message: 'Join this room to search messages' },
            });
          }
        } else {
          const dm = await prisma.directConversation.findUnique({
            where: { id: scopeId },
            select: { participantAId: true, participantBId: true },
          });
          if (!dm || (dm.participantAId !== request.userId && dm.participantBId !== request.userId)) {
            return reply.status(403).send({
              error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation' },
            });
          }
        }

        where.scopeType = scopeType;
        where.scopeId = scopeId;
      } else {
        // Global search: search across all rooms user has joined/left + all DMs they participate in
        const [memberships, dms] = await Promise.all([
          prisma.groupMembership.findMany({
            where: {
              userId: request.userId,
              state: { in: ['joined', 'left'] },
            },
            select: { roomId: true },
          }),
          prisma.directConversation.findMany({
            where: {
              OR: [
                { participantAId: request.userId },
                { participantBId: request.userId },
              ],
            },
            select: { id: true },
          }),
        ]);

        const accessibleScopeIds = [
          ...memberships.map((m) => m.roomId),
          ...dms.map((d) => d.id),
        ];

        if (accessibleScopeIds.length === 0) {
          // User has no accessible scopes, return empty
          const response: ApiResponse<{ messages: SearchResult[]; total: number }> = {
            data: { messages: [], total: 0 },
          };
          return response;
        }

        where.scopeId = { in: accessibleScopeIds };
      }

      // Execute search
      const [messages, total] = await Promise.all([
        prisma.message.findMany({
          where,
          include: {
            author: {
              include: { profile: true },
            },
            attachments: {
              select: { id: true, filename: true, contentType: true, sizeBytes: true },
            },
            reactions: {
              select: { emoji: true, userId: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.message.count({ where }),
      ]);

      // Batch resolve authors
      const authorMap = await batchResolveAuthors(
        messages.map((m) => m.author)
      );

      // Look up room names for context
      const roomIds = [...new Set(
        messages
          .filter((m) => m.scopeType === 'room')
          .map((m) => m.scopeId)
      )];

      const rooms = roomIds.length > 0
        ? await prisma.room.findMany({
            where: { id: { in: roomIds } },
            select: { id: true, name: true },
          })
        : [];

      const roomNameMap = new Map(rooms.map((r) => [r.id, r.name]));

      const data: SearchResult[] = messages.map((m) => ({
        id: m.id,
        scopeType: m.scopeType as 'room' | 'direct',
        scopeId: m.scopeId,
        authorId: m.authorId,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        author: authorMap.get(m.authorId)!,
        attachments: m.attachments.length > 0 ? mapAttachments(m.attachments) : undefined,
        reactions: aggregateReactions(m.reactions),
        roomName: m.scopeType === 'room' ? roomNameMap.get(m.scopeId) ?? null : null,
      }));

      const response: ApiResponse<{ messages: SearchResult[]; total: number }> = {
        data: { messages: data, total },
      };

      return response;
    }
  );
}

// Extended message response with room name for search context
interface SearchResult extends MessageResponse {
  roomName: string | null;
}
