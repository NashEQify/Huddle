/**
 * seed-demo.ts — populate a demo room with fake users + messages.
 *
 * Used for README screenshots and demos. Idempotent (upserts users/profile/
 * memberships, replaces only demo-authored messages in the "meet" room).
 *
 * Run against local dev DB (default) or a target DB via DATABASE_URL env var:
 *
 *   npx tsx prisma/seed-demo.ts
 *
 * Or inside a container:
 *
 *   docker exec -it repo-app-1 npx tsx prisma/seed-demo.ts
 *
 * Optional env:
 *   DEMO_PASSWORD — override the default demo password.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demopass123';

interface DemoUser {
  username: string;
  email: string;
  avatarId: string;
}

const USERS: DemoUser[] = [
  { username: 'fabian',       email: 'fabian@huddle.demo',       avatarId: 'donkey-kong'   },
  { username: 'Basti',        email: 'basti@huddle.demo',        avatarId: 'mario'         },
  { username: 'roger',        email: 'roger@huddle.demo',        avatarId: 'solid-snake'   },
  { username: 'inOttWeTrust', email: 'inottwetrust@huddle.demo', avatarId: 'master-chief'  },
  { username: 'micha',        email: 'micha@huddle.demo',        avatarId: 'luigi'         },
];

interface DemoMessage {
  author: string;
  content: string;
  /** minutes after session-start anchor (19:15 local on the seed run) */
  offsetMinutes: number;
}

/**
 * Story: Thursday evening gaming session.
 * Planning -> stragglers -> server up -> in-game chatter -> pause -> back.
 * Kept short + realistic, mixed German casual.
 */
const MESSAGES: DemoMessage[] = [
  // planning phase (~19:15)
  { author: 'fabian',       content: 'bin noch beim sport, schaffe erst 22 uhr',                          offsetMinutes: 0   },
  { author: 'Basti',        content: 'ok mal schauen wie wirs schaffen. 21ish schaut bei mir gut aus',    offsetMinutes: 2   },
  { author: 'roger',        content: 'yes',                                                                offsetMinutes: 3   },
  { author: 'inOttWeTrust', content: 'bin ready',                                                          offsetMinutes: 4   },
  { author: 'micha',        content: 'https://youtu.be/dQw4w9WgXcQ',                                       offsetMinutes: 8   },
  { author: 'roger',        content: 'immer wieder',                                                       offsetMinutes: 9   },
  { author: 'Basti',        content: 'du lernst es nie',                                                   offsetMinutes: 10  },

  // stragglers (~20:45)
  { author: 'inOttWeTrust', content: 'wer ready?',                                                         offsetMinutes: 90  },
  { author: 'Basti',        content: 'gleich',                                                             offsetMinutes: 91  },
  { author: 'roger',        content: 'stelle server auf',                                                  offsetMinutes: 92  },
  { author: 'micha',        content: 'kurz essen, 5 min',                                                  offsetMinutes: 93  },

  // server up (~21:00)
  { author: 'roger',        content: 'up — neue IP steht im PM',                                           offsetMinutes: 105 },
  { author: 'inOttWeTrust', content: 'bin drin',                                                           offsetMinutes: 106 },
  { author: 'Basti',        content: 'auch da',                                                            offsetMinutes: 107 },
  { author: 'micha',        content: 'moment dns...',                                                      offsetMinutes: 108 },
  { author: 'micha',        content: 'joa passt',                                                          offsetMinutes: 110 },
  { author: 'fabian',       content: '10 min noch sorry',                                                  offsetMinutes: 112 },

  // in-game (~21:15)
  { author: 'roger',        content: 'wtf',                                                                offsetMinutes: 120 },
  { author: 'inOttWeTrust', content: 'lol',                                                                offsetMinutes: 121 },
  { author: 'Basti',        content: 'hinter dir!!',                                                       offsetMinutes: 122 },
  { author: 'roger',        content: 'mannomann',                                                          offsetMinutes: 123 },
  { author: 'micha',        content: 'wer campt schon wieder',                                             offsetMinutes: 125 },
  { author: 'inOttWeTrust', content: 'ich nicht',                                                          offsetMinutes: 126 },
  { author: 'Basti',        content: 'doch',                                                               offsetMinutes: 126 },
  { author: 'roger',        content: 'definitiv doch',                                                     offsetMinutes: 126 },
  { author: 'inOttWeTrust', content: 'ok bisschen',                                                        offsetMinutes: 127 },

  // pause (~21:30)
  { author: 'Basti',        content: 'kurz pause',                                                         offsetMinutes: 135 },
  { author: 'micha',        content: 'kurz weg auch',                                                      offsetMinutes: 136 },
  { author: 'roger',        content: 'kaffee holen',                                                       offsetMinutes: 137 },
  { author: 'fabian',       content: 'so bin da',                                                          offsetMinutes: 145 },
  { author: 'fabian',       content: 'wo seid ihr',                                                        offsetMinutes: 145 },
  { author: 'inOttWeTrust', content: 'pause',                                                              offsetMinutes: 146 },
  { author: 'fabian',       content: 'mach mich ready',                                                    offsetMinutes: 147 },

  // back in (~21:45)
  { author: 'Basti',        content: 'los gehts',                                                          offsetMinutes: 150 },
  { author: 'roger',        content: 'gogogo',                                                             offsetMinutes: 151 },
  { author: 'micha',        content: 'same lobby?',                                                        offsetMinutes: 152 },
  { author: 'inOttWeTrust', content: 'yep',                                                                offsetMinutes: 152 },
];

async function main() {
  console.log('[seed-demo] start');

  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  // ── Users + Profiles ──────────────────────────────────
  const userMap = new Map<string, string>();

  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { usernameCanonical: u.username.toLowerCase() },
      update: {}, // leave existing state alone
      create: {
        username: u.username,
        usernameCanonical: u.username.toLowerCase(),
        email: u.email,
        isAdmin: false,
        isActive: true,
      },
    });
    userMap.set(u.username, user.id);

    await prisma.credential.upsert({
      where: { userId: user.id },
      update: { passwordHash, mustChangePassword: false },
      create: {
        userId: user.id,
        passwordHash,
        mustChangePassword: false,
      },
    });

    await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: { avatarKind: 'built_in', builtInAvatarId: u.avatarId },
      create: {
        userId: user.id,
        title: '',
        avatarKind: 'built_in',
        builtInAvatarId: u.avatarId,
      },
    });
  }
  console.log(`[seed-demo] upserted ${USERS.length} users + profiles`);

  // ── "meet" room ───────────────────────────────────────
  const creatorId = userMap.get('fabian')!;

  let meetRoom = await prisma.room.findFirst({ where: { name: 'meet' } });
  if (!meetRoom) {
    meetRoom = await prisma.room.create({
      data: {
        name: 'meet',
        discoverable: true,
        createdBy: creatorId,
      },
    });
    console.log('[seed-demo] created room "meet"');
  } else {
    console.log('[seed-demo] room "meet" already exists — reusing');
  }

  // ── Memberships ──────────────────────────────────────
  const joinedAt = new Date();
  for (const [, userId] of userMap) {
    await prisma.groupMembership.upsert({
      where: { roomId_userId: { roomId: meetRoom.id, userId } },
      update: { state: 'joined', joinedAt, leftAt: null },
      create: {
        roomId: meetRoom.id,
        userId,
        state: 'joined',
        joinedAt,
      },
    });
  }
  console.log(`[seed-demo] memberships: ${userMap.size} joined`);

  // ── Messages: replace previous demo-authored messages, then insert fresh ──
  const demoAuthorIds = [...userMap.values()];

  const removed = await prisma.message.deleteMany({
    where: {
      scopeType: 'room',
      scopeId: meetRoom.id,
      authorId: { in: demoAuthorIds },
    },
  });
  if (removed.count > 0) {
    console.log(`[seed-demo] removed ${removed.count} prior demo messages`);
  }

  // Anchor: today at 19:15 local
  const anchor = new Date();
  anchor.setHours(19, 15, 0, 0);

  for (const m of MESSAGES) {
    const authorId = userMap.get(m.author);
    if (!authorId) {
      console.warn(`[seed-demo] unknown author "${m.author}" — skipping`);
      continue;
    }
    const ts = new Date(anchor.getTime() + m.offsetMinutes * 60_000);
    await prisma.message.create({
      data: {
        scopeType: 'room',
        scopeId: meetRoom.id,
        authorId,
        content: m.content,
        createdAt: ts,
      },
    });
  }
  console.log(`[seed-demo] inserted ${MESSAGES.length} messages`);

  // ── Bump room lastActivityAt to the last message ─────
  const lastTs = new Date(
    anchor.getTime() + MESSAGES[MESSAGES.length - 1].offsetMinutes * 60_000,
  );
  await prisma.room.update({
    where: { id: meetRoom.id },
    data: { lastActivityAt: lastTs },
  });

  // ── Summary ──────────────────────────────────────────
  console.log('');
  console.log('[seed-demo] done.');
  console.log('');
  console.log(`  room:     meet (${meetRoom.id})`);
  console.log(`  users:    ${USERS.map((u) => u.username).join(', ')}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  messages: ${MESSAGES.length}`);
  console.log('');
  console.log('  Log in as any of the above to screenshot.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
