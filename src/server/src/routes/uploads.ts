/**
 * Upload routes — serving uploaded files with auth protection.
 */

import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'fs';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { getAbsolutePath, fileExists } from '../lib/uploads.js';

export async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/uploads/:attachmentId/:filename — serve an uploaded file
  fastify.get(
    '/api/uploads/:attachmentId/:filename',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { attachmentId } = request.params as { attachmentId: string; filename: string };

      // Find attachment in DB
      const attachment = await prisma.attachment.findUnique({
        where: { id: attachmentId },
        select: { storagePath: true, contentType: true, filename: true, messageId: true },
      });

      if (!attachment) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Attachment not found' },
        });
      }

      // Check access: user must be member of the scope where this attachment was posted
      const message = await prisma.message.findUnique({
        where: { id: attachment.messageId },
        select: { scopeType: true, scopeId: true },
      });
      if (!message) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Attachment not found' },
        });
      }

      if (message.scopeType === 'room') {
        const membership = await prisma.groupMembership.findUnique({
          where: { roomId_userId: { roomId: message.scopeId, userId: request.userId } },
        });
        // 'left' state members retain read access to history (including uploads).
        // Only 'not_joined' users are denied access.
        if (!membership || membership.state === 'not_joined') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Access denied' },
          });
        }
      } else if (message.scopeType === 'direct') {
        const dm = await prisma.directConversation.findUnique({
          where: { id: message.scopeId },
        });
        if (!dm || (dm.participantAId !== request.userId && dm.participantBId !== request.userId)) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Access denied' },
          });
        }
      }

      // Check file exists on disk
      const exists = await fileExists(attachment.storagePath);
      if (!exists) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'File not found on disk' },
        });
      }

      const absolutePath = getAbsolutePath(attachment.storagePath);

      // Set appropriate headers
      const isImage = attachment.contentType.startsWith('image/');
      const disposition = isImage ? 'inline' : 'attachment';

      reply.header('Content-Type', attachment.contentType);
      reply.header(
        'Content-Disposition',
        `${disposition}; filename="${encodeURIComponent(attachment.filename)}"`
      );
      reply.header('Cache-Control', 'private, max-age=86400'); // 24h cache
      reply.header('X-Content-Type-Options', 'nosniff');

      return reply.send(createReadStream(absolutePath));
    }
  );
}
