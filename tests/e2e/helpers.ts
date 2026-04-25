import { type Page } from '@playwright/test';

/**
 * Generate a unique username for test isolation.
 */
export function uniqueUsername(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Signup a new user via the UI.
 */
export async function signupViaUI(
  page: Page,
  options?: { username?: string; email?: string; password?: string }
): Promise<{ username: string; password: string }> {
  const username = options?.username ?? uniqueUsername();
  const email = options?.email ?? `${username}@test.com`;
  const password = options?.password ?? 'testpass123';

  await page.goto('/');

  // Click "create account" link to go to signup
  await page.getByText('create account').click();

  // Fill signup form (IDs from SignupPage.tsx: username, email, password, passwordRepeat)
  await page.locator('#username').fill(username);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#passwordRepeat').fill(password);

  // Submit
  await page.getByRole('button', { name: /sign up/i }).click();

  return { username, password };
}

/**
 * Login an existing user via the UI.
 */
export async function loginViaUI(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  await page.goto('/');

  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /login/i }).click();
}

/**
 * Signup via API (faster than UI) and set the session cookie.
 */
export async function signupViaAPI(
  page: Page,
  options?: { username?: string; password?: string }
): Promise<{ username: string; password: string; userId: string }> {
  const username = options?.username ?? uniqueUsername();
  const password = options?.password ?? 'testpass123';

  // Use the API directly
  const response = await page.request.post('/api/auth/signup', {
    data: {
      username,
      email: `${username}@test.com`,
      password,
      passwordRepeat: password,
    },
  });

  const body = await response.json();
  const userId = body.data.user.id;

  // Navigate to app (cookie is set from the API call)
  await page.goto('/');

  return { username, password, userId };
}
