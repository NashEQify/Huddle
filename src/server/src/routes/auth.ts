import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { COOKIE_NAME, requireAuth } from '../middleware/auth.js';

// ─── Login Attempt Limiting (in-memory) ─────────────────

interface LoginAttempt {
  count: number;
  lockedUntil?: Date;
}

const loginAttempts = new Map<string, LoginAttempt>();

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function checkLockout(usernameCanonical: string): { locked: boolean; minutesLeft?: number } {
  const attempt = loginAttempts.get(usernameCanonical);
  if (!attempt?.lockedUntil) return { locked: false };

  if (new Date() >= attempt.lockedUntil) {
    // Lockout expired — reset
    loginAttempts.delete(usernameCanonical);
    return { locked: false };
  }

  const minutesLeft = Math.ceil(
    (attempt.lockedUntil.getTime() - Date.now()) / 60000
  );
  return { locked: true, minutesLeft };
}

function recordFailedAttempt(usernameCanonical: string): void {
  const attempt = loginAttempts.get(usernameCanonical) || { count: 0 };
  attempt.count += 1;
  if (attempt.count >= MAX_ATTEMPTS) {
    attempt.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
  }
  loginAttempts.set(usernameCanonical, attempt);
}

function clearAttempts(usernameCanonical: string): void {
  loginAttempts.delete(usernameCanonical);
}

// ─── Validation ─────────────────────────────────────────

// Spec 15-auth.md: 2-24 chars, alphanumeric + underscore + hyphen + space
// Space rules: no leading/trailing (trim first), no consecutive spaces
const USERNAME_REGEX = /^[a-zA-Z0-9_ -]{2,24}$/;
const CONSECUTIVE_SPACES = /  /;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ValidationError {
  field: string;
  message: string;
}

function validateSignup(body: {
  username?: string;
  email?: string;
  password?: string;
  passwordRepeat?: string;
}): ValidationError[] {
  const errors: ValidationError[] = [];

  const trimmedUsername = body.username?.trim();
  if (!trimmedUsername || !USERNAME_REGEX.test(trimmedUsername) || CONSECUTIVE_SPACES.test(trimmedUsername)) {
    errors.push({
      field: 'username',
      message:
        'Username must be 2-24 characters: letters, numbers, space, underscore, hyphen. No consecutive spaces.',
    });
  }

  if (!body.email || !EMAIL_REGEX.test(body.email)) {
    errors.push({ field: 'email', message: 'Valid email required' });
  }

  if (!body.password || body.password.length < 8 || body.password.length > 64) {
    errors.push({
      field: 'password',
      message: 'Password must be 8-64 characters',
    });
  }

  if (body.password !== body.passwordRepeat) {
    errors.push({
      field: 'passwordRepeat',
      message: 'Passwords do not match',
    });
  }

  return errors;
}

// ─── Session Helpers ────────────────────────────────────

const SESSION_EXPIRY_DAYS = 30;

async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);
  const sessionId = randomBytes(32).toString('base64url');

  const session = await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      expiresAt,
    },
  });

  return session.id;
}

function setSessionCookie(
  reply: import('fastify').FastifyReply,
  sessionId: string
): void {
  const isProduction = process.env['NODE_ENV'] === 'production';
  reply.setCookie(COOKIE_NAME, sessionId, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60, // seconds
  });
}

function clearSessionCookie(reply: import('fastify').FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

// ─── Response Helpers ───────────────────────────────────

function formatUserResponse(
  user: {
    id: string;
    username: string;
    email: string;
    isAdmin: boolean;
  },
  profile: {
    title: string;
    avatarKind: string;
    builtInAvatarId: string | null;
    portraitUrl: string | null;
  } | null,
  mustChangePassword: boolean
) {
  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
    },
    profile: profile
      ? {
          title: profile.title,
          avatarKind: profile.avatarKind,
          builtInAvatarId: profile.builtInAvatarId,
          portraitUrl: profile.portraitUrl,
        }
      : null,
    mustChangePassword,
  };
}

// ─── Routes ─────────────────────────────────────────────

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/auth/signup
  fastify.post('/api/auth/signup', async (request, reply) => {
    const body = request.body as {
      username?: string;
      email?: string;
      password?: string;
      passwordRepeat?: string;
    };

    // Validate
    const errors = validateSignup(body);
    if (errors.length > 0) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: errors[0]!.message,
          details: errors,
        },
      });
    }

    const username = body.username!.trim();
    const email = body.email!;
    const password = body.password!;
    const usernameCanonical = username.toLowerCase();

    // Check uniqueness
    const existing = await prisma.user.findUnique({
      where: { usernameCanonical },
    });
    if (existing) {
      return reply.status(409).send({
        error: { code: 'USERNAME_TAKEN', message: 'Name already taken' },
      });
    }

    // Hash password
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    // Get random title from pool
    const titleCount = await prisma.titlePoolEntry.count();
    let randomTitle = '';
    if (titleCount > 0) {
      const skip = Math.floor(Math.random() * titleCount);
      const titleEntry = await prisma.titlePoolEntry.findFirst({ skip });
      if (titleEntry) randomTitle = titleEntry.title;
    }

    // Get random built-in avatar.
    // CGL-023 / F-CSD-147: avatarKind is a 'built_in' | 'uploaded' enum;
    // a signup with avatarKind='built_in' AND builtInAvatarId=null renders
    // as a broken avatar. Fail-fast: if the pool is empty, reject signup
    // with a 503 so operators notice (BuiltInAvatar table must be seeded).
    const avatarCount = await prisma.builtInAvatar.count();
    if (avatarCount === 0) {
      fastify.log.error('Built-in avatar pool is empty — cannot complete signup');
      return reply.status(503).send({
        error: {
          code: 'AVATAR_POOL_EMPTY',
          message: 'Signup unavailable — avatar gallery not seeded. Contact an administrator.',
        },
      });
    }
    const avatarSkip = Math.floor(Math.random() * avatarCount);
    const avatarEntry = await prisma.builtInAvatar.findFirst({ skip: avatarSkip });
    const randomAvatarId: string | null = avatarEntry?.id ?? null;

    // Create user + credential + profile in transaction (count inside to avoid admin race)
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const userCount = await tx.user.count();
        const isFirstUser = userCount === 0;

        return tx.user.create({
          data: {
            username,
            usernameCanonical,
            email,
            isAdmin: isFirstUser,
            credentials: {
              create: {
                passwordHash,
                mustChangePassword: false,
              },
            },
            profile: {
              create: {
                title: randomTitle,
                avatarKind: 'built_in',
                builtInAvatarId: randomAvatarId,
              },
            },
          },
          include: {
            profile: true,
            credentials: true,
          },
        });
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return reply.status(409).send({
          error: { code: 'USERNAME_TAKEN', message: 'Name already taken' },
        });
      }
      throw err;
    }

    // Create session
    const sessionId = await createSession(user.id);
    setSessionCookie(reply, sessionId);

    return reply.status(201).send({
      data: formatUserResponse(user, user.profile, false),
    });
  });

  // POST /api/auth/login
  fastify.post('/api/auth/login', async (request, reply) => {
    const body = request.body as {
      username?: string;
      password?: string;
    };

    if (!body.username || !body.password) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Username and password required' },
      });
    }

    if (body.username.length > 24 || body.password.length > 128) {
      return reply.status(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });
    }

    const usernameCanonical = body.username.trim().toLowerCase();

    // Check lockout
    const lockout = checkLockout(usernameCanonical);
    if (lockout.locked) {
      return reply.status(429).send({
        error: {
          code: 'TOO_MANY_ATTEMPTS',
          message: `Too many login attempts. Try again in ${lockout.minutesLeft} minutes.`,
        },
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { usernameCanonical },
      include: {
        credentials: true,
        profile: true,
      },
    });

    if (!user || !user.credentials) {
      recordFailedAttempt(usernameCanonical);
      return reply.status(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });
    }

    // Check if deactivated
    if (!user.isActive) {
      return reply.status(401).send({
        error: { code: 'ACCOUNT_DEACTIVATED', message: 'Account has been deactivated' },
      });
    }

    // Verify password
    const valid = await argon2.verify(user.credentials.passwordHash, body.password);
    if (!valid) {
      recordFailedAttempt(usernameCanonical);
      return reply.status(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });
    }

    // Success — clear attempts
    clearAttempts(usernameCanonical);

    // Rotate login timestamps atomically:
    //   previousLoginAt ← (old) lastLoginAt
    //   lastLoginAt     ← now
    // First-ever login (lastLoginAt == null) leaves previousLoginAt null.
    // Welcome Screen shows previousLoginAt as "Last login" (spec 65.3).
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: { lastLoginAt: true },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          previousLoginAt: current?.lastLoginAt ?? null,
          lastLoginAt: now,
        },
      });
    });

    // Create session
    const sessionId = await createSession(user.id);
    setSessionCookie(reply, sessionId);

    return reply.status(200).send({
      data: formatUserResponse(
        user,
        user.profile,
        user.credentials.mustChangePassword
      ),
    });
  });

  // POST /api/auth/logout
  fastify.post(
    '/api/auth/logout',
    { preHandler: requireAuth },
    async (request, reply) => {
      // Revoke current session
      const sessionId = request.cookies[COOKIE_NAME];
      if (sessionId) {
        await prisma.session.update({
          where: { id: sessionId },
          data: { revokedAt: new Date() },
        }).catch(() => {
          // Session may not exist — best effort
        });
      }

      clearSessionCookie(reply);

      return reply.status(200).send({
        data: { ok: true },
      });
    }
  );

  // POST /api/auth/change-password
  fastify.post(
    '/api/auth/change-password',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body as {
        newPassword?: string;
        newPasswordRepeat?: string;
      };

      // Check that user actually needs to change password
      const credential = await prisma.credential.findUnique({
        where: { userId: request.userId },
      });

      if (!credential || !credential.mustChangePassword) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Password change is not required',
          },
        });
      }

      // Validate
      const errors: ValidationError[] = [];

      if (
        !body.newPassword ||
        body.newPassword.length < 8 ||
        body.newPassword.length > 64
      ) {
        errors.push({
          field: 'newPassword',
          message: 'Password must be 8-64 characters',
        });
      }

      if (body.newPassword !== body.newPasswordRepeat) {
        errors.push({
          field: 'newPasswordRepeat',
          message: 'Passwords do not match',
        });
      }

      if (errors.length > 0) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: errors[0]!.message,
            details: errors,
          },
        });
      }

      // Hash new password and update
      const passwordHash = await argon2.hash(body.newPassword!, {
        type: argon2.argon2id,
      });

      await prisma.credential.update({
        where: { userId: request.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
        },
      });

      return reply.status(200).send({
        data: { ok: true },
      });
    }
  );

  // GET /api/auth/session
  fastify.get('/api/auth/session', async (request, reply) => {
    const sessionId = request.cookies[COOKIE_NAME];
    if (!sessionId) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'No valid session' },
      });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          include: {
            profile: true,
            credentials: true,
          },
        },
      },
    });

    if (!session) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'No valid session' },
      });
    }

    if (session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'No valid session' },
      });
    }

    return reply.status(200).send({
      data: formatUserResponse(
        session.user,
        session.user.profile,
        session.user.credentials?.mustChangePassword ?? false
      ),
    });
  });
}
