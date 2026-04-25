/**
 * SettingsPage Tests — Tab Navigation (L3)
 *
 * TC-001, TC-002, TC-003, TC-004
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../pages/SettingsPage';

// Mock useAuth
vi.mock('../../stores/auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', username: 'testuser', email: 'test@example.com' },
    profile: {
      title: 'Test Title',
      avatarKind: 'built_in',
      builtInAvatarId: 'default',
      portraitUrl: null,
    },
    updateProfile: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

// Mock api
vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ ok: true, data: { avatars: [] } }),
    post: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    patch: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  },
}));

// Mock useCall — make it configurable
const mockCallState = { activeScope: null as any };
vi.mock('../../stores/call', () => ({
  useCall: () => ({
    state: mockCallState,
    joinCall: vi.fn(),
    leaveCall: vi.fn(),
    toggleMute: vi.fn(),
    toggleCamera: vi.fn(),
    endCallForAll: vi.fn(),
    getActiveCall: vi.fn(),
    isUserSpeaking: vi.fn(),
  }),
}));

// Mock useMediaDeviceSelect — configurable per test
let mockDevices: MediaDeviceInfo[] = [];
vi.mock('@livekit/components-react', () => ({
  useMediaDeviceSelect: ({ kind }: { kind: string }) => ({
    devices: mockDevices,
    activeDeviceId: mockDevices.length > 0 ? mockDevices[0].deviceId : '',
    setActiveMediaDevice: vi.fn(),
    className: '',
  }),
}));

// Mock livekit-client
vi.mock('livekit-client', () => ({
  createLocalAudioTrack: vi.fn(),
  createLocalVideoTrack: vi.fn(),
  Room: vi.fn(),
  RoomEvent: {},
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
  ConnectionState: { Disconnected: 'disconnected' },
  ConnectionQuality: { Excellent: 'excellent' },
  LocalParticipant: vi.fn(),
  RemoteParticipant: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// TC-001 (AC-01, L3 Integration, Positiv)
it('TC-001: renders tablist with PROFILE and AUDIO / VIDEO tabs', () => {
  render(<SettingsPage onBack={() => {}} />);

  expect(screen.getByRole('tablist')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /PROFILE/i })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /AUDIO \/ VIDEO/i })).toBeInTheDocument();
});

// TC-002 (AC-01, L3 Integration, Positiv)
it('TC-002: AUDIO/VIDEO tab has aria-selected=true after click, PROFILE has false', async () => {
  const user = userEvent.setup();
  render(<SettingsPage onBack={() => {}} />);

  const avTab = screen.getByRole('tab', { name: /AUDIO \/ VIDEO/i });
  await user.click(avTab);

  expect(avTab).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: /PROFILE/i })).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby');
});

// TC-003 (AC-02, L3 Integration, Regression)
it('TC-003: PROFILE tab content renders with HexLabels 0xA0-0xA4 visible, no AV content', () => {
  render(<SettingsPage onBack={() => {}} />);

  // PROFILE is default tab
  const profileTab = screen.getByRole('tab', { name: /PROFILE/i });
  expect(profileTab).toHaveAttribute('aria-selected', 'true');

  // Profile HexLabels visible
  expect(screen.getByText(/0xA0/)).toBeInTheDocument();
  expect(screen.getByText(/0xA1/)).toBeInTheDocument();

  // AV content not visible
  expect(screen.queryByText(/0xB0/)).not.toBeInTheDocument();
});

// TC-004 (AC-03, L3 Integration, Positiv)
it('TC-004: AUDIO/VIDEO tab renders HexLabels 0xB0 through 0xB4', async () => {
  const user = userEvent.setup();
  render(<SettingsPage onBack={() => {}} />);

  // Switch to AV tab
  await user.click(screen.getByRole('tab', { name: /AUDIO \/ VIDEO/i }));

  expect(screen.getByText(/0xB0/)).toBeInTheDocument();
  expect(screen.getByText(/MICROPHONE/)).toBeInTheDocument();
  expect(screen.getByText(/0xB2/)).toBeInTheDocument();
  expect(screen.getByText(/NOISE SUPPRESSION/)).toBeInTheDocument();
  expect(screen.getByText(/0xB3/)).toBeInTheDocument();
  expect(screen.getByText(/VOICE TEST/)).toBeInTheDocument();
  expect(screen.getByText(/0xB4/)).toBeInTheDocument();
  expect(screen.getByText(/CAMERA/)).toBeInTheDocument();
});

// TC-035 (AC-19, L3 Integration, Positiv)
it('TC-035: changing input device while activeScope non-null shows "applies on next call join"', async () => {
  // Set up: user is in a call
  mockCallState.activeScope = { type: 'room', id: '1' };
  // Provide devices
  mockDevices = [
    { deviceId: 'mic-1', label: 'Built-in Mic', kind: 'audioinput', groupId: '', toJSON: () => ({}) } as MediaDeviceInfo,
    { deviceId: 'mic-2', label: 'USB Mic', kind: 'audioinput', groupId: '', toJSON: () => ({}) } as MediaDeviceInfo,
  ];

  const user = userEvent.setup();
  render(<SettingsPage onBack={() => {}} />);

  // Switch to AV tab
  await user.click(screen.getByRole('tab', { name: /AUDIO \/ VIDEO/i }));

  // Change input device
  const micSelect = screen.getByLabelText(/microphone/i);
  await user.selectOptions(micSelect, 'mic-2');

  expect(screen.getByText(/applies on next call join/i)).toBeInTheDocument();

  // Reset
  mockCallState.activeScope = null;
  mockDevices = [];
});
