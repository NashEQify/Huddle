/**
 * T-011: DM Conversations — E2E Tests
 *
 * Acceptance Criteria:
 * - Click on a user in sidebar opens DM view
 * - Sending first message creates DirectConversation (lazy creation)
 * - Both participants can see messages
 * - DM header shows other user's name and online status
 *
 * NOTE: Each user must be in a SEPARATE browser context to avoid
 * sharing session cookies (which would overwrite each other).
 */

import { test, expect } from '@playwright/test';
import { signupViaAPI } from './helpers';

test.describe('T-011: DM View Navigation', () => {
  test('should open DM view when clicking a user in sidebar', async ({
    browser,
  }) => {
    // Separate browser contexts so cookies don't collide
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const { username: user1 } = await signupViaAPI(page);
    const { username: user2 } = await signupViaAPI(page2);

    // Reload user1's page to see user2 in the users list
    await page.reload();

    // Wait for sidebar
    const sidebar = page.locator('aside');
    await expect(
      sidebar.getByText('USERS', { exact: true })
    ).toBeVisible({ timeout: 10000 });

    // Click on user2
    await sidebar.getByText(user2, { exact: false }).first().click();

    // Should see DM header with user2's name
    const main = page.locator('main');
    await expect(main.getByText(user2).first()).toBeVisible({ timeout: 5000 });

    // Should see message input (always available in DMs)
    await expect(
      page.locator('textarea[placeholder="Type a message..."]')
    ).toBeVisible();

    // Should show "No messages yet" since no DM exists
    await expect(page.getByText('No messages yet')).toBeVisible();

    await page.close();
    await page2.close();
    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('T-011: DM Lazy Creation & Messaging', () => {
  test('should create DM on first message and display it', async ({
    browser,
  }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const { username: user1 } = await signupViaAPI(page);
    const { username: user2, userId: user2Id } = await signupViaAPI(page2);

    // Reload user1 page to see user2
    await page.reload();

    // Navigate to DM with user2
    const sidebar = page.locator('aside');
    await expect(
      sidebar.getByText('USERS', { exact: true })
    ).toBeVisible({ timeout: 10000 });
    await sidebar.getByText(user2, { exact: false }).first().click();

    // Send first message
    const input = page.locator('textarea[placeholder="Type a message..."]');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('Hello from DM!');
    await input.press('Enter');

    // Message should appear
    await expect(page.getByText('Hello from DM!')).toBeVisible({
      timeout: 5000,
    });

    await page.close();
    await page2.close();
    await ctx1.close();
    await ctx2.close();
  });

  test('should allow both users to exchange DM messages', async ({
    browser,
  }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const { username: user1, userId: user1Id } = await signupViaAPI(page);
    const { username: user2, userId: user2Id } = await signupViaAPI(page2);

    // User1: navigate to DM with user2
    await page.reload();
    const sidebar1 = page.locator('aside');
    await expect(
      sidebar1.getByText('USERS', { exact: true })
    ).toBeVisible({ timeout: 10000 });
    await sidebar1.getByText(user2, { exact: false }).first().click();

    // User1 sends first message
    const input1 = page.locator('textarea[placeholder="Type a message..."]');
    await expect(input1).toBeVisible({ timeout: 5000 });
    await input1.fill('Hey user2!');
    await input1.press('Enter');
    await expect(page.getByText('Hey user2!')).toBeVisible({ timeout: 5000 });

    // User2: navigate to DM with user1
    await page2.reload();
    const sidebar2 = page2.locator('aside');
    await expect(
      sidebar2.getByText('USERS', { exact: true })
    ).toBeVisible({ timeout: 10000 });
    await sidebar2.getByText(user1, { exact: false }).first().click();

    // User2 should see user1's message
    await expect(page2.getByText('Hey user2!')).toBeVisible({ timeout: 5000 });

    // User2 replies
    const input2 = page2.locator('textarea[placeholder="Type a message..."]');
    await expect(input2).toBeVisible({ timeout: 5000 });
    await input2.fill('Hey back user1!');
    await input2.press('Enter');

    // User2 sees their own reply
    await expect(page2.getByText('Hey back user1!')).toBeVisible({
      timeout: 5000,
    });

    // User1 should also see user2's reply via WS
    await expect(page.getByText('Hey back user1!')).toBeVisible({
      timeout: 5000,
    });

    await page.close();
    await page2.close();
    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('T-011: DM Header', () => {
  test('should show other user name and online status', async ({
    browser,
  }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await signupViaAPI(page);
    const { username: user2 } = await signupViaAPI(page2);

    // Reload user1 to see user2
    await page.reload();

    // Navigate to DM
    const sidebar = page.locator('aside');
    await expect(
      sidebar.getByText('USERS', { exact: true })
    ).toBeVisible({ timeout: 10000 });
    await sidebar.getByText(user2, { exact: false }).first().click();

    // Should see user2's name in DM header
    const main = page.locator('main');
    await expect(main.getByText(user2).first()).toBeVisible({ timeout: 5000 });

    // Should show "online" status (user2 has a WS connection)
    await expect(main.getByText('online')).toBeVisible({ timeout: 5000 });

    await page.close();
    await page2.close();
    await ctx1.close();
    await ctx2.close();
  });
});
