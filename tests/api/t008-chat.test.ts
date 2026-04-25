/**
 * T-008: Chat — Room View & Messages — API Tests
 *
 * Acceptance Criteria:
 * - Messages load paginated (50 initial, older on scroll-up)
 * - Room creation works (POST /api/rooms)
 * - Created room auto-joins creator
 * - Membership join/leave/rejoin works
 * - Membership gating: not_joined can't read messages, left can read, joined can send
 * - Message creation with WS broadcast
 * - System messages on join/leave/rejoin
 * - Message content validation
 */

import { describe, it, expect } from 'vitest';
import { createClient, createAuthenticatedClient } from '../helpers/api-client';

// ── Room Creation ────────────────────────────────────────

describe('T-008: Room Creation — POST /api/rooms', () => {
  it('should create a room and auto-join the creator', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.post('/api/rooms', {
      name: 'Test Room',
      discoverable: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.room.name).toBe('Test Room');
    expect(res.body.data.room.discoverable).toBe(true);
    expect(res.body.data.room.id).toBeTruthy();

    // Creator should be auto-joined
    const roomsRes = await client.get('/api/rooms');
    const createdRoom = roomsRes.body.data.rooms.find(
      (r: any) => r.id === res.body.data.room.id
    );
    expect(createdRoom).toBeTruthy();
    expect(createdRoom.membership).toBe('joined');
  });

  it('should create a non-discoverable room', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.post('/api/rooms', {
      name: 'Secret Room',
      discoverable: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.room.discoverable).toBe(false);
  });

  it('should default discoverable to true', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.post('/api/rooms', {
      name: 'Default Room',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.room.discoverable).toBe(true);
  });

  it('should validate room name is required', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.post('/api/rooms', {});
    expect(res.status).toBe(400);
  });

  it('should validate room name length (1-50)', async () => {
    const { client } = await createAuthenticatedClient();

    // Empty name
    const res1 = await client.post('/api/rooms', { name: '' });
    expect(res1.status).toBe(400);

    // Too long name
    const res2 = await client.post('/api/rooms', { name: 'A'.repeat(51) });
    expect(res2.status).toBe(400);
  });

  it('should require authentication', async () => {
    const client = createClient();
    const res = await client.post('/api/rooms', { name: 'Test' });
    expect(res.status).toBe(401);
  });
});

// ── Membership Routes ────────────────────────────────────

describe('T-008: Membership — Join/Leave/Rejoin', () => {
  it('should join a room', async () => {
    const { client: creator } = await createAuthenticatedClient();
    const { client: joiner } = await createAuthenticatedClient();

    // Creator makes a room
    const roomRes = await creator.post('/api/rooms', { name: 'Join Test' });
    const roomId = roomRes.body.data.room.id;

    // Joiner joins
    const joinRes = await joiner.patch(`/api/rooms/${roomId}/join`);
    expect(joinRes.status).toBe(200);
    expect(joinRes.body.data.membership.state).toBe('joined');
    expect(joinRes.body.data.membership.roomId).toBe(roomId);
  });

  it('should reject double join', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Double Join' });
    const roomId = roomRes.body.data.room.id;

    // Already joined as creator
    const joinRes = await client.patch(`/api/rooms/${roomId}/join`);
    expect(joinRes.status).toBe(400);
    expect(joinRes.body.error.code).toBe('ALREADY_JOINED');
  });

  it('should leave a room', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Leave Test' });
    const roomId = roomRes.body.data.room.id;

    const leaveRes = await client.patch(`/api/rooms/${roomId}/leave`);
    expect(leaveRes.status).toBe(200);
    expect(leaveRes.body.data.membership.state).toBe('left');
  });

  it('should rejoin a room after leaving', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Rejoin Test' });
    const roomId = roomRes.body.data.room.id;

    await client.patch(`/api/rooms/${roomId}/leave`);
    const rejoinRes = await client.patch(`/api/rooms/${roomId}/rejoin`);
    expect(rejoinRes.status).toBe(200);
    expect(rejoinRes.body.data.membership.state).toBe('joined');
  });

  it('should reject rejoin when not in left state', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Bad Rejoin' });
    const roomId = roomRes.body.data.room.id;

    // Still joined, rejoin should fail
    const rejoinRes = await client.patch(`/api/rooms/${roomId}/rejoin`);
    expect(rejoinRes.status).toBe(400);
  });

  it('should reject leave when not joined', async () => {
    const { client: creator } = await createAuthenticatedClient();
    const { client: outsider } = await createAuthenticatedClient();

    const roomRes = await creator.post('/api/rooms', { name: 'Leave Fail' });
    const roomId = roomRes.body.data.room.id;

    const leaveRes = await outsider.patch(`/api/rooms/${roomId}/leave`);
    expect(leaveRes.status).toBe(400);
  });
});

// ── Messages — GET (Pagination) ─────────────────────────

describe('T-008: Messages — GET /api/messages', () => {
  it('should return messages for a joined room', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Msg Room' });
    const roomId = roomRes.body.data.room.id;

    // Send some messages
    await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Hello World',
    });

    const msgRes = await client.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    expect(msgRes.status).toBe(200);
    expect(msgRes.body.data.messages.length).toBeGreaterThanOrEqual(1);
    expect(msgRes.body.data.hasMore).toBe(false);

    // Find our message (exclude system messages)
    const userMessages = msgRes.body.data.messages.filter(
      (m: any) => !m.content.startsWith('::system::')
    );
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].content).toBe('Hello World');
    expect(userMessages[0].author.username).toBeTruthy();
  });

  it('should paginate with cursor (before timestamp)', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Pag Room' });
    const roomId = roomRes.body.data.room.id;

    // Send 5 messages
    for (let i = 0; i < 5; i++) {
      await client.post('/api/messages', {
        scopeType: 'room',
        scopeId: roomId,
        content: `Message ${i}`,
      });
    }

    // Get with limit 3
    const res1 = await client.get(
      `/api/messages?scopeType=room&scopeId=${roomId}&limit=3`
    );
    expect(res1.status).toBe(200);
    // May include system message (joined) so total could be >3
    // But the limit applies to all messages
    expect(res1.body.data.messages.length).toBeLessThanOrEqual(3);
    expect(res1.body.data.hasMore).toBe(true);

    // Get older messages using cursor
    const oldestTs = res1.body.data.messages[0].createdAt;
    const res2 = await client.get(
      `/api/messages?scopeType=room&scopeId=${roomId}&before=${oldestTs}&limit=10`
    );
    expect(res2.status).toBe(200);
    // Should have remaining messages
    expect(res2.body.data.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('should return messages in chronological order', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Order Room' });
    const roomId = roomRes.body.data.room.id;

    await client.post('/api/messages', { scopeType: 'room', scopeId: roomId, content: 'First' });
    await client.post('/api/messages', { scopeType: 'room', scopeId: roomId, content: 'Second' });

    const res = await client.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    const msgs = res.body.data.messages;

    // Messages should be oldest first
    for (let i = 1; i < msgs.length; i++) {
      expect(new Date(msgs[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(msgs[i - 1].createdAt).getTime()
      );
    }
  });

  it('should reject messages for not_joined room', async () => {
    const { client: creator } = await createAuthenticatedClient();
    const { client: outsider } = await createAuthenticatedClient();

    const roomRes = await creator.post('/api/rooms', { name: 'Private' });
    const roomId = roomRes.body.data.room.id;

    const msgRes = await outsider.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    expect(msgRes.status).toBe(403);
  });

  it('should allow reading messages for left room (read-only)', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Left Read' });
    const roomId = roomRes.body.data.room.id;

    // Send a message while joined
    await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Before leaving',
    });

    // Leave room
    await client.patch(`/api/rooms/${roomId}/leave`);

    // Should still be able to read messages
    const msgRes = await client.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    expect(msgRes.status).toBe(200);
  });
});

// ── Messages — POST (Send) ──────────────────────────────

describe('T-008: Messages — POST /api/messages', () => {
  it('should send a message to a joined room', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Send Room' });
    const roomId = roomRes.body.data.room.id;

    const res = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Test message',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.message.content).toBe('Test message');
    expect(res.body.data.message.scopeType).toBe('room');
    expect(res.body.data.message.scopeId).toBe(roomId);
    expect(res.body.data.message.author).toBeTruthy();
  });

  it('should reject message from non-joined user', async () => {
    const { client: creator } = await createAuthenticatedClient();
    const { client: outsider } = await createAuthenticatedClient();

    const roomRes = await creator.post('/api/rooms', { name: 'No Send' });
    const roomId = roomRes.body.data.room.id;

    const res = await outsider.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Should fail',
    });

    expect(res.status).toBe(403);
  });

  it('should reject message from left user', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Left Send' });
    const roomId = roomRes.body.data.room.id;

    await client.patch(`/api/rooms/${roomId}/leave`);

    const res = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Should fail',
    });

    expect(res.status).toBe(403);
  });

  it('should validate message content (1-4000 chars)', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Valid Room' });
    const roomId = roomRes.body.data.room.id;

    // Empty content
    const res1 = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: '',
    });
    expect(res1.status).toBe(400);

    // Whitespace-only content
    const res2 = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: '   ',
    });
    expect(res2.status).toBe(400);

    // Too long
    const res3 = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'A'.repeat(4001),
    });
    expect(res3.status).toBe(400);
  });

  it('should require all fields', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.post('/api/messages', {
      scopeType: 'room',
    });
    expect(res.status).toBe(400);
  });

  it('should validate scopeType', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.post('/api/messages', {
      scopeType: 'invalid',
      scopeId: 'some-id',
      content: 'test',
    });
    expect(res.status).toBe(400);
  });
});

// ── System Messages ─────────────────────────────────────

describe('T-008: System Messages', () => {
  it('should create system message on join', async () => {
    const { client: creator } = await createAuthenticatedClient();
    const { client: joiner } = await createAuthenticatedClient();

    const roomRes = await creator.post('/api/rooms', { name: 'SysMsg Room' });
    const roomId = roomRes.body.data.room.id;

    await joiner.patch(`/api/rooms/${roomId}/join`);

    // Read messages as creator
    const msgRes = await creator.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    const systemMessages = msgRes.body.data.messages.filter((m: any) =>
      m.content.startsWith('::system::')
    );

    // Should have at least 2 system messages (creator joined + joiner joined)
    expect(systemMessages.length).toBeGreaterThanOrEqual(2);
    expect(systemMessages.some((m: any) => m.content === '::system::joined')).toBe(true);
  });

  it('should create system message on leave', async () => {
    const { client } = await createAuthenticatedClient();

    const roomRes = await client.post('/api/rooms', { name: 'Leave SysMsg' });
    const roomId = roomRes.body.data.room.id;

    await client.patch(`/api/rooms/${roomId}/leave`);

    // Read messages — since we left, we can still read
    const msgRes = await client.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    const systemMessages = msgRes.body.data.messages.filter((m: any) =>
      m.content === '::system::left'
    );
    expect(systemMessages.length).toBe(1);
  });
});

// ── Messages — Author Resolution ─────────────────────────

describe('T-008: Message Author Resolution', () => {
  it('should include author profile with avatar URL', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: 'Author Room' });
    const roomId = roomRes.body.data.room.id;

    await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Test with author',
    });

    const msgRes = await client.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    const userMessages = msgRes.body.data.messages.filter(
      (m: any) => !m.content.startsWith('::system::')
    );
    const msg = userMessages[0];

    expect(msg.author).toBeTruthy();
    expect(msg.author.id).toBeTruthy();
    expect(msg.author.username).toBeTruthy();
    expect(msg.author.profile).toBeTruthy();
    expect(msg.author.profile.avatarKind).toBeTruthy();
  });
});
