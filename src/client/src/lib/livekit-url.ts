/**
 * Get the LiveKit WebSocket URL for signaling.
 *
 * Resolution order:
 * 1. Runtime config from server (/api/config -> livekitUrl) -- for Docker deployments
 * 2. VITE_LIVEKIT_URL env var (set at build time) -- for build-from-source with .env
 * 3. Dev default: ws://localhost:7880 (only in dev, never in production)
 */

let _cachedUrl: string | null = null;
let _fetchPromise: Promise<string> | null = null;

/**
 * Fetch and cache the LiveKit URL from the server.
 * Called at app startup. Safe to call multiple times (deduped).
 */
export function fetchLivekitUrl(): Promise<string> {
  if (_cachedUrl) return Promise.resolve(_cachedUrl);
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = (async () => {
    // Try runtime config from server
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const json = await res.json();
        const serverUrl: string | undefined = json.data?.livekitUrl;
        if (serverUrl) {
          _cachedUrl = serverUrl;
          console.info('[LiveKit] URL from server config:', serverUrl);
          return serverUrl;
        }
      }
    } catch {
      // Server not reachable or endpoint missing -- fall through
    }

    // Fall back to build-time env var
    const envUrl: string | undefined = import.meta.env.VITE_LIVEKIT_URL;
    if (envUrl) {
      _cachedUrl = envUrl;
      console.info('[LiveKit] URL from build-time env:', envUrl);
      return envUrl;
    }

    // Dev default
    const defaultUrl = 'ws://localhost:7880';
    _cachedUrl = defaultUrl;
    console.warn('[LiveKit] Using dev default URL:', defaultUrl);
    return defaultUrl;
  })();

  return _fetchPromise;
}

/**
 * Get the LiveKit URL. MUST be awaited before initiating any call.
 * Waits for the fetch to complete if it hasn't yet — never silently
 * falls back to localhost in production.
 */
export async function getLivekitUrl(): Promise<string> {
  if (_cachedUrl) return _cachedUrl;
  return fetchLivekitUrl();
}
