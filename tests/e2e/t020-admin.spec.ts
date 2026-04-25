/**
 * T-020: Admin Console — E2E Tests
 *
 * Tests admin console functionality:
 * - Admin button visible only for admins
 * - Non-admin cannot access admin API routes
 * - Admin can list users, reset passwords, deactivate/reactivate
 * - Admin can list/rename/delete rooms
 * - Admin can view system status
 * - Admin console navigation (tabs)
 *
 * Uses POST /api/test/promote-admin (dev-only endpoint) to make
 * the test user an admin regardless of signup order.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { uniqueUsername, signupViaAPI } from './helpers';

/**
 * Sign up a user and promote to admin via the dev-only test endpoint.
 */
async function signupAsAdmin(context: BrowserContext): Promise<{
  page: Page;
  username: string;
  userId: string;
  password: string;
}> {
  const page = await context.newPage();
  const result = await signupViaAPI(page);

  // Promote to admin
  const promoteRes = await page.request.post('/api/test/promote-admin');
  expect(promoteRes.ok()).toBeTruthy();

  // Reload to pick up new isAdmin flag in session
  await page.reload();
  await expect(page.getByRole('button', { name: /menu/i })).toBeVisible({ timeout: 10000 });

  return { page, ...result };
}

test.describe('T-020: Admin — Access Control', () => {
  test('admin sees ADMIN button, non-admin does not', async ({ context }) => {
    // Admin user
    const admin = await signupAsAdmin(context);

    // Check admin has ADMIN entry in burger menu
    await admin.page.getByRole('button', { name: /menu/i }).click();
    await expect(admin.page.getByTestId('admin-button')).toBeVisible();
    // Close burger menu by clicking backdrop
    await admin.page.locator('.burger-backdrop').click();

    // Non-admin user (separate page, no promotion)
    const page2 = await context.newPage();
    await signupViaAPI(page2);
    await expect(page2.getByRole('button', { name: /menu/i })).toBeVisible({ timeout: 10000 });

    // Non-admin should NOT have ADMIN entry in burger menu
    await page2.getByRole('button', { name: /menu/i }).click();
    await expect(page2.getByTestId('admin-button')).not.toBeVisible();
  });

  test('non-admin API calls should return 403', async ({ context }) => {
    // Non-admin user
    const page = await context.newPage();
    await signupViaAPI(page);

    const usersRes = await page.request.get('/api/admin/users');
    expect(usersRes.status()).toBe(403);

    const roomsRes = await page.request.get('/api/admin/rooms');
    expect(roomsRes.status()).toBe(403);

    const systemRes = await page.request.get('/api/admin/system');
    expect(systemRes.status()).toBe(403);
  });
});

test.describe('T-020: Admin — Console Navigation', () => {
  test('admin console opens with tabs and X close button', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    // Open burger menu and click ADMIN
    await admin.page.getByRole('button', { name: /menu/i }).click();
    await admin.page.getByTestId('admin-button').click();

    // Should see ADMIN CONSOLE header
    await expect(admin.page.getByText('ADMIN CONSOLE')).toBeVisible({ timeout: 5000 });

    // Should see tabs
    await expect(admin.page.getByRole('button', { name: /^users$/i })).toBeVisible();
    await expect(admin.page.getByRole('button', { name: /^rooms$/i })).toBeVisible();
    await expect(admin.page.getByRole('button', { name: /^system$/i })).toBeVisible();

    // Should see X close button
    await expect(admin.page.getByRole('button', { name: /close/i })).toBeVisible();
  });

  test('BACK button returns to main app', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    await admin.page.getByRole('button', { name: /menu/i }).click();
    await admin.page.getByTestId('admin-button').click();
    await expect(admin.page.getByText('ADMIN CONSOLE')).toBeVisible({ timeout: 5000 });

    // Click X close button
    await admin.page.getByRole('button', { name: /close/i }).click();

    // Should be back in main app shell
    await expect(admin.page.locator('header').getByText('Huddle')).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('T-020: Admin — Users API', () => {
  test('admin can list users', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    const res = await admin.page.request.get('/api/admin/users');
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.data.users).toBeDefined();
    expect(body.data.users.length).toBeGreaterThanOrEqual(1);

    // Find our admin user
    const adminUser = body.data.users.find(
      (u: { username: string }) => u.username === admin.username
    );
    expect(adminUser).toBeDefined();
    expect(adminUser.isAdmin).toBe(true);
    expect(adminUser.isActive).toBe(true);
  });

  test('admin can reset another user password', async ({ browser }) => {
    // Admin in own context
    const adminCtx = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const admin = await signupAsAdmin(adminCtx);

    // Second user in separate context (separate cookies)
    const userCtx = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const userPage = await userCtx.newPage();
    const { userId: user2Id } = await signupViaAPI(userPage);

    // Reset password via admin API (from admin's context)
    const res = await admin.page.request.post(
      `/api/admin/users/${user2Id}/reset-password`
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.data.tempPassword).toBeDefined();
    expect(body.data.tempPassword.length).toBe(12);

    await adminCtx.close();
    await userCtx.close();
  });

  test('admin can deactivate and reactivate a user', async ({ browser }) => {
    // Admin in own context
    const adminCtx = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const admin = await signupAsAdmin(adminCtx);

    // Second user in separate context
    const userCtx = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const userPage = await userCtx.newPage();
    const { userId: user2Id } = await signupViaAPI(userPage);

    // Deactivate
    const deactRes = await admin.page.request.patch(
      `/api/admin/users/${user2Id}/deactivate`
    );
    expect(deactRes.ok()).toBeTruthy();

    const deactBody = await deactRes.json();
    expect(deactBody.data.user.isActive).toBe(false);

    // Reactivate
    const reactRes = await admin.page.request.patch(
      `/api/admin/users/${user2Id}/reactivate`
    );
    expect(reactRes.ok()).toBeTruthy();

    const reactBody = await reactRes.json();
    expect(reactBody.data.user.isActive).toBe(true);

    await adminCtx.close();
    await userCtx.close();
  });

  test('admin cannot deactivate self', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    const res = await admin.page.request.patch(
      `/api/admin/users/${admin.userId}/deactivate`
    );
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(body.error.code).toBe('INVALID_ACTION');
  });
});

test.describe('T-020: Admin — Rooms API', () => {
  test('admin can list rooms', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    const res = await admin.page.request.get('/api/admin/rooms');
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.data.rooms).toBeDefined();
    expect(Array.isArray(body.data.rooms)).toBe(true);
  });

  test('admin can rename a room', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    // Create a room first
    const createRes = await admin.page.request.post('/api/rooms', {
      data: { name: 'test-rename-room' },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    const roomId = createBody.data.room.id;

    // Rename via admin API
    const renameRes = await admin.page.request.patch(
      `/api/admin/rooms/${roomId}`,
      { data: { name: 'renamed-room' } }
    );
    expect(renameRes.ok()).toBeTruthy();

    const renameBody = await renameRes.json();
    expect(renameBody.data.room.name).toBe('renamed-room');
  });

  test('admin can delete a room', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    // Create a room
    const createRes = await admin.page.request.post('/api/rooms', {
      data: { name: 'test-delete-room' },
    });
    const createBody = await createRes.json();
    const roomId = createBody.data.room.id;

    // Delete via admin API
    const deleteRes = await admin.page.request.delete(
      `/api/admin/rooms/${roomId}`
    );
    expect(deleteRes.ok()).toBeTruthy();

    // Verify room is gone
    const listRes = await admin.page.request.get('/api/admin/rooms');
    const listBody = await listRes.json();
    const found = listBody.data.rooms.find((r: { id: string }) => r.id === roomId);
    expect(found).toBeUndefined();
  });

  test('admin room rename validates input', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    // Create a room
    const createRes = await admin.page.request.post('/api/rooms', {
      data: { name: 'validate-room' },
    });
    const createBody = await createRes.json();
    const roomId = createBody.data.room.id;

    // Empty name should fail
    const emptyRes = await admin.page.request.patch(
      `/api/admin/rooms/${roomId}`,
      { data: { name: '' } }
    );
    expect(emptyRes.status()).toBe(400);

    // Too long name should fail (>50 chars)
    const longName = 'x'.repeat(51);
    const longRes = await admin.page.request.patch(
      `/api/admin/rooms/${roomId}`,
      { data: { name: longName } }
    );
    expect(longRes.status()).toBe(400);
  });
});

test.describe('T-020: Admin — System Status', () => {
  test('admin can fetch system status', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    const res = await admin.page.request.get('/api/admin/system');
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.data.totalUsers).toBeGreaterThanOrEqual(1);
    expect(typeof body.data.onlineUsers).toBe('number');
    expect(typeof body.data.totalRooms).toBe('number');
    expect(typeof body.data.activeCalls).toBe('number');
    expect(typeof body.data.activeScreenshares).toBe('number');
    expect(typeof body.data.uploadSizeBytes).toBe('number');
    expect(typeof body.data.dbSizeBytes).toBe('number');
  });
});

test.describe('T-020: Admin — Users Tab UI', () => {
  test('users tab shows user list with actions', async ({ browser }) => {
    // Admin in own context
    const adminCtx = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const admin = await signupAsAdmin(adminCtx);

    // Create a second user in separate context
    const userCtx = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const userPage = await userCtx.newPage();
    const { username: user2Name } = await signupViaAPI(userPage);

    // Open admin console via burger menu
    await admin.page.getByRole('button', { name: /menu/i }).click();
    await admin.page.getByTestId('admin-button').click();
    await expect(admin.page.getByText('ADMIN CONSOLE')).toBeVisible({ timeout: 5000 });

    // Users tab should be default and show both users
    await expect(admin.page.getByText(admin.username, { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(admin.page.getByText(user2Name, { exact: true })).toBeVisible();

    // Should show total count
    await expect(admin.page.getByText(/\d+ users total/)).toBeVisible();

    // Should show RESET PW buttons
    const resetButtons = admin.page.getByText('[ RESET PW ]');
    await expect(resetButtons.first()).toBeVisible();

    await adminCtx.close();
    await userCtx.close();
  });
});

test.describe('T-020: Admin — Force-End Call API', () => {
  test('force-end call endpoint requires valid input', async ({ context }) => {
    const admin = await signupAsAdmin(context);

    // Missing fields should return 400
    const badRes = await admin.page.request.post('/api/admin/calls/end', {
      data: {},
    });
    expect(badRes.status()).toBe(400);

    // Valid but no active call — should still succeed (no-op)
    const okRes = await admin.page.request.post('/api/admin/calls/end', {
      data: { scopeType: 'room', scopeId: 'nonexistent' },
    });
    expect(okRes.ok()).toBeTruthy();
  });
});
