/**
 * VoiceTest Component Tests (L3)
 *
 * TC-015, TC-016, TC-018, TC-019, TC-020, TC-033, TC-040
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoiceTest } from '../../components/settings/VoiceTest';
import type { MediaSettings } from '../../hooks/useMediaSettings';

// Mock livekit-client
const mockStop = vi.fn();
const mockMediaStreamTrack = {
  id: 'mock-track-id',
  kind: 'audio',
  stop: mockStop,
};

const mockCreateLocalAudioTrack = vi.fn();

vi.mock('livekit-client', () => ({
  createLocalAudioTrack: (...args: any[]) => mockCreateLocalAudioTrack(...args),
}));

// Mock audio-utils (GainNode pipeline)
const mockPipelineCleanup = vi.fn();
const mockAnalyserGetData = vi.fn((data: Uint8Array) => data.fill(128));
const mockGainNode = { gain: { value: 1 } };
const mockDestinationStream = { id: 'destination-stream' };

vi.mock('../../lib/audio-utils', () => ({
  createGainPipeline: vi.fn(() => ({
    audioContext: {},
    gainNode: mockGainNode,
    analyserNode: {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteTimeDomainData: mockAnalyserGetData,
    },
    processedTrack: { id: 'processed-track', kind: 'audio' },
    destinationStream: mockDestinationStream,
    cleanup: mockPipelineCleanup,
  })),
  calculateRms: vi.fn(() => 0.3), // Return a mid-range value for tests
}));

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

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();

  // Default: createLocalAudioTrack succeeds
  mockCreateLocalAudioTrack.mockResolvedValue({
    mediaStreamTrack: mockMediaStreamTrack,
    stop: mockStop,
  });

  // Reset gain
  mockGainNode.gain.value = 1;
});

afterEach(() => {
  localStorage.clear();
});

// TC-015 (AC-09, L3 Integration, Positiv)
it('TC-015: START TEST button calls createLocalAudioTrack with stored device + noiseSuppression', async () => {
  const settings = defaultSettings();
  settings.audioInputDeviceId = 'mic-usb';
  settings.audioNoiseSuppression = false;

  const user = userEvent.setup();
  render(<VoiceTest settings={settings} />);

  const startBtn = screen.getByRole('button', { name: /START TEST/i });
  await user.click(startBtn);

  expect(mockCreateLocalAudioTrack).toHaveBeenCalledWith(
    expect.objectContaining({
      deviceId: 'mic-usb',
      noiseSuppression: false,
    }),
  );
});

// TC-016 (AC-09, L3 Integration, Positiv)
it('TC-016: level meter renders three color zones after test starts', async () => {
  const settings = defaultSettings();

  const user = userEvent.setup();
  render(<VoiceTest settings={settings} />);

  await user.click(screen.getByRole('button', { name: /START TEST/i }));

  expect(screen.getByTestId('level-zone-green')).toBeInTheDocument();
  expect(screen.getByTestId('level-zone-yellow')).toBeInTheDocument();
  expect(screen.getByTestId('level-zone-red')).toBeInTheDocument();
});

// TC-018 (AC-10, L3 Integration, Positiv)
it('TC-018: loopback toggle ON routes GainNode destination stream to audio element', async () => {
  const settings = defaultSettings();

  const mockPlay = vi.fn().mockResolvedValue(undefined);
  const mockAudioEl = {
    srcObject: null as any,
    volume: 1,
    play: mockPlay,
    pause: vi.fn(),
    setSinkId: vi.fn(),
  };

  const OriginalAudio = globalThis.Audio;
  (globalThis as any).Audio = function MockAudio() { return mockAudioEl; };

  const user = userEvent.setup();
  render(<VoiceTest settings={settings} />);

  // Start test first
  await user.click(screen.getByRole('button', { name: /START TEST/i }));

  // Toggle loopback
  const checkbox = screen.getByRole('checkbox', { name: /play audio back/i });
  await user.click(checkbox);

  expect(mockAudioEl.srcObject).not.toBeNull();
  expect(mockPlay).toHaveBeenCalled();

  (globalThis as any).Audio = OriginalAudio;
});

// TC-019 (AC-10/AC-07, L3 Integration, Positiv)
it('TC-019: loopback audio element volume equals outputVolume / 100', async () => {
  const settings = defaultSettings();
  settings.audioOutputVolume = 70;

  const mockPlay = vi.fn().mockResolvedValue(undefined);
  const mockAudioEl = {
    srcObject: null as any,
    volume: 1,
    play: mockPlay,
    pause: vi.fn(),
    setSinkId: vi.fn(),
  };

  const OriginalAudio = globalThis.Audio;
  (globalThis as any).Audio = function MockAudio() { return mockAudioEl; };

  const user = userEvent.setup();
  render(<VoiceTest settings={settings} />);

  // Start test
  await user.click(screen.getByRole('button', { name: /START TEST/i }));

  // Toggle loopback
  const checkbox = screen.getByRole('checkbox', { name: /play audio back/i });
  await user.click(checkbox);

  expect(mockAudioEl.volume).toBeCloseTo(0.7);

  (globalThis as any).Audio = OriginalAudio;
});

// TC-020 (AC-11, L3 Integration, Positiv) — unmount stops test
it('TC-020: unmount stops voice test (track released)', async () => {
  const settings = defaultSettings();
  const onTrackStopped = vi.fn();

  const user = userEvent.setup();
  const { unmount } = render(
    <VoiceTest settings={settings} onTrackStopped={onTrackStopped} />,
  );

  // Start test
  await user.click(screen.getByRole('button', { name: /START TEST/i }));

  // Unmount (simulates tab switch)
  unmount();

  expect(mockStop).toHaveBeenCalled();
  expect(onTrackStopped).toHaveBeenCalled();
});

// TC-033 (AC-17/FM-2, L3 Integration, Negativ)
it('TC-033: mic permission prompt shows enabled voice test button, click triggers createLocalAudioTrack', async () => {
  const settings = defaultSettings();

  const user = userEvent.setup();
  render(<VoiceTest settings={settings} />);

  const startBtn = screen.getByRole('button', { name: /START TEST/i });
  expect(startBtn).not.toBeDisabled();

  await user.click(startBtn);
  expect(mockCreateLocalAudioTrack).toHaveBeenCalled();
});

// TC-037 (FM-1, L3 Integration, Negativ) — after NotAllowedError
it('TC-037: NotAllowedError disables voice test button and shows error', async () => {
  const notAllowedError = new Error('Permission denied');
  notAllowedError.name = 'NotAllowedError';
  mockCreateLocalAudioTrack.mockRejectedValueOnce(notAllowedError);

  const settings = defaultSettings();
  const user = userEvent.setup();
  render(<VoiceTest settings={settings} />);

  await user.click(screen.getByRole('button', { name: /START TEST/i }));

  await waitFor(() => {
    expect(screen.getByTestId('voice-test-error')).toHaveTextContent(
      /microphone access denied/i,
    );
  });

  // Button should be disabled after denial
  expect(screen.getByRole('button', { name: /START TEST/i })).toBeDisabled();
});

// TC-040 (FM-9, L3 Integration, Negativ)
it('TC-040: getUserMedia failure (non-permission error) shows error message below section', async () => {
  mockCreateLocalAudioTrack.mockRejectedValueOnce(
    new Error('DevicesExhaustedError'),
  );

  const settings = defaultSettings();
  const user = userEvent.setup();
  render(<VoiceTest settings={settings} />);

  await user.click(screen.getByRole('button', { name: /START TEST/i }));

  await waitFor(() => {
    expect(screen.getByTestId('voice-test-error')).toHaveTextContent(/DevicesExhaustedError/i);
  });
});
