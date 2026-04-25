/**
 * camera-constraints — Builds camera capture options with iOS facingMode fallback.
 *
 * iOS WebKit (Safari engine, used by all iOS browsers) ignores deviceId constraints
 * in getUserMedia for camera selection. On mobile, we detect the facing direction
 * from the device label and use facingMode instead.
 *
 * On desktop, deviceId works reliably and is used as before.
 */

const MOBILE_UA_RE = /iPhone|iPad|iPod|Android/i;

function isMobile(): boolean {
  return MOBILE_UA_RE.test(navigator.userAgent);
}

type FacingMode = 'user' | 'environment';

/**
 * Infer facingMode from a device label string.
 * Returns undefined if we cannot determine the direction.
 */
function facingModeFromLabel(label: string): FacingMode | undefined {
  const l = label.toLowerCase();

  // Front-facing indicators
  if (
    l.includes('front') ||
    l.includes('facetime') ||
    l.includes('user') ||
    l.includes('selfie')
  ) {
    return 'user';
  }

  // Rear-facing indicators
  if (
    l.includes('back') ||
    l.includes('rear') ||
    l.includes('environment') ||
    l.includes('wide') ||
    l.includes('ultra') ||
    l.includes('telephoto')
  ) {
    return 'environment';
  }

  return undefined;
}

/**
 * Build camera capture options suitable for the current platform.
 *
 * On mobile: resolves the deviceId to a facingMode via the device label.
 *            Falls back to facingMode: 'user' if the label is ambiguous.
 * On desktop: passes deviceId through unchanged.
 *
 * @param deviceId - The stored camera deviceId from settings (may be empty string).
 * @returns Partial options object with either `deviceId` or `facingMode` set.
 */
export async function buildCameraConstraints(
  deviceId: string | undefined,
): Promise<{ deviceId?: string; facingMode?: FacingMode }> {
  // No device selected — let the browser pick the default
  if (!deviceId) {
    return {};
  }

  // Desktop — deviceId works fine
  if (!isMobile()) {
    return { deviceId };
  }

  // Mobile — look up the label for this deviceId and map to facingMode
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const match = devices.find(
      (d) => d.kind === 'videoinput' && d.deviceId === deviceId,
    );

    if (match && match.label) {
      const mode = facingModeFromLabel(match.label);
      if (mode) {
        return { facingMode: mode };
      }
      // Label exists but we cannot determine direction — use both as best effort
      return { deviceId, facingMode: 'user' };
    }

    // No label available (permissions not yet granted) or device not found —
    // fall back to deviceId and hope for the best
    return { deviceId };
  } catch {
    // enumerateDevices failed — fall back to deviceId
    return { deviceId };
  }
}
