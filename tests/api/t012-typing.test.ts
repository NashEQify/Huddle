/**
 * T-012: Typing Indicators — API/WS Tests
 *
 * Acceptance Criteria:
 * - typing.start broadcast updates to other users in scope
 * - typing.stop removes user from typing list
 * - Server auto-clears typing after 5s timeout
 * - Typing state cleared on disconnect
 * - typing.update carries full current list
 * - Works for both room and DM scopes
 */

import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { createAuthenticatedClient } from '../helpers/api-client';

// WebSocket helper for testing typing events
function connectWs(cookie: string): Promise<{
  ws: WebSocket;
  messages: Array<{ type: string; payload: any }>;
  waitForMessage: (type: string, timeout?: number) => Promise<any>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:3000/ws', {
      headers: { Cookie: cookie },
    });

    const messages: Array<{ type: string; payload: any }> = [];
    const waiters: Array<{
      type: string;
      resolve: (payload: any) => void;
      reject: (err: Error) => void;
    }> = [];

    ws.on('message', (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf-8');
        const msg = JSON.parse(text);

        // Resolve any waiters for this message type
        const idx = waiters.findIndex((w) => w.type === msg.type);
        if (idx !== -1) {
          const waiter = waiters[idx]!;
          waiters.splice(idx, 1);
          waiter.resolve(msg.payload);
        } else {
          // Only store in messages array if no waiter consumed it
          messages.push(msg);
        }
      } catch {
        // ignore
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        waitForMessage: (type: string, timeout = 10000) => {
          // Check if already received
          const existing = messages.find((m) => m.type === type);
          if (existing) {
            messages.splice(messages.indexOf(existing), 1);
            return Promise.resolve(existing.payload);
          }

          return new Promise<any>((res, rej) => {
            const timer = setTimeout(() => {
              const idx = waiters.findIndex((w) => w.resolve === res);
              if (idx !== -1) waiters.splice(idx, 1);
              rej(new Error(`Timeout waiting for ${type}`));
            }, timeout);

            waiters.push({
              type,
              resolve: (payload) => {
                clearTimeout(timer);
                res(payload);
              },
              reject: rej,
            });
          });
        },
        close: () => ws.close(),
      });
    });

    ws.on('error', (err) => reject(err));
  });
}

function getCookieString(client: any): string {
  return `huddle_session=${client.getCookie('huddle_session')}`;
}

describe('T-012: Typing Indicators — WS Events', () => {
  it('should broadcast typing.update when user starts typing in a room', async () => {
    // Create two users and a room
    const { client: client1, user: user1 } = await createAuthenticatedClient();
    const { client: client2, user: user2 } = await createAuthenticatedClient();

    // Create a room and both users join
    const roomRes = await client1.post('/api/rooms', { name: `TypingRoom-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;
    await client2.patch(`/api/rooms/${roomId}/join`);

    // Connect both to WS
    const ws1 = await connectWs(getCookieString(client1));
    const ws2 = await connectWs(getCookieString(client2));

    // Wait for presence.sync to complete
    await ws1.waitForMessage('presence.sync');
    await ws2.waitForMessage('presence.sync');

    // User1 sends typing.start
    ws1.ws.send(
      JSON.stringify({
        type: 'typing.start',
        payload: { scopeType: 'room', scopeId: roomId },
      })
    );

    // User2 should receive typing.update with user1's ID
    const update = await ws2.waitForMessage('typing.update');
    expect(update.scopeType).toBe('room');
    expect(update.scopeId).toBe(roomId);
    expect(update.typingUserIds).toContain(user1.id);

    ws1.close();
    ws2.close();
  });

  it('should remove user from typing list on typing.stop', async () => {
    const { client: client1, user: user1 } = await createAuthenticatedClient();
    const { client: client2, user: user2 } = await createAuthenticatedClient();

    const roomRes = await client1.post('/api/rooms', { name: `StopRoom-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;
    await client2.patch(`/api/rooms/${roomId}/join`);

    const ws1 = await connectWs(getCookieString(client1));
    const ws2 = await connectWs(getCookieString(client2));

    await ws1.waitForMessage('presence.sync');
    await ws2.waitForMessage('presence.sync');

    // User1 starts typing
    ws1.ws.send(
      JSON.stringify({
        type: 'typing.start',
        payload: { scopeType: 'room', scopeId: roomId },
      })
    );

    await ws2.waitForMessage('typing.update');

    // User1 stops typing
    ws1.ws.send(
      JSON.stringify({
        type: 'typing.stop',
        payload: { scopeType: 'room', scopeId: roomId },
      })
    );

    // User2 should receive update with empty list
    const update = await ws2.waitForMessage('typing.update');
    expect(update.typingUserIds).not.toContain(user1.id);

    ws1.close();
    ws2.close();
  });

  it('should clear typing state on disconnect', async () => {
    const { client: client1, user: user1 } = await createAuthenticatedClient();
    const { client: client2, user: user2 } = await createAuthenticatedClient();

    const roomRes = await client1.post('/api/rooms', { name: `DiscoRoom-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;
    await client2.patch(`/api/rooms/${roomId}/join`);

    const ws1 = await connectWs(getCookieString(client1));
    const ws2 = await connectWs(getCookieString(client2));

    await ws1.waitForMessage('presence.sync');
    await ws2.waitForMessage('presence.sync');

    // User1 starts typing
    ws1.ws.send(
      JSON.stringify({
        type: 'typing.start',
        payload: { scopeType: 'room', scopeId: roomId },
      })
    );

    await ws2.waitForMessage('typing.update');

    // User1 disconnects abruptly
    ws1.close();

    // User2 should receive typing.update with empty list (after cleanup)
    const update = await ws2.waitForMessage('typing.update', 5000);
    expect(update.typingUserIds).not.toContain(user1.id);

    ws2.close();
  });

  it('should auto-clear typing after 5s server timeout', async () => {
    const { client: client1, user: user1 } = await createAuthenticatedClient();
    const { client: client2, user: user2 } = await createAuthenticatedClient();

    const roomRes = await client1.post('/api/rooms', { name: `TimeoutRoom-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;
    await client2.patch(`/api/rooms/${roomId}/join`);

    const ws1 = await connectWs(getCookieString(client1));
    const ws2 = await connectWs(getCookieString(client2));

    await ws1.waitForMessage('presence.sync');
    await ws2.waitForMessage('presence.sync');

    // User1 starts typing
    ws1.ws.send(
      JSON.stringify({
        type: 'typing.start',
        payload: { scopeType: 'room', scopeId: roomId },
      })
    );

    await ws2.waitForMessage('typing.update');

    // Wait for server timeout (5s + buffer)
    const update = await ws2.waitForMessage('typing.update', 7000);
    expect(update.typingUserIds).not.toContain(user1.id);

    ws1.close();
    ws2.close();
  }, 10000);

  it('should work for DM scopes', async () => {
    const { client: client1, user: user1 } = await createAuthenticatedClient();
    const { client: client2, user: user2 } = await createAuthenticatedClient();

    // Create DM by sending first message
    const msgRes = await client1.post('/api/messages', {
      scopeType: 'direct',
      scopeId: `new:${user2.id}`,
      content: 'Hello DM',
    });
    const directId = msgRes.body.data.directId;

    const ws1 = await connectWs(getCookieString(client1));
    const ws2 = await connectWs(getCookieString(client2));

    await ws1.waitForMessage('presence.sync');
    await ws2.waitForMessage('presence.sync');

    // User1 starts typing in the DM
    ws1.ws.send(
      JSON.stringify({
        type: 'typing.start',
        payload: { scopeType: 'direct', scopeId: directId },
      })
    );

    // User2 should receive typing.update for the DM
    const update = await ws2.waitForMessage('typing.update');
    expect(update.scopeType).toBe('direct');
    expect(update.scopeId).toBe(directId);
    expect(update.typingUserIds).toContain(user1.id);

    ws1.close();
    ws2.close();
  });
});
