/**
 * VoiceTest — Live microphone test with visual level meter and optional loopback.
 *
 * Spec: 70.6
 * Uses createLocalAudioTrack (no LiveKit server needed), GainNode pipeline,
 * AnalyserNode for level metering, optional loopback to speakers.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createLocalAudioTrack, type LocalAudioTrack } from 'livekit-client';
import { createGainPipeline, calculateRms, type GainPipelineResult } from '../../lib/audio-utils';
import type { MediaSettings } from '../../hooks/useMediaSettings';

interface VoiceTestProps {
  settings: MediaSettings & {
    update: (key: keyof MediaSettings, value: string | number | boolean) => void;
  };
  disabled?: boolean;
  micPermissionDenied?: boolean;
  onTrackCreated?: (track: LocalAudioTrack) => void;
  onTrackStopped?: () => void;
}

export function VoiceTest({
  settings,
  disabled = false,
  micPermissionDenied = false,
  onTrackCreated,
  onTrackStopped,
}: VoiceTestProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [rmsLevel, setRmsLevel] = useState(0);
  // Persistent preference — survives start/stop cycles. When test is not
  // running, this is still interactive (user can tick it before pressing
  // Start). When test starts, loopback is auto-activated if the preference
  // is on. Playback is always gated on `isRunning` (no sound while idle).
  const [loopbackEnabled, setLoopbackEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);

  const trackRef = useRef<LocalAudioTrack | null>(null);
  const pipelineRef = useRef<GainPipelineResult | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Stable refs for callbacks to avoid dependency churn
  const onTrackCreatedRef = useRef(onTrackCreated);
  onTrackCreatedRef.current = onTrackCreated;
  const onTrackStoppedRef = useRef(onTrackStopped);
  onTrackStoppedRef.current = onTrackStopped;

  // Cleanup everything
  // Note: we intentionally do NOT reset `loopbackEnabled` here. That's a
  // persistent user preference — if the user re-runs the test with the same
  // settings, loopback should resume the same way. The audio element is
  // torn down regardless (no sound while test is idle).
  const stopTest = useCallback(() => {
    // Stop animation frame
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Stop loopback audio playback (preference persists)
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
    }

    // Cleanup pipeline
    if (pipelineRef.current) {
      pipelineRef.current.cleanup();
      pipelineRef.current = null;
    }

    // Stop and release track
    if (trackRef.current) {
      trackRef.current.stop();
      trackRef.current = null;
    }

    setIsRunning(false);
    setRmsLevel(0);
    onTrackStoppedRef.current?.();
  }, []);

  // Level meter update loop (~20fps with 50ms throttle)
  const updateLevelMeter = useCallback(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;

    const now = performance.now();
    if (now - lastUpdateRef.current >= 50) {
      const dataArray = new Uint8Array(pipeline.analyserNode.frequencyBinCount);
      pipeline.analyserNode.getByteTimeDomainData(dataArray);
      const rms = calculateRms(dataArray);
      setRmsLevel(rms);
      lastUpdateRef.current = now;
    }

    animFrameRef.current = requestAnimationFrame(updateLevelMeter);
  }, []);

  // Start test
  const startTest = useCallback(async () => {
    setError(null);

    try {
      const audioTrack = await createLocalAudioTrack({
        deviceId: settings.audioInputDeviceId || undefined,
        noiseSuppression: settings.audioNoiseSuppression,
      });

      trackRef.current = audioTrack;
      onTrackCreatedRef.current?.(audioTrack);

      // Create GainNode pipeline
      const rawTrack = audioTrack.mediaStreamTrack;
      const pipeline = createGainPipeline(rawTrack, settings.audioInputGain);
      pipelineRef.current = pipeline;

      // CGL-013: Resume AudioContext immediately on test start (not only
      // when loopback is toggled). Chrome/Brave start AudioContexts suspended
      // by default, and the level meter won't update until the context is
      // resumed — previously this left the meter stuck at 0 until the user
      // clicked the loopback toggle, which was confusing ("my mic is broken").
      if (pipeline.audioContext.state === 'suspended') {
        try {
          await pipeline.audioContext.resume();
        } catch (resumeErr) {
          console.warn('[VoiceTest] AudioContext resume failed — level meter may not update:', resumeErr);
        }
      }

      setIsRunning(true);

      // Start level meter
      lastUpdateRef.current = 0;
      animFrameRef.current = requestAnimationFrame(updateLevelMeter);

      // If loopback preference was pre-set by the user, auto-activate playback
      // now that the pipeline is ready.
      if (loopbackEnabled) {
        // Defer slightly so pipelineRef is fully set before startLoopback reads it
        queueMicrotask(() => {
          void startLoopbackPlayback();
        });
      }
    } catch (err) {
      const error = err as Error;
      // F-CSD-7007: map DOMException names to user-friendly strings instead of
      // leaking raw browser error text (e.g. "Could not start audio source").
      if (error.name === 'NotAllowedError') {
        setError('microphone access denied -- check browser permissions');
        setMicDenied(true);
      } else if (error.name === 'NotFoundError') {
        setError('no microphone found');
      } else if (error.name === 'NotReadableError') {
        setError('microphone in use by another application');
      } else {
        setError(`voice test failed: ${error.name || 'unknown error'}`);
      }
      stopTest();
    }
    // startLoopbackPlayback is declared below; excluded from deps to avoid
    // circular useCallback identity — it reads from refs and state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.audioInputDeviceId, settings.audioNoiseSuppression, settings.audioInputGain, updateLevelMeter, stopTest, loopbackEnabled]);

  // Update gain in real-time when slider changes
  useEffect(() => {
    if (pipelineRef.current) {
      pipelineRef.current.gainNode.gain.value = settings.audioInputGain / 100;
    }
  }, [settings.audioInputGain]);

  // Start the actual loopback audio playback against an already-built
  // pipeline. Separate from the toggle because it can be called from two
  // places: the toggle handler (user gesture context) and from startTest
  // (if user pre-enabled loopback).
  const startLoopbackPlayback = useCallback(async () => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;

    try {
      // Resume AudioContext again as a safety net. startTest does this
      // already, but this path may run outside user-gesture context
      // (e.g. auto-resume after reconnect) so cheap to re-check.
      if (pipeline.audioContext.state === 'suspended') {
        await pipeline.audioContext.resume();
      }

      if (!audioElRef.current) {
        audioElRef.current = new Audio();
      }
      const audioEl = audioElRef.current;
      audioEl.srcObject = pipeline.destinationStream;
      audioEl.volume = settings.audioOutputVolume / 100;

      // Set output device if stored and setSinkId is supported
      if (
        settings.audioOutputDeviceId &&
        'setSinkId' in audioEl &&
        typeof audioEl.setSinkId === 'function'
      ) {
        try {
          await audioEl.setSinkId(settings.audioOutputDeviceId);
        } catch {
          // Fall back to default output
        }
      }

      await audioEl.play();
    } catch (err) {
      console.warn('Loopback failed:', err);
      setLoopbackEnabled(false);
      setError('loopback failed -- browser may block audio playback');
    }
  }, [settings.audioOutputVolume, settings.audioOutputDeviceId]);

  // Stop the actual loopback audio playback. Does NOT reset the user's
  // loopback preference — call setLoopbackEnabled(false) separately if
  // that's what you want.
  const stopLoopbackPlayback = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
    }
  }, []);

  // Toggle handler — handles both "test is running, apply immediately" and
  // "test not yet running, just save the preference for next start".
  const handleLoopbackToggle = useCallback(() => {
    const next = !loopbackEnabled;
    setLoopbackEnabled(next);

    if (!isRunning) return; // Just flip the preference; playback at next start

    if (next) {
      void startLoopbackPlayback();
    } else {
      stopLoopbackPlayback();
    }
  }, [loopbackEnabled, isRunning, startLoopbackPlayback, stopLoopbackPlayback]);

  // Update loopback volume when output volume changes
  useEffect(() => {
    if (audioElRef.current && loopbackEnabled) {
      audioElRef.current.volume = settings.audioOutputVolume / 100;
    }
  }, [settings.audioOutputVolume, loopbackEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTest();
    };
  }, [stopTest]);

  // Auto-stop on browser tab hidden (spec 70.6)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopTest();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopTest]);

  const buttonDisabled = disabled || micPermissionDenied || micDenied;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Start / Stop Button */}
      <button
        type="button"
        onClick={isRunning ? stopTest : startTest}
        disabled={buttonDisabled}
        aria-label={isRunning ? 'STOP TEST' : 'START TEST'}
        style={{
          background: 'transparent',
          color: buttonDisabled
            ? 'var(--text-muted)'
            : isRunning
              ? 'var(--error)'
              : 'var(--accent)',
          border: `1px solid ${
            buttonDisabled
              ? 'var(--border-default)'
              : isRunning
                ? 'var(--error)'
                : 'var(--accent)'
          }`,
          borderRadius: 0,
          padding: 'var(--space-2) var(--space-4)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          cursor: buttonDisabled ? 'default' : 'pointer',
          transition: 'background 150ms, color 150ms',
          alignSelf: 'flex-start',
        }}
      >
        {isRunning ? 'STOP TEST' : 'START TEST'}
      </button>

      {/* Level Meter */}
      <div
        style={{
          width: '100%',
          height: '12px',
          background: 'var(--bg-input)',
          position: 'relative',
          overflow: 'hidden',
        }}
        data-testid="level-meter"
      >
        {/* Three color zones background */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '40%',
            height: '100%',
            background: 'var(--success)',
            opacity: 0.2,
          }}
          data-testid="level-zone-green"
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '40%',
            width: '30%',
            height: '100%',
            background: 'var(--warning)',
            opacity: 0.2,
          }}
          data-testid="level-zone-yellow"
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '70%',
            width: '30%',
            height: '100%',
            background: 'var(--error)',
            opacity: 0.2,
          }}
          data-testid="level-zone-red"
        />

        {/* Filled bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${Math.min(rmsLevel * 100, 100)}%`,
            height: '100%',
            background:
              rmsLevel <= 0.4
                ? 'var(--success)'
                : rmsLevel <= 0.7
                  ? 'var(--warning)'
                  : 'var(--error)',
            transition: 'width 50ms linear',
          }}
          data-testid="level-bar"
        />
      </div>

      {/* Loopback Toggle — interactive even when test is idle (preference is
          saved and applied when the next test starts). Playback is gated on
          isRunning, so no sound while idle. */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={loopbackEnabled}
          onChange={handleLoopbackToggle}
          aria-label="Play audio back to speakers during test"
          style={{ accentColor: 'var(--accent)' }}
        />
        Play audio back to speakers
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
          {isRunning ? '(use headphones)' : '(will play when test starts)'}
        </span>
      </label>

      {/* Error */}
      {error && (
        <div
          style={{
            color: 'var(--error)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-mono)',
          }}
          data-testid="voice-test-error"
        >
          {error}
        </div>
      )}
    </div>
  );
}

// Export ref handle type for parent to call stopTest
export type VoiceTestHandle = {
  stopTest: () => void;
};
