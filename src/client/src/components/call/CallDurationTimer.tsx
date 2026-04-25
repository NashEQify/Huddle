/**
 * CallDurationTimer -- Shared timer component that shows elapsed time
 * since a given start timestamp. Used in CallControls, RoomView header,
 * and sidebar RoomItem.
 */

import { useState, useEffect } from 'react';

interface CallDurationTimerProps {
  /** Timestamp (Date.now()-style) when the call started */
  startedAt: number;
  /** Optional prefix text before the time (e.g., "CALL") */
  prefix?: string;
  /** CSS color override (defaults to --accent-dim) */
  color?: string;
  /** Font size override (defaults to --text-xs) */
  fontSize?: string;
}

export function CallDurationTimer({
  startedAt,
  prefix,
  color = 'var(--accent-dim)',
  fontSize = 'var(--text-xs)',
}: CallDurationTimerProps) {
  const [elapsed, setElapsed] = useState(
    Math.floor((Date.now() - startedAt) / 1000)
  );

  useEffect(() => {
    // Sync immediately
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize,
        color,
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
      }}
    >
      {prefix ? `${prefix} ${display}` : display}
    </span>
  );
}
