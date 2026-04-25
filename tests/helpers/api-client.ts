/**
 * Test helper: HTTP client with cookie management for API tests.
 * Targets the running Fastify server on localhost:3000.
 */

const BASE_URL = 'http://localhost:3000';

export class TestApiClient {
  private cookies: Map<string, string> = new Map();

  /**
   * Make a GET request.
   */
  async get(path: string): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    this.extractCookies(res);
    const body = await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers };
  }

  /**
   * Make a POST request with JSON body.
   */
  async post(path: string, data?: any): Promise<{ status: number; body: any; headers: Headers }> {
    const headers: Record<string, string> = { ...this.buildHeaders() };
    // Only set Content-Type and body when data is provided.
    // Fastify rejects Content-Type: application/json with empty body.
    if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    this.extractCookies(res);
    const body = await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers };
  }

  /**
   * Make a PATCH request with JSON body.
   */
  async patch(path: string, data?: any): Promise<{ status: number; body: any; headers: Headers }> {
    const headers: Record<string, string> = { ...this.buildHeaders() };
    // Only set Content-Type and body when data is provided.
    // Fastify rejects Content-Type: application/json with empty body.
    if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    this.extractCookies(res);
    const body = await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers };
  }

  /**
   * Make a POST request with multipart form data.
   */
  async postMultipart(
    path: string,
    formData: FormData
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const headers: Record<string, string> = {};
    const cookieStr = this.cookieString();
    if (cookieStr) headers['Cookie'] = cookieStr;

    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    });
    this.extractCookies(res);
    const body = await res.json().catch(() => null);
    return { status: res.status, body, headers: res.headers };
  }

  /**
   * Signup a test user and return the client (with session cookie set).
   */
  async signup(overrides?: {
    username?: string;
    email?: string;
    password?: string;
  }): Promise<{ status: number; body: any }> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const data = {
      username: overrides?.username ?? `test-${suffix}`,
      email: overrides?.email ?? `test-${suffix}@test.com`,
      password: overrides?.password ?? 'testpass123',
      passwordRepeat: overrides?.password ?? 'testpass123',
    };
    return this.post('/api/auth/signup', data);
  }

  /**
   * Clear all cookies (simulate fresh client).
   */
  clearCookies(): void {
    this.cookies.clear();
  }

  /**
   * Get current cookie value.
   */
  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const cookieStr = this.cookieString();
    if (cookieStr) headers['Cookie'] = cookieStr;
    return headers;
  }

  private cookieString(): string {
    const parts: string[] = [];
    for (const [name, value] of this.cookies) {
      parts.push(`${name}=${value}`);
    }
    return parts.join('; ');
  }

  private extractCookies(res: Response): void {
    const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
    for (const header of setCookieHeaders) {
      const match = header.match(/^([^=]+)=([^;]*)/);
      if (match) {
        const [, name, value] = match;
        if (value === '' || header.includes('Max-Age=0')) {
          this.cookies.delete(name!);
        } else {
          this.cookies.set(name!, value!);
        }
      }
    }
  }
}

/**
 * Create a fresh API client.
 */
export function createClient(): TestApiClient {
  return new TestApiClient();
}

/**
 * Create an API client already authenticated as a new test user.
 */
export async function createAuthenticatedClient(overrides?: {
  username?: string;
  email?: string;
  password?: string;
}): Promise<{ client: TestApiClient; user: any; profile: any }> {
  const client = createClient();
  const res = await client.signup(overrides);
  if (res.status !== 201) {
    throw new Error(`Signup failed: ${JSON.stringify(res.body)}`);
  }
  return {
    client,
    user: res.body.data.user,
    profile: res.body.data.profile,
  };
}
