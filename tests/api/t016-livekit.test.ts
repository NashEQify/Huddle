/**
 * T-016: LiveKit Voice Calls — API Tests
 *
 * Tests for:
 * - POST /api/livekit/token (token generation)
 * - Room name pattern validation
 * - Permission checks (membership, DM participation)
 */

import { describe, test, expect } from 'vitest';
import { createAuthenticatedClient, createClient } from '../helpers/api-client';

describe('T-016: LiveKit Token Generation', () => {
  test('should generate token for room call when user is joined', async () => {
    const { client } = await createAuthenticatedClient();

    // Create a room (auto-joins)
    const roomRes = await client.post('/api/rooms', { name: `LKTest-${Date.now()}` });
    expect(roomRes.status).toBe(201);
    const roomId = roomRes.body.data.room.id;

    // Request token
    const tokenRes = await client.post('/api/livekit/token', {
      roomName: `call:${roomId}`,
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.data.token).toBeDefined();
    expect(typeof tokenRes.body.data.token).toBe('string');
    expect(tokenRes.body.data.token.length).toBeGreaterThan(0);
  });

  test('should reject token request without authentication', async () => {
    const client = createClient();
    const tokenRes = await client.post('/api/livekit/token', {
      roomName: 'call:fake-room',
    });
    expect(tokenRes.status).toBe(401);
  });

  test('should reject token for non-joined room', async () => {
    const { client: creator } = await createAuthenticatedClient();
    const { client: other } = await createAuthenticatedClient();

    // Creator makes a room
    const roomRes = await creator.post('/api/rooms', { name: `LKNoJoin-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    // Other user (not joined) requests token
    const tokenRes = await other.post('/api/livekit/token', {
      roomName: `call:${roomId}`,
    });
    expect(tokenRes.status).toBe(403);
  });

  test('should reject token with missing roomName', async () => {
    const { client } = await createAuthenticatedClient();
    const tokenRes = await client.post('/api/livekit/token', {});
    expect(tokenRes.status).toBe(400);
  });

  test('should reject token with invalid room name pattern', async () => {
    const { client } = await createAuthenticatedClient();
    const tokenRes = await client.post('/api/livekit/token', {
      roomName: 'invalid-pattern',
    });
    expect(tokenRes.status).toBe(400);
  });

  test('should reject token for DM call when not a participant', async () => {
    const { client: user1, user: u1 } = await createAuthenticatedClient();
    const { client: user2, user: u2 } = await createAuthenticatedClient();
    const { client: user3 } = await createAuthenticatedClient();

    // Create a DM between user1 and user2
    const msgRes = await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u2.id}`,
      content: 'DM for LK test',
    });
    expect(msgRes.status).toBe(201);
    const directId = msgRes.body.data.directId;

    // user3 tries to get token for this DM call
    const tokenRes = await user3.post('/api/livekit/token', {
      roomName: `call:dm:${directId}`,
    });
    expect(tokenRes.status).toBe(403);
  });

  test('should allow token for DM call when user is a participant', async () => {
    const { client: user1, user: u1 } = await createAuthenticatedClient();
    const { client: user2, user: u2 } = await createAuthenticatedClient();

    // Create a DM between user1 and user2
    const msgRes = await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u2.id}`,
      content: 'DM for LK token test',
    });
    expect(msgRes.status).toBe(201);
    const directId = msgRes.body.data.directId;

    // user2 requests token for this DM call
    const tokenRes = await user2.post('/api/livekit/token', {
      roomName: `call:dm:${directId}`,
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.data.token).toBeDefined();
  });

  test('should generate token for screenshare room pattern', async () => {
    const { client } = await createAuthenticatedClient();

    // Create a room
    const roomRes = await client.post('/api/rooms', { name: `LKScreen-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    // Request screenshare token
    const tokenRes = await client.post('/api/livekit/token', {
      roomName: `ss:room:${roomId}`,
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.data.token).toBeDefined();
  });

  test('should allow global screenshare token for own user ID', async () => {
    const { client, user } = await createAuthenticatedClient();

    const tokenRes = await client.post('/api/livekit/token', {
      roomName: `ss:global:${user.id}`,
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.data.token).toBeDefined();
  });

  test('should reject global screenshare token for another user ID', async () => {
    const { client } = await createAuthenticatedClient();
    const { user: other } = await createAuthenticatedClient();

    const tokenRes = await client.post('/api/livekit/token', {
      roomName: `ss:global:${other.id}`,
    });
    expect(tokenRes.status).toBe(403);
  });
});
