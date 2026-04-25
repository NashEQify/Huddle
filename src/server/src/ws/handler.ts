import type { WsMessage } from '@huddle/shared';

// ── WebSocket type ───────────────────────────────────────
// Minimal interface matching the ws.WebSocket API we use,
// avoiding a direct import from 'ws' which lacks @types/ws.

interface WsConnection {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  on(event: 'pong', listener: () => void): void;
  on(event: 'message', listener: (data: Buffer | string) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

// ── Connection Registry ──────────────────────────────────
// userId -> WebSocket. Single connection per user (last-write-wins).

const connections = new Map<string, WsConnection>();

/**
 * Register a user's WebSocket connection.
 * If the user already has a connection, close the old one first.
 */
function addConnection(userId: string, ws: WsConnection): void {
  const existing = connections.get(userId);
  if (existing && existing !== ws) {
    // Close previous connection (duplicate tab / stale reconnect)
    existing.close(4000, 'Replaced by new connection');
  }
  connections.set(userId, ws);
}

/**
 * Remove a user's WebSocket connection.
 * Only removes if the stored connection matches (avoids race with replacement).
 */
function removeConnection(userId: string, ws: WsConnection): void {
  const stored = connections.get(userId);
  if (stored === ws) {
    connections.delete(userId);
  }
}

/**
 * Broadcast a message to all connected clients, optionally excluding one user.
 *
 * Per spec 25-websocket §25.7 + CGL-011: takes a snapshot of the connection
 * entries before iteration to avoid disruption if the map mutates during send
 * (disconnect/reconnect mid-broadcast).
 */
function broadcast(message: WsMessage, excludeUserId?: string): void {
  const data = JSON.stringify(message);
  // Snapshot entries before iterating (guards against concurrent
  // add/remove while we fan out the message).
  const snapshot = [...connections];
  for (const [userId, ws] of snapshot) {
    if (userId === excludeUserId) continue;
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

/**
 * Broadcast a message to a specific set of userIds. Disconnected users are
 * silently skipped. Used when a broadcast must be membership-filtered —
 * e.g. room message broadcasts per spec 25-websocket §25.5 + CGL-002.
 *
 * Pass a Set or an Array; we snapshot & iterate only over registered users.
 */
function broadcastToUsers(
  userIds: Iterable<string>,
  message: WsMessage,
  excludeUserId?: string,
): void {
  const data = JSON.stringify(message);
  for (const userId of userIds) {
    if (userId === excludeUserId) continue;
    const ws = connections.get(userId);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

/**
 * Send a message to a specific user. No-op if user is not connected.
 */
function sendToUser(userId: string, message: WsMessage): void {
  const ws = connections.get(userId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Get all currently online user IDs.
 */
function getOnlineUserIds(): string[] {
  return Array.from(connections.keys());
}

/**
 * Check if a specific user is online.
 */
function isUserOnline(userId: string): boolean {
  return connections.has(userId);
}

/**
 * Force-close all WebSocket connections for a user.
 * Used by admin deactivation to immediately disconnect the user.
 */
function removeAllConnectionsForUser(userId: string): void {
  const ws = connections.get(userId);
  if (ws) {
    ws.close(4004, 'Account deactivated');
    connections.delete(userId);
  }
}

export type { WsConnection };

export {
  connections,
  addConnection,
  removeConnection,
  removeAllConnectionsForUser,
  broadcast,
  broadcastToUsers,
  sendToUser,
  getOnlineUserIds,
  isUserOnline,
};
