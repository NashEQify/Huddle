/**
 * Shared LiveKit Configuration — Single source of truth for LiveKit service clients.
 *
 * Both admin.ts and livekit.ts routes need RoomServiceClient with identical config.
 * This module centralizes env-var reading, URL conversion, and production validation
 * so there's exactly one place to maintain LiveKit connection setup.
 *
 * WebhookReceiver is also exported here since it uses the same credentials.
 */

import { RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';

// ── ENV ────────────────────────────────────────────────

export const LK_API_KEY = process.env['LIVEKIT_API_KEY'] || 'devkey';
export const LK_API_SECRET = process.env['LIVEKIT_API_SECRET'] || 'devsecret';
export const LK_URL = process.env['LIVEKIT_URL'] || 'ws://localhost:7880';

// RoomServiceClient needs HTTP(S), not WS(S)
export const LK_HTTP_URL = LK_URL.replace(/^ws(s?):\/\//, 'http$1://');

// ── Production Guard ───────────────────────────────────

if (process.env['NODE_ENV'] === 'production') {
  if (!process.env['LIVEKIT_API_KEY'] || !process.env['LIVEKIT_API_SECRET']) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in production');
  }
}

// ── Shared Clients ─────────────────────────────────────

/** RoomServiceClient for listing rooms, participants, and deleting rooms. */
export const roomService = new RoomServiceClient(LK_HTTP_URL, LK_API_KEY, LK_API_SECRET);

/** WebhookReceiver for validating incoming LiveKit webhook payloads. */
export const webhookReceiver = new WebhookReceiver(LK_API_KEY, LK_API_SECRET);
