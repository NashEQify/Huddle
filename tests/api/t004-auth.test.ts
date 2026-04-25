/**
 * T-004: Auth — Signup, Login, Sessions
 *
 * Acceptance Criteria:
 * - Signup creates user with random title and avatar
 * - Login sets session cookie, auto-login works on reload
 * - Invalid credentials show generic error
 * - Lockout after 5 failed attempts (5 min)
 * - Logout clears session and returns to login
 * - First user gets is_admin: true
 * - Deactivated users cannot login
 */

import { describe, it, expect } from 'vitest';
import { createClient, createAuthenticatedClient } from '../helpers/api-client';

describe('T-004: Auth — Signup', () => {
  it('should create a user with random title and avatar', async () => {
    const client = createClient();
    const res = await client.signup();

    expect(res.status).toBe(201);
    expect(res.body.data.user.id).toBeTruthy();
    expect(res.body.data.user.username).toBeTruthy();
    expect(res.body.data.profile.title).toBeTruthy();
    expect(res.body.data.profile.avatarKind).toBe('built_in');
    expect(res.body.data.profile.builtInAvatarId).toBeTruthy();
  });

  it('should set session cookie on signup', async () => {
    const client = createClient();
    await client.signup();

    // Session cookie should be set — verify by calling session endpoint
    const sessionRes = await client.get('/api/auth/session');
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.data.user).toBeTruthy();
  });

  it('should reject duplicate username (case-insensitive)', async () => {
    const client1 = createClient();
    const username = `duptest-${Date.now()}`;
    const res1 = await client1.signup({ username });
    expect(res1.status).toBe(201);

    const client2 = createClient();
    const res2 = await client2.signup({ username: username.toUpperCase() });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('should validate username format (2-24 chars, alphanumeric + underscore + hyphen)', async () => {
    const client = createClient();

    // Too short
    const res1 = await client.post('/api/auth/signup', {
      username: 'a',
      email: 'a@test.com',
      password: 'testpass123',
      passwordRepeat: 'testpass123',
    });
    expect(res1.status).toBe(400);

    // Invalid chars
    const res2 = await client.post('/api/auth/signup', {
      username: 'bad user!',
      email: 'bad@test.com',
      password: 'testpass123',
      passwordRepeat: 'testpass123',
    });
    expect(res2.status).toBe(400);
  });

  it('should validate password length (8-64)', async () => {
    const client = createClient();
    const res = await client.post('/api/auth/signup', {
      username: `shortpw-${Date.now()}`,
      email: 'pw@test.com',
      password: '1234567', // 7 chars
      passwordRepeat: '1234567',
    });
    expect(res.status).toBe(400);
  });

  it('should reject mismatched passwords', async () => {
    const client = createClient();
    const res = await client.post('/api/auth/signup', {
      username: `mismatch-${Date.now()}`,
      email: 'mm@test.com',
      password: 'testpass123',
      passwordRepeat: 'differentpass',
    });
    expect(res.status).toBe(400);
  });
});

describe('T-004: Auth — Login', () => {
  it('should login with correct credentials and return user data', async () => {
    const username = `login-${Date.now()}`;
    const password = 'testpass123';

    // First signup
    const signupClient = createClient();
    await signupClient.signup({ username, password });

    // Then login from a fresh client
    const loginClient = createClient();
    const res = await loginClient.post('/api/auth/login', { username, password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.profile).toBeTruthy();
    expect(res.body.data.mustChangePassword).toBe(false);
  });

  it('should reject invalid credentials with generic error', async () => {
    const client = createClient();
    const res = await client.post('/api/auth/login', {
      username: 'nonexistent',
      password: 'wrongpassword',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    // Should be generic — not revealing whether user exists
    expect(res.body.error.message).toBe('Invalid username or password');
  });

  it('should reject wrong password with same generic error', async () => {
    const username = `wrongpw-${Date.now()}`;
    const signupClient = createClient();
    await signupClient.signup({ username, password: 'correctpass1' });

    const loginClient = createClient();
    const res = await loginClient.post('/api/auth/login', {
      username,
      password: 'wrongpassword',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('should lock out after 5 failed attempts', async () => {
    const username = `lockout-${Date.now()}`;
    const signupClient = createClient();
    await signupClient.signup({ username, password: 'correctpass1' });

    const loginClient = createClient();

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await loginClient.post('/api/auth/login', {
        username,
        password: 'wrongpassword',
      });
      // First 4 should be 401, 5th triggers lockout
      if (i < 4) {
        expect(res.status).toBe(401);
      }
    }

    // 6th attempt should be locked out (429)
    const lockedRes = await loginClient.post('/api/auth/login', {
      username,
      password: 'correctpass1', // Even correct password should be rejected
    });
    expect(lockedRes.status).toBe(429);
    expect(lockedRes.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('T-004: Auth — Session', () => {
  it('should return user data for valid session (auto-login)', async () => {
    const { client, user } = await createAuthenticatedClient();

    const res = await client.get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
  });

  it('should reject requests without session cookie', async () => {
    const client = createClient();
    const res = await client.get('/api/auth/session');
    expect(res.status).toBe(401);
  });
});

describe('T-004: Auth — Logout', () => {
  it('should clear session on logout', async () => {
    const { client } = await createAuthenticatedClient();

    // Verify authenticated
    const beforeRes = await client.get('/api/auth/session');
    expect(beforeRes.status).toBe(200);

    // Logout
    const logoutRes = await client.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);

    // Session should be invalid now
    const afterRes = await client.get('/api/auth/session');
    expect(afterRes.status).toBe(401);
  });
});
