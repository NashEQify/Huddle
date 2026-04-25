import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ApiResponse } from '@huddle/shared';
import fastifyMultipart from '@fastify/multipart';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { membershipRoutes } from './routes/membership.js';
import { messageRoutes } from './routes/messages.js';
import { directRoutes } from './routes/direct.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';
import { uploadRoutes } from './routes/uploads.js';
import { reactionRoutes } from './routes/reactions.js';
import { livekitRoutes, syncScreenshareState } from './routes/livekit.js';
import { welcomeRoutes } from './routes/welcome.js';
import { adminRoutes } from './routes/admin.js';
import { searchRoutes } from './routes/search.js';
import { configRoutes } from './routes/config.js';
import { wsPlugin } from './ws/index.js';
import { cleanupExpiredSessions } from './lib/session-cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env['PORT'] || '3000', 10);
const NODE_ENV = process.env['NODE_ENV'] || 'development';

const fastify = Fastify({
  logger: true,
});

// --- Plugins ---

await fastify.register(fastifyCookie);
await fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max per file
    files: 5, // max 5 files per request
  },
});
await fastify.register(fastifyWebsocket);

// In production, serve the built client files
if (NODE_ENV === 'production') {
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../../client/dist'),
    prefix: '/',
    wildcard: false,
    setHeaders: (res, filePath) => {
      // Vite build does not emit a Content-Type for .tflite (unknown
      // extension). Explicitly tag MediaPipe's selfie_segmenter.tflite
      // so strict fetch loaders don't reject the response.
      if (filePath.endsWith('.tflite')) {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
    },
  });
}

// --- Routes ---

await fastify.register(authRoutes);
await fastify.register(roomRoutes);
await fastify.register(membershipRoutes);
await fastify.register(messageRoutes);
await fastify.register(directRoutes);
await fastify.register(settingsRoutes);
await fastify.register(userRoutes);
await fastify.register(uploadRoutes);
await fastify.register(reactionRoutes);
await fastify.register(livekitRoutes);
await fastify.register(welcomeRoutes);
await fastify.register(adminRoutes);
await fastify.register(searchRoutes);
await fastify.register(configRoutes);

// --- WebSocket ---

await fastify.register(wsPlugin);

fastify.get('/api/health', async (_request, _reply) => {
  const response: ApiResponse<{ status: string }> = {
    data: { status: 'ok' },
  };
  return response;
});

// --- Dev/Test Utilities (never available in production) ---

if (NODE_ENV !== 'production') {
  const { prisma } = await import('./lib/prisma.js');
  const { requireAuth } = await import('./middleware/auth.js');

  // Promote current user to admin — test helper
  fastify.post('/api/test/promote-admin', { preHandler: [requireAuth] }, async (request, reply) => {
    await prisma.user.update({
      where: { id: request.userId },
      data: { isAdmin: true },
    });
    return reply.send({ data: { ok: true } });
  });
}

// In production, serve index.html for client-side routing
if (NODE_ENV === 'production') {
  fastify.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile('index.html');
  });
}

// --- Start ---

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  fastify.log.info(`Server running in ${NODE_ENV} mode on port ${PORT}`);

  // Rebuild screenshare state from LiveKit after server starts
  syncScreenshareState().catch((err) => {
    fastify.log.warn({ err }, 'Failed to sync screenshare state from LiveKit on startup');
  });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

// --- Session Cleanup ---

try {
  const deleted = await cleanupExpiredSessions();
  if (deleted > 0) {
    fastify.log.info(`Cleaned up ${deleted} expired sessions on startup`);
  }
} catch (err) {
  fastify.log.error(err, 'Failed to cleanup expired sessions on startup');
}

// Run session cleanup every 24 hours
const SESSION_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
const sessionCleanupTimer = setInterval(async () => {
  try {
    const deleted = await cleanupExpiredSessions();
    if (deleted > 0) {
      fastify.log.info(`Cleaned up ${deleted} expired sessions`);
    }
  } catch (err) {
    fastify.log.error(err, 'Scheduled session cleanup failed');
  }
}, SESSION_CLEANUP_INTERVAL);

// --- Graceful Shutdown ---

const shutdown = async (signal: string) => {
  fastify.log.info(`Received ${signal}, shutting down gracefully...`);
  clearInterval(sessionCleanupTimer);
  try {
    await fastify.close();
    process.exit(0);
  } catch (err) {
    fastify.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
