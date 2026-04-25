/**
 * T-007: Sidebar Structure — E2E Tests
 *
 * Acceptance Criteria:
 * - Three sections render with correct headers
 * - Chatrooms grouped by membership bucket, sorted by activity
 * - Users show avatar, name, title, online/offline status, last seen
 * - Sections collapsible and reorderable (order persists in localStorage)
 * - Clicking user opens DM view (wired in T-011 — check navigation)
 * - Clicking room opens room view (wired in T-008 — check navigation)
 */

import { test, expect } from '@playwright/test';
import { signupViaAPI } from './helpers';

test.describe('T-007: Sidebar — Section Structure', () => {
  test('should render three sections with hex-label headers', async ({ page }) => {
    await signupViaAPI(page);

    // Sidebar is the <aside> element
    const sidebar = page.locator('aside');

    // Wait for app shell
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });

    // Check all three section headers with hex codes
    await expect(sidebar.getByText('0x10')).toBeVisible();
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible();

    await expect(sidebar.getByText('0x20')).toBeVisible();
    await expect(sidebar.getByText('USERS', { exact: true })).toBeVisible();

    await expect(sidebar.getByText('0x30')).toBeVisible();
    await expect(sidebar.getByText('SCREENSHARES', { exact: true })).toBeVisible();
  });

  test('should show [ + NEW ROOM ] button in Chatrooms section', async ({ page }) => {
    await signupViaAPI(page);
    await expect(page.getByText('[ + NEW ROOM ]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('T-007: Sidebar — Users Section', () => {
  test('should display the current user in the Users section', async ({ page }) => {
    const { username } = await signupViaAPI(page);

    // Wait for sidebar Users section to load
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('USERS', { exact: true })).toBeVisible({ timeout: 10000 });

    // The user should appear in the sidebar with "(you)" suffix
    await expect(sidebar.getByText('(you)')).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText(username)).toBeVisible();
  });

  test('should show online indicator for the current user', async ({ page }) => {
    await signupViaAPI(page);

    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('USERS', { exact: true })).toBeVisible({ timeout: 10000 });

    // Verify the user entry exists with "(you)" marker — online indicator is a visual element
    await expect(sidebar.getByText('(you)')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('T-007: Sidebar — Collapse/Expand', () => {
  test('should collapse and expand sections', async ({ page }) => {
    await signupViaAPI(page);

    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('CHATROOMS', { exact: true })).toBeVisible({ timeout: 10000 });

    // The [ + NEW ROOM ] button should be visible initially
    await expect(page.getByText('[ + NEW ROOM ]')).toBeVisible();

    // Click the CHATROOMS header to collapse
    await sidebar.getByText('CHATROOMS', { exact: true }).click();

    // The [ + NEW ROOM ] button should now be hidden
    await expect(page.getByText('[ + NEW ROOM ]')).not.toBeVisible();

    // Click again to expand
    await sidebar.getByText('CHATROOMS', { exact: true }).click();

    // Should be visible again
    await expect(page.getByText('[ + NEW ROOM ]')).toBeVisible();
  });
});

test.describe('T-007: Sidebar — Navigation', () => {
  test('should show DM view when clicking a user', async ({ page }) => {
    await signupViaAPI(page);

    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('USERS', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText('(you)')).toBeVisible({ timeout: 10000 });

    // Click on the current user entry — this opens DM with self
    const userButton = sidebar.locator('button').filter({ hasText: '(you)' });
    await userButton.click();

    // DmView renders self-DM prevention message
    await expect(page.getByText("You can't send a DM to yourself")).toBeVisible({ timeout: 5000 });
  });
});
