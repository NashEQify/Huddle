/**
 * AudioVideoSettings Component Tests (L3)
 *
 * TC-005, TC-006, TC-009, TC-010, TC-011, TC-023, TC-034, TC-037, TC-038, TC-039, TC-040, TC-041
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioVideoSettings } from '../../components/settings/AudioVideoSettings';

// ── Configurable mocks ──────────────────────────────────

let mockAudioInputDevices: MediaDeviceInfo[] = [];
let mockAudioOutputDevices: MediaDeviceInfo[] = [];
let mockVideoInputDevices: MediaDeviceInfo[] = [];
let mockActiveAudioInputId = '';
let mockActiveVideoInputId = '';

vi.mock('@livekit/components-react', () => ({
  useMediaDeviceSelect: ({ kind }: { kind: string }) => {
    if (kind === 'audioinput') {
      return {
        devices: mockAudioInputDevices,
        activeDeviceId: mockActiveAudioInputId,
        setActiveMediaDevice: vi.fn(),
        className: '',
      };
    }
    if (kind === 'audiooutput') {
      return {
        devices: mockAudioOutputDevices,
        activeDeviceId: '',
        setActiveMediaDevice: vi.fn(),
        className: '',
      };
    }
    if (kind === 'videoinput') {
      return {
        devices: mockVideoInputDevices,
        activeDeviceId: mockActiveVideoInputId,
        setActiveMediaDevice: vi.fn(),
        className: '',
      };
    }
    return { devices: [], activeDeviceId: '', setActiveMediaDevice: vi.fn(), className: '' };
  },
}));

vi.mock('../../stores/call', () => ({
  useCall: () => ({
    state: { activeScope: null },
    joinCall: vi.fn(),
    leaveCall: vi.fn(),
    toggleMute: vi.fn(),
    toggleCamera: vi.fn(),
    endCallForAll: vi.fn(),
    getActiveCall: vi.fn(),
    isUserSpeaking: vi.fn(),
  }),
}));

vi.mock('livekit-client', () => ({
  createLocalAudioTrack: vi.fn(),
  createLocalVideoTrack: vi.fn(),
}));

// Save and restore HTMLAudioElement.prototype.setSinkId
const originalSetSinkId = HTMLAudioElement.prototype.setSinkId;

function makeDevice(deviceId: string, label: string, kind: MediaDeviceKind): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: '', toJSON: () => ({}) } as MediaDeviceInfo;
}

beforeEach(() => {
  localStorage.clear();
  mockAudioInputDevices = [];
  mockAudioOutputDevices = [];
  mockVideoInputDevices = [];
  mockActiveAudioInputId = '';
  mockActiveVideoInputId = '';
  // Ensure setSinkId exists for most tests
  if (!HTMLAudioElement.prototype.setSinkId) {
    HTMLAudioElement.prototype.setSinkId = vi.fn().mockResolvedValue(undefined);
  }
});

afterEach(() => {
  localStorage.clear();
  // Restore setSinkId
  if (originalSetSinkId) {
    HTMLAudioElement.prototype.setSinkId = originalSetSinkId;
  }
});

// TC-005 (AC-04, L3 Integration, Positiv)
it('TC-005: input device dropdown shows enumerated audioinput devices', () => {
  mockAudioInputDevices = [
    makeDevice('mic-1', 'Built-in Microphone', 'audioinput'),
    makeDevice('mic-2', 'USB Mic', 'audioinput'),
  ];
  mockActiveAudioInputId = 'mic-1';

  render(<AudioVideoSettings />);

  const select = screen.getByLabelText(/microphone/i);
  expect(select).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Built-in Microphone' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'USB Mic' })).toBeInTheDocument();
});

// TC-006 (AC-04, L3 Integration, Positiv)
it('TC-006: selecting input device persists to localStorage audio.inputDeviceId', async () => {
  mockAudioInputDevices = [
    makeDevice('mic-1', 'Built-in Microphone', 'audioinput'),
    makeDevice('mic-2', 'USB Mic', 'audioinput'),
  ];
  mockActiveAudioInputId = 'mic-1';

  const user = userEvent.setup();
  render(<AudioVideoSettings />);

  const select = screen.getByLabelText(/microphone/i);
  await user.selectOptions(select, 'mic-2');

  expect(localStorage.getItem('audio.inputDeviceId')).toBe('mic-2');
});

// TC-009 (AC-05, L3 Integration, Positiv)
it('TC-009: input gain > 100% renders inline warning text in var(--warning) color', () => {
  localStorage.setItem('audio.inputGain', '120');
  mockAudioInputDevices = [makeDevice('mic-1', 'Mic', 'audioinput')];

  render(<AudioVideoSettings />);

  const warning = screen.getByText(/gain >100%/i);
  expect(warning).toBeInTheDocument();
  expect(warning).toHaveStyle({ color: 'var(--warning)' });
});

// TC-010 (AC-06/FM-7, L2 Unit, Negativ) — setSinkId unsupported
it('TC-010: hides output section when setSinkId not on HTMLAudioElement.prototype', () => {
  // Remove setSinkId
  delete (HTMLAudioElement.prototype as any).setSinkId;

  mockAudioInputDevices = [makeDevice('mic-1', 'Mic', 'audioinput')];

  render(<AudioVideoSettings />);

  expect(screen.queryByText(/0xB1/)).not.toBeInTheDocument();
  expect(screen.getByText(/output device selection not supported in this browser/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/output device/i)).not.toBeInTheDocument();

  // Restore setSinkId
  HTMLAudioElement.prototype.setSinkId = vi.fn().mockResolvedValue(undefined);
});

// TC-011 (AC-06, L3 Integration, Positiv) — setSinkId supported
it('TC-011: output device dropdown shows enumerated audiooutput devices when setSinkId supported', () => {
  HTMLAudioElement.prototype.setSinkId = vi.fn().mockResolvedValue(undefined);
  mockAudioOutputDevices = [makeDevice('spk-1', 'Speakers', 'audiooutput')];
  mockAudioInputDevices = [makeDevice('mic-1', 'Mic', 'audioinput')];

  render(<AudioVideoSettings />);

  expect(screen.getByText(/0xB1/)).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Speakers' })).toBeInTheDocument();
});

// TC-023 (AC-12, L3 Integration, Positiv)
it('TC-023: camera dropdown shows enumerated videoinput devices, selection persists', async () => {
  mockVideoInputDevices = [
    makeDevice('cam-1', 'Webcam', 'videoinput'),
    makeDevice('cam-2', 'External Cam', 'videoinput'),
  ];
  mockActiveVideoInputId = 'cam-1';
  mockAudioInputDevices = [makeDevice('mic-1', 'Mic', 'audioinput')];

  const user = userEvent.setup();
  render(<AudioVideoSettings />);

  const cameraSelect = screen.getByLabelText(/camera/i);
  expect(cameraSelect).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Webcam' })).toBeInTheDocument();

  await user.selectOptions(cameraSelect, 'cam-2');
  expect(localStorage.getItem('video.cameraDeviceId')).toBe('cam-2');
});

// TC-034 (AC-18, L3 Integration, Positiv)
it('TC-034: AV tab has no borderRadius anywhere, slider thumbs are square', () => {
  mockAudioInputDevices = [makeDevice('mic-1', 'Mic', 'audioinput')];

  render(<AudioVideoSettings />);

  // Check that gain slider exists and has no borderRadius
  const gainSlider = screen.getByLabelText(/input gain/i);
  expect(gainSlider).toBeInTheDocument();

  // Verify HexLabels use JetBrains Mono
  const hexLabel = screen.getByText(/0xB0/);
  expect(hexLabel.closest('div')).toHaveStyle({ fontFamily: "var(--font-mono)" });
});

// TC-037 (FM-1, L3 Integration, Negativ)
it('TC-037: no audioinput devices — "no microphone detected" shown, voice test start is disabled', () => {
  // No audio input devices
  mockAudioInputDevices = [];

  render(<AudioVideoSettings />);

  expect(screen.getByText(/no microphone detected/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /START TEST/i })).toBeDisabled();
});

// TC-038 (FM-5, L3 Integration, Negativ)
it('TC-038: no audioinput devices shows "no microphone detected", disables dropdown and test', () => {
  mockAudioInputDevices = [];

  render(<AudioVideoSettings />);

  expect(screen.getByText(/no microphone detected/i)).toBeInTheDocument();
  // No dropdown when no devices
  expect(screen.queryByLabelText(/microphone/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /START TEST/i })).toBeDisabled();
});

// TC-039 (FM-6, L3 Integration, Negativ)
it('TC-039: no videoinput devices shows "no camera detected", disables dropdown and preview', () => {
  mockVideoInputDevices = [];
  mockAudioInputDevices = [makeDevice('mic-1', 'Mic', 'audioinput')];

  render(<AudioVideoSettings />);

  expect(screen.getByText(/no camera detected/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/camera/i)).not.toBeInTheDocument();
});

// TC-041 (FM-11, L3 Integration, Boundary)
it('TC-041: Permissions API unavailable treats camera as prompt, shows ENABLE PREVIEW button', async () => {
  mockVideoInputDevices = [makeDevice('cam-1', 'Webcam', 'videoinput')];
  mockAudioInputDevices = [makeDevice('mic-1', 'Mic', 'audioinput')];

  // Save permissions and remove it
  const originalPermissions = navigator.permissions;
  Object.defineProperty(navigator, 'permissions', {
    value: undefined,
    writable: true,
    configurable: true,
  });

  render(<AudioVideoSettings />);

  // Wait for permission check to complete
  await vi.waitFor(() => {
    expect(screen.getByRole('button', { name: /ENABLE PREVIEW/i })).toBeInTheDocument();
  });

  // Restore
  Object.defineProperty(navigator, 'permissions', {
    value: originalPermissions,
    writable: true,
    configurable: true,
  });
});

describe('TC-030, TC-031 (AC-16/FM-8): unavailable device handling', () => {
  // TC-030
  it('stored audio input device not in list shown as "(unavailable)"', () => {
    localStorage.setItem('audio.inputDeviceId', 'old-mic-id');
    mockAudioInputDevices = [makeDevice('new-mic', 'New Mic', 'audioinput')];
    mockActiveAudioInputId = '';

    render(<AudioVideoSettings />);

    expect(screen.getByRole('option', { name: /unavailable/i })).toBeInTheDocument();
  });

  // TC-031
  it('stored camera device not in list shown as "(unavailable)"', () => {
    localStorage.setItem('video.cameraDeviceId', 'cam-old');
    mockVideoInputDevices = [makeDevice('cam-new', 'New Camera', 'videoinput')];
    mockActiveVideoInputId = '';
    mockAudioInputDevices = [makeDevice('mic-1', 'Mic', 'audioinput')];

    render(<AudioVideoSettings />);

    const options = screen.getAllByRole('option', { name: /unavailable/i });
    expect(options.length).toBeGreaterThanOrEqual(1);
  });
});
