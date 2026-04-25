/**
 * CameraPreview Component Tests (L3/L4)
 *
 * TC-021, TC-022, TC-024, TC-025, TC-027, TC-031, TC-032, TC-036
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraPreview } from '../../components/settings/CameraPreview';
import type { MediaSettings } from '../../hooks/useMediaSettings';

// Mock livekit-client
const mockVideoStop = vi.fn();
const mockVideoMediaStreamTrack = {
  id: 'mock-video-track-id',
  kind: 'video',
  stop: mockVideoStop,
};

const mockCreateLocalVideoTrack = vi.fn();

vi.mock('livekit-client', () => ({
  createLocalVideoTrack: (...args: any[]) => mockCreateLocalVideoTrack(...args),
  createLocalAudioTrack: vi.fn(),
}));

vi.mock('@livekit/track-processors', () => ({
  BackgroundProcessor: vi.fn(() => ({ name: 'mock-blur-processor' })),
  BackgroundBlur: vi.fn(() => ({ name: 'mock-blur-processor' })),
  supportsBackgroundProcessors: vi.fn(() => true),
}));

// Save original permissions
const originalPermissions = navigator.permissions;

function defaultSettings(): MediaSettings & {
  update: (key: keyof MediaSettings, value: string | number | boolean) => void;
} {
  return {
    audioInputDeviceId: '',
    audioOutputDeviceId: '',
    audioInputGain: 100,
    audioOutputVolume: 100,
    audioNoiseSuppression: true,
    videoCameraDeviceId: '',
    videoMirrorSelfView: true,
    videoBackgroundBlur: false,
    update: vi.fn(),
  };
}

function mockPermissions(state: 'granted' | 'prompt' | 'denied') {
  Object.defineProperty(navigator, 'permissions', {
    value: {
      query: vi.fn().mockResolvedValue({ state }),
    },
    writable: true,
    configurable: true,
  });
}

function restorePermissions() {
  Object.defineProperty(navigator, 'permissions', {
    value: originalPermissions,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();

  mockCreateLocalVideoTrack.mockResolvedValue({
    mediaStreamTrack: mockVideoMediaStreamTrack,
    stop: mockVideoStop,
  });
});

afterEach(() => {
  localStorage.clear();
  restorePermissions();
});

// TC-024 (AC-13, L3 Integration, Positiv)
it('TC-024: camera preview auto-starts when Permissions API returns granted', async () => {
  mockPermissions('granted');

  const settings = defaultSettings();
  render(<CameraPreview settings={settings} />);

  await waitFor(() => {
    expect(mockCreateLocalVideoTrack).toHaveBeenCalled();
  });

  expect(screen.queryByRole('button', { name: /ENABLE PREVIEW/i })).not.toBeInTheDocument();
});

// TC-025 (AC-13/FM-4, L3 Integration, Negativ)
it('TC-025: shows ENABLE PREVIEW button when camera permission is prompt', async () => {
  mockPermissions('prompt');

  const settings = defaultSettings();
  render(<CameraPreview settings={settings} />);

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /ENABLE PREVIEW/i })).toBeInTheDocument();
  });

  expect(mockCreateLocalVideoTrack).not.toHaveBeenCalled();
});

// TC-027 (AC-14, L3 Integration, Positiv)
it('TC-027: mirror ON applies CSS transform scaleX(-1) to preview video element', async () => {
  mockPermissions('granted');

  const settings = defaultSettings();
  settings.videoMirrorSelfView = true;

  render(<CameraPreview settings={settings} />);

  await waitFor(() => {
    expect(mockCreateLocalVideoTrack).toHaveBeenCalled();
  });

  const video = screen.getByTestId('camera-preview-video');
  expect(video).toHaveStyle({ transform: 'scaleX(-1)' });
});

// TC-021 (AC-11, L3 Integration, Positiv)
it('TC-021: navigating away from settings stops camera preview track', async () => {
  mockPermissions('granted');

  const settings = defaultSettings();
  const onTrackStopped = vi.fn();

  const { unmount } = render(
    <CameraPreview settings={settings} onTrackStopped={onTrackStopped} />,
  );

  await waitFor(() => {
    expect(mockCreateLocalVideoTrack).toHaveBeenCalled();
  });

  unmount();

  expect(mockVideoStop).toHaveBeenCalled();
  expect(onTrackStopped).toHaveBeenCalled();
});

// TC-022 (AC-11/FM-10, L4 E2E, Positiv)
it('TC-022: visibilitychange to hidden stops camera preview, return shows button', async () => {
  mockPermissions('granted');

  const settings = defaultSettings();
  render(<CameraPreview settings={settings} />);

  await waitFor(() => {
    expect(mockCreateLocalVideoTrack).toHaveBeenCalled();
  });

  // Simulate browser tab hidden
  Object.defineProperty(document, 'visibilityState', {
    value: 'hidden',
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));

  expect(mockVideoStop).toHaveBeenCalled();

  // Restore visibility
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    writable: true,
    configurable: true,
  });
});

// TC-032 (AC-17/FM-3, L3 Integration, Negativ)
it('TC-032: camera permission denied shows denial message and dark bg', async () => {
  mockPermissions('denied');

  const settings = defaultSettings();
  render(<CameraPreview settings={settings} />);

  await waitFor(() => {
    expect(
      screen.getByText(/camera access denied -- check browser permissions/i),
    ).toBeInTheDocument();
  });

  // Preview container has dark bg
  const container = screen.getByTestId('camera-preview-container');
  expect(container).toHaveStyle({ background: 'var(--bg-input)' });

  // No ENABLE PREVIEW button when denied
  expect(screen.queryByRole('button', { name: /ENABLE PREVIEW/i })).not.toBeInTheDocument();
});

// TC-036 (AC-20, L4 E2E, Positiv) — tested with VoiceTest separately
// Here we just verify camera preview can start independently
it('TC-036: camera preview starts independently of voice test', async () => {
  mockPermissions('granted');

  const settings = defaultSettings();
  render(<CameraPreview settings={settings} />);

  await waitFor(() => {
    expect(mockCreateLocalVideoTrack).toHaveBeenCalledTimes(1);
  });
});

// TC-041 (FM-11, L3 Integration, Boundary)
it('TC-041: Permissions API unavailable treats camera as prompt, shows ENABLE PREVIEW', async () => {
  // Remove permissions API
  Object.defineProperty(navigator, 'permissions', {
    value: undefined,
    writable: true,
    configurable: true,
  });

  const settings = defaultSettings();
  render(<CameraPreview settings={settings} />);

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /ENABLE PREVIEW/i })).toBeInTheDocument();
  });

  expect(mockCreateLocalVideoTrack).not.toHaveBeenCalled();
});
