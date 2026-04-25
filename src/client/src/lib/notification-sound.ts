/**
 * Notification sounds via Web Audio API
 *
 * No external sound files needed -- generates tones programmatically.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (audioContext && audioContext.state !== 'closed') {
    return audioContext;
  }
  audioContext = new AudioContext();
  return audioContext;
}

/**
 * Resume the shared AudioContext if it is suspended.
 * Chrome suspends AudioContext until a user gesture (click/keydown) occurs.
 * Call this on first user interaction to ensure notification sounds
 * (including incoming call ring) can play immediately.
 */
export function ensureAudioContext(): void {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch {
    // Silently fail if AudioContext is not available
  }
}

/**
 * Play a simple notification beep using Web Audio API.
 * Two-tone descending: 800Hz -> 600Hz, 0.3s total, quiet volume.
 */
export function playMessageSound(): void {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, ctx.currentTime);
    oscillator.frequency.setValueAtTime(600, ctx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    // Silently fail if audio context is not available
  }
}

/**
 * Play incoming call ring using Web Audio API.
 * Two-tone ring (880Hz -> 660Hz), repeated 3 times.
 */
export function playCallRingSound(): void {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    for (let i = 0; i < 3; i++) {
      const offset = i * 0.6;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime + offset);
      osc.frequency.setValueAtTime(660, ctx.currentTime + offset + 0.15);

      gain.gain.setValueAtTime(0.08, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.4);

      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.4);
    }
  } catch {
    // Silently fail
  }
}

/**
 * Play continuous incoming call ring.
 * Rings in bursts (3 tones, then 2s pause), repeating until stopped.
 * Returns a cleanup function to stop the ringing.
 */
export function startCallRingLoop(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function ring() {
    if (stopped) return;
    playCallRingSound();
    // 3 tones take ~1.8s, wait 2s pause before next burst
    timer = setTimeout(ring, 3800);
  }

  ring();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
