/**
 * LiveKit Routes — Token Generation & Webhook Handler
 *
 * POST /api/livekit/token  — Generate LiveKit access token for a room
 * POST /api/livekit/webhook — Receive LiveKit webhook events
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { sendToUser } from '../ws/handler.js';
import { broadcastToCallScope, broadcastToScreenshareScope } from '../lib/scope-broadcast.js';
import { LK_API_KEY, LK_API_SECRET, webhookReceiver, roomService } from '../lib/livekit.js';

// ── Room Name Patterns ─────────────────────────────────

const ROOM_PATTERNS = {
  roomCall: /^call:([\w-]+)$/,
  dmCall: /^call:dm:([\w-]+)$/,
  roomScreenshare: /^ss:room:([\w-]+)$/,
  dmScreenshare: /^ss:dm:([\w-]+)$/,
};

function parseRoomName(
  roomName: string
): { type: 'roomCall' | 'dmCall' | 'roomScreenshare' | 'dmScreenshare'; scopeId: string } | null {
  for (const [type, pattern] of Object.entries(ROOM_PATTERNS)) {
    const match = roomName.match(pattern);
    if (match) {
      return { type: type as keyof typeof ROOM_PATTERNS, scopeId: match[1] };
    }
  }
  return null;
}

// ── Helper: scope from LiveKit room name ───────────────

function scopeFromRoomName(livekitRoomName: string): { type: 'room' | 'direct'; id: string } | null {
  const parsed = parseRoomName(livekitRoomName);
  if (!parsed) return null;

  switch (parsed.type) {
    case 'roomCall':
      return { type: 'room', id: parsed.scopeId };
    case 'dmCall':
      return { type: 'direct', id: parsed.scopeId };
    case 'roomScreenshare':
      // Screenshare rooms don't map to call scopes — handled separately
      return null;
    default:
      return null;
  }
}

// ── Helper: screenshare info from LiveKit room name ────

function screenshareFromRoomName(
  livekitRoomName: string
): { mode: 'room' | 'direct'; scopeId: string } | null {
  const parsed = parseRoomName(livekitRoomName);
  if (!parsed) return null;

  if (parsed.type === 'roomScreenshare') {
    return { mode: 'room', scopeId: parsed.scopeId };
  }
  if (parsed.type === 'dmScreenshare') {
    return { mode: 'direct', scopeId: parsed.scopeId };
  }
  return null;
}

// ── In-memory active screenshare tracking ──────────────

interface ActiveScreenshare {
  mode: 'room' | 'direct';
  scopeId: string;
  userId: string;
  sourceRoomId?: string;
  sourceRoomName?: string;
}

const activeScreenshares = new Map<string, ActiveScreenshare>();

export function getActiveScreenshares(): ActiveScreenshare[] {
  return Array.from(activeScreenshares.values());
}

export function getActiveRoomScreenshare(roomId: string): ActiveScreenshare | undefined {
  return activeScreenshares.get(`room:${roomId}`);
}

// ── Helper: bump last_activity_at on call/screenshare events ─────────
// Per CGL-006 + spec 20.6: Sidebar sort is `last_activity_at DESC`, and
// call/screenshare lifecycle events count as activity for that ordering.
// Silent try/catch — a missing row (race with delete) must not crash the
// webhook pipeline. Errors logged but not thrown.

async function bumpLastActivity(
  scope: { type: 'room' | 'direct'; id: string }
): Promise<void> {
  const now = new Date();
  try {
    if (scope.type === 'room') {
      await prisma.room.update({
        where: { id: scope.id },
        data: { lastActivityAt: now },
      });
    } else {
      await prisma.directConversation.update({
        where: { id: scope.id },
        data: { lastActivityAt: now },
      });
    }
  } catch (err) {
    console.warn('[LiveKit] bumpLastActivity failed:', err);
  }
}

// ── Helper: get participants for a LiveKit room ────────

async function getLivekitParticipants(
  livekitRoomName: string
): Promise<Array<{ userId: string; isMuted: boolean; hasCamera: boolean }>> {
  try {
    const participants = await roomService.listParticipants(livekitRoomName);
    return participants.map((p) => ({
      userId: p.identity,
      isMuted: p.tracks.every(
        (t) => t.source !== 1 /* MICROPHONE */ || t.muted
      ),
      hasCamera: p.tracks.some(
        (t) => t.source === 2 /* CAMERA */ && !t.muted
      ),
    }));
  } catch {
    return [];
  }
}

// ── Routes ──────────────────────────────────────────────

export async function livekitRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/livekit/token ─────────────────────────
  fastify.post(
    '/api/livekit/token',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { roomName } = request.body as { roomName?: string };

      if (!roomName || typeof roomName !== 'string') {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: 'roomName is required' },
        });
      }

      // Validate room name pattern
      const parsed = parseRoomName(roomName);
      if (!parsed) {
        return reply.status(400).send({
          error: { code: 'INVALID_ROOM_NAME', message: 'Invalid LiveKit room name pattern' },
        });
      }

      // Permission check based on scope
      const userId = request.userId;

      if (parsed.type === 'roomCall' || parsed.type === 'roomScreenshare') {
        // Check room membership
        const membership = await prisma.groupMembership.findUnique({
          where: { roomId_userId: { roomId: parsed.scopeId, userId } },
        });
        if (!membership || membership.state !== 'joined') {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Must be a joined room member' },
          });
        }
      } else if (parsed.type === 'dmCall' || parsed.type === 'dmScreenshare') {
        // Check DM participation
        const dm = await prisma.directConversation.findUnique({
          where: { id: parsed.scopeId },
        });
        if (!dm || (dm.participantAId !== userId && dm.participantBId !== userId)) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Not a participant in this conversation' },
          });
        }
      }

      // Generate token
      const token = new AccessToken(LK_API_KEY, LK_API_SECRET, {
        identity: userId,
        ttl: '6h',
      });

      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const jwt = await token.toJwt();

      return reply.send({ data: { token: jwt } });
    }
  );

  // ── GET /api/livekit/screenshares — Active screenshares ──
  fastify.get(
    '/api/livekit/screenshares',
    { preHandler: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        data: { screenshares: getActiveScreenshares() },
      });
    }
  );

  // ── POST /api/livekit/mute-participant ──────────────────
  fastify.post(
    '/api/livekit/mute-participant',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { roomName, userId: targetUserId, muted } = request.body as {
        roomName?: string;
        userId?: string;
        muted?: boolean;
      };

      if (!roomName || !targetUserId || typeof muted !== 'boolean') {
        return reply.status(400).send({
          error: { code: 'INVALID_INPUT', message: 'roomName, userId, and muted are required' },
        });
      }

      // Only allow muting in rooms where the user is a joined member
      const parsed = parseRoomName(roomName);
      if (!parsed) {
        return reply.status(400).send({
          error: { code: 'INVALID_ROOM_NAME', message: 'Invalid room name' },
        });
      }

      // CGL-003: Per spec 40-voice §40.13 the caller MUST be in the same
      // LiveKit room as the target. Without this check any authenticated user
      // could mute any other user's mic in any call. Verify the caller's
      // userId is in the LiveKit room's participant list AND verify the
      // target is also in the same list.
      try {
        const participants = await roomService.listParticipants(roomName);
        const callerId = request.userId;
        const caller = participants.find((p) => p.identity === callerId);
        if (!caller) {
          return reply.status(403).send({
            error: {
              code: 'NOT_IN_ROOM',
              message: 'Caller must be in the same call to mute participants',
            },
          });
        }

        const target = participants.find((p) => p.identity === targetUserId);
        if (!target) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Participant not in room' },
          });
        }

        // Find the audio track to mute/unmute
        for (const track of target.tracks) {
          if (track.source === 1) { // TrackSource.MICROPHONE = 1
            await roomService.mutePublishedTrack(
              roomName,
              targetUserId,
              track.sid,
              muted
            );
          }
        }

        return reply.send({ data: { ok: true } });
      } catch (err) {
        fastify.log.error(err, 'Failed to mute participant');
        return reply.status(500).send({
          error: { code: 'INTERNAL', message: 'Failed to mute participant' },
        });
      }
    }
  );

  // ── Register a content type parser to capture raw body for webhooks ──
  fastify.addContentTypeParser(
    'application/webhook+json',
    { parseAs: 'string' },
    (_request, payload, done) => {
      done(null, payload);
    }
  );

  // ── POST /api/livekit/webhook ───────────────────────
  fastify.post(
    '/api/livekit/webhook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Body may already be parsed as JSON or as raw string
        const body = typeof request.body === 'string'
          ? request.body
          : JSON.stringify(request.body);
        const authHeader = request.headers['authorization'] as string || '';

        // Verify and parse the webhook event
        const event = await webhookReceiver.receive(body, authHeader);

        request.log.info({ event: event.event, room: event.room?.name }, 'LiveKit webhook');

        const livekitRoomName = event.room?.name;
        if (!livekitRoomName) {
          return reply.send({ ok: true });
        }

        const scope = scopeFromRoomName(livekitRoomName);
        const ssInfo = screenshareFromRoomName(livekitRoomName);

        switch (event.event) {
          case 'room_started': {
            if (scope) {
              // CGL-006: bump last_activity_at on call start
              await bumpLastActivity(scope);
              await broadcastToCallScope(scope, {
                type: 'call.started',
                payload: {
                  scope,
                  startedBy: event.participant?.identity || '',
                },
              });
            }
            break;
          }

          case 'room_finished': {
            if (scope) {
              // CGL-006: bump last_activity_at on call end
              await bumpLastActivity(scope);
              await broadcastToCallScope(scope, {
                type: 'call.ended',
                payload: { scope },
              });
            }
            // Clean up screenshare tracking
            if (ssInfo) {
              const key = `${ssInfo.mode}:${ssInfo.scopeId}`;
              const ss = activeScreenshares.get(key);
              if (ss) {
                activeScreenshares.delete(key);
                // CGL-006: bump last_activity_at on screenshare end
                await bumpLastActivity({
                  type: ssInfo.mode === 'room' ? 'room' : 'direct',
                  id: ssInfo.scopeId,
                });
                await broadcastToScreenshareScope(ssInfo, {
                  type: 'screenshare.ended',
                  payload: {
                    mode: ssInfo.mode,
                    scopeId: ssInfo.scopeId,
                    userId: ss.userId,
                  },
                });
              }
            }
            break;
          }

          case 'participant_joined': {
            if (scope && event.participant) {
              await broadcastToCallScope(scope, {
                type: 'call.joined',
                payload: {
                  scope,
                  userId: event.participant.identity,
                },
              });

              // Also send full participant list
              const participants = await getLivekitParticipants(livekitRoomName);
              await broadcastToCallScope(scope, {
                type: 'call.participants',
                payload: {
                  scope,
                  participants: participants.map((p) => ({
                    ...p,
                    isSpeaking: false,
                  })),
                },
              });

              // DM call: send incoming call notification to the other participant
              if (scope.type === 'direct') {
                try {
                  const dm = await prisma.directConversation.findUnique({
                    where: { id: scope.id },
                  });
                  if (dm) {
                    const callerId = event.participant.identity;
                    const otherId =
                      dm.participantAId === callerId
                        ? dm.participantBId
                        : dm.participantAId;

                    // Only notify if the other user isn't already in the call
                    const isOtherInCall = participants.some(
                      (p) => p.userId === otherId
                    );
                    if (!isOtherInCall) {
                      sendToUser(otherId, {
                        type: 'dm.call.incoming',
                        payload: {
                          directId: scope.id,
                          callerId,
                        },
                      });
                    }
                  }
                } catch {
                  // ignore lookup errors
                }
              }
            }
            break;
          }

          case 'participant_left': {
            if (scope && event.participant) {
              await broadcastToCallScope(scope, {
                type: 'call.left',
                payload: {
                  scope,
                  userId: event.participant.identity,
                },
              });

              // Send updated participant list
              const participants = await getLivekitParticipants(livekitRoomName);
              await broadcastToCallScope(scope, {
                type: 'call.participants',
                payload: {
                  scope,
                  participants: participants.map((p) => ({
                    ...p,
                    isSpeaking: false,
                  })),
                },
              });

              // DM call: delete room when any participant leaves.
              // DM calls have max 2 participants — if either leaves, the call
              // is over. Don't check participant count (race condition: LiveKit
              // may still report the leaving participant in listParticipants
              // when the webhook fires, causing the count check to skip deletion).
              if (scope.type === 'direct') {
                try {
                  await roomService.deleteRoom(livekitRoomName);
                } catch (err) {
                  request.log.warn({ err, livekitRoomName }, 'Failed to delete DM call room');
                }
              }
            }
            // Clean up screenshare if the sharer left
            if (ssInfo && event.participant) {
              const key = `${ssInfo.mode}:${ssInfo.scopeId}`;
              const ss = activeScreenshares.get(key);
              if (ss && ss.userId === event.participant.identity) {
                activeScreenshares.delete(key);
                // CGL-006: bump last_activity_at on screenshare end
                await bumpLastActivity({
                  type: ssInfo.mode === 'room' ? 'room' : 'direct',
                  id: ssInfo.scopeId,
                });
                await broadcastToScreenshareScope(ssInfo, {
                  type: 'screenshare.ended',
                  payload: {
                    mode: ssInfo.mode,
                    scopeId: ssInfo.scopeId,
                    userId: event.participant.identity,
                  },
                });
              }
            }
            break;
          }

          case 'track_published': {
            if (event.participant && event.track) {
              const track = event.track;
              // Camera track (on call rooms)
              if (scope && track.source === 2 /* CAMERA */) {
                await broadcastToCallScope(scope, {
                  type: 'call.camera',
                  payload: {
                    scope,
                    userId: event.participant.identity,
                    hasCamera: true,
                  },
                });
              }
              // Screen share track (on screenshare rooms — room or DM)
              if (ssInfo && (track.source === 3 /* SCREEN_SHARE */ || track.source === 4 /* SCREEN_SHARE_AUDIO */)) {
                if (track.source === 3) {
                  // Only register on the video track, not audio
                  const key = `${ssInfo.mode}:${ssInfo.scopeId}`;
                  const newUserId = event.participant.identity;

                  // CGL-007: If another user is already the active publisher
                  // for this (mode, scopeId), this is a takeover. Signal the
                  // prior publisher to unpublish + disconnect BEFORE we
                  // overwrite the map + broadcast the new started event.
                  // Targeted via sendToUser — all other clients simply see
                  // the `screenshare.started` replacement (the existing
                  // client-side reducer already handles same-scope replace).
                  //
                  // F-CA-R3: Stake the Map slot SYNCHRONOUSLY (before the
                  // DB lookup await below) to close a takeover race-window.
                  // Webhooks are processed concurrently: if two users publish
                  // within ~sub-second of each other, the second handler's
                  // `activeScreenshares.get(key)` previously returned undefined
                  // while the first was still awaiting `prisma.room.findUnique`,
                  // so no takeover event fired for the first publisher. The
                  // first's track then became a ghost on LiveKit (its later
                  // track_unpublished branch skips emit because the Map now
                  // shows the second user). Staking the slot synchronously
                  // means the second handler sees the first's claim and
                  // correctly emits the takeover signal.
                  const existing = activeScreenshares.get(key);
                  if (existing && existing.userId !== newUserId) {
                    sendToUser(existing.userId, {
                      type: 'screenshare.takeover',
                      payload: {
                        mode: ssInfo.mode,
                        scopeId: ssInfo.scopeId,
                        takenOverBy: newUserId,
                      },
                    });
                  }

                  const ssEntry: ActiveScreenshare = {
                    mode: ssInfo.mode,
                    scopeId: ssInfo.scopeId,
                    userId: newUserId,
                  };

                  // Stake the slot immediately — before any await. Subsequent
                  // concurrent publishes will see this user as the current
                  // active publisher and route through the takeover branch
                  // instead of silently overwriting.
                  activeScreenshares.set(key, ssEntry);

                  // Look up source room name for room screenshares. The
                  // inner try/catch already swallows DB errors so the stake
                  // above needs no rollback — a DB-lookup failure just means
                  // sourceRoomName stays undefined (same as pre-fix behaviour).
                  if (ssInfo.mode === 'room') {
                    ssEntry.sourceRoomId = ssInfo.scopeId;
                    try {
                      const room = await prisma.room.findUnique({
                        where: { id: ssInfo.scopeId },
                        select: { name: true },
                      });
                      if (room) ssEntry.sourceRoomName = room.name;
                    } catch {
                      // ignore
                    }
                  }

                  // CGL-006: bump last_activity_at on screenshare start
                  await bumpLastActivity({
                    type: ssInfo.mode === 'room' ? 'room' : 'direct',
                    id: ssInfo.scopeId,
                  });
                  await broadcastToScreenshareScope(ssInfo, {
                    type: 'screenshare.started',
                    payload: {
                      mode: ssInfo.mode,
                      scopeId: ssInfo.scopeId,
                      userId: newUserId,
                      sourceRoomId: ssEntry.sourceRoomId,
                      sourceRoomName: ssEntry.sourceRoomName,
                    },
                  });
                }
              }
            }
            break;
          }

          case 'track_unpublished': {
            if (event.participant && event.track) {
              const track = event.track;
              if (scope && track.source === 2 /* CAMERA */) {
                await broadcastToCallScope(scope, {
                  type: 'call.camera',
                  payload: {
                    scope,
                    userId: event.participant.identity,
                    hasCamera: false,
                  },
                });
              }
              // Screen share track unpublished
              if (ssInfo && track.source === 3 /* SCREEN_SHARE */) {
                const key = `${ssInfo.mode}:${ssInfo.scopeId}`;
                const ss = activeScreenshares.get(key);
                if (ss && ss.userId === event.participant.identity) {
                  activeScreenshares.delete(key);
                  // CGL-006: bump last_activity_at on screenshare end
                  await bumpLastActivity({
                    type: ssInfo.mode === 'room' ? 'room' : 'direct',
                    id: ssInfo.scopeId,
                  });
                  await broadcastToScreenshareScope(ssInfo, {
                    type: 'screenshare.ended',
                    payload: {
                      mode: ssInfo.mode,
                      scopeId: ssInfo.scopeId,
                      userId: event.participant.identity,
                    },
                  });
                }
              }
            }
            break;
          }
        }

        return reply.send({ ok: true });
      } catch (err) {
        request.log.error({ err }, 'LiveKit webhook error');
        return reply.status(400).send({ error: 'Invalid webhook' });
      }
    }
  );
}

// ── Force End Call ──────────────────────────────────────

export async function handleCallForceEnd(
  userId: string,
  payload: { scope: { type: string; id: string } }
): Promise<void> {
  const { scope } = payload;

  // Only admins can force-end calls
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  if (!user?.isAdmin) return;

  // Validate scope membership
  if (scope.type === 'room') {
    const membership = await prisma.groupMembership.findUnique({
      where: { roomId_userId: { roomId: scope.id, userId } },
    });
    if (!membership || membership.state !== 'joined') {
      return; // Silently ignore unauthorized force_end
    }
  } else if (scope.type === 'direct') {
    const dm = await prisma.directConversation.findUnique({
      where: { id: scope.id },
    });
    if (!dm || (dm.participantAId !== userId && dm.participantBId !== userId)) {
      return;
    }
  }

  // Build LiveKit room name
  const livekitRoomName =
    scope.type === 'room'
      ? `call:${scope.id}`
      : `call:dm:${scope.id}`;

  try {
    await roomService.deleteRoom(livekitRoomName);
    // room_finished webhook will handle broadcasting call.ended
  } catch (err) {
    console.error('Failed to force-end call:', err);
  }
}

// ── DM Call Decline ─────────────────────────────────────

export async function handleDmCallDecline(
  userId: string,
  payload: { directId: string; callerId: string }
): Promise<void> {
  const { directId, callerId } = payload;

  // Validate the user is a participant in this DM
  const dm = await prisma.directConversation.findUnique({
    where: { id: directId },
  });
  if (!dm || (dm.participantAId !== userId && dm.participantBId !== userId)) {
    return; // Silently ignore unauthorized decline
  }

  // Notify the caller that the call was declined
  sendToUser(callerId, {
    type: 'dm.call.declined',
    payload: {
      directId,
      declinedBy: userId,
    },
  });

  // Delete the LiveKit room so the caller gets kicked via room_finished webhook
  const livekitRoomName = `call:dm:${directId}`;
  try {
    await roomService.deleteRoom(livekitRoomName);
  } catch (err) {
    console.error('Failed to delete DM call room on decline:', err);
  }
}

// ── Sync Screenshare State from LiveKit ─────────────────
// Called on server startup to rebuild in-memory screenshare map

export async function syncScreenshareState(): Promise<void> {
  try {
    const rooms = await roomService.listRooms();
    for (const room of rooms) {
      const ssInfo = screenshareFromRoomName(room.name);
      if (!ssInfo) continue;

      const participants = await roomService.listParticipants(room.name);
      for (const p of participants) {
        // Check if participant has a screen_share video track (source === 3)
        const hasScreenShare = p.tracks.some(
          (t) => t.source === 3 /* SCREEN_SHARE */
        );

        if (hasScreenShare) {
          const key = `${ssInfo.mode}:${ssInfo.scopeId}`;
          const ssEntry: ActiveScreenshare = {
            mode: ssInfo.mode,
            scopeId: ssInfo.scopeId,
            userId: p.identity,
          };

          // Look up source room name from DB for room screenshares
          if (ssInfo.mode === 'room') {
            ssEntry.sourceRoomId = ssInfo.scopeId;
            try {
              const dbRoom = await prisma.room.findUnique({
                where: { id: ssInfo.scopeId },
                select: { name: true },
              });
              if (dbRoom) ssEntry.sourceRoomName = dbRoom.name;
            } catch {
              // ignore
            }
          }

          activeScreenshares.set(key, ssEntry);
          console.log(`[LiveKit Sync] Restored screenshare: ${key} by ${p.identity}`);
        }
      }
    }

    const count = activeScreenshares.size;
    if (count > 0) {
      console.log(`[LiveKit Sync] Restored ${count} active screenshare(s)`);
    }
  } catch (err) {
    console.warn('[LiveKit Sync] Failed to sync screenshare state:', err);
  }
}
