/**
 * T-006: WebSocket Connection & Presence
 *
 * Acceptance Criteria:
 * - WS connects after login with session cookie auth
 * - presence.sync received with all user states
 * - Other clients receive presence.online/presence.offline events
 * - Dead client detected within ~40s (ping/pong timeout) — not tested (too slow)
 * - Reconnection works with backoff — frontend only, not tested here
 * - Banner shows/hides on disconnect/reconnect — E2E
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createClient } from '../helpers/api-client';

const WS_URL = 'ws://localhost:3000/ws';

/**
 * Helper: connect a WebSocket with session cookie.
 */
function connectWs(sessionCookie: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers: { Cookie: `huddle_session=${sessionCookie}` },
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    // Timeout after 5s
    setTimeout(() => reject(new Error('WS connection timeout')), 5000);
  });
}

/**
 * Helper: wait for a specific message type.
 */
function waitForMessage(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${type}`)),
      timeoutMs
    );

    const handler = (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

// Track WebSockets to close in afterEach
const openSockets: WebSocket[] = [];

afterEach(() => {
  for (const ws of openSockets) {
    try {
      ws.close();
    } catch {
      // Ignore
    }
  }
  openSockets.length = 0;
});

describe('T-006: WebSocket — Connection & Auth', () => {
  it('should connect with valid session cookie', async () => {
    const client = createClient();
    await client.signup();
    const sessionCookie = client.getCookie('huddle_session')!;
    expect(sessionCookie).toBeTruthy();

    const ws = await connectWs(sessionCookie);
    openSockets.push(ws);

    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('should reject connection without session cookie', async () => {
    // Connect without cookie — should close with 4001
    const ws = new WebSocket(WS_URL);
    openSockets.push(ws);

    await new Promise<void>((resolve, reject) => {
      ws.on('close', (code) => {
        expect(code).toBe(4001);
        resolve();
      });
      ws.on('error', () => {
        // Expected — connection refused or closed
        resolve();
      });
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });
  });

  it('should reject connection with invalid session cookie', async () => {
    const ws = new WebSocket(WS_URL, {
      headers: { Cookie: 'huddle_session=invalid-session-id' },
    });
    openSockets.push(ws);

    await new Promise<void>((resolve, reject) => {
      ws.on('close', (code) => {
        expect(code).toBe(4001);
        resolve();
      });
      ws.on('error', () => resolve());
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });
  });
});

describe('T-006: WebSocket — Presence', () => {
  it('should receive presence.sync on connect', async () => {
    const client = createClient();
    await client.signup();
    const sessionCookie = client.getCookie('huddle_session')!;

    const ws = await connectWs(sessionCookie);
    openSockets.push(ws);

    const msg = await waitForMessage(ws, 'presence.sync');

    expect(msg.type).toBe('presence.sync');
    expect(msg.payload.users).toBeInstanceOf(Array);
    expect(msg.payload.users.length).toBeGreaterThan(0);

    // Each user entry should have userId and isActive
    for (const user of msg.payload.users) {
      expect(user.userId).toBeTruthy();
      expect(typeof user.isActive).toBe('boolean');
    }
  });

  it('should broadcast presence.online to other clients', async () => {
    // User A connects first
    const clientA = createClient();
    await clientA.signup();
    const cookieA = clientA.getCookie('huddle_session')!;
    const wsA = await connectWs(cookieA);
    openSockets.push(wsA);

    // Wait for A's sync to complete
    await waitForMessage(wsA, 'presence.sync');

    // User B connects — A should receive presence.online
    const clientB = createClient();
    const signupB = await clientB.signup();
    const userIdB = signupB.body.data.user.id;
    const cookieB = clientB.getCookie('huddle_session')!;

    // Start listening for online event BEFORE B connects
    const onlinePromise = waitForMessage(wsA, 'presence.online');

    const wsB = await connectWs(cookieB);
    openSockets.push(wsB);

    const onlineMsg = await onlinePromise;
    expect(onlineMsg.payload.userId).toBe(userIdB);
  });

  it('should broadcast presence.offline when a client disconnects', async () => {
    // User A connects
    const clientA = createClient();
    await clientA.signup();
    const cookieA = clientA.getCookie('huddle_session')!;
    const wsA = await connectWs(cookieA);
    openSockets.push(wsA);
    await waitForMessage(wsA, 'presence.sync');

    // User B connects
    const clientB = createClient();
    const signupB = await clientB.signup();
    const userIdB = signupB.body.data.user.id;
    const cookieB = clientB.getCookie('huddle_session')!;
    const wsB = await connectWs(cookieB);
    openSockets.push(wsB);
    await waitForMessage(wsA, 'presence.online');

    // Start listening for offline event
    const offlinePromise = waitForMessage(wsA, 'presence.offline');

    // B disconnects
    wsB.close();

    const offlineMsg = await offlinePromise;
    expect(offlineMsg.payload.userId).toBe(userIdB);
    expect(offlineMsg.payload.lastSeenAt).toBeTruthy();
  });
});
