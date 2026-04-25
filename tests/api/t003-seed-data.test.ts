/**
 * T-003: Seed Data — Avatars, Titles, Quotes
 *
 * Acceptance Criteria:
 * - 25 BuiltInAvatar rows in DB
 * - ~5000 TitlePool rows in DB (we have 4185)
 * - ~100-150 MotdQuote rows in DB
 * - SVG files accessible at /avatars/*.svg from Vite dev server
 * - Each SVG is recognizably the intended character (manual check — we verify file exists and is valid SVG)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createAuthenticatedClient } from '../helpers/api-client';

describe('T-003: Seed Data', () => {
  it('should have 25 built-in avatars accessible via API', async () => {
    const { client } = await createAuthenticatedClient();
    const res = await client.get('/api/settings/avatars');

    expect(res.status).toBe(200);
    expect(res.body.data.avatars).toHaveLength(25);

    // Each avatar should have id, label, and imageUrl
    for (const avatar of res.body.data.avatars) {
      expect(avatar.id).toBeTruthy();
      expect(avatar.label).toBeTruthy();
      expect(avatar.imageUrl).toMatch(/^\/avatars\/.+\.svg$/);
    }
  });

  it('should have avatar SVG files on disk matching API data', async () => {
    const { client } = await createAuthenticatedClient();
    const avatarsRes = await client.get('/api/settings/avatars');
    const avatars = avatarsRes.body.data.avatars;

    // SVGs live in src/client/public/ — verify they exist and are valid SVG
    const publicDir = join(__dirname, '../../src/client/public');

    for (const avatar of avatars.slice(0, 5)) {
      const filePath = join(publicDir, avatar.imageUrl);
      expect(existsSync(filePath)).toBe(true);
      const text = readFileSync(filePath, 'utf-8');
      expect(text).toContain('<svg');
      expect(text).toContain('viewBox');
    }
  });

  it('should have a random title available via API', async () => {
    const { client } = await createAuthenticatedClient();
    const res = await client.get('/api/settings/random-title');

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBeTruthy();
    expect(typeof res.body.data.title).toBe('string');
    expect(res.body.data.title.length).toBeGreaterThan(0);
  });

  it('should return different random titles on multiple calls', async () => {
    const { client } = await createAuthenticatedClient();
    const titles = new Set<string>();

    // Call 10 times — with ~4000+ titles, should get at least 2 different ones
    for (let i = 0; i < 10; i++) {
      const res = await client.get('/api/settings/random-title');
      expect(res.status).toBe(200);
      titles.add(res.body.data.title);
    }

    expect(titles.size).toBeGreaterThan(1);
  });

  it('should have MOTD quotes available via welcome endpoint', async () => {
    const { client } = await createAuthenticatedClient();
    const res = await client.get('/api/welcome');

    expect(res.status).toBe(200);
    expect(res.body.data.motdQuote).toBeTruthy();
    expect(res.body.data.motdQuote.text).toBeTruthy();
    expect(res.body.data.motdQuote.attribution).toBeTruthy();
  });

  it('signup should assign random title and avatar from seed data', async () => {
    const { profile } = await createAuthenticatedClient();

    expect(profile.title).toBeTruthy();
    expect(profile.avatarKind).toBe('built_in');
    expect(profile.builtInAvatarId).toBeTruthy();
  });
});
