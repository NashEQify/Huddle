/**
 * Emoji Reactions routes — toggle reactions on messages.
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse, ReactionGroup } from '@huddle/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast, broadcastToUsers, sendToUser } from '../ws/handler.js';

// Curated emoji set (spec 30.5)
const ALLOWED_EMOJIS = new Set([
  '\u{1F44D}', // 👍
  '\u{1F44E}', // 👎
  '\u{2764}\u{FE0F}', // ❤️
  '\u{1F602}', // 😂
  '\u{1F62D}', // 😭
  '\u{1F525}', // 🔥
  '\u{1F480}', // 💀
  '\u{1F624}', // 😤
  '\u{1F914}', // 🤔
  '\u{1F60E}', // 😎
  '\u{1FAE1}', // 🫡
  '\u{1F921}', // 🤡
  '\u{1F631}', // 😱
  '\u{1F3AE}', // 🎮
  '\u{2694}\u{FE0F}', // ⚔️
  '\u{1F3C6}', // 🏆
  '\u{1F3AF}', // 🎯
  '\u{1F4AF}', // 💯
  '\u{1F346}', // 🍆
  '\u{1F5FF}', // 🗿
  '\u{1F440}', // 👀
  '\u{1F4A9}', // 💩
]);

const MAX_REACTIONS_PER_USER_PER_MESSAGE = 10;

/**
 * Aggregate reactions for a message into ReactionGroup[]
 */
async function getReactionGroups(messageId: string): Promise<ReactionGroup[]> {
  const reactions = await prisma.reaction.findMany({
    where: { messageId },
    select: { emoji: true, userId: true },
    orderBy: { emoji: 'asc' },
  });

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

export async function reactionRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/messages/:messageId/reactions — toggle a reaction
  fastify.post(
    '/api/messages/:messageId/reactions',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { messageId } = request.params as { messageId: string };
      const { emoji } = request.body as { emoji?: string };

      if (!emoji) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'emoji is required' },
        });
      }

      // Validate emoji is in the allowed set
      if (!ALLOWED_EMOJIS.has(emoji)) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Emoji not allowed' },
        });
      }

      // Check message exists
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, scopeType: true, scopeId: true },
      });

      if (!message) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }

      // Check membership/participation
      if (message.scopeType === 'room') {
        const membership = await prisma.groupMembership.findUnique({
          where: { roomId_userId: { roomId: message.scopeId, userId: request.userId } },
        });
        if (!membership || membership.state !== 'joined') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'You must be a joined member to react' },
          });
        }
      } else if (message.scopeType === 'direct') {
        const dm = await prisma.directConversation.findUnique({
          where: { id: message.scopeId },
          select: { participantAId: true, participantBId: true },
        });
        if (!dm || (dm.participantAId !== request.userId && dm.participantBId !== request.userId)) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation' },
          });
        }
      }

      // Toggle reaction in a transaction to prevent race conditions
      let action: 'add' | 'remove';
      try {
        action = await prisma.$transaction(async (tx) => {
          const existing = await tx.reaction.findUnique({
            where: {
              messageId_userId_emoji: {
                messageId,
                userId: request.userId,
                emoji,
              },
            },
          });

          if (existing) {
            await tx.reaction.delete({
              where: {
                messageId_userId_emoji: {
                  messageId,
                  userId: request.userId,
                  emoji,
                },
              },
            });
            return 'remove' as const;
          }

          // Check max reactions per user per message
          const count = await tx.reaction.count({
            where: { messageId, userId: request.userId },
          });
          if (count >= MAX_REACTIONS_PER_USER_PER_MESSAGE) {
            throw new Error('TOO_MANY_REACTIONS');
          }

          await tx.reaction.create({
            data: {
              messageId,
              userId: request.userId,
              emoji,
            },
          });
          return 'add' as const;
        });
      } catch (err: any) {
        if (err?.message === 'TOO_MANY_REACTIONS') {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: `Maximum ${MAX_REACTIONS_PER_USER_PER_MESSAGE} reactions per message`,
            },
          });
        }
        if (err?.code === 'P2002') {
          // Idempotent — reaction already exists
          action = 'add';
        } else {
          throw err;
        }
      }

      // Get updated reaction groups
      const reactions = await getReactionGroups(messageId);

      // Broadcast the reaction event
      const reactionPayload = {
        messageId,
        scopeType: message.scopeType,
        scopeId: message.scopeId,
        emoji,
        userId: request.userId,
        action,
        reactions,
      };

      if (message.scopeType === 'direct') {
        const dm = await prisma.directConversation.findUnique({
          where: { id: message.scopeId },
          select: { participantAId: true, participantBId: true },
        });
        if (dm) {
          sendToUser(dm.participantAId, { type: 'message.reaction', payload: reactionPayload });
          sendToUser(dm.participantBId, { type: 'message.reaction', payload: reactionPayload });
        }
      } else {
        // CGL-002 scope expansion: membership-filtered broadcast for room reactions.
        // Same invariant as message.new — only joined members see room content in
        // real-time.
        const joined = await prisma.groupMembership.findMany({
          where: { roomId: message.scopeId, state: 'joined' },
          select: { userId: true },
        });
        broadcastToUsers(
          joined.map((m) => m.userId),
          { type: 'message.reaction', payload: reactionPayload },
        );
      }

      const response: ApiResponse<{ action: string; reactions: ReactionGroup[] }> = {
        data: { action, reactions },
      };

      return reply.status(200).send(response);
    }
  );
}

export { getReactionGroups };
