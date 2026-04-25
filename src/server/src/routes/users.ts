import type { FastifyInstance } from 'fastify';
import type { ApiResponse, UserResponse, UserProfileResponse } from '@huddle/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/users
  // Returns all active users with their profiles
  fastify.get(
    '/api/users',
    { preHandler: requireAuth },
    async (_request, _reply) => {
      const users = await prisma.user.findMany({
        where: { isActive: true },
        include: {
          profile: {
            include: {
              // We need the built-in avatar URL — but UserProfile doesn't have
              // a relation to BuiltInAvatar in Prisma. We resolve it manually.
            },
          },
        },
        orderBy: { username: 'asc' },
      });

      // Collect all built-in avatar IDs to batch-fetch their URLs
      const builtInAvatarIds = users
        .map((u) => u.profile?.builtInAvatarId)
        .filter((id): id is string => id != null);

      const avatarMap = new Map<string, { imageUrl: string; label: string }>();
      if (builtInAvatarIds.length > 0) {
        const avatars = await prisma.builtInAvatar.findMany({
          where: { id: { in: builtInAvatarIds } },
          select: { id: true, imageUrl: true, label: true },
        });
        for (const avatar of avatars) {
          avatarMap.set(avatar.id, { imageUrl: avatar.imageUrl, label: avatar.label });
        }
      }

      const data: UserResponse[] = users.map((user) => {
        let profile: UserProfileResponse | null = null;
        if (user.profile) {
          profile = {
            title: user.profile.title,
            avatarKind: user.profile.avatarKind as 'built_in' | 'uploaded',
            builtInAvatarId: user.profile.builtInAvatarId,
            builtInAvatarUrl: user.profile.builtInAvatarId
              ? avatarMap.get(user.profile.builtInAvatarId)?.imageUrl ?? null
              : null,
            builtInAvatarLabel: user.profile.builtInAvatarId
              ? avatarMap.get(user.profile.builtInAvatarId)?.label ?? null
              : null,
            portraitUrl: user.profile.portraitUrl,
          };
        }

        return {
          id: user.id,
          username: user.username,
          isActive: user.isActive,
          lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
          profile,
        };
      });

      const response: ApiResponse<{ users: UserResponse[] }> = {
        data: { users: data },
      };

      return response;
    }
  );
}
