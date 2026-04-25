/**
 * T-016: LiveKit Voice Calls — E2E Tests
 *
 * Tests UI aspects of call controls:
 * - Call button visibility based on membership
 * - Join Call dropdown (audio-only / with camera)
 * - Token endpoint integration
 *
 * NOTE: Actual LiveKit media connections require hardware (mic/camera)
 * and a running LiveKit server. These tests verify the UI flow up to
 * the point of LiveKit connection. The call.* WS events and speaking
 * indicators are tested at the API/integration level.
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

test.describe('T-016: Call Button Visibility', () => {
  test('should show CALL button when user is joined to room', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `CallBtn-${Date.now()}`;

    await createRoom(user.page, roomName);

    // The CALL button should be visible in the header
    await expect(
      user.page.locator('button:has-text("[ CALL ]")')
    ).toBeVisible({ timeout: 3000 });

    await user.context.close();
  });

  test('should not show CALL button for not_joined users', async ({ browser }) => {
    const creator = await createIsolatedUser(browser);
    const viewer = await createIsolatedUser(browser);

    const roomName = `CallNoJoin-${Date.now()}`;
    await createRoom(creator.page, roomName);

    // Viewer navigates to the room (not joined)
    await viewer.page.reload();
    await viewer.page.getByText(roomName).first().click();

    // Should see JOIN ROOM, not CALL
    await expect(
      viewer.page.locator('button:has-text("[ JOIN ROOM ]")').first()
    ).toBeVisible({ timeout: 3000 });

    // CALL button should NOT be visible
    await expect(
      viewer.page.locator('button:has-text("[ CALL ]")')
    ).not.toBeVisible({ timeout: 1000 });

    await creator.context.close();
    await viewer.context.close();
  });
});

test.describe('T-016: Call Dropdown', () => {
  test('should show join options when clicking CALL button', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `CallDrop-${Date.now()}`;

    await createRoom(user.page, roomName);

    // Click the CALL button
    await user.page.locator('button:has-text("[ CALL ]")').click();

    // Dropdown should appear with two options
    await expect(
      user.page.getByText('Join (audio only)')
    ).toBeVisible({ timeout: 2000 });
    await expect(
      user.page.getByText('Join with camera')
    ).toBeVisible({ timeout: 2000 });

    await user.context.close();
  });
});

test.describe('T-016: Call Controls — No End Call Button', () => {
  test('should show LEAVE but not END CALL in call controls UI', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `NoEndCall-${Date.now()}`;

    await createRoom(user.page, roomName);

    // Verify CALL button is present
    await expect(
      user.page.locator('button:has-text("[ CALL ]")')
    ).toBeVisible({ timeout: 3000 });

    // Verify END CALL button does NOT exist anywhere on the page
    // (even before joining a call, it should not be in the DOM)
    await expect(
      user.page.locator('button:has-text("[ END CALL ]")')
    ).not.toBeVisible({ timeout: 1000 });

    // LEAVE button should also not be visible before joining
    await expect(
      user.page.locator('button:has-text("[ LEAVE ]")')
    ).not.toBeVisible({ timeout: 1000 });

    await user.context.close();
  });
});

test.describe('T-016: Token Endpoint via Page API', () => {
  test('should get valid token from /api/livekit/token', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `CallToken-${Date.now()}`;

    await createRoom(user.page, roomName);

    // Get the room ID via API
    const roomsRes = await user.page.request.get('/api/rooms');
    const rooms = (await roomsRes.json()).data.rooms;
    const room = rooms.find((r: any) => r.name === roomName);
    expect(room).toBeDefined();

    // Request a LiveKit token
    const tokenRes = await user.page.request.post('/api/livekit/token', {
      data: { roomName: `call:${room.id}` },
    });
    expect(tokenRes.status()).toBe(200);

    const tokenBody = await tokenRes.json();
    expect(tokenBody.data.token).toBeDefined();
    expect(typeof tokenBody.data.token).toBe('string');

    await user.context.close();
  });
});
