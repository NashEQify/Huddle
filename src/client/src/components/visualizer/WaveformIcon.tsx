/**
 * WaveformIcon — small button in the header that opens the audio visualizer.
 *
 * Spec: 95.1.1
 * Static 5-bar waveform. Idle: --text-muted. Hover: --accent with 200ms transition.
 * Preloads Butterchurn on hover. No tooltip (intentionally cryptic).
 */

import { useCallback, useRef } from 'react';

interface WaveformIconProps {
  onClick: () => void;
}

// Bar heights as percentages of the container height (5 bars, varying)
const BAR_HEIGHTS = [40, 70, 100, 55, 80];
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const ICON_HEIGHT = 20;

export function WaveformIcon({ onClick }: WaveformIconProps) {
  const preloadedRef = useRef(false);

  const handleMouseEnter = useCallback(() => {
    // Preload Butterchurn chunk on hover (spec 95.1.1)
    if (!preloadedRef.current) {
      preloadedRef.current = true;
      import('../../lib/visualizer/VisualizerEngine').catch(() => {
        // Preload failed — not critical, will load on click
      });
    }
  }, []);

  const totalWidth = BAR_HEIGHTS.length * BAR_WIDTH + (BAR_HEIGHTS.length - 1) * BAR_GAP;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      aria-label="Audio Visualizer"
      style={{
        background: 'transparent',
        border: 'none',
        padding: 'var(--space-1)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg
        width={totalWidth}
        height={ICON_HEIGHT}
        viewBox={`0 0 ${totalWidth} ${ICON_HEIGHT}`}
        style={{ display: 'block' }}
      >
        <style>{`
          .waveform-bar {
            fill: var(--text-muted);
            transition: fill 200ms;
          }
          button:hover .waveform-bar {
            fill: var(--accent);
          }
        `}</style>
        {BAR_HEIGHTS.map((heightPct, i) => {
          const barHeight = (heightPct / 100) * ICON_HEIGHT;
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = ICON_HEIGHT - barHeight;
          return (
            <rect
              key={i}
              className="waveform-bar"
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={barHeight}
            />
          );
        })}
      </svg>
    </button>
  );
}
