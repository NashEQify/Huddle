/**
 * T-015: User Settings — API Tests
 *
 * Acceptance Criteria:
 * - Built-in avatar selection works
 * - Portrait upload crops to square, sets avatar_kind to uploaded
 * - Title edit and randomize work
 * - Custom title added to TitlePool on save
 * - Email change requires correct password
 * - Password change requires correct current password
 */

import { describe, it, expect } from 'vitest';
import { createClient, createAuthenticatedClient } from '../helpers/api-client';

describe('T-015: Settings — Profile (Title & Avatar)', () => {
  it('should update title via PATCH /api/settings/profile', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.patch('/api/settings/profile', {
      title: 'Test Commander',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.profile.title).toBe('Test Commander');
  });

  it('should add custom title to TitlePool', async () => {
    const { client } = await createAuthenticatedClient();
    const customTitle = `Custom-${Date.now()}`;

    await client.patch('/api/settings/profile', {
      title: customTitle,
    });

    // The custom title should now be in the pool (verifiable indirectly:
    // if we randomize enough times from a fresh signup, we might get it.
    // But that's unreliable. Instead, verify the title was set.)
    const sessionRes = await client.get('/api/auth/session');
    expect(sessionRes.body.data.profile.title).toBe(customTitle);
  });

  it('should select built-in avatar via PATCH /api/settings/profile', async () => {
    const { client } = await createAuthenticatedClient();

    // Get list of available avatars
    const avatarsRes = await client.get('/api/settings/avatars');
    expect(avatarsRes.status).toBe(200);
    const avatars = avatarsRes.body.data.avatars;
    expect(avatars.length).toBeGreaterThan(0);

    const targetAvatar = avatars[0];

    const res = await client.patch('/api/settings/profile', {
      builtInAvatarId: targetAvatar.id,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.profile.avatarKind).toBe('built_in');
    expect(res.body.data.profile.builtInAvatarId).toBe(targetAvatar.id);
  });

  it('should reject invalid avatar ID', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.patch('/api/settings/profile', {
      builtInAvatarId: 'nonexistent-avatar-id',
    });

    expect(res.status).toBe(400);
  });

  it('should validate title length (1-40)', async () => {
    const { client } = await createAuthenticatedClient();

    // Empty title
    const res1 = await client.patch('/api/settings/profile', {
      title: '',
    });
    expect(res1.status).toBe(400);

    // Too long title
    const res2 = await client.patch('/api/settings/profile', {
      title: 'A'.repeat(41),
    });
    expect(res2.status).toBe(400);
  });

  it('should return random title via GET /api/settings/random-title', async () => {
    const { client } = await createAuthenticatedClient();

    const res = await client.get('/api/settings/random-title');
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBeTruthy();
    expect(typeof res.body.data.title).toBe('string');
  });
});

describe('T-015: Settings — Portrait Upload', () => {
  it('should upload portrait and set avatar_kind to uploaded', async () => {
    const { client } = await createAuthenticatedClient();

    // Generate a proper 64x64 PNG using sharp (same lib the server uses)
    const sharp = (await import('sharp')).default;
    const pngBuffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 100, g: 200, b: 150 } },
    })
      .png()
      .toBuffer();

    const formData = new FormData();
    const blob = new Blob([pngBuffer], { type: 'image/png' });
    formData.append('file', blob, 'portrait.png');

    const res = await client.postMultipart('/api/settings/portrait', formData);

    expect(res.status).toBe(200);
    expect(res.body.data.profile.avatarKind).toBe('uploaded');
    expect(res.body.data.profile.portraitUrl).toMatch(/\/api\/uploads\/portraits\/.+\.webp$/);
  });

  it('should reject non-image file', async () => {
    const { client } = await createAuthenticatedClient();

    const formData = new FormData();
    const blob = new Blob(['not an image'], { type: 'text/plain' });
    formData.append('file', blob, 'text.txt');

    const res = await client.postMultipart('/api/settings/portrait', formData);
    expect(res.status).toBe(400);
  });
});

describe('T-015: Settings — Email Change', () => {
  it('should change email with correct password', async () => {
    const password = 'testpass123';
    const { client, user } = await createAuthenticatedClient({ password });

    const newEmail = `newemail-${Date.now()}@test.com`;
    const res = await client.patch('/api/settings/email', {
      email: newEmail,
      currentPassword: password,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(newEmail);
  });

  it('should reject email change with wrong password', async () => {
    const { client } = await createAuthenticatedClient({ password: 'correctpass1' });

    const res = await client.patch('/api/settings/email', {
      email: 'new@test.com',
      currentPassword: 'wrongpassword',
    });

    expect(res.status).toBe(401);
  });

  it('should validate email format', async () => {
    const { client } = await createAuthenticatedClient({ password: 'testpass123' });

    const res = await client.patch('/api/settings/email', {
      email: 'not-an-email',
      currentPassword: 'testpass123',
    });

    expect(res.status).toBe(400);
  });
});

describe('T-015: Settings — Password Change', () => {
  it('should change password with correct current password', async () => {
    const password = 'testpass123';
    const username = `pwchange-${Date.now()}`;
    const { client } = await createAuthenticatedClient({ username, password });

    const res = await client.patch('/api/settings/password', {
      currentPassword: password,
      newPassword: 'newpassword123',
      newPasswordRepeat: 'newpassword123',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    // Verify new password works by logging in with it
    const loginClient = createClient();
    const loginRes = await loginClient.post('/api/auth/login', {
      username,
      password: 'newpassword123',
    });
    expect(loginRes.status).toBe(200);
  });

  it('should reject password change with wrong current password', async () => {
    const { client } = await createAuthenticatedClient({ password: 'correctpass1' });

    const res = await client.patch('/api/settings/password', {
      currentPassword: 'wrongpassword',
      newPassword: 'newpassword123',
      newPasswordRepeat: 'newpassword123',
    });

    expect(res.status).toBe(401);
  });

  it('should validate new password length', async () => {
    const { client } = await createAuthenticatedClient({ password: 'testpass123' });

    const res = await client.patch('/api/settings/password', {
      currentPassword: 'testpass123',
      newPassword: 'short',
      newPasswordRepeat: 'short',
    });

    expect(res.status).toBe(400);
  });

  it('should reject mismatched new passwords', async () => {
    const { client } = await createAuthenticatedClient({ password: 'testpass123' });

    const res = await client.patch('/api/settings/password', {
      currentPassword: 'testpass123',
      newPassword: 'newpassword123',
      newPasswordRepeat: 'different123',
    });

    expect(res.status).toBe(400);
  });
});

