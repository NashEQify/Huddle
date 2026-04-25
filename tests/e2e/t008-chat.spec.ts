/**
 * T-008: Chat — Room View & Messages — E2E Tests
 *
 * Acceptance Criteria:
 * - Room creation from sidebar button
 * - Created room auto-joins and navigates to room view
 * - Message sending and display
 * - Message grouping (consecutive same-user within 2 min)
 * - System messages on join/leave
 * - Membership gating (join CTA, read-only for left)
 * - Leave/Rejoin flow
 */

import { test, expect } from '@playwright/test';
import { signupViaAPI } from './helpers';

test.describe('T-008: Room Creation', () => {
  test('should create a room via sidebar button and navigate to it', async ({ page }) => {
    await signupViaAPI(page);

    // Wait for sidebar
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });

    // Click [ + NEW ROOM ] button
    await page.getByText('[ + NEW ROOM ]').click();

    // Create Room dialog should appear
    await expect(page.getByText('CREATE ROOM')).toBeVisible({ timeout: 5000 });

    // Fill in room name
    await page.locator('#room-name').fill('Test Chat Room');

    // Click CREATE
    await page.getByText('[ CREATE ]').click();

    // Should navigate to room view — room name should appear in the header area
    await expect(page.getByText('Test Chat Room').first()).toBeVisible({ timeout: 5000 });

    // Should see [ LEAVE ROOM ] button (creator is auto-joined)
    await expect(page.getByText('[ LEAVE ROOM ]')).toBeVisible();
  });

  test('should disable CREATE button when name is empty', async ({ page }) => {
    await signupViaAPI(page);

    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });

    // Open dialog
    await page.getByText('[ + NEW ROOM ]').click();
    await expect(page.getByText('CREATE ROOM')).toBeVisible({ timeout: 5000 });

    // CREATE button should be disabled when name is empty
    const createBtn = page.getByRole('button', { name: '[ CREATE ]' });
    await expect(createBtn).toBeDisabled();

    // Type a name — button should become enabled
    await page.locator('#room-name').fill('Valid Name');
    await expect(createBtn).toBeEnabled();
  });

  test('should close dialog on CANCEL', async ({ page }) => {
    await signupViaAPI(page);

    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });

    // Open dialog
    await page.getByText('[ + NEW ROOM ]').click();
    await expect(page.getByText('CREATE ROOM')).toBeVisible({ timeout: 5000 });

    // Click CANCEL
    await page.getByText('CANCEL').click();

    // Dialog should be closed
    await expect(page.getByText('CREATE ROOM')).not.toBeVisible();
  });
});

test.describe('T-008: Message Sending & Display', () => {
  test('should send a message and see it appear', async ({ page }) => {
    const { username } = await signupViaAPI(page);
    const roomName = `MsgTest-${Date.now()}`;

    // Create a room via API for speed
    const roomRes = await page.request.post('/api/rooms', {
      data: { name: roomName },
    });
    const roomData = await roomRes.json();
    const roomId = roomData.data.room.id;

    // Navigate to the room by clicking it in sidebar
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });

    // Wait for room to appear in sidebar after WS broadcast
    await expect(sidebar.getByText(roomName).first()).toBeVisible({ timeout: 5000 });
    await sidebar.getByText(roomName).first().click();

    // Wait for room view to load
    await expect(page.getByText(roomName).first()).toBeVisible({ timeout: 5000 });

    // Type and send a message
    const input = page.locator('textarea[placeholder="Type a message..."]');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill('Hello from E2E test!');
    await input.press('Enter');

    // Message should appear in the message list
    await expect(page.getByText('Hello from E2E test!')).toBeVisible({ timeout: 5000 });

    // Username should appear as author (it appears both in system msg and message author line)
    const mainContent = page.locator('main');
    await expect(mainContent.getByText(username, { exact: true }).first()).toBeVisible();
  });

  test('should send message with Enter key and newline with Shift+Enter', async ({ page }) => {
    await signupViaAPI(page);
    const roomName = `KbTest-${Date.now()}`;

    // Create room
    const roomRes = await page.request.post('/api/rooms', {
      data: { name: roomName },
    });
    const roomData = await roomRes.json();
    const roomId = roomData.data.room.id;

    // Navigate to room
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText(roomName).first()).toBeVisible({ timeout: 5000 });
    await sidebar.getByText(roomName).first().click();

    const input = page.locator('textarea[placeholder="Type a message..."]');
    await expect(input).toBeVisible({ timeout: 5000 });

    // Shift+Enter should add newline, not send
    await input.fill('Line 1');
    await input.press('Shift+Enter');
    await input.type('Line 2');

    // Input should have both lines
    const value = await input.inputValue();
    expect(value).toContain('Line 1');
    expect(value).toContain('Line 2');

    // Enter should send
    await input.press('Enter');

    // Message should appear with both lines
    await expect(page.getByText('Line 1')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('T-008: Membership Gating', () => {
  test('should show join CTA for non-member', async ({ page, context }) => {
    const roomName = `Gated-${Date.now()}`;

    // Create a room with user1
    const { username: user1 } = await signupViaAPI(page);
    const roomRes = await page.request.post('/api/rooms', {
      data: { name: roomName },
    });
    const roomData = await roomRes.json();
    const roomId = roomData.data.room.id;

    // Create user2 in a new page
    const page2 = await context.newPage();
    const { username: user2 } = await signupViaAPI(page2);

    // Navigate user2 to the room
    const sidebar2 = page2.locator('aside');
    await expect(sidebar2.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(sidebar2.getByText(roomName).first()).toBeVisible({ timeout: 5000 });
    await sidebar2.getByText(roomName).first().click();

    // User2 should see JOIN ROOM button and "NOT A MEMBER" gate
    await expect(page2.getByText('[ JOIN ROOM ]').first()).toBeVisible({ timeout: 5000 });
    await expect(page2.getByText('NOT A MEMBER')).toBeVisible();

    // Click JOIN ROOM
    await page2.getByText('[ JOIN ROOM ]').first().click();

    // Should now see LEAVE ROOM and the message input
    await expect(page2.getByText('[ LEAVE ROOM ]')).toBeVisible({ timeout: 5000 });
    await expect(page2.locator('textarea[placeholder="Type a message..."]')).toBeVisible();

    await page2.close();
  });

  test('should show read-only state for left members', async ({ page }) => {
    await signupViaAPI(page);
    const roomName = `LeaveTest-${Date.now()}`;

    // Create and join room
    const roomRes = await page.request.post('/api/rooms', {
      data: { name: roomName },
    });
    const roomData = await roomRes.json();
    const roomId = roomData.data.room.id;

    // Send a message first
    await page.request.post('/api/messages', {
      data: { scopeType: 'room', scopeId: roomId, content: 'Before leaving' },
    });

    // Navigate to room
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText(roomName).first()).toBeVisible({ timeout: 5000 });
    await sidebar.getByText(roomName).first().click();

    // Should see LEAVE ROOM
    await expect(page.getByText('[ LEAVE ROOM ]')).toBeVisible({ timeout: 5000 });

    // Leave the room
    await page.getByText('[ LEAVE ROOM ]').click();

    // Should see [ REJOIN ] button
    await expect(page.getByText('[ REJOIN ]')).toBeVisible({ timeout: 5000 });

    // Should see the message in read-only mode
    await expect(page.getByText('Before leaving')).toBeVisible();

    // Message input should NOT be visible
    await expect(page.locator('textarea[placeholder="Type a message..."]')).not.toBeVisible();

    // Should see "You left this room" banner
    await expect(page.getByText('You left this room')).toBeVisible();

    // Rejoin
    await page.getByText('[ REJOIN ]').click();

    // Should see LEAVE ROOM again and message input
    await expect(page.getByText('[ LEAVE ROOM ]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('textarea[placeholder="Type a message..."]')).toBeVisible();
  });
});

test.describe('T-008: System Messages', () => {
  test('should display system messages for join events', async ({ page }) => {
    const { username } = await signupViaAPI(page);
    const roomName = `SysMsg-${Date.now()}`;

    // Create room
    const roomRes = await page.request.post('/api/rooms', {
      data: { name: roomName },
    });
    const roomData = await roomRes.json();
    const roomId = roomData.data.room.id;

    // Navigate to room — click the first match in sidebar
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText(roomName).first()).toBeVisible({ timeout: 5000 });
    await sidebar.getByText(roomName).first().click();

    // Should see system message about joining
    await expect(page.getByText(`${username} joined the room`)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('T-008: Room in Sidebar', () => {
  test('should show created room in sidebar Chatrooms section', async ({ page }) => {
    await signupViaAPI(page);
    const roomName = `SidebarRoom-${Date.now()}`;

    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });

    // Create a room via API
    await page.request.post('/api/rooms', {
      data: { name: roomName },
    });

    // Room should appear in sidebar after reload
    await page.reload();
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText(roomName)).toBeVisible({ timeout: 5000 });
  });
});
