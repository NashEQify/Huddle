/**
 * AudioVisualizer — Fullscreen Milkdrop-style audio visualization.
 *
 * Spec: 95
 * Renders via React portal on document.body. Uses Butterchurn (lazy-loaded)
 * for WebGL 2.0 Milkdrop preset rendering. Audio captured from monitor source
 * of the configured output device.
 *
 * The container div is always in the DOM (rendered via portal). Only Butterchurn
 * and presets are lazy-loaded inside it. requestFullscreen() is called directly
 * from the user's click handler via the exposed open() method.
 *
 * All Butterchurn and preset code is loaded via dynamic import() — zero bytes
 * in the main bundle.
 */

import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { Phone, PhoneMissed } from 'lucide-react';
import type { AudioSourceType } from '../../lib/visualizer/audio-capture';
import { useCall } from '../../stores/call';
import { useNavigation } from '../../stores/navigation';
import { api } from '../../lib/api';
import { IconButton } from '../ui/IconButton';
import type { UserResponse } from '@huddle/shared';

// ── Types for lazy-loaded modules ──────────────────────────

interface EngineState {
  currentPresetName: string;
  currentPresetIndex: number;
  isCyclePaused: boolean;
  cycleInterval: number;
}

interface VisualizerEngineInstance {
  init(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    onStateChange: (state: EngineState) => void,
  ): void;
  connectAudio(stream: MediaStream, externalContext?: AudioContext): void;
  resize(width: number, height: number): void;
  nextPreset(): void;
  prevPreset(): void;
  loadPresetByIndex(index: number): void;
  toggleCyclePause(): void;
  setCycleInterval(ms: number): void;
  getCycleInterval(): number;
  getState(): EngineState;
  suspend(): void;
  resume(): void;
  destroy(): void;
}

// ── Cycle interval options ──────────────────────────────────

const CYCLE_INTERVAL_OPTIONS = [
  { label: '30s', value: 30_000 },
  { label: '1m', value: 60_000 },
  { label: '2m', value: 120_000 },
  { label: '5m', value: 300_000 },
] as const;

function formatCycleInterval(ms: number): string {
  const match = CYCLE_INTERVAL_OPTIONS.find((o) => o.value === ms);
  if (match) return match.label;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

// ── Error Boundary ────────────────────────────────────────

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class VisualizerErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(): void {
    // Errors caught — exit fullscreen after 3s
    setTimeout(() => {
      this.props.onError();
    }, 3000);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#000000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100000,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-lg)',
              color: 'var(--error)',
              letterSpacing: '0.02em',
            }}
          >
            [ VISUALIZER ERROR ] {this.state.errorMessage}
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Public handle ────────────────────────────────────────────

export interface AudioVisualizerHandle {
  /**
   * Call this from a synchronous click handler to satisfy the
   * browser's user-gesture requirement for requestFullscreen().
   */
  open: () => void;
}

// ── Main Component ────────────────────────────────────────

export const AudioVisualizer = forwardRef<AudioVisualizerHandle>(
  function AudioVisualizer(_props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<VisualizerEngineInstance | null>(null);

    // UI state
    const [isActive, setIsActive] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [audioSource, setAudioSource] = useState<AudioSourceType>('none');
    const [engineState, setEngineState] = useState<EngineState>({
      currentPresetName: '',
      currentPresetIndex: 0,
      isCyclePaused: true,
      cycleInterval: 30_000,
    });

    // Preset picker
    const [pickerOpen, setPickerOpen] = useState(false);
    const [presetList, setPresetList] = useState<string[]>([]);

    // Cycle interval dropup
    const [cycleDropupOpen, setCycleDropupOpen] = useState(false);

    // Menu auto-hide
    const [menuVisible, setMenuVisible] = useState(true);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFullscreenRef = useRef(false);

    // ── Incoming DM call banner (spec 95.6.6) ────────────────
    const {
      incomingDmCall,
      acceptIncomingCall,
      declineIncomingCall,
      state: callState,
    } = useCall();
    const { navigateToDm } = useNavigation();
    const [incomingCallerUsername, setIncomingCallerUsername] = useState<string | null>(null);
    const [isAcceptingCall, setIsAcceptingCall] = useState(false);

    const isInCall = callState.activeScope !== null;
    const hasIncomingCall = isActive && incomingDmCall !== null && !isInCall;

    // Fetch caller username when incoming call arrives
    useEffect(() => {
      if (!incomingDmCall) {
        setIncomingCallerUsername(null);
        setIsAcceptingCall(false);
        return;
      }

      let cancelled = false;
      api.get<{ users: UserResponse[] }>('/api/users').then((result) => {
        if (cancelled) return;
        if (result.ok) {
          const found = result.data.users.find(
            (u) => u.id === incomingDmCall.callerId
          );
          if (found) {
            setIncomingCallerUsername(found.username);
          }
        }
      });

      return () => {
        cancelled = true;
      };
    }, [incomingDmCall?.callerId]);

    const handleAcceptCall = useCallback(async () => {
      if (!incomingDmCall) return;
      setIsAcceptingCall(true);

      // Exit fullscreen first, then accept
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {
        // Continue even if exitFullscreen fails
      }

      const result = await acceptIncomingCall();
      if (result.ok) {
        navigateToDm(incomingDmCall.callerId);
      } else {
        setIsAcceptingCall(false);
      }
    }, [incomingDmCall, acceptIncomingCall, navigateToDm]);

    const handleDeclineCall = useCallback(() => {
      declineIncomingCall();
    }, [declineIncomingCall]);

    // ── Cleanup ──────────────────────────────────────────────

    const cleanup = useCallback(() => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (engineRef.current) {
        // destroy() closes the external AudioContext we handed over via
        // connectAudio (CGL-012 / F-CSD-198), so no separate close here.
        engineRef.current.destroy();
        engineRef.current = null;
      }

      // Reset state for next open
      setIsActive(false);
      setIsLoading(true);
      setError(null);
      setAudioSource('none');
      setPickerOpen(false);
      setCycleDropupOpen(false);
      setPresetList([]);
      setExpandedAuthors(new Set());
      setMenuVisible(true);
      setEngineState({
        currentPresetName: '',
        currentPresetIndex: 0,
        isCyclePaused: true,
        cycleInterval: 30_000,
      });
    }, []);

    // ── Initialize Butterchurn engine (lazy-loaded) ──────────

    const initializeEngine = useCallback(async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        // Dynamic import — this is the lazy-load point
        const engineModule = await import('../../lib/visualizer/VisualizerEngine');

        // Check WebGL 2.0 support
        if (!engineModule.isSupported()) {
          setError('WebGL 2.0 not available');
          setIsLoading(false);
          setTimeout(() => {
            try {
              document.exitFullscreen();
            } catch {
              cleanup();
            }
          }, 3000);
          return;
        }

        // Set canvas dimensions after fullscreen is active
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;

        // Create and init engine
        const engine = new engineModule.VisualizerEngine();
        engine.init(canvas, width, height, (state) => {
          setEngineState(state);
        });
        engineRef.current = engine;
        setPresetList(engineModule.presetNames);

        setIsLoading(false);

        // Attempt to capture monitor audio
        const captureModule = await import('../../lib/visualizer/audio-capture');

        const outputDeviceId = localStorage.getItem('audio.outputDeviceId') ?? '';
        console.info('[visualizer] localStorage audio.outputDeviceId:', outputDeviceId || '(not set)');
        const monitorDeviceId = await captureModule.findMonitorSource(outputDeviceId);

        if (monitorDeviceId) {
          try {
            const stream = await captureModule.captureMonitorAudio(monitorDeviceId);
            engine.connectAudio(stream);
            setAudioSource('monitor');
            console.info('[visualizer] Audio connected via monitor source');
            return;
          } catch (captureErr) {
            console.warn('[visualizer] Monitor found but capture failed:', captureErr);
          }
        }

        // Fallback: tap call audio if user is in a call.
        // CGL-012 / F-CSD-198: hand the external AudioContext to the engine
        // so engine.destroy() owns the close — no ref, no dual-ownership.
        const callCapture = captureModule.captureCallAudio();
        if (callCapture) {
          engine.connectAudio(callCapture.stream, callCapture.context);
          setAudioSource('call');
          console.info('[visualizer] Audio connected via active call');
          return;
        }

        console.warn('[visualizer] No audio source found');
        setAudioSource('none');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load visualizer';
        setError(message);
        setIsLoading(false);
        setTimeout(() => {
          try {
            document.exitFullscreen();
          } catch {
            cleanup();
          }
        }, 3000);
      }
    }, [cleanup]);

    // ── Imperative open() — called from click handler ────────

    useImperativeHandle(ref, () => ({
      open() {
        const container = containerRef.current;
        if (!container || isFullscreenRef.current) return;

        setIsActive(true);

        // Pre-request mic permission BEFORE fullscreen — browsers block
        // permission prompts in fullscreen mode. This ensures Firefox can
        // enumerate monitor sources (needs mic permission to show labels).
        // Fire-and-forget: the actual capture happens in initializeEngine.
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((s) => s.getTracks().forEach((t) => t.stop()))
          .catch(() => {}); // Permission denied is OK — we try anyway

        // requestFullscreen() MUST be synchronous within the click handler
        // (browser user-gesture requirement). Spec 95.1.2.
        //
        // CGL-013 / F-CSD-180: requestFullscreen() can throw synchronously
        // (unsupported / disallowed) AND can return a Promise that rejects
        // later (user denied, Permissions-Policy, iframe sandbox). Both
        // paths must be handled — otherwise the engine renders into a 0×0
        // windowed container forever. Strategy: abort the open() attempt
        // if fullscreen fails. The engine is initialized by the
        // fullscreenchange handler; if we never enter fullscreen we never
        // initialize, which avoids the 0×0 trap. Show a transient error
        // toast for user feedback.
        const handleFullscreenError = (reason: unknown) => {
          console.warn('[visualizer] requestFullscreen failed:', reason);
          setError('Fullscreen not available. Visualizer requires fullscreen mode.');
          setIsActive(false);
          setTimeout(() => setError(null), 3000);
        };
        try {
          const result = container.requestFullscreen();
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).catch(handleFullscreenError);
          }
        } catch (syncErr) {
          handleFullscreenError(syncErr);
        }
      },
    }), [initializeEngine]);

    // ── Fullscreen change handler ────────────────────────────

    useEffect(() => {
      const handleFullscreenChange = () => {
        if (document.fullscreenElement === containerRef.current) {
          isFullscreenRef.current = true;
          // Now in fullscreen — initialize engine in next rAF for accurate sizing
          requestAnimationFrame(() => {
            initializeEngine();
          });
        } else if (isFullscreenRef.current) {
          isFullscreenRef.current = false;
          cleanup();
        }
      };

      document.addEventListener('fullscreenchange', handleFullscreenChange);
      return () => {
        document.removeEventListener('fullscreenchange', handleFullscreenChange);
      };
    }, [initializeEngine, cleanup]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        cleanup();
      };
    }, [cleanup]);

    // ── beforeunload: release audio on tab/window close ─────
    // Brave+PipeWire doesn't release source-outputs on tab close.
    // This ensures MediaStream tracks are stopped even if React
    // unmount doesn't fire (hard close, navigation, crash).
    useEffect(() => {
      const handleBeforeUnload = () => {
        if (engineRef.current) {
          engineRef.current.destroy();
          engineRef.current = null;
        }
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }, []);

    // ── Tab visibility ───────────────────────────────────────

    useEffect(() => {
      const handleVisibility = () => {
        const engine = engineRef.current;
        if (!engine) return;

        if (document.hidden) {
          engine.suspend();
        } else {
          engine.resume();
        }
      };

      document.addEventListener('visibilitychange', handleVisibility);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibility);
      };
    }, []);

    // ── Window resize ────────────────────────────────────────

    useEffect(() => {
      const handleResize = () => {
        const engine = engineRef.current;
        if (!engine || !isFullscreenRef.current) return;
        engine.resize(window.innerWidth, window.innerHeight);
      };

      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }, []);

    // ── Keyboard controls ────────────────────────────────────

    useEffect(() => {
      if (!isActive) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        const engine = engineRef.current;
        if (!engine) return;

        switch (e.key) {
          case 'Escape':
            if (cycleDropupOpen) {
              e.preventDefault();
              setCycleDropupOpen(false);
            } else if (pickerOpen) {
              e.preventDefault();
              setPickerOpen(false);
            }
            break;
          case ' ':
            e.preventDefault();
            engine.toggleCyclePause();
            break;
          case 'ArrowRight':
            engine.nextPreset();
            break;
          case 'ArrowLeft':
            engine.prevPreset();
            break;
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }, [isActive, pickerOpen, cycleDropupOpen]);

    // ── Mouse move — auto-hide menu ──────────────────────────

    const resetHideTimer = useCallback(() => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      setMenuVisible(true);
      // Keep menu visible if no audio (spec 95.5) or incoming call (spec 95.6.6)
      if (audioSource === 'none' || hasIncomingCall) return;
      hideTimerRef.current = setTimeout(() => {
        setMenuVisible(false);
      }, 3000);
    }, [audioSource, hasIncomingCall]);

    useEffect(() => {
      if (!isActive) return;

      const handleMouseMove = () => {
        resetHideTimer();
      };

      document.addEventListener('mousemove', handleMouseMove);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
      };
    }, [isActive, resetHideTimer]);

    // Keep menu visible when in "no audio" state
    useEffect(() => {
      if (audioSource === 'none') {
        setMenuVisible(true);
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      }
    }, [audioSource]);

    // Keep menu visible when incoming call banner is showing (spec 95.6.6)
    useEffect(() => {
      if (hasIncomingCall) {
        setMenuVisible(true);
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      }
    }, [hasIncomingCall]);

    // ── Preset picker ──────────────────────────────────────────

    type PresetEntry = { index: number; name: string; shortName: string };
    type PresetGroup = { author: string; presets: PresetEntry[] };

    const handleSelectPreset = useCallback((index: number) => {
      engineRef.current?.loadPresetByIndex(index);
      setPickerOpen(false);
    }, []);

    // Accordion state — which author groups are expanded
    const [expandedAuthors, setExpandedAuthors] = useState<Set<string>>(new Set());

    const toggleAuthor = useCallback((author: string) => {
      setExpandedAuthors((prev) => {
        const next = new Set(prev);
        if (next.has(author)) next.delete(author);
        else next.add(author);
        return next;
      });
    }, []);

    // Group presets by author, merge singles into "Various"
    const groupedPresets: PresetGroup[] = React.useMemo(() => {
      const authorMap = new Map<string, PresetEntry[]>();

      presetList.forEach((name, index) => {
        const dashIdx = name.indexOf(' - ');
        let author: string;
        let shortName: string;
        if (dashIdx > 0) {
          author = name.substring(0, dashIdx).trim();
          shortName = name.substring(dashIdx + 3).trim();
        } else {
          author = '_solo_';
          shortName = name;
        }
        const key = author.toLowerCase();
        if (!authorMap.has(key)) authorMap.set(key, []);
        authorMap.get(key)!.push({ index, name, shortName });
      });

      const groups: PresetGroup[] = [];
      const various: PresetEntry[] = [];

      // Sort authors alphabetically, collect singles into Various
      const sortedKeys = [...authorMap.keys()].sort();
      for (const key of sortedKeys) {
        const presets = authorMap.get(key)!;
        if (presets.length <= 1) {
          // Single-preset author -> Various (use full name as shortName)
          various.push(
            ...presets.map((p) => ({ ...p, shortName: p.name })),
          );
        } else {
          // Use the original casing from the first preset
          const author = presets[0].name.substring(
            0,
            presets[0].name.indexOf(' - '),
          ).trim();
          groups.push({ author, presets });
        }
      }

      if (various.length > 0) {
        groups.push({ author: 'Various', presets: various });
      }

      return groups;
    }, [presetList]);

    // ── Cycle interval selector ──────────────────────────────

    const handleSelectCycleInterval = useCallback((ms: number) => {
      engineRef.current?.setCycleInterval(ms);
      setCycleDropupOpen(false);
    }, []);

    // ── Exit handler ─────────────────────────────────────────

    const handleExit = useCallback(() => {
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          cleanup();
        }
      } catch {
        cleanup();
      }
    }, [cleanup]);

    // ── Render ───────────────────────────────────────────────

    // The container is always in the DOM (spec 95.1.2).
    // When not active, it's a 0x0 fixed element (no visual footprint).
    // We avoid display:none because some browsers reject requestFullscreen()
    // on hidden elements.
    const portalContent = (
      <div
        ref={containerRef}
        style={isActive ? {
          position: 'fixed',
          inset: 0,
          background: '#000000',
          zIndex: 100000,
          cursor: !menuVisible ? 'none' : 'default',
        } : {
          position: 'fixed',
          width: 0,
          height: 0,
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        {isActive && (
          <VisualizerErrorBoundary onError={handleExit}>
            {/* Canvas */}
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                display: 'block',
              }}
            />

            {/* Incoming DM call banner (spec 95.6.6) */}
            {hasIncomingCall && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  background: 'rgba(31, 31, 53, 0.95)',
                  borderBottom: '1px solid var(--warning)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-4)',
                  padding: 'var(--space-3) var(--space-4)',
                  zIndex: 4,
                  letterSpacing: '0.02em',
                }}
              >
                <span style={{ color: 'var(--warning)' }}>
                  [ INCOMING CALL ]
                </span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {incomingCallerUsername ?? 'someone'} is calling...
                </span>
                {isAcceptingCall ? (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    connecting...
                  </span>
                ) : (
                  <IconButton
                    icon={Phone}
                    label="Accept call"
                    color="var(--success)"
                    onClick={handleAcceptCall}
                  />
                )}
                <IconButton
                  icon={PhoneMissed}
                  label="Decline call"
                  color="var(--error)"
                  disabled={isAcceptingCall}
                  onClick={handleDeclineCall}
                />
              </div>
            )}

            {/* Loading state */}
            {isLoading && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-lg)',
                    color: 'var(--text-muted)',
                    letterSpacing: '0.02em',
                  }}
                >
                  [ LOADING VISUALIZER... ]
                </span>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-lg)',
                    color: 'var(--error)',
                    letterSpacing: '0.02em',
                  }}
                >
                  [ VISUALIZER ERROR ] {error}
                </span>
              </div>
            )}

            {/* "No Audio" overlay — share tab audio */}
            {!isLoading && !error && audioSource === 'none' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-4)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-lg)',
                    color: 'var(--text-muted)',
                    letterSpacing: '0.02em',
                  }}
                >
                  [ NO AUDIO SOURCE ]
                </span>

                {/* Setup guidance — show both platforms, no OS detection
                    (Firefox privacy.resistFingerprinting spoofs the UA) */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                  alignItems: 'center',
                  maxWidth: '520px',
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-secondary)',
                    }}>
                      linux:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        // One-liner: installs wrapper script + systemd service + starts it.
                        // Wrapper auto-stops after 30s idle (no browser consumer).
                        // Safe to run multiple times (overwrites existing).
                        const wrapper = `#!/usr/bin/env bash
set -euo pipefail
IDLE_TIMEOUT=\${HUDDLE_CAPTURE_IDLE_TIMEOUT:-30}
NODE_NAME="Huddle_Audio_Capture"
pw-loopback --capture-props='media.class=Stream/Input/Audio stream.capture.sink=true node.name=huddle_capture_in audio.position=[FL,FR]' --playback-props="media.class=Audio/Source node.name=\${NODE_NAME} node.description=\\"\${NODE_NAME}\\" audio.position=[FL,FR]" &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT
sleep 60
idle=0
while kill -0 $PID 2>/dev/null; do
if pw-link -ol 2>/dev/null | grep -q "\${NODE_NAME}:playback"; then idle=0; else idle=$((idle+5)); [ $idle -ge $IDLE_TIMEOUT ] && exit 0; fi
sleep 5
done
exit 1`;
                        const service = `[Unit]
Description=Huddle Audio Capture (auto-stops when idle)
After=pipewire.service
BindsTo=pipewire.service
[Service]
Type=simple
ExecStart=%h/.local/bin/huddle-audio-capture.sh
Restart=on-failure
RestartSec=3
Environment=HUDDLE_CAPTURE_IDLE_TIMEOUT=30`;
                        const cmd = `mkdir -p ~/.local/bin ~/.config/systemd/user && cat > ~/.local/bin/huddle-audio-capture.sh << 'WRAPPER'\n${wrapper}\nWRAPPER\nchmod +x ~/.local/bin/huddle-audio-capture.sh && cat > ~/.config/systemd/user/huddle-audio-capture.service << 'SVC'\n${service}\nSVC\nsystemctl --user daemon-reload && systemctl --user start huddle-audio-capture`;
                        navigator.clipboard.writeText(cmd).then(() => {
                          const el = document.getElementById('visu-copy-hint');
                          if (el) el.textContent = 'copied! paste in terminal — installs + starts with auto-shutdown.';
                        });
                      }}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--accent)',
                        borderRadius: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        padding: 'var(--space-2) var(--space-4)',
                        letterSpacing: '0.05em',
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
                      COPY SETUP COMMAND
                    </button>
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                  }}>
                    windows: enable "Stereo Mix" in sound settings
                  </span>
                  <span
                    id="visu-copy-hint"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    one-time setup, then reload
                  </span>
                </div>
              </div>
            )}

            {/* Preset picker panel — accordion, opens upward from bottom */}
            {!isLoading && !error && pickerOpen && (
              <>
                {/* Backdrop — click to close */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 2,
                  }}
                  onClick={() => setPickerOpen(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 48,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 'min(520px, 88vw)',
                    maxHeight: '60vh',
                    overflowY: 'auto',
                    background: 'rgba(22, 22, 40, 0.96)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-sm)',
                    zIndex: 3,
                    padding: 'var(--space-1) 0',
                  }}
                >
                  {groupedPresets.map((group) => {
                    const isExpanded = expandedAuthors.has(group.author);
                    const hasActive = group.presets.some(
                      (p) => p.index === engineState.currentPresetIndex,
                    );
                    return (
                      <div key={group.author}>
                        {/* Author header — clickable accordion toggle */}
                        <button
                          type="button"
                          onClick={() => toggleAuthor(group.author)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                            borderRadius: 0,
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-sm)',
                            color: hasActive ? 'var(--accent)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            padding: 'var(--space-2) var(--space-3)',
                            textAlign: 'left',
                            letterSpacing: '0.02em',
                            transition: 'color 150ms',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = 'var(--accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = hasActive
                              ? 'var(--accent)'
                              : 'var(--text-secondary)';
                          }}
                        >
                          <span style={{
                            fontSize: 'var(--text-xs)',
                            width: '1em',
                            flexShrink: 0,
                            display: 'inline-block',
                            transition: 'transform 150ms',
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          }}>
                            {'\u25B6'}
                          </span>
                          <span style={{ flex: 1 }}>{group.author}</span>
                          <span style={{
                            color: 'var(--text-muted)',
                            fontSize: 'var(--text-xs)',
                            flexShrink: 0,
                          }}>
                            {group.presets.length}
                          </span>
                        </button>

                        {/* Presets — visible only when expanded */}
                        {isExpanded && group.presets.map((p) => (
                          <button
                            key={p.index}
                            type="button"
                            onClick={() => handleSelectPreset(p.index)}
                            style={{
                              display: 'block',
                              width: '100%',
                              background: p.index === engineState.currentPresetIndex
                                ? 'rgba(168, 216, 185, 0.10)'
                                : 'transparent',
                              border: 'none',
                              borderRadius: 0,
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-sm)',
                              color: p.index === engineState.currentPresetIndex
                                ? 'var(--accent)'
                                : 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: 'var(--space-1) var(--space-3) var(--space-1) var(--space-6)',
                              textAlign: 'left',
                              letterSpacing: '0.02em',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              transition: 'color 150ms, background 150ms',
                            }}
                            onMouseEnter={(e) => {
                              if (p.index !== engineState.currentPresetIndex) {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                                e.currentTarget.style.color = 'var(--accent)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background =
                                p.index === engineState.currentPresetIndex
                                  ? 'rgba(168, 216, 185, 0.10)'
                                  : 'transparent';
                              e.currentTarget.style.color =
                                p.index === engineState.currentPresetIndex
                                  ? 'var(--accent)'
                                  : 'var(--text-muted)';
                            }}
                          >
                            {p.shortName}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Cycle dropup backdrop — click to close */}
            {!isLoading && !error && cycleDropupOpen && !engineState.isCyclePaused && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                }}
                onClick={() => setCycleDropupOpen(false)}
              />
            )}

            {/* Bottom menu bar */}
            {!isLoading && !error && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 48,
                  background: 'rgba(31, 31, 53, 0.85)',
                  borderTop: '1px solid var(--border-default)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: menuVisible ? 'translateY(0)' : 'translateY(100%)',
                  opacity: menuVisible ? 1 : 0,
                  transition: 'transform 200ms ease-out, opacity 200ms ease-out',
                  zIndex: 1,
                }}
              >
                {/* Cycle controls: shuffle toggle + cycle time — inline left of preset picker */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  {/* Shuffle / auto-cycle toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      engineRef.current?.toggleCyclePause();
                      setCycleDropupOpen(false);
                    }}
                    aria-label={engineState.isCyclePaused ? 'Enable auto-cycle' : 'Disable auto-cycle'}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 0,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-lg)',
                      color: engineState.isCyclePaused
                        ? 'var(--text-muted)'
                        : 'var(--accent)',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      lineHeight: 1,
                      letterSpacing: '0.02em',
                      transition: 'color 150ms',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = engineState.isCyclePaused
                        ? 'var(--text-muted)'
                        : 'var(--accent)';
                    }}
                  >
                    {'\u27F3'}
                  </button>

                  {/* Cycle time selector — only visible when cycle is ON */}
                  {!engineState.isCyclePaused && (
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => setCycleDropupOpen((v) => !v)}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border-default)',
                          borderRadius: 0,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          color: cycleDropupOpen
                            ? 'var(--accent)'
                            : 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: '2px 8px',
                          letterSpacing: '0.02em',
                          transition: 'color 150ms, border-color 150ms',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--accent)';
                          e.currentTarget.style.borderColor = 'var(--accent)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = cycleDropupOpen
                            ? 'var(--accent)'
                            : 'var(--text-secondary)';
                          e.currentTarget.style.borderColor = 'var(--border-default)';
                        }}
                      >
                        {formatCycleInterval(engineState.cycleInterval)}
                      </button>

                      {/* Dropup — positioned above the time button */}
                      {cycleDropupOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 'calc(100% + 8px)',
                            left: 0,
                            background: 'rgba(22, 22, 40, 0.96)',
                            border: '1px solid var(--border-default)',
                            borderRadius: 0,
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-sm)',
                            zIndex: 3,
                            padding: 'var(--space-1) 0',
                          }}
                        >
                          {CYCLE_INTERVAL_OPTIONS.map((opt) => {
                            const isSelected = opt.value === engineState.cycleInterval;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => handleSelectCycleInterval(opt.value)}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  background: isSelected
                                    ? 'rgba(168, 216, 185, 0.10)'
                                    : 'transparent',
                                  border: 'none',
                                  borderRadius: 0,
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 'var(--text-sm)',
                                  color: isSelected
                                    ? 'var(--accent)'
                                    : 'var(--text-muted)',
                                  cursor: 'pointer',
                                  padding: 'var(--space-1) var(--space-4)',
                                  textAlign: 'left',
                                  letterSpacing: '0.02em',
                                  whiteSpace: 'nowrap',
                                  transition: 'color 150ms, background 150ms',
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected) {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                                    e.currentTarget.style.color = 'var(--accent)';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = isSelected
                                    ? 'rgba(168, 216, 185, 0.10)'
                                    : 'transparent';
                                  e.currentTarget.style.color = isSelected
                                    ? 'var(--accent)'
                                    : 'var(--text-muted)';
                                }}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Preset picker button — centered */}
                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen((v) => !v);
                    setCycleDropupOpen(false);
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-default)',
                    borderRadius: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-sm)',
                    color: pickerOpen ? 'var(--accent)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 'var(--space-1) var(--space-3)',
                    letterSpacing: '0.02em',
                    maxWidth: '400px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    transition: 'color 150ms, border-color 150ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--accent)';
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = pickerOpen ? 'var(--accent)' : 'var(--text-secondary)';
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                  }}
                >
                  {engineState.currentPresetName || 'Select Preset'}
                </button>

                {/* Exit button */}
                <button
                  type="button"
                  onClick={handleExit}
                  style={{
                    position: 'absolute',
                    right: 'var(--space-4)',
                    background: 'transparent',
                    border: 'none',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--error)',
                    cursor: 'pointer',
                    padding: 0,
                    letterSpacing: '0.02em',
                  }}
                >
                  [ESC]
                </button>
              </div>
            )}
          </VisualizerErrorBoundary>
        )}
      </div>
    );

    return createPortal(portalContent, document.body);
  },
);
