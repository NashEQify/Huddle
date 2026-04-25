import type { FastifyInstance } from 'fastify';
import type {
  ApiResponse,
  MessageResponse,
  AttachmentResponse,
  MessageAuthor,
  UserProfileResponse,
} from '@huddle/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast, broadcastToUsers, sendToUser } from '../ws/handler.js';
import {
  validateFile,
  validateFileCount,
  storeFile,
  sanitizeFilename,
  attachmentUrl,
} from '../lib/uploads.js';
import {
  batchResolveAuthors,
  mapAttachments,
  aggregateReactions,
} from '../lib/message-utils.js';

// ── Helper: find or create DirectConversation ───────────
// Always store the lexicographically smaller user ID as participantA

function sortParticipants(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function findDirectConversation(userId: string, otherUserId: string) {
  const [pA, pB] = sortParticipants(userId, otherUserId);
  return prisma.directConversation.findUnique({
    where: { participantAId_participantBId: { participantAId: pA, participantBId: pB } },
  });
}

async function createDirectConversation(userId: string, otherUserId: string) {
  const [pA, pB] = sortParticipants(userId, otherUserId);
  return prisma.directConversation.create({
    data: {
      participantAId: pA,
      participantBId: pB,
    },
  });
}

async function isDirectParticipant(directId: string, userId: string): Promise<boolean> {
  const dm = await prisma.directConversation.findUnique({
    where: { id: directId },
    select: { participantAId: true, participantBId: true },
  });
  if (!dm) return false;
  return dm.participantAId === userId || dm.participantBId === userId;
}

// ── Helper: resolve author with avatar URL ──────────────

async function resolveAuthor(
  author: {
    id: string;
    username: string;
    profile: {
      title: string;
      avatarKind: string;
      builtInAvatarId: string | null;
      portraitUrl: string | null;
    } | null;
  }
): Promise<MessageAuthor> {
  let profile: UserProfileResponse | null = null;
  if (author.profile) {
    let builtInAvatarUrl: string | null = null;
    let builtInAvatarLabel: string | null = null;
    if (author.profile.builtInAvatarId) {
      const avatar = await prisma.builtInAvatar.findUnique({
        where: { id: author.profile.builtInAvatarId },
        select: { imageUrl: true, label: true },
      });
      builtInAvatarUrl = avatar?.imageUrl ?? null;
      builtInAvatarLabel = avatar?.label ?? null;
    }
    profile = {
      title: author.profile.title,
      avatarKind: author.profile.avatarKind as 'built_in' | 'uploaded',
      builtInAvatarId: author.profile.builtInAvatarId,
      builtInAvatarUrl,
      builtInAvatarLabel,
      portraitUrl: author.profile.portraitUrl,
    };
  }
  return {
    id: author.id,
    username: author.username,
    profile,
  };
}

// ── Helper: truncate string ──────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

// ── Helper: map DB message to v2 MessageResponse ────────

type DbMessageWithIncludes = {
  id: string;
  scopeType: string;
  scopeId: string;
  authorId: string;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  editedAt: Date | null;
  editedBy: string | null;
  author: {
    id: string;
    username: string;
    profile: {
      title: string;
      avatarKind: string;
      builtInAvatarId: string | null;
      portraitUrl: string | null;
    } | null;
  };
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }>;
  reactions: Array<{ emoji: string; userId: string }>;
  replyTo: {
    id: string;
    authorId: string;
    content: string;
    deletedAt: Date | null;
    author: {
      id: string;
      username: string;
      profile: {
        title: string;
        avatarKind: string;
        builtInAvatarId: string | null;
        portraitUrl: string | null;
      } | null;
    };
  } | null;
};

function mapMessageToResponse(
  m: DbMessageWithIncludes,
  authorMap: Map<string, MessageAuthor>,
  replyAuthorMap?: Map<string, MessageAuthor>,
): MessageResponse {
  const isTombstone = m.deletedAt !== null;

  // Build replyTo
  let replyTo: MessageResponse['replyTo'] = undefined;
  if (m.replyTo) {
    const rt = m.replyTo;
    const rtAuthor = replyAuthorMap?.get(rt.authorId) ?? authorMap.get(rt.authorId);
    const rtIsTombstone = rt.deletedAt !== null;
    if (rtAuthor) {
      replyTo = {
        id: rt.id,
        authorId: rt.authorId,
        author: rtAuthor,
        content: rtIsTombstone ? null : truncate(rt.content, 120),
        ...(rtIsTombstone ? { deletedAt: rt.deletedAt!.toISOString() } : {}),
      };
    }
  }

  return {
    id: m.id,
    scopeType: m.scopeType as 'room' | 'direct',
    scopeId: m.scopeId,
    authorId: m.authorId,
    content: isTombstone ? null : m.content,
    createdAt: m.createdAt.toISOString(),
    author: authorMap.get(m.authorId)!,
    attachments: isTombstone ? [] : (m.attachments.length > 0 ? mapAttachments(m.attachments) : undefined),
    reactions: aggregateReactions(m.reactions),
    ...(m.deletedAt ? { deletedAt: m.deletedAt.toISOString() } : {}),
    ...(m.editedAt && !isTombstone ? { editedAt: m.editedAt.toISOString(), editedBy: m.editedBy ?? undefined } : {}),
    ...(replyTo !== undefined ? { replyTo } : {}),
  };
}

// ── Routes ──────────────────────────────────────────────

export async function messageRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/messages?scopeType=room&scopeId={id}&before={timestamp}&limit=50
  fastify.get(
    '/api/messages',
    { preHandler: requireAuth },
    async (request, reply) => {
      const query = request.query as {
        scopeType?: string;
        scopeId?: string;
        before?: string;
        limit?: string;
      };

      const scopeType = query.scopeType;
      const scopeId = query.scopeId;

      if (!scopeType || !scopeId) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'scopeType and scopeId are required' },
        });
      }

      if (scopeType !== 'room' && scopeType !== 'direct') {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'scopeType must be "room" or "direct"' },
        });
      }

      // Membership check for rooms
      if (scopeType === 'room') {
        const membership = await prisma.groupMembership.findUnique({
          where: { roomId_userId: { roomId: scopeId, userId: request.userId } },
        });

        const state = membership?.state ?? 'not_joined';

        if (state === 'not_joined') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Join this room to see messages' },
          });
        }
      }

      // Participant check for DMs
      if (scopeType === 'direct') {
        const isParticipant = await isDirectParticipant(scopeId, request.userId);
        if (!isParticipant) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation' },
          });
        }
      }

      const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 100);
      const beforeDate = query.before ? new Date(query.before) : undefined;

      const where: {
        scopeType: string;
        scopeId: string;
        createdAt?: { lt: Date };
      } = {
        scopeType,
        scopeId,
      };

      if (beforeDate && !isNaN(beforeDate.getTime())) {
        where.createdAt = { lt: beforeDate };
      }

      // Fetch limit + 1 to determine hasMore
      const messages = await prisma.message.findMany({
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
          replyTo: {
            include: {
              author: { include: { profile: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      });

      const hasMore = messages.length > limit;
      const resultMessages = hasMore ? messages.slice(0, limit) : messages;

      // Batch resolve authors (message authors + replyTo authors)
      const allAuthors = [
        ...resultMessages.map((m) => m.author),
        ...resultMessages
          .filter((m) => m.replyTo)
          .map((m) => m.replyTo!.author),
      ];
      const authorMap = await batchResolveAuthors(allAuthors);

      // Reverse to chronological order (oldest first)
      const data: MessageResponse[] = resultMessages
        .reverse()
        .map((m) => mapMessageToResponse(m as DbMessageWithIncludes, authorMap));

      const response: ApiResponse<{ messages: MessageResponse[]; hasMore: boolean }> = {
        data: { messages: data, hasMore },
      };

      return response;
    }
  );

  // GET /api/messages/since — missed message recovery after WS reconnect
  // Returns messages newer than a given timestamp for a specific scope
  fastify.get(
    '/api/messages/since',
    { preHandler: requireAuth },
    async (request, reply) => {
      const query = request.query as {
        scope?: string; // "room:{id}" or "direct:{id}"
        after?: string; // ISO timestamp
      };

      if (!query.scope || !query.after) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'scope and after are required' },
        });
      }

      const [scopeType, scopeId] = query.scope.split(':', 2);
      if (!scopeType || !scopeId || (scopeType !== 'room' && scopeType !== 'direct')) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'scope must be "room:{id}" or "direct:{id}"' },
        });
      }

      const afterDate = new Date(query.after);
      if (isNaN(afterDate.getTime())) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'after must be a valid ISO timestamp' },
        });
      }

      // Membership/participant check
      if (scopeType === 'room') {
        const membership = await prisma.groupMembership.findUnique({
          where: { roomId_userId: { roomId: scopeId, userId: request.userId } },
        });
        if (!membership || membership.state === 'not_joined') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Join this room to see messages' },
          });
        }
      } else {
        const isParticipant = await isDirectParticipant(scopeId, request.userId);
        if (!isParticipant) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation' },
          });
        }
      }

      // Fetch messages newer than the timestamp, max 200
      const messages = await prisma.message.findMany({
        where: {
          scopeType,
          scopeId,
          createdAt: { gt: afterDate },
        },
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
          replyTo: {
            include: {
              author: { include: { profile: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });

      const allAuthors = [
        ...messages.map((m) => m.author),
        ...messages
          .filter((m) => m.replyTo)
          .map((m) => m.replyTo!.author),
      ];
      const authorMap = await batchResolveAuthors(allAuthors);

      const data: MessageResponse[] = messages.map((m) =>
        mapMessageToResponse(m as DbMessageWithIncludes, authorMap)
      );

      const response: ApiResponse<{ messages: MessageResponse[] }> = {
        data: { messages: data },
      };

      return response;
    }
  );

  // POST /api/messages — accepts JSON or multipart/form-data (with files)
  fastify.post(
    '/api/messages',
    { preHandler: requireAuth },
    async (request, reply) => {
      let scopeType: string | undefined;
      let scopeId: string | undefined;
      let content: string | undefined;
      let replyToId: string | undefined;

      // Parsed file buffers for multipart
      const fileBuffers: Array<{
        buffer: Buffer;
        filename: string;
        contentType: string;
      }> = [];

      // Determine if this is a multipart request
      const contentType = request.headers['content-type'] ?? '';
      const isMultipart = contentType.includes('multipart/form-data');

      if (isMultipart) {
        // Parse multipart form data
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'field') {
            const value = (part as any).value as string;
            if (part.fieldname === 'scopeType') scopeType = value;
            else if (part.fieldname === 'scopeId') scopeId = value;
            else if (part.fieldname === 'content') content = value;
            else if (part.fieldname === 'replyToId') replyToId = value;
          } else if (part.type === 'file') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) {
              chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            // Skip empty file parts
            if (buffer.length > 0) {
              fileBuffers.push({
                buffer,
                filename: part.filename ?? 'unnamed',
                contentType: part.mimetype ?? 'application/octet-stream',
              });
            }
          }
        }
      } else {
        // JSON body
        const body = request.body as {
          scopeType?: string;
          scopeId?: string;
          content?: string;
          replyToId?: string;
        };
        scopeType = body.scopeType;
        scopeId = body.scopeId;
        content = body.content;
        replyToId = body.replyToId;
      }

      // Must have either content or files
      if (!scopeType || !scopeId) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'scopeType and scopeId are required' },
        });
      }

      const hasContent = content && content.trim().length > 0;
      const hasFiles = fileBuffers.length > 0;

      if (!hasContent && !hasFiles) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Message must have content or attachments' },
        });
      }

      if (scopeType !== 'room' && scopeType !== 'direct') {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'scopeType must be "room" or "direct"' },
        });
      }

      const trimmedContent = content?.trim() ?? '';
      if (trimmedContent.length > 10000) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Message content must be under 10000 characters' },
        });
      }

      // Content guard: reject ::system:: prefix
      if (trimmedContent.startsWith('::system::')) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Reserved message prefix' },
        });
      }

      // Validate file count
      if (hasFiles) {
        const countErr = validateFileCount(fileBuffers.length);
        if (countErr) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: countErr.message },
          });
        }

        // Validate each file
        for (const f of fileBuffers) {
          const err = validateFile(f.buffer, f.contentType, f.filename);
          if (err) {
            return reply.status(400).send({
              error: { code: 'VALIDATION_ERROR', message: err.message },
            });
          }
        }
      }

      let actualScopeId = scopeId;
      let directId: string | undefined;

      // Membership check for rooms
      if (scopeType === 'room') {
        const membership = await prisma.groupMembership.findUnique({
          where: { roomId_userId: { roomId: scopeId, userId: request.userId } },
        });

        if (!membership || membership.state !== 'joined') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'You must be a joined member to send messages' },
          });
        }
      }

      // DM handling: lazy creation with "new:{otherUserId}" pattern
      if (scopeType === 'direct') {
        if (scopeId.startsWith('new:')) {
          const otherUserId = scopeId.slice(4);

          const otherUser = await prisma.user.findUnique({
            where: { id: otherUserId },
            select: { id: true, isActive: true },
          });
          if (!otherUser || !otherUser.isActive) {
            return reply.status(404).send({
              error: { code: 'NOT_FOUND', message: 'User not found' },
            });
          }

          if (otherUserId === request.userId) {
            return reply.status(400).send({
              error: { code: 'VALIDATION_ERROR', message: 'Cannot send a DM to yourself' },
            });
          }

          let dm = await findDirectConversation(request.userId, otherUserId);
          if (!dm) {
            try {
              dm = await createDirectConversation(request.userId, otherUserId);
            } catch (err: any) {
              if (err?.code === 'P2002') {
                dm = await findDirectConversation(request.userId, otherUserId);
                if (!dm) throw err;
              } else {
                throw err;
              }
            }
          }
          actualScopeId = dm.id;
          directId = dm.id;
        } else {
          const isParticipant = await isDirectParticipant(scopeId, request.userId);
          if (!isParticipant) {
            return reply.status(403).send({
              error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation' },
            });
          }
        }
      }

      // Validate replyToId if provided
      if (replyToId) {
        const replyTarget = await prisma.message.findUnique({
          where: { id: replyToId },
          select: { id: true, scopeType: true, scopeId: true },
        });
        if (!replyTarget) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Reply target message not found' },
          });
        }
        if (replyTarget.scopeType !== scopeType || replyTarget.scopeId !== actualScopeId) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Cannot reply to a message in a different scope' },
          });
        }
      }

      // Create message
      const message = await prisma.message.create({
        data: {
          scopeType,
          scopeId: actualScopeId,
          authorId: request.userId,
          content: trimmedContent,
          ...(replyToId ? { replyToId } : {}),
        },
        include: {
          author: {
            include: { profile: true },
          },
          replyTo: {
            include: {
              author: { include: { profile: true } },
            },
          },
        },
      });

      // Store files and create attachment records
      const attachmentRecords: AttachmentResponse[] = [];
      if (hasFiles) {
        for (const f of fileBuffers) {
          const sanitized = sanitizeFilename(f.filename);

          // Create DB record first (need the ID for storage path)
          const attachment = await prisma.attachment.create({
            data: {
              messageId: message.id,
              filename: sanitized,
              contentType: f.contentType,
              sizeBytes: f.buffer.length,
              storagePath: '', // temp, updated after store
            },
          });

          // Store file on disk
          let storagePath: string;
          try {
            storagePath = await storeFile(attachment.id, sanitized, f.buffer);
          } catch (err) {
            // Clean up orphaned attachment record
            await prisma.attachment.delete({ where: { id: attachment.id } }).catch(() => {});
            throw err;
          }

          // Update storage path
          await prisma.attachment.update({
            where: { id: attachment.id },
            data: { storagePath },
          });

          attachmentRecords.push({
            id: attachment.id,
            filename: sanitized,
            contentType: f.contentType,
            sizeBytes: f.buffer.length,
            url: attachmentUrl(attachment.id, sanitized),
          });
        }
      }

      // Update lastActivityAt
      if (scopeType === 'room') {
        await prisma.room.update({
          where: { id: actualScopeId },
          data: { lastActivityAt: new Date() },
        }).catch(() => {});
      } else if (scopeType === 'direct') {
        await prisma.directConversation.update({
          where: { id: actualScopeId },
          data: { lastActivityAt: new Date() },
        }).catch(() => {});
      }

      // Resolve author for response
      const author = await resolveAuthor(message.author);

      // Build replyTo for response
      let replyToData: MessageResponse['replyTo'] = undefined;
      if (message.replyTo) {
        const rt = message.replyTo;
        const rtAuthor = await resolveAuthor(rt.author);
        const isTombstone = rt.deletedAt !== null;
        replyToData = {
          id: rt.id,
          authorId: rt.authorId,
          author: rtAuthor,
          content: isTombstone ? null : truncate(rt.content, 120),
          ...(isTombstone ? { deletedAt: rt.deletedAt!.toISOString() } : {}),
        };
      }

      const messageResponse: MessageResponse = {
        id: message.id,
        scopeType: message.scopeType as 'room' | 'direct',
        scopeId: message.scopeId,
        authorId: message.authorId,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        author,
        attachments: attachmentRecords.length > 0 ? attachmentRecords : undefined,
        ...(replyToData ? { replyTo: replyToData } : {}),
      };

      // Broadcast message.new
      // Per CGL-002 + spec overview.md Invariant E: membership states bestimmen
      // Zugriff auf alles. Real-time broadcast nur an Users mit state='joined'.
      // Left/not_joined users behalten Read-Access auf History (on pull), bekommen
      // aber keinen Push. Trust-based + Cloudflare Access ist die aeussere Schicht,
      // aber die Invariant wird server-side enforced.
      if (scopeType === 'direct') {
        const dm = await prisma.directConversation.findUnique({
          where: { id: actualScopeId },
          select: { participantAId: true, participantBId: true },
        });
        if (dm) {
          sendToUser(dm.participantAId, { type: 'message.new', payload: messageResponse });
          sendToUser(dm.participantBId, { type: 'message.new', payload: messageResponse });
        }
      } else {
        const joinedMemberships = await prisma.groupMembership.findMany({
          where: { roomId: actualScopeId, state: 'joined' },
          select: { userId: true },
        });
        const memberIds = joinedMemberships.map((m) => m.userId);
        broadcastToUsers(memberIds, {
          type: 'message.new',
          payload: messageResponse,
        });
      }

      const response: ApiResponse<{ message: MessageResponse; directId?: string }> = {
        data: { message: messageResponse, ...(directId ? { directId } : {}) },
      };

      return reply.status(201).send(response);
    }
  );

  // ── DELETE /api/messages/:messageId — soft-delete ──────

  fastify.delete(
    '/api/messages/:messageId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { messageId } = request.params as { messageId: string };
      const userId = request.userId;

      const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          authorId: true,
          content: true,
          scopeType: true,
          scopeId: true,
          createdAt: true,
          deletedAt: true,
        },
      });

      if (!message) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }

      // Already deleted
      if (message.deletedAt) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Message is already deleted' },
        });
      }

      // System messages cannot be deleted
      if (message.content.startsWith('::system::')) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'System messages cannot be deleted' },
        });
      }

      // Check if user is admin
      const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      const isAdmin = requester?.isAdmin === true;

      // Permission check
      if (!isAdmin) {
        // Must be the author
        if (message.authorId !== userId) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'You can only delete your own messages' },
          });
        }

        // Membership gate: must be joined for room scope
        if (message.scopeType === 'room') {
          const membership = await prisma.groupMembership.findUnique({
            where: { roomId_userId: { roomId: message.scopeId, userId } },
          });
          if (!membership || membership.state !== 'joined') {
            return reply.status(403).send({
              error: { code: 'FORBIDDEN', message: 'You must be a joined member to delete messages' },
            });
          }
        }

        // 3-minute window check
        const threeMinMs = 3 * 60 * 1000;
        const elapsed = Date.now() - message.createdAt.getTime();
        if (elapsed > threeMinMs) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'time window expired' },
          });
        }
      }

      // Soft-delete
      await prisma.message.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          deletedBy: userId,
        },
      });

      // WS broadcast
      const wsPayload = {
        messageId: message.id,
        scopeType: message.scopeType as 'room' | 'direct',
        scopeId: message.scopeId,
      };

      if (message.scopeType === 'direct') {
        const dm = await prisma.directConversation.findUnique({
          where: { id: message.scopeId },
          select: { participantAId: true, participantBId: true },
        });
        if (dm) {
          sendToUser(dm.participantAId, { type: 'message.deleted', payload: wsPayload });
          sendToUser(dm.participantBId, { type: 'message.deleted', payload: wsPayload });
        }
      } else {
        // CGL-002: membership-filtered broadcast for room scope
        const joined = await prisma.groupMembership.findMany({
          where: { roomId: message.scopeId, state: 'joined' },
          select: { userId: true },
        });
        broadcastToUsers(
          joined.map((m) => m.userId),
          { type: 'message.deleted', payload: wsPayload },
        );
      }

      const response: ApiResponse<{ deleted: true; messageId: string }> = {
        data: { deleted: true, messageId: message.id },
      };

      return response;
    }
  );

  // ── PATCH /api/messages/:messageId — edit message ──────

  fastify.patch(
    '/api/messages/:messageId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { messageId } = request.params as { messageId: string };
      const userId = request.userId;
      const body = request.body as { content?: string };

      const newContent = body.content?.trim();

      if (!newContent || newContent.length === 0) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Content must not be empty' },
        });
      }

      if (newContent.length > 10000) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Message content must be under 10000 characters' },
        });
      }

      // Content guard
      if (newContent.startsWith('::system::')) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Reserved message prefix' },
        });
      }

      const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          authorId: true,
          content: true,
          scopeType: true,
          scopeId: true,
          createdAt: true,
          deletedAt: true,
        },
      });

      if (!message) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }

      // Tombstone cannot be edited
      if (message.deletedAt) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Deleted messages cannot be edited' },
        });
      }

      // System messages cannot be edited
      if (message.content.startsWith('::system::')) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'System messages cannot be edited' },
        });
      }

      // Check if user is admin
      const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      const isAdmin = requester?.isAdmin === true;

      // Permission check
      if (!isAdmin) {
        if (message.authorId !== userId) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'You can only edit your own messages' },
          });
        }

        // Membership gate
        if (message.scopeType === 'room') {
          const membership = await prisma.groupMembership.findUnique({
            where: { roomId_userId: { roomId: message.scopeId, userId } },
          });
          if (!membership || membership.state !== 'joined') {
            return reply.status(403).send({
              error: { code: 'FORBIDDEN', message: 'You must be a joined member to edit messages' },
            });
          }
        }

        // 3-minute window
        const threeMinMs = 3 * 60 * 1000;
        const elapsed = Date.now() - message.createdAt.getTime();
        if (elapsed > threeMinMs) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'time window expired' },
          });
        }
      }

      // Update message
      const updated = await prisma.message.update({
        where: { id: messageId },
        data: {
          content: newContent,
          editedAt: new Date(),
          editedBy: userId,
        },
        include: {
          author: { include: { profile: true } },
          attachments: {
            select: { id: true, filename: true, contentType: true, sizeBytes: true },
          },
          reactions: {
            select: { emoji: true, userId: true },
          },
          replyTo: {
            include: {
              author: { include: { profile: true } },
            },
          },
        },
      });

      const allAuthors = [
        updated.author,
        ...(updated.replyTo ? [updated.replyTo.author] : []),
      ];
      const authorMap = await batchResolveAuthors(allAuthors);

      const messageResponse = mapMessageToResponse(
        updated as unknown as DbMessageWithIncludes,
        authorMap,
      );

      // WS broadcast
      const wsPayload = {
        messageId: updated.id,
        scopeType: updated.scopeType as 'room' | 'direct',
        scopeId: updated.scopeId,
        content: newContent,
        editedAt: updated.editedAt!.toISOString(),
        editedBy: userId,
      };

      if (message.scopeType === 'direct') {
        const dm = await prisma.directConversation.findUnique({
          where: { id: message.scopeId },
          select: { participantAId: true, participantBId: true },
        });
        if (dm) {
          sendToUser(dm.participantAId, { type: 'message.edited', payload: wsPayload });
          sendToUser(dm.participantBId, { type: 'message.edited', payload: wsPayload });
        }
      } else {
        // CGL-002: membership-filtered broadcast for room scope
        const joined = await prisma.groupMembership.findMany({
          where: { roomId: message.scopeId, state: 'joined' },
          select: { userId: true },
        });
        broadcastToUsers(
          joined.map((m) => m.userId),
          { type: 'message.edited', payload: wsPayload },
        );
      }

      const response: ApiResponse<{ message: MessageResponse }> = {
        data: { message: messageResponse },
      };

      return response;
    }
  );

  // ── Media Gallery ────────────────────────────────────────
  // GET /api/messages/media?scopeType=room&scopeId={id}&type=images|files&cursor=&limit=50

  fastify.get(
    '/api/messages/media',
    { preHandler: requireAuth },
    async (request, reply) => {
      const query = request.query as {
        scopeType?: string;
        scopeId?: string;
        type?: string;
        cursor?: string;
        limit?: string;
      };

      const scopeType = query.scopeType;
      const scopeId = query.scopeId;
      const mediaType = query.type; // 'images' or 'files'

      if (!scopeType || !scopeId) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'scopeType and scopeId are required' },
        });
      }

      if (scopeType !== 'room' && scopeType !== 'direct') {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'scopeType must be "room" or "direct"' },
        });
      }

      if (mediaType && mediaType !== 'images' && mediaType !== 'files') {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'type must be "images" or "files"' },
        });
      }

      // Membership check for rooms
      if (scopeType === 'room') {
        const membership = await prisma.groupMembership.findUnique({
          where: { roomId_userId: { roomId: scopeId, userId: request.userId } },
        });
        if ((membership?.state ?? 'not_joined') === 'not_joined') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Join this room to see media' },
          });
        }
      }

      // Participant check for DMs
      if (scopeType === 'direct') {
        const isParticipant = await isDirectParticipant(scopeId, request.userId);
        if (!isParticipant) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation' },
          });
        }
      }

      const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 100);
      const cursorDate = query.cursor ? new Date(query.cursor) : undefined;

      // Build content type filter
      const contentTypeFilter = mediaType === 'images'
        ? { startsWith: 'image/' }
        : mediaType === 'files'
          ? { not: { startsWith: 'image/' } }
          : undefined;

      const attachments = await prisma.attachment.findMany({
        where: {
          message: {
            scopeType,
            scopeId,
            deletedAt: null,
          },
          ...(contentTypeFilter ? { contentType: contentTypeFilter } : {}),
          ...(cursorDate && !isNaN(cursorDate.getTime())
            ? { createdAt: { lt: cursorDate } }
            : {}),
        },
        include: {
          message: {
            include: {
              author: { include: { profile: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      });

      const hasMore = attachments.length > limit;
      const results = hasMore ? attachments.slice(0, limit) : attachments;

      const items = results.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        url: attachmentUrl(a.id, a.filename),
        authorUsername: a.message.author.username,
        createdAt: a.createdAt.toISOString(),
      }));

      const nextCursor = hasMore && results.length > 0
        ? results[results.length - 1]!.createdAt.toISOString()
        : null;

      return {
        data: {
          items,
          nextCursor,
        },
      };
    }
  );
}
