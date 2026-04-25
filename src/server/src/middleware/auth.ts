import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';

const COOKIE_NAME = 'huddle_session';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

/**
 * Validate a session from the cookie and return the userId if valid.
 * Returns null if no valid session.
 */
export async function validateSessionFromRequest(
  request: FastifyRequest
): Promise<string | null> {
  const sessionId = request.cookies[COOKIE_NAME];
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;

  return session.userId;
}

/**
 * Fastify preHandler hook that requires a valid session.
 * Sets request.userId on success, returns 401 on failure.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = await validateSessionFromRequest(request);

  if (!userId) {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
  }

  request.userId = userId;
}

/**
 * Fastify preHandler hook that requires admin privileges.
 * Must be used after requireAuth.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { isAdmin: true },
  });

  if (!user || !user.isAdmin) {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Admin access required' },
    });
  }
}

export { COOKIE_NAME };
