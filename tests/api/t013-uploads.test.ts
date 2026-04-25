/**
 * T-013: File & Image Uploads — API Tests
 *
 * Acceptance Criteria:
 * - Upload via multipart with files
 * - Size limit (10 MB) enforced
 * - Content-type whitelist with magic byte validation
 * - Attachments returned in message responses
 * - Files served auth-protected via /api/uploads/:id/:filename
 * - Multiple files per message (up to 5)
 * - Message can have text + files or just files
 */

import { describe, it, expect } from 'vitest';
import { createAuthenticatedClient } from '../helpers/api-client';
import FormData from 'form-data';

// Helper: create a minimal valid PNG buffer
function createPngBuffer(size = 100): Buffer {
  // Minimal PNG header + IDAT + IEND
  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width 1
    0x00, 0x00, 0x00, 0x01, // height 1
    0x08, 0x02, // bit depth 8, color type 2 (RGB)
    0x00, 0x00, 0x00, // compression, filter, interlace
    0x90, 0x77, 0x53, 0xde, // CRC
  ]);
  // Pad to desired size
  const padding = Buffer.alloc(Math.max(0, size - header.length));
  return Buffer.concat([header, padding]);
}

// Helper: create a minimal valid JPEG buffer
function createJpegBuffer(size = 100): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
  const padding = Buffer.alloc(Math.max(0, size - header.length));
  return Buffer.concat([header, padding]);
}

// Helper: send message with file attachments via multipart
async function sendMessageWithFiles(
  client: ReturnType<typeof createAuthenticatedClient> extends Promise<infer T> ? T : never,
  options: {
    scopeType: string;
    scopeId: string;
    content?: string;
    files?: Array<{ buffer: Buffer; filename: string; contentType: string }>;
  }
) {
  const form = new FormData();
  form.append('scopeType', options.scopeType);
  form.append('scopeId', options.scopeId);
  if (options.content) {
    form.append('content', options.content);
  }
  if (options.files) {
    for (const file of options.files) {
      form.append('files', file.buffer, {
        filename: file.filename,
        contentType: file.contentType,
      });
    }
  }

  // Use raw fetch since supertest may not handle form-data well
  const cookie = `huddle_session=${client.client.getCookie('huddle_session')}`;
  const response = await fetch('http://localhost:3000/api/messages', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      ...form.getHeaders(),
    },
    body: form.getBuffer(),
  });

  const body = await response.json() as any;
  return { status: response.status, body };
}

describe('T-013: File Uploads — Message with Attachments', () => {
  it('should send a message with an image attachment', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `Upload-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const png = createPngBuffer(200);
    const result = await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Check this out!',
      files: [{ buffer: png, filename: 'screenshot.png', contentType: 'image/png' }],
    });

    expect(result.status).toBe(201);
    expect(result.body.data.message.content).toBe('Check this out!');
    expect(result.body.data.message.attachments).toHaveLength(1);
    expect(result.body.data.message.attachments[0].filename).toBe('screenshot.png');
    expect(result.body.data.message.attachments[0].contentType).toBe('image/png');
    expect(result.body.data.message.attachments[0].url).toMatch(/\/api\/uploads\/.+\/screenshot\.png/);
  });

  it('should send a message with only files (no text)', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `FileOnly-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const png = createPngBuffer(150);
    const result = await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      files: [{ buffer: png, filename: 'image.png', contentType: 'image/png' }],
    });

    expect(result.status).toBe(201);
    expect(result.body.data.message.content).toBe('');
    expect(result.body.data.message.attachments).toHaveLength(1);
  });

  it('should send a message with multiple files', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `Multi-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const result = await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Multiple files',
      files: [
        { buffer: createPngBuffer(100), filename: 'a.png', contentType: 'image/png' },
        { buffer: createJpegBuffer(100), filename: 'b.jpg', contentType: 'image/jpeg' },
        { buffer: createPngBuffer(100), filename: 'c.png', contentType: 'image/png' },
      ],
    });

    expect(result.status).toBe(201);
    expect(result.body.data.message.attachments).toHaveLength(3);
  });
});

describe('T-013: File Uploads — Validation', () => {
  it('should reject files with disallowed content types', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `BadType-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const result = await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Bad file',
      files: [{ buffer: Buffer.from('hello'), filename: 'script.js', contentType: 'application/javascript' }],
    });

    expect(result.status).toBe(400);
    expect(result.body.error.message).toContain('not allowed');
  });

  it('should reject more than 5 files', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `TooMany-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const files = Array.from({ length: 6 }, (_, i) => ({
      buffer: createPngBuffer(50),
      filename: `file${i}.png`,
      contentType: 'image/png',
    }));

    const result = await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Too many',
      files,
    });

    // Fastify multipart plugin returns 413 when file count exceeds limit
    expect([400, 413]).toContain(result.status);
  });

  it('should reject files with mismatched magic bytes', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `BadMagic-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    // Declare as PNG but send random bytes
    const result = await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Bad magic',
      files: [{ buffer: Buffer.from('not a png file at all'), filename: 'fake.png', contentType: 'image/png' }],
    });

    expect(result.status).toBe(400);
  });
});

describe('T-013: File Uploads — Serving', () => {
  it('should serve uploaded files with correct content type', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `Serve-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const png = createPngBuffer(200);
    const result = await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Serving test',
      files: [{ buffer: png, filename: 'serve-test.png', contentType: 'image/png' }],
    });

    expect(result.status).toBe(201);
    const attachment = result.body.data.message.attachments[0];

    // Fetch the file
    const fileRes = await client.get(attachment.url);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toContain('image/png');
  });

  it('should require auth for file serving', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `Auth-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    const png = createPngBuffer(200);
    const result = await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      content: 'Auth test',
      files: [{ buffer: png, filename: 'auth-test.png', contentType: 'image/png' }],
    });

    const attachment = result.body.data.message.attachments[0];

    // Fetch without auth
    const noAuthRes = await fetch(`http://localhost:3000${attachment.url}`);
    expect(noAuthRes.status).toBe(401);
  });

  it('should return 404 for non-existent attachment', async () => {
    const { client } = await createAuthenticatedClient();
    const res = await client.get('/api/uploads/nonexistent123/file.png');
    expect(res.status).toBe(404);
  });
});

describe('T-013: File Uploads — Attachments in Message List', () => {
  it('should include attachments when fetching messages', async () => {
    const { client } = await createAuthenticatedClient();
    const roomRes = await client.post('/api/rooms', { name: `List-${Date.now()}` });
    const roomId = roomRes.body.data.room.id;

    // Send a message with attachment
    const png = createPngBuffer(200);
    await sendMessageWithFiles({ client } as any, {
      scopeType: 'room',
      scopeId: roomId,
      content: 'With attachment',
      files: [{ buffer: png, filename: 'listed.png', contentType: 'image/png' }],
    });

    // Also send a text-only message
    await client.post('/api/messages', {
      scopeType: 'room',
      scopeId: roomId,
      content: 'No attachment',
    });

    // Fetch messages
    const msgRes = await client.get(`/api/messages?scopeType=room&scopeId=${roomId}`);
    expect(msgRes.status).toBe(200);
    const messages = msgRes.body.data.messages;

    // First message (with attachment)
    const withAttach = messages.find((m: any) => m.content === 'With attachment');
    expect(withAttach).toBeDefined();
    expect(withAttach.attachments).toHaveLength(1);
    expect(withAttach.attachments[0].filename).toBe('listed.png');

    // Second message (no attachment)
    const noAttach = messages.find((m: any) => m.content === 'No attachment');
    expect(noAttach).toBeDefined();
    expect(noAttach.attachments).toBeUndefined();
  });
});
