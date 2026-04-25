/**
 * T-014: Emoji Reactions — API Tests
 *
 * Acceptance Criteria:
 * - Toggle reaction (add/remove) on a message
 * - Only allowed emojis accepted
 * - Max 10 reactions per user per message
 * - Reactions included in message list response
 * - Membership/participant gating
 * - Real-time broadcast via WS
 */

import { describe, it, expect } from 'vitest';
import { createAuthenticatedClient } from '../helpers/api-client';

describe('T-014: Emoji Reactions — Toggle', () => {
  it('should add a reaction to a message', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `React-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    // Send a message
    const msgRes = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'React to this!',
    });
    const messageId = msgRes.body.data.message.id;

    // Add a reaction
    const res = await client.post(`/api/messages/${messageId}/reactions`, {
      emoji: '\u{1F44D}', // 👍
    });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('add');
    expect(res.body.data.reactions).toHaveLength(1);
    expect(res.body.data.reactions[0].emoji).toBe('\u{1F44D}');
    expect(res.body.data.reactions[0].count).toBe(1);
  });

  it('should toggle (remove) an existing reaction', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `Toggle-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const msgRes = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Toggle me',
    });
    const messageId = msgRes.body.data.message.id;

    // Add
    await client.post(`/api/messages/${messageId}/reactions`, { emoji: '\u{1F525}' });

    // Toggle (remove)
    const res = await client.post(`/api/messages/${messageId}/reactions`, { emoji: '\u{1F525}' });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('remove');
    expect(res.body.data.reactions).toHaveLength(0);
  });

  it('should allow multiple different emojis from same user', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `Multi-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const msgRes = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'React lots',
    });
    const messageId = msgRes.body.data.message.id;

    // Add three different emojis
    await client.post(`/api/messages/${messageId}/reactions`, { emoji: '\u{1F44D}' }); // 👍
    await client.post(`/api/messages/${messageId}/reactions`, { emoji: '\u{1F525}' }); // 🔥
    const res = await client.post(`/api/messages/${messageId}/reactions`, { emoji: '\u{1F480}' }); // 💀

    expect(res.body.data.reactions).toHaveLength(3);
  });

  it('should aggregate reactions from multiple users', async () => {
    const { client: client1 } = await createAuthenticatedClient();
    const { client: client2 } = await createAuthenticatedClient();

    const roomRes = await client1.post('/api/rooms', { name: `Agg-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    // User2 joins the room
    await client2.patch(`/api/rooms/${roomId}/join`);

    const msgRes = await client1.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Everyone react!',
    });
    const messageId = msgRes.body.data.message.id;

    // Both users react with the same emoji
    await client1.post(`/api/messages/${messageId}/reactions`, { emoji: '\u{1F44D}' });
    const res = await client2.post(`/api/messages/${messageId}/reactions`, { emoji: '\u{1F44D}' });

    expect(res.body.data.reactions).toHaveLength(1);
    expect(res.body.data.reactions[0].count).toBe(2);
    expect(res.body.data.reactions[0].userIds).toHaveLength(2);
  });
});

describe('T-014: Emoji Reactions — Validation', () => {
  it('should reject disallowed emojis', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `Bad-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const msgRes = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'No custom emojis',
    });
    const messageId = msgRes.body.data.message.id;

    const res = await client.post(`/api/messages/${messageId}/reactions`, {
      emoji: '\u{1F4B0}', // 💰 not in allowed set
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('not allowed');
  });

  it('should enforce max 10 reactions per user per message', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `Max-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const msgRes = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Max reactions',
    });
    const messageId = msgRes.body.data.message.id;

    // Add 10 different emojis
    const emojis = [
      '\u{1F44D}', '\u{1F44E}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62D}',
      '\u{1F525}', '\u{1F480}', '\u{1F624}', '\u{1F914}', '\u{1F60E}',
    ];

    for (const emoji of emojis) {
      const r = await client.post(`/api/messages/${messageId}/reactions`, { emoji });
      expect(r.status).toBe(200);
    }

    // 11th should be rejected
    const res = await client.post(`/api/messages/${messageId}/reactions`, {
      emoji: '\u{1FAE1}', // 🫡
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Maximum');
  });

  it('should require emoji field', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `NoEmoji-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const msgRes = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Missing emoji',
    });
    const messageId = msgRes.body.data.message.id;

    const res = await client.post(`/api/messages/${messageId}/reactions`, {});
    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent message', async () => {
    const { client } = await createAuthenticatedClient();
    const res = await client.post('/api/messages/nonexistent/reactions', {
      emoji: '\u{1F44D}',
    });
    expect(res.status).toBe(404);
  });
});

describe('T-014: Emoji Reactions — Membership Gating', () => {
  it('should reject reactions from non-joined users', async () => {
    const { client: creator } = await createAuthenticatedClient();
    const { client: outsider } = await createAuthenticatedClient();

    const roomRes = await creator.post('/api/rooms', { name: `Gate-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const msgRes = await creator.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Members only react',
    });
    const messageId = msgRes.body.data.message.id;

    // Outsider (not joined) tries to react
    const res = await outsider.post(`/api/messages/${messageId}/reactions`, {
      emoji: '\u{1F44D}',
    });
    expect(res.status).toBe(403);
  });
});

describe('T-014: Emoji Reactions — In Message List', () => {
  it('should include reactions when fetching messages', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `List-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const msgRes = await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'React and list',
    });
    const messageId = msgRes.body.data.message.id;

    // Add a reaction
    await client.post(`/api/messages/${messageId}/reactions`, { emoji: '\u{1F525}' });

    // Fetch messages
    const listRes = await client.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    expect(listRes.status).toBe(200);

    const msg = listRes.body.data.messages.find((m: any) => m.id === messageId);
    expect(msg).toBeDefined();
    expect(msg.reactions).toHaveLength(1);
    expect(msg.reactions[0].emoji).toBe('\u{1F525}');
    expect(msg.reactions[0].count).toBe(1);
  });
});
