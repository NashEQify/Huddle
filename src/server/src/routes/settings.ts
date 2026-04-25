import type { FastifyInstance } from 'fastify';
import * as argon2 from 'argon2';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcast } from '../ws/handler.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPLOAD_DIR = process.env['UPLOAD_DIR'] || '/tmp/huddle-uploads';

// Allowed MIME types for portrait upload
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

// Magic byte signatures for image validation
const MAGIC_BYTES: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header
];

function detectMimeFromBytes(buffer: Buffer): string | null {
  for (const entry of MAGIC_BYTES) {
    if (buffer.length >= entry.bytes.length) {
      const matches = entry.bytes.every((b, i) => buffer[i] === b);
      if (matches) return entry.mime;
    }
  }
  return null;
}

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── GET /api/settings/avatars ─────────────────────────
  fastify.get(
    '/api/settings/avatars',
    { preHandler: requireAuth },
    async (_request, reply) => {
      const avatars = await prisma.builtInAvatar.findMany({
        select: { id: true, label: true, imageUrl: true },
        orderBy: { label: 'asc' },
      });

      return reply.status(200).send({
        data: { avatars },
      });
    }
  );

  // ─── GET /api/settings/random-title ────────────────────
  fastify.get(
    '/api/settings/random-title',
    { preHandler: requireAuth },
    async (_request, reply) => {
      const count = await prisma.titlePoolEntry.count();
      if (count === 0) {
        return reply.status(200).send({
          data: { title: '' },
        });
      }

      const skip = Math.floor(Math.random() * count);
      const entry = await prisma.titlePoolEntry.findFirst({ skip });

      return reply.status(200).send({
        data: { title: entry?.title ?? '' },
      });
    }
  );

  // ─── PATCH /api/settings/profile ───────────────────────
  fastify.patch(
    '/api/settings/profile',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body as {
        title?: string;
        builtInAvatarId?: string;
      };

      const updates: Record<string, unknown> = {};

      // Validate and set title
      if (body.title !== undefined) {
        const title = body.title.trim();
        if (title.length < 1 || title.length > 40) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Title must be 1-40 characters',
            },
          });
        }
        updates.title = title;

        // Add custom title to TitlePool if not already there (capped at 200 user entries)
        const userTitleCount = await prisma.titlePoolEntry.count({ where: { source: 'user' } });
        if (userTitleCount < 200) {
          const existing = await prisma.titlePoolEntry.findFirst({
            where: { title },
          });
          if (!existing) {
            await prisma.titlePoolEntry.create({
              data: { title, source: 'user' },
            });
          }
        }
      }

      // Validate and set built-in avatar
      if (body.builtInAvatarId !== undefined) {
        const avatar = await prisma.builtInAvatar.findUnique({
          where: { id: body.builtInAvatarId },
        });
        if (!avatar) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid avatar ID',
            },
          });
        }
        updates.builtInAvatarId = body.builtInAvatarId;
        updates.avatarKind = 'built_in';
      }

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No valid fields to update',
          },
        });
      }

      const profile = await prisma.userProfile.update({
        where: { userId: request.userId },
        data: updates,
      });

      // Broadcast profile change to all clients
      let builtInAvatarUrl: string | null = null;
      if (profile.avatarKind === 'built_in' && profile.builtInAvatarId) {
        const avatar = await prisma.builtInAvatar.findUnique({
          where: { id: profile.builtInAvatarId },
          select: { imageUrl: true },
        });
        builtInAvatarUrl = avatar?.imageUrl ?? null;
      }

      broadcast({
        type: 'user.updated',
        payload: {
          userId: request.userId,
          profile: {
            title: profile.title,
            avatarKind: profile.avatarKind,
            builtInAvatarUrl,
            portraitUrl: profile.portraitUrl,
          },
        },
      });

      return reply.status(200).send({
        data: {
          profile: {
            title: profile.title,
            avatarKind: profile.avatarKind,
            builtInAvatarId: profile.builtInAvatarId,
            portraitUrl: profile.portraitUrl,
          },
        },
      });
    }
  );

  // ─── POST /api/settings/portrait ───────────────────────
  fastify.post(
    '/api/settings/portrait',
    { preHandler: requireAuth },
    async (request, reply) => {
      const file = await request.file();

      if (!file) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No file uploaded',
          },
        });
      }

      // Check MIME type from content-type header
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Only PNG, JPEG, and WebP images are allowed',
          },
        });
      }

      // Read file buffer
      const chunks: Buffer[] = [];
      let totalSize = 0;
      const MAX_SIZE = 1 * 1024 * 1024; // 1 MB

      for await (const chunk of file.file) {
        totalSize += chunk.length;
        if (totalSize > MAX_SIZE) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'File exceeds 1 MB limit',
            },
          });
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);

      // Validate magic bytes
      const detectedMime = detectMimeFromBytes(buffer);
      if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'File content does not match an allowed image format',
          },
        });
      }

      // Process image: center crop to square, resize to 256x256, output as WebP
      const metadata = await sharp(buffer).metadata();
      const width = metadata.width || 256;
      const height = metadata.height || 256;
      const size = Math.min(width, height);

      const processed = await sharp(buffer)
        .extract({
          left: Math.floor((width - size) / 2),
          top: Math.floor((height - size) / 2),
          width: size,
          height: size,
        })
        .resize(256, 256)
        .webp({ quality: 85 })
        .toBuffer();

      // Ensure portraits directory exists
      const portraitsDir = path.join(UPLOAD_DIR, 'portraits');
      await fs.promises.mkdir(portraitsDir, { recursive: true });

      // Save file
      const filename = `${request.userId}.webp`;
      const filePath = path.join(portraitsDir, filename);
      await fs.promises.writeFile(filePath, processed);

      // Update profile
      const portraitUrl = `/api/uploads/portraits/${filename}`;
      const profile = await prisma.userProfile.update({
        where: { userId: request.userId },
        data: {
          avatarKind: 'uploaded',
          portraitUrl,
        },
      });

      // Broadcast portrait change to all clients
      broadcast({
        type: 'user.updated',
        payload: {
          userId: request.userId,
          profile: {
            title: profile.title,
            avatarKind: profile.avatarKind,
            builtInAvatarUrl: null, // uploaded avatar, no built-in URL
            portraitUrl: profile.portraitUrl,
          },
        },
      });

      return reply.status(200).send({
        data: {
          profile: {
            title: profile.title,
            avatarKind: profile.avatarKind,
            builtInAvatarId: profile.builtInAvatarId,
            portraitUrl: profile.portraitUrl,
          },
        },
      });
    }
  );

  // ─── GET /api/uploads/portraits/:filename ──────────────
  fastify.get(
    '/api/uploads/portraits/:filename',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { filename } = request.params as { filename: string };

      // Prevent path traversal
      const sanitized = path.basename(filename);
      if (sanitized !== filename || !filename.endsWith('.webp')) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'Invalid filename' },
        });
      }

      const filePath = path.join(UPLOAD_DIR, 'portraits', sanitized);

      try {
        await fs.promises.access(filePath, fs.constants.R_OK);
      } catch {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Portrait not found' },
        });
      }

      const stream = fs.createReadStream(filePath);
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.type('image/webp').send(stream);
    }
  );

  // ─── PATCH /api/settings/email ─────────────────────────
  fastify.patch(
    '/api/settings/email',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body as {
        email?: string;
        currentPassword?: string;
      };

      if (!body.email || !EMAIL_REGEX.test(body.email)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Valid email required',
          },
        });
      }

      if (!body.currentPassword) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Current password required',
          },
        });
      }

      // Verify current password
      const credential = await prisma.credential.findUnique({
        where: { userId: request.userId },
      });

      if (!credential) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          },
        });
      }

      const valid = await argon2.verify(
        credential.passwordHash,
        body.currentPassword
      );
      if (!valid) {
        return reply.status(401).send({
          error: {
            code: 'INVALID_PASSWORD',
            message: 'Current password is incorrect',
          },
        });
      }

      // Update email
      const user = await prisma.user.update({
        where: { id: request.userId },
        data: { email: body.email },
      });

      return reply.status(200).send({
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isAdmin: user.isAdmin,
          },
        },
      });
    }
  );

  // ─── PATCH /api/settings/password ──────────────────────
  fastify.patch(
    '/api/settings/password',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body as {
        currentPassword?: string;
        newPassword?: string;
        newPasswordRepeat?: string;
      };

      if (!body.currentPassword) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Current password required',
          },
        });
      }

      if (
        !body.newPassword ||
        body.newPassword.length < 8 ||
        body.newPassword.length > 64
      ) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'New password must be 8-64 characters',
          },
        });
      }

      if (body.newPassword !== body.newPasswordRepeat) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'New passwords do not match',
          },
        });
      }

      // Verify current password
      const credential = await prisma.credential.findUnique({
        where: { userId: request.userId },
      });

      if (!credential) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          },
        });
      }

      const valid = await argon2.verify(
        credential.passwordHash,
        body.currentPassword
      );
      if (!valid) {
        return reply.status(401).send({
          error: {
            code: 'INVALID_PASSWORD',
            message: 'Current password is incorrect',
          },
        });
      }

      // Hash and update
      const passwordHash = await argon2.hash(body.newPassword, {
        type: argon2.argon2id,
      });

      await prisma.credential.update({
        where: { userId: request.userId },
        data: { passwordHash },
      });

      return reply.status(200).send({
        data: { ok: true },
      });
    }
  );

}
