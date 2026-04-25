import type { FastifyInstance } from 'fastify';
import type { ApiResponse, WelcomeData } from '@huddle/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { getOnlineUserIds } from '../ws/handler.js';
import { roomService } from '../lib/livekit.js';

// ── Tips Pool ───────────────────────────────────────────

const TIPS = [
  'Click a room to start chatting.',
  'Click a user to send a direct message.',
  'Press Ctrl+V to paste a screenshot into chat.',
  'Drag files onto the chat area to upload.',
  'Your title is displayed next to your name \u2014 change it in Settings.',
  'Use Shift+Enter for multi-line messages.',
  'Join a call by clicking the call button in a room.',
  'You can share your screen in a room by clicking the Share Screen button.',
  'The admin can reset your password if you forget it.',
  'Emoji reactions: hover over a message and click the reaction icon.',
];

function randomTip(): string {
  return TIPS[Math.floor(Math.random() * TIPS.length)]!;
}

// ── Route ───────────────────────────────────────────────

export async function welcomeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/welcome',
    { preHandler: requireAuth },
    async (request, _reply) => {
      const userId = request.userId;

      // Fetch user's previousLoginAt and a random MOTD quote in parallel.
      // "Last login" on the Welcome Screen shows the PREVIOUS session start,
      // not the current one (spec 65.3). See auth.ts login flow for rotation.
      const [user, totalUsers, motdQuote, liveCounts] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { previousLoginAt: true },
        }),
        prisma.user.count({ where: { isActive: true } }),
        getRandomMotdQuote(),
        getActiveLivekitCounts(fastify),
      ]);

      const onlineCount = getOnlineUserIds().length;

      const data: WelcomeData = {
        lastLoginAt: user?.previousLoginAt?.toISOString() ?? null,
        onlineCount,
        totalUsers,
        activeCalls: liveCounts.activeCalls,
        activeScreenshares: liveCounts.activeScreenshares,
        motdQuote: motdQuote
          ? { text: motdQuote.text, attribution: motdQuote.attribution }
          : null,
        tip: randomTip(),
      };

      const response: ApiResponse<WelcomeData> = { data };
      return response;
    }
  );
}

// ── Helpers ─────────────────────────────────────────────

async function getRandomMotdQuote() {
  // Count total quotes, pick a random offset
  const count = await prisma.motdQuote.count();
  if (count === 0) return null;

  const skip = Math.floor(Math.random() * count);
  const quotes = await prisma.motdQuote.findMany({
    take: 1,
    skip,
    select: { text: true, attribution: true },
  });

  return quotes[0] ?? null;
}

// Query LiveKit for active rooms and bucket by name prefix:
//   call:*  → active calls (room or DM call)
//   ss:*    → active screenshares
// Only rooms with participants count. Unreachable LiveKit degrades to 0/0.
async function getActiveLivekitCounts(
  fastify: FastifyInstance
): Promise<{ activeCalls: number; activeScreenshares: number }> {
  try {
    const lkRooms = await roomService.listRooms();
    let activeCalls = 0;
    let activeScreenshares = 0;
    for (const lkRoom of lkRooms) {
      if (lkRoom.numParticipants <= 0) continue;
      if (lkRoom.name.startsWith('call:')) activeCalls += 1;
      else if (lkRoom.name.startsWith('ss:')) activeScreenshares += 1;
    }
    return { activeCalls, activeScreenshares };
  } catch (err) {
    fastify.log.warn(
      { err },
      'welcome: LiveKit listRooms failed; returning 0 active calls/screenshares'
    );
    return { activeCalls: 0, activeScreenshares: 0 };
  }
}
