/**
 * VisualizerEngine — wraps Butterchurn with lifecycle management.
 *
 * Spec: 95.2
 * This module is the main lazy-load entry point. It is imported dynamically
 * only when the user opens the visualizer.
 */

import butterchurn from 'butterchurn';
import isSupported from 'butterchurn/dist/isSupported.min';
import { curatedPresets, presetNames, getPresetByIndex, DEFAULT_PRESET_NAME } from './visualizer-presets';

export { isSupported, presetNames };

const BLEND_TIME = 2.5; // seconds — Butterchurn morph transition
const DEFAULT_CYCLE_INTERVAL = 30_000; // 30 seconds auto-cycle
const CYCLE_PAUSE_ON_MANUAL = 60_000; // 60 seconds pause after manual nav

export interface EngineState {
  currentPresetName: string;
  currentPresetIndex: number;
  isCyclePaused: boolean;
  cycleInterval: number;
}

export class VisualizerEngine {
  private visualizer: ReturnType<typeof butterchurn.createVisualizer> | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private autoGainTimerId: ReturnType<typeof setInterval> | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private currentStream: MediaStream | null = null;
  // CGL-012 / F-CSD-198: the call-tap fallback captureCallAudio() creates
  // an AudioContext that must be closed on destroy(). The engine owns it
  // once received via connectAudio(..., externalContext).
  private externalAudioContext: AudioContext | null = null;

  // Render loop
  private rafId: number | null = null;
  private lastRenderTime = 0;
  private fpsCap = 30;

  // Preset cycling
  private currentPresetIndex = 0;
  private cyclePaused = true; // OFF by default
  private cycleInterval = DEFAULT_CYCLE_INTERVAL;
  private cycleTimerId: ReturnType<typeof setTimeout> | null = null;
  private manualPauseTimerId: ReturnType<typeof setTimeout> | null = null;

  // Callbacks
  private onStateChange: ((state: EngineState) => void) | null = null;

  constructor() {
    // Read persisted FPS cap
    const storedFps = localStorage.getItem('viz.fpsCap');
    if (storedFps === '60') {
      this.fpsCap = 60;
    }

    // Read persisted cycle settings
    const storedCycleEnabled = localStorage.getItem('viz.cycleEnabled');
    if (storedCycleEnabled === 'true') {
      this.cyclePaused = false;
    }
    // else: stays true (cycle OFF by default)

    const storedInterval = localStorage.getItem('viz.cycleInterval');
    if (storedInterval) {
      const parsed = parseInt(storedInterval, 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.cycleInterval = parsed;
      }
    }
  }

  /**
   * Initialize Butterchurn on the given canvas and connect audio.
   */
  init(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    onStateChange: (state: EngineState) => void,
  ): void {
    this.canvas = canvas;
    this.onStateChange = onStateChange;

    // Create AudioContext (one per session)
    this.audioContext = new AudioContext();
    // AudioContext may start suspended (autoplay policy) — resume immediately.
    // The user has already clicked (user gesture), so resume is allowed.
    if (this.audioContext.state === 'suspended') {
      console.info('[visualizer] AudioContext suspended, resuming…');
      this.audioContext.resume();
    }
    console.info('[visualizer] AudioContext state:', this.audioContext.state);

    // Create Butterchurn visualizer
    this.visualizer = butterchurn.createVisualizer(this.audioContext, canvas, {
      width,
      height,
    });

    // Load initial preset — use persisted name, then DEFAULT_PRESET_NAME, then index 0
    const storedPresetName = localStorage.getItem('viz.lastPreset');
    if (storedPresetName && curatedPresets[storedPresetName]) {
      this.currentPresetIndex = presetNames.indexOf(storedPresetName);
    } else if (curatedPresets[DEFAULT_PRESET_NAME]) {
      this.currentPresetIndex = presetNames.indexOf(DEFAULT_PRESET_NAME);
    }
    // else: stays at 0

    const { name, preset } = getPresetByIndex(this.currentPresetIndex);
    this.visualizer.loadPreset(preset, 0); // No blend for initial load
    this.notifyState();

    // Persist
    localStorage.setItem('viz.lastPreset', name);

    // Start auto-cycle only if enabled (persisted or default off)
    if (!this.cyclePaused) {
      this.startCycleTimer();
    }

    // Start render loop
    this.startRenderLoop();
  }

  /**
   * Connect an audio stream to the visualizer.
   */
  connectAudio(stream: MediaStream, externalContext?: AudioContext): void {
    if (!this.audioContext || !this.visualizer) return;

    // CGL-012 / F-CSD-198: track the external context so destroy() can
    // close it. If a previous external context existed and differs, close
    // it now.
    if (this.externalAudioContext && this.externalAudioContext !== externalContext) {
      this.externalAudioContext.close().catch(() => {});
    }
    this.externalAudioContext = externalContext ?? null;

    // Disconnect previous source
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        // ignore
      }
    }
    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // ignore
      }
    }

    // Stop previous stream tracks
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((t) => t.stop());
    }

    this.currentStream = stream;

    const tracks = stream.getAudioTracks();
    console.info('[visualizer] connectAudio: tracks:', tracks.length,
      'state:', tracks.map((t) => `${t.label} (${t.readyState})`).join(', '));
    console.info('[visualizer] connectAudio: AudioContext state:', this.audioContext.state);

    // Ensure AudioContext is running
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Create source node from the stream
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // GainNode for auto-level — different browsers/OS attenuate monitor
    // sources differently (Chromium/PipeWire ~10x, others may pass through).
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0; // Start neutral, auto-gain adjusts

    // Create analyser for Butterchurn
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;

    // Wire: source -> gain -> analyser
    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);

    // Connect boosted signal to Butterchurn
    this.visualizer.connectAudio(this.gainNode);

    // Start auto-gain: measure peak amplitude every 2s, adjust gain
    // so Butterchurn gets a usable signal (~0.15-0.5 range).
    this.startAutoGain();

    // Debug: check if we're receiving audio data
    setTimeout(() => {
      if (this.analyserNode) {
        const data = new Float32Array(this.analyserNode.fftSize);
        this.analyserNode.getFloatTimeDomainData(data);
        const maxVal = Math.max(...data.map(Math.abs));
        console.info('[visualizer] Audio level check (1s after connect): max amplitude =', maxVal.toFixed(6));
        if (maxVal < 0.001) {
          console.warn('[visualizer] Audio appears silent — check PipeWire routing');
        }
      }
    }, 1000);
  }

  /**
   * Resize the renderer (call after fullscreen change or window resize).
   */
  resize(width: number, height: number): void {
    if (!this.visualizer || !this.canvas) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.visualizer.setRendererSize(width, height);
  }

  /**
   * Navigate to next preset.
   */
  nextPreset(): void {
    this.currentPresetIndex = (this.currentPresetIndex + 1) % presetNames.length;
    this.loadCurrentPreset();
    this.pauseCycleTemporarily();
  }

  /**
   * Navigate to previous preset.
   */
  prevPreset(): void {
    this.currentPresetIndex =
      (this.currentPresetIndex - 1 + presetNames.length) % presetNames.length;
    this.loadCurrentPreset();
    this.pauseCycleTemporarily();
  }

  /**
   * Load a specific preset by index.
   */
  loadPresetByIndex(index: number): void {
    this.currentPresetIndex =
      ((index % presetNames.length) + presetNames.length) % presetNames.length;
    this.loadCurrentPreset();
    this.pauseCycleTemporarily();
  }

  /**
   * Toggle auto-cycle pause.
   */
  toggleCyclePause(): void {
    this.cyclePaused = !this.cyclePaused;
    if (this.cyclePaused) {
      this.stopCycleTimer();
    } else {
      this.startCycleTimer();
    }

    // Clear manual pause timer if user manually toggles
    if (this.manualPauseTimerId !== null) {
      clearTimeout(this.manualPauseTimerId);
      this.manualPauseTimerId = null;
    }

    // Persist cycle enabled state
    localStorage.setItem('viz.cycleEnabled', String(!this.cyclePaused));

    this.notifyState();
  }

  /**
   * Set the auto-cycle interval in milliseconds.
   * Persists to localStorage and restarts the timer if cycling is active.
   */
  setCycleInterval(ms: number): void {
    this.cycleInterval = ms;
    localStorage.setItem('viz.cycleInterval', String(ms));
    if (!this.cyclePaused) {
      this.startCycleTimer(); // Restart with new interval
    }
    this.notifyState();
  }

  /**
   * Get the current cycle interval in milliseconds.
   */
  getCycleInterval(): number {
    return this.cycleInterval;
  }

  /**
   * Get current engine state.
   */
  getState(): EngineState {
    return {
      currentPresetName: presetNames[this.currentPresetIndex] ?? '',
      currentPresetIndex: this.currentPresetIndex,
      isCyclePaused: this.cyclePaused,
      cycleInterval: this.cycleInterval,
    };
  }

  /**
   * Pause rendering and audio (tab visibility hidden).
   * Spec: 95.8.3
   *
   * CGL-014 / F-CSD-199: also stop the preset cycle timer so presets do
   * not advance while the tab is hidden. The cyclePaused flag is NOT
   * touched — resume() restarts the timer only if cycling was active
   * before suspend.
   */
  suspend(): void {
    this.stopRenderLoop();
    this.stopCycleTimer();
    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend();
    }
  }

  /**
   * Resume rendering and audio (tab visibility visible).
   * Spec: 95.8.3
   *
   * CGL-014 / F-CSD-199: restart the cycle timer iff cycling is active.
   */
  resume(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    if (!this.cyclePaused) {
      this.startCycleTimer();
    }
    this.startRenderLoop();
  }

  /**
   * Full cleanup — call on exit.
   * Spec: 95.8.2
   *
   * Order matters for PipeWire: disconnect audio nodes BEFORE stopping
   * MediaStream tracks, then close AudioContext. Otherwise PipeWire
   * sees the source-output as still registered (corked but alive) and
   * the system mic icon stays lit.
   */
  destroy(): void {
    // 1. Cancel rAF
    this.stopRenderLoop();

    // Stop cycle timers
    this.stopCycleTimer();
    if (this.manualPauseTimerId !== null) {
      clearTimeout(this.manualPauseTimerId);
      this.manualPauseTimerId = null;
    }

    // 2. Stop auto-gain (uses analyserNode/gainNode)
    this.stopAutoGain();

    // 3. Release Butterchurn's audio references
    this.visualizer = null;

    // 4. Disconnect audio nodes (BEFORE stopping tracks —
    //    MediaStreamAudioSourceNode holds a ref to the stream)
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        // ignore
      }
      this.gainNode = null;
    }
    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // ignore
      }
      this.analyserNode = null;
    }

    // 5. Stop all MediaStream tracks (PipeWire releases the node
    //    now that no AudioNode references the stream)
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((t) => t.stop());
      this.currentStream = null;
    }

    // 6. Close AudioContext (returns Promise — fire-and-forget is fine,
    //    the important refs are already disconnected above)
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    // 6b. CGL-012 / F-CSD-198: close the external (call-tap) AudioContext
    //     if one was handed over via connectAudio(). The engine owns it
    //     once received; without this close, it leaks forever.
    if (this.externalAudioContext) {
      this.externalAudioContext.close().catch(() => {});
      this.externalAudioContext = null;
    }

    // 7. Lose WebGL context
    if (this.canvas) {
      try {
        const gl = this.canvas.getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_lose_context');
        ext?.loseContext();
      } catch {
        // ignore
      }
      this.canvas = null;
    }

    this.onStateChange = null;
  }

  // ── Private ──────────────────────────────────────────────

  private loadCurrentPreset(): void {
    if (!this.visualizer) return;
    const { name, preset } = getPresetByIndex(this.currentPresetIndex);
    this.visualizer.loadPreset(preset, BLEND_TIME);
    localStorage.setItem('viz.lastPreset', name);
    this.notifyState();
  }

  private startRenderLoop(): void {
    if (this.rafId !== null) return; // Already running
    const renderFrame = (timestamp: number) => {
      const interval = 1000 / this.fpsCap;
      if (timestamp - this.lastRenderTime >= interval) {
        if (this.visualizer) {
          try {
            this.visualizer.render();
          } catch {
            // WebGL error — ignore silently
          }
        }
        this.lastRenderTime = timestamp;
      }
      this.rafId = requestAnimationFrame(renderFrame);
    };
    this.rafId = requestAnimationFrame(renderFrame);
  }

  private stopRenderLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private startCycleTimer(): void {
    // CGL-015 / F-CSD-182: defensive — cycleTimer is a no-op while paused.
    // Callers (toggleCyclePause, setCycleInterval, init, resume) already
    // ensure cyclePaused is false before scheduling. This guard is
    // belt-and-suspenders for any future call site.
    this.stopCycleTimer();
    if (this.cyclePaused) return;
    this.cycleTimerId = setTimeout(() => {
      this.currentPresetIndex =
        (this.currentPresetIndex + 1) % presetNames.length;
      this.loadCurrentPreset();
      this.startCycleTimer(); // Schedule next
    }, this.cycleInterval);
  }

  private stopCycleTimer(): void {
    if (this.cycleTimerId !== null) {
      clearTimeout(this.cycleTimerId);
      this.cycleTimerId = null;
    }
  }

  /**
   * Pause cycle temporarily after manual preset navigation.
   * Spec: 95.4.2 — 60 seconds pause, then resume.
   */
  private pauseCycleTemporarily(): void {
    // Only pause temporarily if cycle was active
    const wasCycling = !this.cyclePaused;
    this.cyclePaused = true;
    this.stopCycleTimer();

    if (this.manualPauseTimerId !== null) {
      clearTimeout(this.manualPauseTimerId);
    }

    // Only auto-resume if cycling was on before manual nav
    if (wasCycling) {
      this.manualPauseTimerId = setTimeout(() => {
        this.cyclePaused = false;
        this.manualPauseTimerId = null;
        this.startCycleTimer();
        this.notifyState();
      }, CYCLE_PAUSE_ON_MANUAL);
    }

    this.notifyState();
  }

  /**
   * Auto-gain: measure peak amplitude every 2s and adjust gain so
   * Butterchurn receives a usable signal level (~0.15-0.5 peak).
   * Works regardless of browser/OS attenuation level.
   */
  private startAutoGain(): void {
    this.stopAutoGain();
    const TARGET_PEAK = 0.3;
    const MIN_GAIN = 1;
    const MAX_GAIN = 50;

    this.autoGainTimerId = setInterval(() => {
      if (!this.analyserNode || !this.gainNode) return;

      const data = new Float32Array(this.analyserNode.fftSize);
      this.analyserNode.getFloatTimeDomainData(data);

      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }

      if (peak < 0.001) return; // Silence — don't adjust

      const currentGain = this.gainNode.gain.value;
      // Raw peak = peak / currentGain (what the source actually delivers)
      const rawPeak = peak / currentGain;
      const desiredGain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_PEAK / rawPeak));

      // Smooth: move 30% toward desired gain per tick
      const newGain = currentGain + (desiredGain - currentGain) * 0.3;
      this.gainNode.gain.value = Math.min(MAX_GAIN, Math.max(MIN_GAIN, newGain));
    }, 2000);
  }

  private stopAutoGain(): void {
    if (this.autoGainTimerId !== null) {
      clearInterval(this.autoGainTimerId);
      this.autoGainTimerId = null;
    }
  }

  private notifyState(): void {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }
}
