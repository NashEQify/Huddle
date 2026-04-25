/**
 * CallIndicatorOverlay — Small mic-icon overlay on an avatar.
 *
 * Spec 30-chat §30.2 / CGL-014 (2026-04-10):
 * Shown at bottom-right of a user's avatar when that user is currently in
 * any active call. Gives a consistent "is in call" signal across the sidebar
 * (DM list) and the room member strip. The standalone CallParticipantsStrip
 * only lives inside the call view, so the sidebar needs its own signal.
 *
 * The parent must wrap the avatar in a `position: relative` container.
 *
 * Styling follows TTY aesthetic:
 *  - No border-radius (hard rule)
 *  - Accent (mint) color for the mic
 *  - Dark surface background with a 1px border so it reads over both
 *    light and dark avatar pixels
 */

import React from 'react';

interface CallIndicatorOverlayProps {
  /** Overall box size in px. Default 14 (fits 48×48 avatars well). */
  size?: number;
  /** Accessible hover tooltip. */
  title?: string;
}

export function CallIndicatorOverlay({
  size = 14,
  title = 'In a call',
}: CallIndicatorOverlayProps) {
  const iconSize = Math.max(8, size - 4);

  return (
    <span
      aria-label={title}
      title={title}
      style={{
        position: 'absolute',
        bottom: '-2px',
        right: '-2px',
        width: `${size}px`,
        height: `${size}px`,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--accent)',
        lineHeight: 1,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-4.08c3.39-.49 6-3.39 6-6.92h-2z" />
      </svg>
    </span>
  );
}
