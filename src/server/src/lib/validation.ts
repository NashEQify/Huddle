/**
 * Shared input validators.
 *
 * Used by REST routes to enforce spec-level invariants on user-supplied
 * strings (room names, DM titles, etc.) beyond simple length checks.
 */

/**
 * Returns true if the string contains any character that must not appear in
 * user-visible text fields per spec 10.3 (Room name validation):
 *
 *   - U+0000 .. U+001F  — C0 controls (NUL, tabs, newlines, ESC, etc.)
 *   - U+007F            — DEL
 *   - U+2028, U+2029    — LINE SEPARATOR, PARAGRAPH SEPARATOR
 *
 * These characters break rendering, enable log-injection / CSV-injection
 * tricks, and are useless in a human-readable name.
 */
export function containsForbiddenControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f) return true;
    if (code === 0x7f) return true;
    if (code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/**
 * Validate a room name. Length window + control-char rejection.
 * Returns an error message on failure, null on success. Callers should
 * `.trim()` before calling so leading/trailing whitespace is not counted.
 */
export function validateRoomName(name: string): string | null {
  if (name.length === 0 || name.length > 50) {
    return 'Room name must be 1-50 characters';
  }
  if (containsForbiddenControlChars(name)) {
    return 'Room name contains forbidden control characters';
  }
  return null;
}
