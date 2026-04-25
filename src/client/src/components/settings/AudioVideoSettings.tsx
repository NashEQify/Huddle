/**
 * AudioVideoSettings — Audio/Video Settings tab content.
 *
 * Spec: 70.2 - 70.8
 * Sections: Microphone (0xB0), Output (0xB1), Noise Suppression (0xB2),
 *           Voice Test (0xB3), Camera (0xB4).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useMediaDeviceSelect } from '@livekit/components-react';
import type { LocalAudioTrack, LocalVideoTrack } from 'livekit-client';
import { useMediaSettings } from '../../hooks/useMediaSettings';
import { useCall } from '../../stores/call';
import { VoiceTest } from './VoiceTest';
import { CameraPreview } from './CameraPreview';

// ── Style Constants ──────────────────────────────────────

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-input)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 0,
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-base)',
  outline: 'none',
};

const sliderContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  marginTop: 'var(--space-2)',
};

const sliderValueStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
  minWidth: '48px',
  textAlign: 'right' as const,
};

// ── Helpers ──────────────────────────────────────────────

function HexLabel({ hex, label }: { hex: string; label: string }) {
  return (
    <div
      style={{
        color: 'var(--text-secondary)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-mono)',
        marginBottom: 'var(--space-4)',
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>[ </span>
      <span style={{ color: 'var(--text-secondary)' }}>{hex} </span>
      <span style={{ color: 'var(--accent)' }}>{label}</span>
      <span style={{ color: 'var(--text-secondary)' }}> ]</span>
    </div>
  );
}

function InCallNote({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        color: 'var(--text-muted)',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-mono)',
        marginTop: 'var(--space-1)',
      }}
    >
      applies on next call join
    </div>
  );
}

// ── Check setSinkId support ─────────────────────────────

function isSinkIdSupported(): boolean {
  return typeof HTMLAudioElement !== 'undefined' &&
    'setSinkId' in HTMLAudioElement.prototype;
}

// ── Main Component ───────────────────────────────────────
// No permission gate — renders INSTANTLY. Device labels populate
// asynchronously in the background via useMediaDeviceSelect.

export function AudioVideoSettings() {
  const settings = useMediaSettings();
  const { state: callState } = useCall();
  const isInCall = callState.activeScope !== null;
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  const [audioPreviewTrack, setAudioPreviewTrack] = useState<LocalAudioTrack | null>(null);
  const [videoPreviewTrack, setVideoPreviewTrack] = useState<LocalVideoTrack | null>(null);
  const [noMicDetected, setNoMicDetected] = useState(false);
  const [noCameraDetected, setNoCameraDetected] = useState(false);

  const voiceTestStopRef = useRef<(() => void) | null>(null);
  const cameraStopRef = useRef<(() => void) | null>(null);

  // Background label fetch — never blocks rendering.
  // All hooks use requestPermissions:false so they render instantly.
  // If labels are empty (first-time permission), we request audio-only
  // getUserMedia, then dispatch a synthetic devicechange event to make
  // all hooks re-enumerate with labels. Timeout guards against Brave hangs.
  useEffect(() => {
    if (isInCall) return;
    let cancelled = false;

    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasLabels = devices.some((d) => d.kind === 'audioinput' && d.label !== '');
        if (hasLabels || cancelled) return;

        // Check if camera permission is already granted (iOS needs a video
        // getUserMedia call to enumerate camera devices at all).
        let includeVideo = false;
        try {
          if (navigator.permissions && typeof navigator.permissions.query === 'function') {
            const camPerm = await navigator.permissions.query({ name: 'camera' as PermissionName });
            includeVideo = camPerm.state === 'granted';
          }
        } catch {
          // Permissions API unavailable or 'camera' not supported — skip video
        }

        // Race getUserMedia against a 4s timeout (Brave shields can hang)
        const constraints = includeVideo ? { audio: true, video: true } : { audio: true };
        const stream = await Promise.race([
          navigator.mediaDevices.getUserMedia(constraints),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 4000)
          ),
        ]) as MediaStream | null;
        if (cancelled || !stream) return;
        stream.getTracks().forEach((t) => t.stop());

        // Notify all LiveKit device observers to re-enumerate with labels
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.message === 'timeout')) {
          setMicPermissionDenied(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [isInCall]);

  // Device enumeration — all hooks use requestPermissions:false.
  // Labels come from cached permission (instant) or background fetch above.
  const {
    devices: audioInputDevices,
    activeDeviceId: activeAudioInputId,
  } = useMediaDeviceSelect({
    kind: 'audioinput',
    track: audioPreviewTrack ?? undefined,
    requestPermissions: false,
  });

  const {
    devices: audioOutputDevices,
  } = useMediaDeviceSelect({
    kind: 'audiooutput',
    requestPermissions: false,
  });

  const {
    devices: videoInputDevices,
    activeDeviceId: activeVideoInputId,
  } = useMediaDeviceSelect({
    kind: 'videoinput',
    track: videoPreviewTrack ?? undefined,
    requestPermissions: false,
  });

  useEffect(() => {
    setNoMicDetected(audioInputDevices.length === 0);
  }, [audioInputDevices]);

  useEffect(() => {
    setNoCameraDetected(videoInputDevices.length === 0);
  }, [videoInputDevices]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        voiceTestStopRef.current?.();
        cameraStopRef.current?.();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const selectedAudioInputId = activeAudioInputId || settings.audioInputDeviceId;
  const selectedVideoInputId = activeVideoInputId || settings.videoCameraDeviceId;

  const storedAudioInputUnavailable =
    settings.audioInputDeviceId &&
    audioInputDevices.length > 0 &&
    !audioInputDevices.some((d) => d.deviceId === settings.audioInputDeviceId);

  const storedOutputUnavailable =
    settings.audioOutputDeviceId &&
    audioOutputDevices.length > 0 &&
    !audioOutputDevices.some((d) => d.deviceId === settings.audioOutputDeviceId);

  const storedCameraUnavailable =
    settings.videoCameraDeviceId &&
    videoInputDevices.length > 0 &&
    !videoInputDevices.some((d) => d.deviceId === settings.videoCameraDeviceId);

  const sinkIdSupported = isSinkIdSupported();

  const [changedSettings, setChangedSettings] = useState<Set<string>>(new Set());
  const markChanged = useCallback((key: string) => {
    if (isInCall) {
      setChangedSettings((prev) => new Set(prev).add(key));
    }
  }, [isInCall]);

  return (
    <div
      style={{
        maxWidth: '600px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
      }}
    >
      {/* ── 0xB0 MICROPHONE ────────────────────────── */}
      <section>
        <HexLabel hex="0xB0" label="MICROPHONE" />

        {noMicDetected ? (
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            no microphone detected
          </div>
        ) : (
          <>
            {/* Device dropdown */}
            <label
              htmlFor="audio-input-select"
              style={{
                display: 'block',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-mono)',
                marginBottom: 'var(--space-1)',
              }}
            >
              input device
            </label>
            <select
              id="audio-input-select"
              aria-label="microphone"
              value={selectedAudioInputId}
              onChange={(e) => {
                settings.update('audioInputDeviceId', e.target.value);
                markChanged('audioInput');
              }}
              disabled={noMicDetected}
              style={selectStyle}
            >
              {audioInputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
              {storedAudioInputUnavailable && (
                <option value={settings.audioInputDeviceId}>
                  Stored device (unavailable)
                </option>
              )}
            </select>
            <InCallNote visible={isInCall && changedSettings.has('audioInput')} />

            {micPermissionDenied && (
              <div
                style={{
                  color: 'var(--error)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: 'var(--space-2)',
                }}
              >
                microphone access denied -- check browser permissions
              </div>
            )}

            {/* Input Gain Slider */}
            <div style={{ marginTop: 'var(--space-4)' }}>
              <label
                htmlFor="audio-input-gain"
                style={{
                  display: 'block',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-mono)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                input volume (gain)
              </label>
              <div style={sliderContainerStyle}>
                <input
                  id="audio-input-gain"
                  type="range"
                  min={0}
                  max={200}
                  value={settings.audioInputGain}
                  onChange={(e) => {
                    settings.update('audioInputGain', Number(e.target.value));
                    markChanged('audioInputGain');
                  }}
                  aria-label="input gain"
                  style={{
                    flex: 1,
                    accentColor: 'var(--accent)',
                  }}
                />
                <span style={sliderValueStyle}>
                  {settings.audioInputGain}%
                </span>
              </div>
              {settings.audioInputGain > 100 && (
                <div
                  style={{
                    color: 'var(--warning)',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-mono)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  gain &gt;100% -- audio quality may degrade
                </div>
              )}
              <InCallNote visible={isInCall && changedSettings.has('audioInputGain')} />
            </div>
          </>
        )}
      </section>

      {/* ── 0xB1 OUTPUT ────────────────────────────── */}
      {sinkIdSupported ? (
        <section>
          <HexLabel hex="0xB1" label="OUTPUT" />

          <label
            htmlFor="audio-output-select"
            style={{
              display: 'block',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              marginBottom: 'var(--space-1)',
            }}
          >
            output device
          </label>
          <select
            id="audio-output-select"
            aria-label="output device"
            value={settings.audioOutputDeviceId}
            onChange={(e) => {
              settings.update('audioOutputDeviceId', e.target.value);
              markChanged('audioOutput');
            }}
            style={selectStyle}
          >
            {audioOutputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
            {storedOutputUnavailable && (
              <option value={settings.audioOutputDeviceId}>
                Stored device (unavailable)
              </option>
            )}
          </select>
          <InCallNote visible={isInCall && changedSettings.has('audioOutput')} />

          {/* Output Volume Slider */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <label
              htmlFor="audio-output-volume"
              style={{
                display: 'block',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-mono)',
                marginBottom: 'var(--space-1)',
              }}
            >
              output volume
            </label>
            <div style={sliderContainerStyle}>
              <input
                id="audio-output-volume"
                type="range"
                min={0}
                max={100}
                value={settings.audioOutputVolume}
                onChange={(e) => {
                  settings.update('audioOutputVolume', Number(e.target.value));
                }}
                aria-label="output volume"
                style={{
                  flex: 1,
                  accentColor: 'var(--accent)',
                }}
              />
              <span style={sliderValueStyle}>
                {settings.audioOutputVolume}%
              </span>
            </div>
          </div>
        </section>
      ) : (
        <section>
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            output device selection not supported in this browser
          </div>
        </section>
      )}

      {/* ── 0xB2 NOISE SUPPRESSION ────────────────── */}
      <section>
        <HexLabel hex="0xB2" label="NOISE SUPPRESSION" />

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            cursor: 'pointer',
          }}
        >
          <div
            role="switch"
            aria-checked={settings.audioNoiseSuppression}
            aria-label="Noise Suppression"
            tabIndex={0}
            onClick={() => {
              settings.update('audioNoiseSuppression', !settings.audioNoiseSuppression);
              markChanged('noiseSuppression');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                settings.update('audioNoiseSuppression', !settings.audioNoiseSuppression);
                markChanged('noiseSuppression');
              }
            }}
            style={{
              width: '40px',
              height: '20px',
              background: settings.audioNoiseSuppression
                ? 'var(--accent)'
                : 'var(--bg-input)',
              border: `1px solid ${
                settings.audioNoiseSuppression
                  ? 'var(--accent)'
                  : 'var(--border-default)'
              }`,
              borderRadius: 0,
              position: 'relative',
              cursor: 'pointer',
              transition: 'background 150ms',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: '16px',
                height: '16px',
                background: settings.audioNoiseSuppression
                  ? 'var(--bg-base)'
                  : 'var(--text-muted)',
                position: 'absolute',
                top: '1px',
                left: settings.audioNoiseSuppression ? '21px' : '1px',
                transition: 'left 150ms',
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-base)',
                color: 'var(--text-primary)',
              }}
            >
              Noise Suppression
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
              }}
            >
              Browser-based noise suppression for microphone input
            </div>
          </div>
        </label>
        <InCallNote visible={isInCall && changedSettings.has('noiseSuppression')} />
      </section>

      {/* ── In-call notice for test/preview sections ── */}
      {isInCall && (
        <div
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            padding: 'var(--space-2) 0',
          }}
        >
          voice test and camera preview disabled during active call
        </div>
      )}

      {/* ── 0xB3 VOICE TEST ───────────────────────── */}
      <section>
        <HexLabel hex="0xB3" label="VOICE TEST" />

        <VoiceTest
          settings={settings}
          disabled={noMicDetected || isInCall}
          micPermissionDenied={micPermissionDenied}
          onTrackCreated={(track) => {
            setAudioPreviewTrack(track);
            voiceTestStopRef.current = () => {
              // Will be called by visibilitychange handler
              // The component itself handles the cleanup
            };
          }}
          onTrackStopped={() => {
            setAudioPreviewTrack(null);
            voiceTestStopRef.current = null;
          }}
        />
      </section>

      {/* ── 0xB4 CAMERA ───────────────────────────── */}
      <section>
        <HexLabel hex="0xB4" label="CAMERA" />

        {noCameraDetected ? (
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            no camera detected
          </div>
        ) : (
          <>
            {/* Camera Device dropdown */}
            <label
              htmlFor="video-input-select"
              style={{
                display: 'block',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-mono)',
                marginBottom: 'var(--space-1)',
              }}
            >
              camera device
            </label>
            <select
              id="video-input-select"
              aria-label="camera"
              value={selectedVideoInputId}
              onChange={(e) => {
                settings.update('videoCameraDeviceId', e.target.value);
                markChanged('cameraDevice');
              }}
              disabled={noCameraDetected}
              style={{ ...selectStyle, marginBottom: 'var(--space-3)' }}
            >
              {videoInputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
              {storedCameraUnavailable && (
                <option value={settings.videoCameraDeviceId}>
                  Stored device (unavailable)
                </option>
              )}
            </select>
            <InCallNote visible={isInCall && changedSettings.has('cameraDevice')} />

            {/* Background Blur toggle */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                marginBottom: 'var(--space-3)',
              }}
            >
              <input
                type="checkbox"
                checked={settings.videoBackgroundBlur}
                onChange={(e) => settings.update('videoBackgroundBlur', e.target.checked)}
                aria-label="Background blur"
                style={{ accentColor: 'var(--accent)' }}
              />
              Background blur
            </label>

            <CameraPreview
              settings={settings}
              disabled={noCameraDetected || isInCall}
              onTrackCreated={(track) => {
                setVideoPreviewTrack(track);
              }}
              onTrackStopped={() => {
                setVideoPreviewTrack(null);
                cameraStopRef.current = null;
              }}
            />
          </>
        )}
      </section>

      {/* ── 0xB5 TROUBLESHOOTING ──────────────── */}
      <section>
        <HexLabel hex="0xB5" label="TROUBLESHOOTING" />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
          }}
        >
          <div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
              calls not connecting?
            </div>
            <div>
              Firefox: open <code style={{ color: 'var(--accent)' }}>about:config</code>, search for{' '}
              <code style={{ color: 'var(--accent)' }}>media.peerconnection.enabled</code>
              {' '}and set it to <code style={{ color: 'var(--accent)' }}>true</code>.
            </div>
            <div>
              Brave: click the Shields icon in the address bar for this site and lower fingerprinting protection.
            </div>
          </div>

          <div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
              visualizer not detecting audio? (linux)
            </div>
            <div>
              run once in a terminal, then reload:
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
              <button
                type="button"
                onClick={() => {
                  const wrapper = `#!/usr/bin/env bash\nset -euo pipefail\nIDLE_TIMEOUT=\${HUDDLE_CAPTURE_IDLE_TIMEOUT:-30}\nNODE_NAME="Huddle_Audio_Capture"\npw-loopback --capture-props='media.class=Stream/Input/Audio stream.capture.sink=true node.name=huddle_capture_in audio.position=[FL,FR]' --playback-props="media.class=Audio/Source node.name=\${NODE_NAME} node.description=\\"\${NODE_NAME}\\" audio.position=[FL,FR]" &\nPID=$!\ntrap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT\nsleep 60\nidle=0\nwhile kill -0 $PID 2>/dev/null; do\nif pw-link -ol 2>/dev/null | grep -q "\${NODE_NAME}:playback"; then idle=0; else idle=$((idle+5)); [ $idle -ge $IDLE_TIMEOUT ] && exit 0; fi\nsleep 5\ndone\nexit 1`;
                  const service = `[Unit]\nDescription=Huddle Audio Capture (auto-stops when idle)\nAfter=pipewire.service\nBindsTo=pipewire.service\n[Service]\nType=simple\nExecStart=%h/.local/bin/huddle-audio-capture.sh\nRestart=on-failure\nRestartSec=3\nEnvironment=HUDDLE_CAPTURE_IDLE_TIMEOUT=30`;
                  const cmd = `mkdir -p ~/.local/bin ~/.config/systemd/user && cat > ~/.local/bin/huddle-audio-capture.sh << 'WRAPPER'\n${wrapper}\nWRAPPER\nchmod +x ~/.local/bin/huddle-audio-capture.sh && cat > ~/.config/systemd/user/huddle-audio-capture.service << 'SVC'\n${service}\nSVC\nsystemctl --user daemon-reload && systemctl --user start huddle-audio-capture`;
                  navigator.clipboard.writeText(cmd);
                }}
                style={{
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 0,
                  padding: 'var(--space-1) var(--space-2)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  cursor: 'pointer',
                }}
              >
                copy command
              </button>
              <span>creates a PipeWire audio capture service (persistent)</span>
            </div>
          </div>

          <div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>
              visualizer not detecting audio? (windows)
            </div>
            <div>
              press <code style={{ color: 'var(--accent)' }}>Win+R</code>{' '}
              → type <code style={{ color: 'var(--accent)' }}>mmsys.cpl</code>{' '}
              → Enter. go to the <strong style={{ color: 'var(--text-secondary)' }}>Recording</strong> tab{' '}
              → right-click empty area → <strong style={{ color: 'var(--text-secondary)' }}>Show Disabled Devices</strong>{' '}
              → right-click <strong style={{ color: 'var(--text-secondary)' }}>Stereo Mix</strong>{' '}
              → <strong style={{ color: 'var(--text-secondary)' }}>Enable</strong>. reload the page.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
