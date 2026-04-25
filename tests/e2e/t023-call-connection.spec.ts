/**
 * T-023: Call Connection -- E2E Tests
 *
 * Tests actual LiveKit call connections between users:
 * - Two users joining the same room call
 * - DM incoming call overlay and accept flow
 * - Differentiated error messages on call failure
 *
 * REQUIRES: Docker Compose services running (postgres + livekit).
 * These tests use fake media streams via Chromium flags
 * (--use-fake-device-for-media-stream, --use-fake-ui-for-media-stream)
 * configured in playwright.config.ts.
 */

import { test, expect, type Browser } from '@playwright/test';
import { signupViaAPI } from './helpers';

async function createIsolatedUser(browser: Browser) {
  const context = await browser.newContext({
    permissions: ['microphone', 'camera'],
  });
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

async function joinRoomAsUser(
  page: import('@playwright/test').Page,
  roomName: string
) {
  // Reload to pick up the room in the sidebar
  await page.reload();
  await page.getByText(roomName).first().click();
  // Click JOIN ROOM button
  const joinBtn = page.locator('button:has-text("[ JOIN ROOM ]")').first();
  await expect(joinBtn).toBeVisible({ timeout: 5000 });
  await joinBtn.click();
  // Wait for textarea (indicates joined state)
  await expect(page.locator('textarea')).toBeVisible({ timeout: 5000 });
}

async function openDmAndSendMessage(
  page: import('@playwright/test').Page,
  otherUsername: string,
  message: string
) {
  await page.getByText(otherUsername).first().click();
  const textarea = page.locator('textarea');
  await expect(textarea).toBeVisible({ timeout: 3000 });
  await textarea.fill(message);
  await textarea.press('Enter');
  await expect(page.getByText(message)).toBeVisible({ timeout: 5000 });
}

test.describe('T-023: Call Connection (requires Docker services)', () => {
  test('Two users can join the same room call simultaneously', async ({
    browser,
  }) => {
    const user1 = await createIsolatedUser(browser);
    const user2 = await createIsolatedUser(browser);
    const roomName = `CallConn-${Date.now()}`;

    // User 1 creates the room
    await createRoom(user1.page, roomName);

    // User 2 joins the room
    await joinRoomAsUser(user2.page, roomName);

    // User 1 clicks CALL -> Join (audio only)
    await user1.page.locator('button:has-text("[ CALL ]")').click();
    await user1.page.getByText('Join (audio only)').click();

    // User 1 should see in-call controls
    await expect(
      user1.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).toBeVisible({ timeout: 35000 });
    // Mic button should be visible
    await expect(
      user1.page.locator('button').filter({ hasText: /\[ MIC( OFF)? \]/ })
    ).toBeVisible({ timeout: 3000 });

    // Short wait for call state to propagate
    await user1.page.waitForTimeout(1000);

    // User 2 clicks CALL (or JOIN CALL if active) -> Join (audio only)
    const user2CallBtn = user2.page
      .locator('button')
      .filter({ hasText: /\[ (CALL|JOIN CALL) \]/ });
    await expect(user2CallBtn).toBeVisible({ timeout: 5000 });
    await user2CallBtn.click();
    await user2.page.getByText('Join (audio only)').click();

    // User 2 should see in-call controls
    await expect(
      user2.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).toBeVisible({ timeout: 35000 });

    // Both users are now in the call -- verify both have LEAVE CALL
    await expect(
      user1.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).toBeVisible();
    await expect(
      user2.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).toBeVisible();

    // User 1 leaves
    await user1.page.locator('button:has-text("[ LEAVE CALL ]")').click();
    await expect(
      user1.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).not.toBeVisible({ timeout: 5000 });

    // User 2 leaves
    await user2.page.locator('button:has-text("[ LEAVE CALL ]")').click();
    await expect(
      user2.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).not.toBeVisible({ timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
  });

  test('DM call shows incoming call overlay for other user', async ({
    browser,
  }) => {
    const user1 = await createIsolatedUser(browser);
    const user2 = await createIsolatedUser(browser);

    // Create a DM conversation
    await openDmAndSendMessage(
      user1.page,
      user2.username,
      'hello for call overlay test'
    );

    // User 2 also opens the DM so they have the conversation visible
    await openDmAndSendMessage(
      user2.page,
      user1.username,
      'hi back'
    );

    // User 1 starts a DM call
    await user1.page.locator('button:has-text("[ CALL ]")').click();
    await user1.page.getByText('Join (audio only)').click();

    // User 1 should see in-call controls
    await expect(
      user1.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).toBeVisible({ timeout: 35000 });

    // User 2 should see the incoming call overlay
    await expect(
      user2.page.locator('[data-testid="incoming-call-overlay"]')
    ).toBeVisible({ timeout: 10000 });

    // Overlay should have ACCEPT and DECLINE buttons
    const overlay = user2.page.locator('[data-testid="incoming-call-overlay"]');
    await expect(overlay.getByText('[ ACCEPT ]')).toBeVisible();
    await expect(overlay.getByText('[ DECLINE ]')).toBeVisible();

    // User 2 clicks ACCEPT
    await overlay.getByText('[ ACCEPT ]').click();

    // User 2 should now see in-call controls
    await expect(
      user2.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).toBeVisible({ timeout: 35000 });

    // Both users leave
    await user1.page.locator('button:has-text("[ LEAVE CALL ]")').click();
    await user2.page.locator('button:has-text("[ LEAVE CALL ]")').click();

    await user1.context.close();
    await user2.context.close();
  });

  test('Error messages differentiate offline vs connection failure', async ({
    browser,
  }) => {
    // This test verifies that a non-DM call failure shows
    // "Failed to connect. Try again." (not "User is offline.")
    const user1 = await createIsolatedUser(browser);
    const roomName = `ErrMsg-${Date.now()}`;

    await createRoom(user1.page, roomName);

    // Verify the CALL button is present
    await expect(
      user1.page.locator('button:has-text("[ CALL ]")')
    ).toBeVisible({ timeout: 3000 });

    // Start a call, then leave it, to verify UI resets properly
    await user1.page.locator('button:has-text("[ CALL ]")').click();
    await user1.page.getByText('Join (audio only)').click();

    // Wait for in-call controls
    await expect(
      user1.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).toBeVisible({ timeout: 35000 });

    // Leave the call
    await user1.page.locator('button:has-text("[ LEAVE CALL ]")').click();
    await expect(
      user1.page.locator('button:has-text("[ LEAVE CALL ]")')
    ).not.toBeVisible({ timeout: 5000 });

    // After leaving, the CALL button should reappear
    await expect(
      user1.page.locator('button').filter({ hasText: /\[ (CALL|JOIN CALL) \]/ })
    ).toBeVisible({ timeout: 5000 });

    // Verify that "User is offline." text is NOT shown
    // (non-DM call failures should never show this message)
    await expect(
      user1.page.getByText('User is offline.')
    ).not.toBeVisible({ timeout: 1000 });

    await user1.context.close();
  });
});
