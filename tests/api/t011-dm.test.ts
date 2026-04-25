/**
 * T-011: DM Conversations — API Tests
 *
 * Acceptance Criteria:
 * - First message creates DirectConversation (lazy creation)
 * - Subsequent messages use real directId
 * - Only participants can read DM messages
 * - GET /api/direct/:otherUserId returns directId or null
 * - GET /api/direct returns all DM conversations for the user
 */

import { describe, it, expect } from 'vitest';
import { createClient, createAuthenticatedClient } from '../helpers/api-client';

// ── Lazy DM Creation ─────────────────────────────────────

describe('T-011: DM — Lazy Creation via POST /api/messages', () => {
  it('should create DirectConversation on first message (new: pattern)', async () => {
    const { client: sender, user: senderUser } = await createAuthenticatedClient();
    const { client: receiver, user: receiverUser } = await createAuthenticatedClient();

    const res = await sender.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${receiverUser.id}`,
      content: 'Hello from DM!',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.message.content).toBe('Hello from DM!');
    expect(res.body.data.message.scopeType).toBe('direct');
    expect(res.body.data.directId).toBeTruthy();

    // The scopeId should be the new directId, not the "new:" pattern
    expect(res.body.data.message.scopeId).toBe(res.body.data.directId);
    expect(res.body.data.message.scopeId).not.toContain('new:');
  });

  it('should reuse existing DirectConversation on second message', async () => {
    const { client: sender, user: senderUser } = await createAuthenticatedClient();
    const { client: receiver, user: receiverUser } = await createAuthenticatedClient();

    // First message creates the DM
    const res1 = await sender.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${receiverUser.id}`,
      content: 'First message',
    });
    const directId = res1.body.data.directId;

    // Second message with "new:" pattern should reuse the same directId
    const res2 = await sender.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${receiverUser.id}`,
      content: 'Second message',
    });
    expect(res2.body.data.directId).toBe(directId);
  });

  it('should use existing directId for subsequent messages', async () => {
    const { client: sender, user: senderUser } = await createAuthenticatedClient();
    const { client: receiver, user: receiverUser } = await createAuthenticatedClient();

    // Create DM
    const res1 = await sender.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${receiverUser.id}`,
      content: 'Create DM',
    });
    const directId = res1.body.data.directId;

    // Send with real directId
    const res2 = await sender.post('/api/messages', {
      scopeType: 'direct',
      scopeId: directId,
      content: 'Using real ID',
    });
    expect(res2.status).toBe(201);
    expect(res2.body.data.message.scopeId).toBe(directId);
  });

  it('should reject DM to self', async () => {
    const { client, user } = await createAuthenticatedClient();

    const res = await client.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${user.id}`,
      content: 'Talking to myself',
    });

    expect(res.status).toBe(400);
  });

  it('should reject DM to non-existent user', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.post('/api/messages', {
      scopeType: 'direct',
      scopeId: 'new:nonexistent-user-id',
      content: 'Hello?',
    });

    expect(res.status).toBe(404);
  });
});

// ── DM Access Control ────────────────────────────────────

describe('T-011: DM — Access Control', () => {
  it('should allow both participants to read messages', async () => {
    const { client: user1, user: u1 } = await createAuthenticatedClient();
    const { client: user2, user: u2 } = await createAuthenticatedClient();

    // User1 creates DM with user2
    const res = await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u2.id}`,
      content: 'Hi from user1',
    });
    const directId = res.body.data.directId;

    // User1 can read
    const msgs1 = await user1.get(`/api/messages?scopeType=direct&scopeId=${directId}`);
    expect(msgs1.status).toBe(200);
    expect(msgs1.body.data.messages.length).toBe(1);

    // User2 can read
    const msgs2 = await user2.get(`/api/messages?scopeType=direct&scopeId=${directId}`);
    expect(msgs2.status).toBe(200);
    expect(msgs2.body.data.messages.length).toBe(1);
  });

  it('should reject reading DM from non-participant', async () => {
    const { client: user1, user: u1 } = await createAuthenticatedClient();
    const { client: user2, user: u2 } = await createAuthenticatedClient();
    const { client: outsider } = await createAuthenticatedClient();

    // Create DM between user1 and user2
    const res = await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u2.id}`,
      content: 'Private message',
    });
    const directId = res.body.data.directId;

    // Outsider cannot read
    const msgs = await outsider.get(`/api/messages?scopeType=direct&scopeId=${directId}`);
    expect(msgs.status).toBe(403);
  });

  it('should reject sending to DM from non-participant', async () => {
    const { client: user1, user: u1 } = await createAuthenticatedClient();
    const { client: user2, user: u2 } = await createAuthenticatedClient();
    const { client: outsider } = await createAuthenticatedClient();

    // Create DM
    const res = await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u2.id}`,
      content: 'First',
    });
    const directId = res.body.data.directId;

    // Outsider cannot send
    const sendRes = await outsider.post('/api/messages', {
      scopeType: 'direct',
      scopeId: directId,
      content: 'Intruder',
    });
    expect(sendRes.status).toBe(403);
  });

  it('should allow receiver to reply', async () => {
    const { client: user1, user: u1 } = await createAuthenticatedClient();
    const { client: user2, user: u2 } = await createAuthenticatedClient();

    // User1 creates DM
    const res = await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u2.id}`,
      content: 'Hello',
    });
    const directId = res.body.data.directId;

    // User2 replies
    const replyRes = await user2.post('/api/messages', {
      scopeType: 'direct',
      scopeId: directId,
      content: 'Hello back!',
    });
    expect(replyRes.status).toBe(201);
    expect(replyRes.body.data.message.content).toBe('Hello back!');
  });
});

// ── Direct Conversation Lookup ───────────────────────────

describe('T-011: DM — GET /api/direct/:otherUserId', () => {
  it('should return null when no DM exists', async () => {
    const { client, user } = await createAuthenticatedClient();
    const { user: otherUser } = await createAuthenticatedClient();

    const res = await client.get(`/api/direct/${otherUser.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.directId).toBeNull();
  });

  it('should return directId when DM exists', async () => {
    const { client: user1, user: u1 } = await createAuthenticatedClient();
    const { client: user2, user: u2 } = await createAuthenticatedClient();

    // Create DM
    const msgRes = await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u2.id}`,
      content: 'Creating DM',
    });
    const directId = msgRes.body.data.directId;

    // Both users should find the DM
    const res1 = await user1.get(`/api/direct/${u2.id}`);
    expect(res1.body.data.directId).toBe(directId);

    const res2 = await user2.get(`/api/direct/${u1.id}`);
    expect(res2.body.data.directId).toBe(directId);
  });

  it('should reject lookup with self', async () => {
    const { client, user } = await createAuthenticatedClient();

    const res = await client.get(`/api/direct/${user.id}`);
    expect(res.status).toBe(400);
  });
});

// ── List DM Conversations ────────────────────────────────

describe('T-011: DM — GET /api/direct', () => {
  it('should return all DM conversations for user', async () => {
    const { client: user1, user: u1 } = await createAuthenticatedClient();
    const { client: user2, user: u2 } = await createAuthenticatedClient();
    const { client: user3, user: u3 } = await createAuthenticatedClient();

    // User1 DMs user2 and user3
    await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u2.id}`,
      content: 'DM to user2',
    });
    await user1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${u3.id}`,
      content: 'DM to user3',
    });

    const res = await user1.get('/api/direct');
    expect(res.status).toBe(200);
    expect(res.body.data.conversations.length).toBe(2);

    // Each conversation should have otherUser info
    for (const conv of res.body.data.conversations) {
      expect(conv.otherUser.id).toBeTruthy();
      expect(conv.otherUser.username).toBeTruthy();
    }
  });

  it('should return empty when no DMs exist', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.get('/api/direct');
    expect(res.status).toBe(200);
    expect(res.body.data.conversations.length).toBe(0);
  });
});
