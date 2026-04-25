/**
 * T-012: Typing Indicators — E2E Tests
 *
 * Acceptance Criteria:
 * - Typing indicator appears when another user types in a room
 * - Typing indicator shows correct username
 * - Typing indicator disappears when user sends message
 * - Typing indicator works in DMs
 */

import { test, expect, type Browser } from '@playwright/test';
import { signupViaAPI } from './helpers';

/**
 * Creates a separate browser context (isolated cookies) and signs up a user.
 */
async function createIsolatedUser(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { username, userId } = await signupViaAPI(page);
  return { context, page, username, userId };
}

/**
 * Helper: create a room from user's page.
 */
async function createRoom(page: import('@playwright/test').Page, name: string) {
  await page.getByText('+ NEW ROOM').click();
  await page.locator('#room-name').fill(name);
  await page.getByText('[ CREATE ]').first().click();
}

test.describe('T-012: Typing Indicators — Room', () => {
  test('should show typing indicator when another user types in a room', async ({
    browser,
  }) => {
    const user1 = await createIsolatedUser(browser);
    const user2 = await createIsolatedUser(browser);

    // User1 creates a room
    const roomName = `TypingE2E-${Date.now()}`;
    await createRoom(user1.page, roomName);

    // Wait for room view to render with input visible
    await expect(user1.page.getByPlaceholder('Type a message...')).toBeVisible();

    // User2 navigates to the room and joins
    await user2.page.reload();
    await user2.page.getByText(roomName).first().click();
    await user2.page.getByText('[ JOIN ROOM ]').first().click();
    await expect(user2.page.getByPlaceholder('Type a message...')).toBeVisible();

    // Small wait for WS connections to stabilize
    await user2.page.waitForTimeout(500);

    // User2 starts typing character by character
    await user2.page.getByPlaceholder('Type a message...').pressSequentially('hello the', {
      delay: 80,
    });

    // User1 should see typing indicator with user2's username
    await expect(
      user1.page.getByText(`${user2.username} is typing...`)
    ).toBeVisible({ timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
  });

  test('should hide typing indicator after user sends message', async ({
    browser,
  }) => {
    const user1 = await createIsolatedUser(browser);
    const user2 = await createIsolatedUser(browser);

    // User1 creates a room
    const roomName = `TypingSend-${Date.now()}`;
    await createRoom(user1.page, roomName);
    await expect(user1.page.getByPlaceholder('Type a message...')).toBeVisible();

    // User2 joins
    await user2.page.reload();
    await user2.page.getByText(roomName).first().click();
    await user2.page.getByText('[ JOIN ROOM ]').first().click();
    await expect(user2.page.getByPlaceholder('Type a message...')).toBeVisible();

    // Small wait for WS connections to stabilize
    await user2.page.waitForTimeout(500);

    // User2 types a message character by character
    await user2.page.getByPlaceholder('Type a message...').pressSequentially('hello world', {
      delay: 50,
    });

    // Confirm user1 sees typing indicator
    await expect(
      user1.page.getByText(`${user2.username} is typing...`)
    ).toBeVisible({ timeout: 5000 });

    // User2 sends the message (Enter)
    await user2.page.getByPlaceholder('Type a message...').press('Enter');

    // Typing indicator should disappear (typing.stop sent on send)
    await expect(
      user1.page.getByText(`${user2.username} is typing...`)
    ).toBeHidden({ timeout: 5000 });

    // The actual message should appear
    await expect(user1.page.getByText('hello world')).toBeVisible({
      timeout: 5000,
    });

    await user1.context.close();
    await user2.context.close();
  });
});

test.describe('T-012: Typing Indicators — DM', () => {
  test('should show typing indicator in DM when the other user types', async ({
    browser,
  }) => {
    const user1 = await createIsolatedUser(browser);
    const user2 = await createIsolatedUser(browser);

    // User1 opens DM with user2 by clicking user2 in sidebar
    await user1.page.reload();
    await user1.page.getByText(user2.username).first().click();

    // Wait for DM view to load
    await expect(user1.page.getByPlaceholder('Type a message...')).toBeVisible();

    // User1 sends first message to create the DM
    await user1.page.getByPlaceholder('Type a message...').fill('hey there');
    await user1.page.getByPlaceholder('Type a message...').press('Enter');

    // Wait for message to appear (DM created)
    await expect(user1.page.getByText('hey there')).toBeVisible({
      timeout: 5000,
    });

    // User2 opens the DM with user1
    await user2.page.reload();
    await user2.page.getByText(user1.username).first().click();

    // Wait for DM to load — the message should be visible
    await expect(user2.page.getByText('hey there')).toBeVisible({
      timeout: 5000,
    });

    // Wait for WS connection to stabilize
    await user2.page.waitForTimeout(500);

    // User2 starts typing in the DM character by character
    await user2.page.getByPlaceholder('Type a message...').pressSequentially('typing ba', {
      delay: 80,
    });

    // User1 should see typing indicator
    await expect(
      user1.page.getByText(`${user2.username} is typing...`)
    ).toBeVisible({ timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
  });
});
