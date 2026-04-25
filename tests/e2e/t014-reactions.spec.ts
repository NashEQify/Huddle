/**
 * T-014: Emoji Reactions — E2E Tests
 *
 * Acceptance Criteria:
 * - Reactions appear as badges with counts
 * - Badges are highlighted if current user reacted
 * - Real-time update via WS between users
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

test.describe('T-014: Emoji Reactions — Display', () => {
  test('should display reaction badges after adding via API', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `ReactBadge-${Date.now()}`;

    await createRoom(user.page, roomName);

    // Send a message
    await user.page.locator('textarea').fill('Badge test');
    await user.page.locator('button:text-is("SEND")').click();
    await expect(user.page.getByText('Badge test')).toBeVisible();

    // Get the message ID from the DOM — we need it for the API call
    // Instead, use the API to send and react
    const msgRes = await user.page.request.post('/api/messages', {
      data: {
        scopeType: 'room',
        scopeId: roomName, // We need the actual room ID
        content: 'API reaction test',
      },
    });

    // Actually, let's use a simpler approach - find the message via API
    // and use the API to add a reaction, then check rendering
    // First, let's get the room's messages
    const roomsRes = await user.page.request.get('/api/rooms');
    const rooms = (await roomsRes.json()).data.rooms;
    const room = rooms.find((r: any) => r.name === roomName);

    const messagesRes = await user.page.request.get(
      `/api/messages?scopeType=room&scopeId=${room.id}`
    );
    const messages = (await messagesRes.json()).data.messages;
    const msg = messages.find((m: any) => m.content === 'Badge test');

    // Add a reaction via API
    const reactionRes = await user.page.request.post(
      `/api/messages/${msg.id}/reactions`,
      { data: { emoji: '\u{1F525}' } } // 🔥
    );
    expect(reactionRes.status()).toBe(200);

    // The WS broadcast should update the UI — wait for the badge
    await expect(
      user.page.locator('button[aria-label*="reaction"]')
    ).toBeVisible({ timeout: 5000 });

    await user.context.close();
  });

  test('should show emoji picker on hover and display emoji grid', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `Picker-${Date.now()}`;

    await createRoom(user.page, roomName);

    await user.page.locator('textarea').fill('Pick me');
    await user.page.locator('button:text-is("SEND")').click();
    await expect(user.page.getByText('Pick me')).toBeVisible();

    // Hover over the message content
    await user.page.getByText('Pick me').hover();

    // Wait for the reaction trigger to appear — should show smiley icon, not "+"
    const trigger = user.page.locator('[data-testid="reaction-trigger"]');
    await expect(trigger).toBeVisible({ timeout: 3000 });

    // Verify trigger shows smiley character (U+263A), not "+"
    const triggerText = await trigger.textContent();
    expect(triggerText).toContain('\u263A');
    expect(triggerText).not.toBe('+');

    // Click the trigger to open emoji picker
    await trigger.click();

    // Emoji grid should be visible with our curated set
    await expect(
      user.page.locator('button[aria-label*="React with"]').first()
    ).toBeVisible({ timeout: 3000 });

    // Verify all 22 emojis are shown (curated set has 22)
    const emojiCount = await user.page.locator('button[aria-label*="React with"]').count();
    expect(emojiCount).toBe(22);

    // Close with Escape
    await user.page.keyboard.press('Escape');
    await expect(
      user.page.locator('button[aria-label*="React with"]').first()
    ).not.toBeVisible({ timeout: 2000 });

    await user.context.close();
  });

  test('should render reaction badges in a single non-wrapping line', async ({ browser }) => {
    const user = await createIsolatedUser(browser);
    const roomName = `BadgeLine-${Date.now()}`;

    await createRoom(user.page, roomName);

    // Send a message
    await user.page.locator('textarea').fill('Badge line test');
    await user.page.locator('button:text-is("SEND")').click();
    await expect(user.page.getByText('Badge line test')).toBeVisible();

    // Get room and message IDs via API
    const roomsRes = await user.page.request.get('/api/rooms');
    const rooms = (await roomsRes.json()).data.rooms;
    const room = rooms.find((r: any) => r.name === roomName);

    const messagesRes = await user.page.request.get(
      `/api/messages?scopeType=room&scopeId=${room.id}`
    );
    const messages = (await messagesRes.json()).data.messages;
    const msg = messages.find((m: any) => m.content === 'Badge line test');

    // Add multiple reactions via API to test non-wrapping
    const emojis = ['\u{1F44D}', '\u{1F525}', '\u{1F602}'];
    for (const emoji of emojis) {
      await user.page.request.post(`/api/messages/${msg.id}/reactions`, {
        data: { emoji },
      });
    }

    // Wait for badges to appear
    await expect(
      user.page.locator('button[aria-label*="reaction"]').first()
    ).toBeVisible({ timeout: 5000 });

    // Verify the badge container uses nowrap (flex-wrap: nowrap) and right-alignment
    const badgeContainer = user.page.locator('button[aria-label*="reaction"]').first().locator('..');
    const flexWrap = await badgeContainer.evaluate((el) =>
      window.getComputedStyle(el).flexWrap
    );
    expect(flexWrap).toBe('nowrap');

    const justifyContent = await badgeContainer.evaluate((el) =>
      window.getComputedStyle(el).justifyContent
    );
    expect(justifyContent).toBe('flex-end');

    await user.context.close();
  });
});

test.describe('T-014: Emoji Reactions — Multi-User Real-Time', () => {
  test('should show reactions from other users in real-time via WS', async ({ browser }) => {
    const user1 = await createIsolatedUser(browser);
    const user2 = await createIsolatedUser(browser);

    const roomName = `WSReact-${Date.now()}`;
    await createRoom(user1.page, roomName);

    // User2 joins the room
    await user2.page.reload();
    await user2.page.getByText(roomName).first().click();
    await user2.page.getByText('[ JOIN ROOM ]').first().click();
    await expect(user2.page.locator('textarea')).toBeVisible();

    await user2.page.waitForTimeout(500);

    // User1 sends a message
    await user1.page.locator('textarea').fill('React from afar!');
    await user1.page.locator('button:text-is("SEND")').click();

    // Both should see the message
    await expect(user1.page.getByText('React from afar!')).toBeVisible();
    await expect(user2.page.getByText('React from afar!')).toBeVisible({ timeout: 5000 });

    // Get the room ID and message ID via API from user2
    const roomsRes = await user2.page.request.get('/api/rooms');
    const rooms = (await roomsRes.json()).data.rooms;
    const room = rooms.find((r: any) => r.name === roomName);

    const messagesRes = await user2.page.request.get(
      `/api/messages?scopeType=room&scopeId=${room.id}`
    );
    const messages = (await messagesRes.json()).data.messages;
    const msg = messages.find((m: any) => m.content === 'React from afar!');

    // User2 adds a reaction via API
    await user2.page.request.post(`/api/messages/${msg.id}/reactions`, {
      data: { emoji: '\u{1F44D}' }, // 👍
    });

    // User1 should see the reaction badge appear (via WS)
    await expect(
      user1.page.locator('button[aria-label*="reaction"]')
    ).toBeVisible({ timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
  });
});
