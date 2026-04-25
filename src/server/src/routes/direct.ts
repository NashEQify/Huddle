import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@huddle/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

function sortParticipants(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function directRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/direct/:otherUserId
  // Returns the DirectConversation between the current user and otherUserId.
  // Creates the DirectConversation if it doesn't exist yet, so that call/screenshare
  // controls are available before the first message is sent.
  fastify.get(
    '/api/direct/:otherUserId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { otherUserId } = request.params as { otherUserId: string };
      const userId = request.userId;

      if (otherUserId === userId) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'Cannot look up DM with yourself' },
        });
      }

      const [pA, pB] = sortParticipants(userId, otherUserId);
      let dm = await prisma.directConversation.findUnique({
        where: { participantAId_participantBId: { participantAId: pA, participantBId: pB } },
      });

      if (!dm) {
        try {
          dm = await prisma.directConversation.create({
            data: {
              participantAId: pA,
              participantBId: pB,
            },
          });
        } catch (err: any) {
          if (err?.code === 'P2002') {
            // Lost the race — the other request already created it
            dm = await prisma.directConversation.findFirst({
              where: { participantAId: pA, participantBId: pB },
            });
            if (!dm) throw err;
          } else {
            throw err;
          }
        }
      }

      const response: ApiResponse<{ directId: string | null }> = {
        data: { directId: dm.id },
      };

      return response;
    }
  );

  // GET /api/direct
  // Returns all DirectConversations the current user is a participant in.
  fastify.get(
    '/api/direct',
    { preHandler: requireAuth },
    async (request, _reply) => {
      const userId = request.userId;

      const conversations = await prisma.directConversation.findMany({
        where: {
          OR: [
            { participantAId: userId },
            { participantBId: userId },
          ],
        },
        include: {
          participantA: {
            select: { id: true, username: true },
          },
          participantB: {
            select: { id: true, username: true },
          },
        },
        orderBy: { lastActivityAt: 'desc' },
      });

      const data = conversations.map((dm) => ({
        id: dm.id,
        otherUser: dm.participantAId === userId
          ? dm.participantB
          : dm.participantA,
        lastActivityAt: dm.lastActivityAt.toISOString(),
      }));

      const response: ApiResponse<{ conversations: typeof data }> = {
        data: { conversations: data },
      };

      return response;
    }
  );
}
