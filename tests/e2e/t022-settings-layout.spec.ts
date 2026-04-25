/**
 * T-022: Settings Page Layout — E2E Tests
 *
 * Verifies:
 * - Settings page renders all sections (Avatar, Title, Email, Password, Quote)
 * - Two-column grid layout is used (compact, no excessive scrolling)
 * - All hex-labels are visible
 */

import { test, expect, type Browser } from '@playwright/test';
import { signupViaAPI } from './helpers';

async function createIsolatedUser(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { username, userId } = await signupViaAPI(page);
  return { context, page, username, userId };
}

test.describe('T-022: Settings Page — Layout', () => {
  test('should render all settings sections', async ({ browser }) => {
    const user = await createIsolatedUser(browser);

    // Navigate to settings
    await user.page.getByText('SETTINGS').click();

    // Verify all hex-labels are visible
    await expect(user.page.getByText('AVATAR')).toBeVisible({ timeout: 3000 });
    await expect(user.page.getByText('TITLE')).toBeVisible();
    await expect(user.page.getByText('EMAIL')).toBeVisible();
    await expect(user.page.getByText('PASSWORD')).toBeVisible();
    await expect(user.page.getByText('QUOTE SUBMISSION')).toBeVisible();

    // Verify the BACK button is present
    await expect(user.page.getByText('BACK')).toBeVisible();

    await user.context.close();
  });

  test('should use a wide container for compact layout', async ({ browser }) => {
    const user = await createIsolatedUser(browser);

    // Navigate to settings
    await user.page.getByText('SETTINGS').click();
    await expect(user.page.getByText('AVATAR')).toBeVisible({ timeout: 3000 });

    // The content container should have maxWidth of 900px (not 600px)
    // We can verify by checking the container that wraps all sections
    // Find the grid container (two-column layout)
    const gridContainer = user.page.locator('div[style*="grid-template-columns"]').first();
    await expect(gridContainer).toBeVisible();

    // Verify grid has two columns
    const gridCols = await gridContainer.evaluate((el) =>
      window.getComputedStyle(el).gridTemplateColumns
    );
    // Should have two column values (e.g., "450px 450px" or similar)
    const colCount = gridCols.split(' ').length;
    expect(colCount).toBe(2);

    await user.context.close();
  });
});
