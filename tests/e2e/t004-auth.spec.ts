/**
 * T-004: Auth — E2E Tests
 *
 * Tests the frontend auth flow:
 * - Login screen renders
 * - Signup creates account and enters app
 * - Login with valid credentials enters app
 * - Invalid credentials show error
 * - Logout returns to login screen
 * - Auto-login on reload
 */

import { test, expect } from '@playwright/test';
import { uniqueUsername, signupViaUI, loginViaUI, signupViaAPI } from './helpers';

test.describe('T-004: Auth — Login Page', () => {
  test('should display login form on initial visit', async ({ page }) => {
    await page.goto('/');

    // Wait for loading to finish
    await expect(page.getByText('Huddle').first()).toBeVisible();
    await expect(page.locator('#login-username')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.getByRole('button', { name: /login/i })).toBeVisible();
    await expect(page.getByText('create account')).toBeVisible();
  });

  test('should switch between login and signup views', async ({ page }) => {
    await page.goto('/');

    // Go to signup
    await page.getByText('create account').click();
    // Signup page uses id="username" (not "signup-username")
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible();

    // Go back to login
    await page.getByText('already have an account').click();
    await expect(page.locator('#login-username')).toBeVisible();
  });
});

test.describe('T-004: Auth — Signup Flow', () => {
  test('should create account and enter app shell', async ({ page }) => {
    const { username } = await signupViaUI(page);

    // Should now be in the app shell — check for header with username
    // Use header locator to avoid matching in sidebar
    await expect(page.locator('header').getByText(username)).toBeVisible({ timeout: 10000 });

    // Should see burger menu button
    await expect(page.getByRole('button', { name: /menu/i })).toBeVisible();
  });
});

test.describe('T-004: Auth — Login Flow', () => {
  test('should login with valid credentials and enter app', async ({ page }) => {
    const username = uniqueUsername('login');
    const password = 'testpass123';

    // First signup via API
    await page.request.post('/api/auth/signup', {
      data: {
        username,
        email: `${username}@test.com`,
        password,
        passwordRepeat: password,
      },
    });

    // Logout (clear cookie)
    await page.request.post('/api/auth/logout');

    // Now login via UI
    await loginViaUI(page, username, password);

    // Should be in app shell — use header to avoid ambiguity
    await expect(page.locator('header').getByText(username)).toBeVisible({ timeout: 10000 });
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/');

    // Use unique username to avoid rate limiter from previous test runs
    const badUser = `bad-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await page.locator('#login-username').fill(badUser);
    await page.locator('#login-password').fill('wrongpassword');
    await page.getByRole('button', { name: /login/i }).click();

    // Should show error message (either "invalid" or rate-limit)
    await expect(page.getByText(/invalid|too many/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('T-004: Auth — Logout', () => {
  test('should logout and return to login screen', async ({ page }) => {
    // Signup and enter app
    await signupViaAPI(page);

    // Wait for app shell to be visible
    await expect(page.getByRole('button', { name: /menu/i })).toBeVisible({ timeout: 10000 });

    // Open burger menu and click Abmelden
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByText('Abmelden').click();

    // Should be back at login
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('T-004: Auth — Auto-login', () => {
  test('should auto-login on page reload if session is valid', async ({ page }) => {
    const { username } = await signupViaAPI(page);

    // Wait for app shell — use header
    await expect(page.locator('header').getByText(username)).toBeVisible({ timeout: 10000 });

    // Reload page
    await page.reload();

    // Should still be in app shell (auto-login)
    await expect(page.locator('header').getByText(username)).toBeVisible({ timeout: 10000 });
  });
});
