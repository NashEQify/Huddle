/**
 * T-018: Screenshare — E2E Tests
 *
 * Tests UI aspects of screenshare controls:
 * - SHARE SCREEN button visibility for joined members
 * - GLOBAL SHARE button visibility
 * - Token endpoint for screenshare room patterns
 * - Screenshares sidebar section
 *
 * NOTE: Actual screen capture requires browser permissions and a running
 * LiveKit server. These tests verify UI flow and API integration only.
 */

import { test, expect, type Browser } from '@playwright/test';
import { signupViaAPI } from './helpers';

async function createIsolatedUser(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { username, userId } = await signupViaAPI(page);
  return { context, page, username, userId };
}

async function createRoom(page: import('@playwright/test').Page, name: string) {
  await page.getByText('+ NEW ROOM').click();
  await page.locator('#room-name').fill(name);
  await page.getByText('[ CREATE ]').first().click();
  await expect(page.locator('textarea')).toBeVisible();
}

test.describe('T-018: Screenshare Button Visibility', () => {
  test('should show SHARE SCREEN button for joined room member', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `SSBtn-${Date.now()}`;

    await createRoom(user.page, roomName);

    // SHARE SCREEN button should be visible
    await expect(
      user.page.locator('button:has-text("[ SHARE SCREEN ]")')
    ).toBeVisible({ timeout: 3000 });

    // GLOBAL SHARE button should also be visible
    await expect(
      user.page.locator('button:has-text("[ GLOBAL SHARE ]")')
    ).toBeVisible({ timeout: 3000 });

    await user.context.close();
  });

  test('should not show screenshare buttons for not_joined users', async ({ browser }) => {
    const creator = await createIsolatedUser(browser);
    const viewer = await createIsolatedUser(browser);

    const roomName = `SSNoJoin-${Date.now()}`;
    await createRoom(creator.page, roomName);

    // Viewer navigates to room
    await viewer.page.reload();
    await viewer.page.getByText(roomName).first().click();

    // Should see JOIN ROOM, not screenshare buttons
    await expect(
      viewer.page.locator('button:has-text("[ JOIN ROOM ]")').first()
    ).toBeVisible({ timeout: 3000 });

    await expect(
      viewer.page.locator('button:has-text("[ SHARE SCREEN ]")')
    ).not.toBeVisible({ timeout: 1000 });

    await creator.context.close();
    await viewer.context.close();
  });
});

test.describe('T-018: Screenshare Token Endpoints', () => {
  test('should get valid token for room screenshare', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `SSToken-${Date.now()}`;

    await createRoom(user.page, roomName);

    // Get room ID
    const roomsRes = await user.page.request.get('/api/rooms');
    const rooms = (await roomsRes.json()).data.rooms;
    const room = rooms.find((r: any) => r.name === roomName);
    expect(room).toBeDefined();

    // Request token for room screenshare
    const tokenRes = await user.page.request.post('/api/livekit/token', {
      data: { roomName: `ss:room:${room.id}` },
    });
    expect(tokenRes.status()).toBe(200);

    const body = await tokenRes.json();
    expect(body.data.token).toBeDefined();
    expect(typeof body.data.token).toBe('string');

    await user.context.close();
  });

  test('should get valid token for global screenshare (own user)', async ({ browser }) => {
    const user = await createIsolatedUser(browser);

    // Request token for global screenshare with own userId
    const tokenRes = await user.page.request.post('/api/livekit/token', {
      data: { roomName: `ss:global:${user.userId}` },
    });
    expect(tokenRes.status()).toBe(200);

    const body = await tokenRes.json();
    expect(body.data.token).toBeDefined();

    await user.context.close();
  });

  test('should reject token for global screenshare with other userId', async ({ browser }) => {
    const user = await createIsolatedUser(browser);

    const tokenRes = await user.page.request.post('/api/livekit/token', {
      data: { roomName: `ss:global:other-user-id` },
    });
    expect(tokenRes.status()).toBe(403);

    await user.context.close();
  });

  test('should reject room screenshare token for non-joined user', async ({ browser }) => {
    const creator = await createIsolatedUser(browser);
    const viewer = await createIsolatedUser(browser);

    const roomName = `SSReject-${Date.now()}`;
    await createRoom(creator.page, roomName);

    // Get room ID
    const roomsRes = await creator.page.request.get('/api/rooms');
    const rooms = (await roomsRes.json()).data.rooms;
    const room = rooms.find((r: any) => r.name === roomName);

    // Viewer tries to get screenshare token — should be rejected
    const tokenRes = await viewer.page.request.post('/api/livekit/token', {
      data: { roomName: `ss:room:${room.id}` },
    });
    expect(tokenRes.status()).toBe(403);

    await creator.context.close();
    await viewer.context.close();
  });
});

test.describe('T-018: Screenshares Sidebar Section', () => {
  test('should show "No active screenshares" when empty', async ({ browser }) => {
    const user = await createIsolatedUser(browser);

    // Scroll to the "No active screenshares" text which is in the sidebar
    const emptyState = user.page.getByText('No active screenshares');
    await emptyState.scrollIntoViewIfNeeded();
    await expect(emptyState).toBeVisible({ timeout: 5000 });

    await user.context.close();
  });
});

test.describe('T-018: Screenshares API Endpoint', () => {
  test('should return empty screenshares list', async ({ browser }) => {
    const user = await createIsolatedUser(browser);

    const res = await user.page.request.get('/api/livekit/screenshares');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.data.screenshares).toBeDefined();
    expect(Array.isArray(body.data.screenshares)).toBe(true);
    expect(body.data.screenshares.length).toBe(0);

    await user.context.close();
  });
});
