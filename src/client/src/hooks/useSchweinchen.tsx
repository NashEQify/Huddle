import { useState, useCallback, useRef } from 'react';

/**
 * Generate a wet fart sound using Web Audio API.
 * Triggered on user gesture (OK click) per spec 15.5.
 */
function playFartSound(): void {
  try {
    const ctx = new AudioContext();
    const duration = 0.8;

    // Noise buffer for the "wet" texture
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * 0.3;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Low-frequency oscillator for the bass rumble
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + duration);

    // Filter for "wetness"
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + duration);
    filter.Q.value = 5;

    // Gain envelope
    const gainNoise = ctx.createGain();
    gainNoise.gain.setValueAtTime(0.4, ctx.currentTime);
    gainNoise.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    const gainOsc = ctx.createGain();
    gainOsc.gain.setValueAtTime(0.3, ctx.currentTime);
    gainOsc.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    // Connect noise path
    noiseSource.connect(filter);
    filter.connect(gainNoise);
    gainNoise.connect(ctx.destination);

    // Connect oscillator path
    osc.connect(gainOsc);
    gainOsc.connect(ctx.destination);

    // Play
    noiseSource.start(ctx.currentTime);
    osc.start(ctx.currentTime);
    noiseSource.stop(ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);

    // Cleanup
    setTimeout(() => ctx.close(), (duration + 0.5) * 1000);
  } catch {
    // Audio not available — silent fallback
  }
}

const SCHWEIN_ASCII = `
    ___
   /   \\
  | o o |
  |  _  |
  | / \\ |
   \\___/
    | |
   _| |_
  |_____|
`;

export function useSchweinchen() {
  const [visible, setVisible] = useState(false);
  const afterDismissRef = useRef<(() => void) | null>(null);

  const checkAndShow = useCallback(
    (username: string, afterDismiss: () => void): boolean => {
      if (username.toLowerCase() === 'penis') {
        afterDismissRef.current = afterDismiss;
        setVisible(true);
        return true;
      }
      return false;
    },
    []
  );

  function handleDismiss() {
    playFartSound();
    setVisible(false);
    // Proceed with the original action after a short delay for sound
    const cb = afterDismissRef.current;
    afterDismissRef.current = null;
    if (cb) {
      setTimeout(cb, 200);
    }
  }

  function SchweinModal() {
    if (!visible) return null;

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(10, 10, 20, 0.7)',
          backdropFilter: 'blur(4px)',
        }}
      >
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: 'var(--space-6)',
            maxWidth: '360px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
          }}
        >
          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-4)',
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>[ </span>
            <span style={{ color: 'var(--text-secondary)' }}>0x69 </span>
            <span style={{ color: 'var(--error)' }}>SCHWEINCHEN ALERT</span>
            <span style={{ color: 'var(--text-secondary)' }}> ]</span>
          </div>

          <pre
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-lg)',
              color: 'var(--warning)',
              lineHeight: 1.2,
              margin: '0 0 var(--space-4) 0',
            }}
          >
            {SCHWEIN_ASCII}
          </pre>

          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-lg)',
              fontWeight: 700,
              color: 'var(--error)',
              marginBottom: 'var(--space-6)',
            }}
          >
            Du bist ein kleines Schweinchen!
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            style={{
              background: 'transparent',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 0,
              padding: 'var(--space-2) var(--space-8)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              transition: 'background 150ms, color 150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent)';
              e.currentTarget.style.color = 'var(--bg-base)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--accent)';
            }}
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  return { checkAndShow, SchweinModal };
}
