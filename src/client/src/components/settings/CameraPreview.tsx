/**
 * CameraPreview — Live camera preview with permission-gated auto-start.
 *
 * Spec: 70.7
 * Uses createLocalVideoTrack (no LiveKit server needed).
 * Auto-starts if camera permission previously granted (Permissions API check).
 * Shows [ ENABLE PREVIEW ] button otherwise.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createLocalVideoTrack, type LocalVideoTrack } from 'livekit-client';

// ── Background Blur: Self-Hosted MediaPipe Assets ──────────
// Lazy-loaded to prevent track-processors from crashing at module load.
// Assets are self-hosted under /mediapipe/ instead of fetched from jsdelivr +
// storage.googleapis.com — external CDN fetches silently failed in some
// environments (Brave Shields, strict networks). See IT-1 (2026-04-10) root-cause.
const MEDIAPIPE_WASM_PATH = '/mediapipe/wasm';
const MEDIAPIPE_MODEL_PATH = '/mediapipe/selfie_segmenter.tflite';
// Must match BLUR_RADIUS in stores/call.tsx — 10 is subtle, 15 clearly
// blurred but recognizable, 20 strong, 25+ heavy.
const BLUR_RADIUS = 20;

let _blurModule: {
  BackgroundProcessor: typeof import('@livekit/track-processors').BackgroundProcessor;
  supportsBackgroundProcessors: () => boolean;
} | null = null;
const isFirefox = /firefox/i.test(navigator.userAgent);
async function getBlurModule() {
  if (isFirefox) return null; // TensorFlow.js CPU fallback freezes Firefox
  if (!_blurModule) {
    try {
      const mod = await import('@livekit/track-processors');
      _blurModule = { BackgroundProcessor: mod.BackgroundProcessor, supportsBackgroundProcessors: mod.supportsBackgroundProcessors };
    } catch (err) {
      console.error('[CameraPreview] Failed to load @livekit/track-processors:', err);
      return null;
    }
  }
  return _blurModule;
}

/** Build a BackgroundBlur processor with self-hosted MediaPipe assets.
 *  Replaces the deprecated `BackgroundBlur(radius)` helper which does NOT
 *  expose the `assetPaths` option we need to point MediaPipe at local files. */
function createBlurProcessor(
  mod: NonNullable<typeof _blurModule>,
  blurRadius = BLUR_RADIUS,
) {
  return mod.BackgroundProcessor(
    {
      mode: 'background-blur',
      blurRadius,
      assetPaths: {
        tasksVisionFileSet: MEDIAPIPE_WASM_PATH,
        modelAssetPath: MEDIAPIPE_MODEL_PATH,
      },
    },
    'background-blur',
  );
}

import type { MediaSettings } from '../../hooks/useMediaSettings';
import { buildCameraConstraints } from '../../lib/camera-constraints';

interface CameraPreviewProps {
  settings: MediaSettings & {
    update: (key: keyof MediaSettings, value: string | number | boolean) => void;
  };
  disabled?: boolean;
  onTrackCreated?: (track: LocalVideoTrack) => void;
  onTrackStopped?: () => void;
}

type PermissionState = 'checking' | 'granted' | 'prompt' | 'denied';

export function CameraPreview({
  settings,
  disabled = false,
  onTrackCreated,
  onTrackStopped,
}: CameraPreviewProps) {
  const [permissionState, setPermissionState] = useState<PermissionState>('checking');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackRef = useRef<LocalVideoTrack | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // CGL-008: state (not ref) so the auto-start effect re-runs when we flip
  // the guard. Refs don't trigger re-renders, which left a stale-closure
  // window where a fast device-switch could race the restart sequence.
  const [isRestarting, setIsRestarting] = useState(false);
  // Tracks which deviceId the currently-running preview was started with.
  // Used to detect an actual change (vs. incidental re-render) so the
  // restart effect doesn't loop when isRunning flips during restart.
  const runningDeviceIdRef = useRef<string | null>(null);

  // Stable refs for callbacks to avoid dependency churn
  const onTrackCreatedRef = useRef(onTrackCreated);
  onTrackCreatedRef.current = onTrackCreated;
  const onTrackStoppedRef = useRef(onTrackStopped);
  onTrackStoppedRef.current = onTrackStopped;

  // Cleanup
  const stopPreview = useCallback(() => {
    if (trackRef.current) {
      try {
        trackRef.current.stopProcessor();
      } catch {
        // Processor may not be active
      }
      trackRef.current.stop();
      trackRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    runningDeviceIdRef.current = null;
    setIsRunning(false);
    onTrackStoppedRef.current?.();
  }, []);

  // Start preview
  const startPreview = useCallback(async () => {
    setError(null);

    try {
      const cameraConstraints = await buildCameraConstraints(
        settings.videoCameraDeviceId || undefined,
      );
      const videoTrack = await createLocalVideoTrack({
        ...cameraConstraints,
      });

      trackRef.current = videoTrack;
      runningDeviceIdRef.current = settings.videoCameraDeviceId || null;
      onTrackCreatedRef.current?.(videoTrack);

      // Apply background blur if enabled in settings
      if (settings.videoBackgroundBlur) {
        try {
          const blur = await getBlurModule();
          if (blur && blur.supportsBackgroundProcessors()) {
            // showProcessedStreamLocally: true — without this, the local
            // self-view binds to the raw camera track, not the blurred output.
            // Reimplementers MUST pass this flag for any "self-preview" UI;
            // remote participants would still see the blurred version
            // either way, but the local user looking at their own preview
            // would see "blur doesn't work" because the visible track is raw.
            await videoTrack.setProcessor(createBlurProcessor(blur), true);
          } else if (blur) {
            console.warn('[CameraPreview] Background blur unsupported in this browser (OffscreenCanvas/WebGL2/VideoFrame required)');
          }
        } catch (blurErr) {
          console.error('[CameraPreview] Failed to apply background blur on start:', blurErr);
        }
      }

      // Attach to video element
      // After setProcessor with showProcessedStreamLocally=true, the
      // videoTrack.mediaStreamTrack getter returns the processed stream.
      if (videoRef.current) {
        const stream = new MediaStream([videoTrack.mediaStreamTrack]);
        videoRef.current.srcObject = stream;
      }

      setIsRunning(true);
      setPermissionState('granted');
    } catch (err) {
      const error = err as Error;
      if (error.name === 'NotAllowedError') {
        setPermissionState('denied');
        setError('camera access denied -- check browser permissions');
      } else if (error.name === 'NotReadableError') {
        setError('camera in use by another app -- close it and retry');
      } else {
        setError(error.message || 'Failed to start camera preview');
      }
      stopPreview();
    }
  }, [settings.videoCameraDeviceId, settings.videoBackgroundBlur, stopPreview]);

  // Check camera permission on mount
  useEffect(() => {
    let cancelled = false;

    async function checkPermission() {
      try {
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
          // Permissions API unavailable — treat as 'prompt'
          if (!cancelled) setPermissionState('prompt');
          return;
        }

        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (!cancelled) {
          if (result.state === 'granted') {
            setPermissionState('granted');
          } else if (result.state === 'denied') {
            setPermissionState('denied');
            setError('camera access denied -- check browser permissions');
          } else {
            setPermissionState('prompt');
          }
        }
      } catch {
        // Permission query failed — treat as 'prompt'
        if (!cancelled) setPermissionState('prompt');
      }
    }

    checkPermission();
    return () => { cancelled = true; };
  }, []);

  // Auto-start when permission is granted
  useEffect(() => {
    if (permissionState === 'granted' && !isRunning && !disabled && !error && !isRestarting) {
      startPreview();
    }
  }, [permissionState, isRunning, disabled, error, startPreview, isRestarting]);

  // React to blur setting change during active preview
  useEffect(() => {
    if (!isRunning || !trackRef.current) return;
    const track = trackRef.current;

    let cancelled = false;
    (async () => {
      try {
        if (settings.videoBackgroundBlur) {
          const blur = await getBlurModule();
          if (!cancelled && blur && blur.supportsBackgroundProcessors()) {
            // showProcessedStreamLocally: true — see startPreview note
            await track.setProcessor(createBlurProcessor(blur), true);
            // Re-bind the video element to the now-processed track so the
            // self-view picks up the blurred output. The track instance is
            // the same but its internal mediaStreamTrack reference changed.
            if (videoRef.current) {
              videoRef.current.srcObject = new MediaStream([track.mediaStreamTrack]);
            }
          } else if (!cancelled && blur) {
            console.warn('[CameraPreview] Background blur unsupported in this browser on toggle');
          }
        } else {
          if (!cancelled) {
            await track.stopProcessor();
            // Re-bind to the now-raw track so the self-view drops the blur.
            if (videoRef.current) {
              videoRef.current.srcObject = new MediaStream([track.mediaStreamTrack]);
            }
          }
        }
      } catch (err) {
        console.error('[CameraPreview] Failed to toggle background blur:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [settings.videoBackgroundBlur, isRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to device change during active preview.
  //
  // CGL-008: Reworked as a state-driven flow (previously: ref-based guard
  // with stale-closure bugs, refs don't trigger re-runs, and a race window
  // when users rapidly clicked through device dropdowns).
  //
  // Flow:
  //   1. user picks new device → deviceId changes → this effect runs
  //   2. guard: only act if running AND new deviceId differs from running one
  //   3. setIsRestarting(true) + stopPreview() (clears runningDeviceIdRef)
  //   4. 500ms later: setIsRestarting(false)
  //   5. auto-start effect (depends on isRestarting) picks up → startPreview
  //   6. startPreview sets runningDeviceIdRef to the new deviceId
  //   7. this effect re-runs because isRunning toggled, but guard 2 holds
  //      (running=new, no mismatch), so no-op → stable
  //
  // If user rapidly picks another device during step 3-4, the effect re-runs,
  // clears the old setTimeout via the cleanup, and starts a fresh restart
  // cycle — last-write-wins without racing.
  useEffect(() => {
    const desiredDeviceId = settings.videoCameraDeviceId || null;
    if (!isRunning) return;
    if (runningDeviceIdRef.current === desiredDeviceId) return;

    setIsRestarting(true);
    stopPreview();

    // Delay to allow cleanup (500ms for USB cameras that need re-enumeration)
    const t = setTimeout(() => {
      setIsRestarting(false);
      // startPreview will be picked up by the auto-start effect since
      // isRunning=false, permissionState=granted, isRestarting=false
    }, 500);

    return () => {
      clearTimeout(t);
      // Don't reset isRestarting here — if a new effect run is starting,
      // it will set it fresh. If we're unmounting, it doesn't matter.
    };
  }, [settings.videoCameraDeviceId, isRunning, stopPreview]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  // Auto-stop on browser tab hidden (spec 70.7)
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopPreview();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopPreview]);

  // Mirror transform
  const mirrorStyle: React.CSSProperties = settings.videoMirrorSelfView
    ? { transform: 'scaleX(-1)' }
    : {};

  const showEnableButton =
    !isRunning &&
    !disabled &&
    permissionState === 'prompt' &&
    !error;

  // Show retry when a non-permission error occurred (device busy, etc.)
  const showRetryButton =
    !isRunning &&
    !disabled &&
    error !== null &&
    permissionState !== 'denied';

  const showDeniedMessage = permissionState === 'denied';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Preview container */}
      <div
        style={{
          maxWidth: '400px',
          aspectRatio: '16/9',
          background: 'var(--bg-input)',
          position: 'relative',
          overflow: 'hidden',
        }}
        data-testid="camera-preview-container"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: isRunning ? 'block' : 'none',
            ...mirrorStyle,
          }}
          data-testid="camera-preview-video"
        />

        {/* Denied message */}
        {showDeniedMessage && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'var(--error)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              textAlign: 'center',
              padding: 'var(--space-3)',
            }}
          >
            camera access denied -- check browser permissions
          </div>
        )}

        {/* Enable preview button */}
        {showEnableButton && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <button
              type="button"
              onClick={startPreview}
              aria-label="ENABLE PREVIEW"
              style={{
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 0,
                padding: 'var(--space-2) var(--space-4)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                transition: 'background 150ms, color 150ms',
              }}
            >
              ENABLE PREVIEW
            </button>
          </div>
        )}

        {/* Checking state — nothing shown, just dark bg */}
        {permissionState === 'checking' && !isRunning && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
            }}
          >
            checking permissions...
          </div>
        )}
      </div>

      {/* Mirror toggle */}
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
          checked={settings.videoMirrorSelfView}
          onChange={(e) => settings.update('videoMirrorSelfView', e.target.checked)}
          aria-label="Mirror self-view"
          style={{ accentColor: 'var(--accent)' }}
        />
        Mirror self-view
      </label>

      {/* Error (non-permission) + retry */}
      {error && !showDeniedMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <div
            style={{
              color: 'var(--error)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
            }}
            data-testid="camera-preview-error"
          >
            {error}
          </div>
          {showRetryButton && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                startPreview();
              }}
              style={{
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 0,
                padding: 'var(--space-1) var(--space-3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              RETRY
            </button>
          )}
        </div>
      )}
    </div>
  );
}
