/**
 * VideoGrid Mirror Propagation Tests (L3)
 *
 * TC-027b
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoGrid } from '../../components/call/VideoGrid';

// Mock useCall — provide a room with local participant + camera track
const mockLocalMediaStreamTrack = {
  id: 'local-track',
  kind: 'video',
  stop: vi.fn(),
};

const mockLocalTrackPub = {
  track: { mediaStreamTrack: mockLocalMediaStreamTrack },
  isMuted: false,
  source: 'camera',
};

const mockMicPub = {
  isMuted: false,
};

const mockLocalParticipant = {
  identity: 'user-1',
  getTrackPublication: vi.fn((source: string) => {
    if (source === 'camera') return mockLocalTrackPub;
    if (source === 'microphone') return mockMicPub;
    return undefined;
  }),
};

const mockRoom = {
  localParticipant: mockLocalParticipant,
  remoteParticipants: new Map(),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('../../stores/call', () => ({
  useCall: () => ({
    state: {
      room: mockRoom,
      activeScope: { type: 'room', id: 'test' },
    },
    isUserSpeaking: vi.fn(() => false),
  }),
}));

// Mock useMediaSettings — configurable mirror state
let mockMirrorSelfView = true;
vi.mock('../../hooks/useMediaSettings', () => ({
  useMediaSettings: () => ({
    videoMirrorSelfView: mockMirrorSelfView,
  }),
}));

// Mock livekit-client enums
vi.mock('livekit-client', () => ({
  Room: vi.fn(),
  RoomEvent: {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
  },
  Track: {
    Source: {
      Camera: 'camera',
      Microphone: 'microphone',
    },
  },
  ConnectionState: { Disconnected: 'disconnected' },
  ConnectionQuality: { Excellent: 'excellent' },
}));

beforeEach(() => {
  localStorage.clear();
  mockMirrorSelfView = true;
});

afterEach(() => {
  localStorage.clear();
});

// TC-027b (AC-14, L3 Integration, Positiv)
it('TC-027b: VideoGrid VideoTile applies scaleX(-1) to local participant when mirrorSelfView=true', () => {
  mockMirrorSelfView = true;

  render(<VideoGrid roomId="test" />);

  const localVideo = screen.getByTestId('local-video');
  expect(localVideo).toHaveStyle({ transform: 'scaleX(-1)' });
});

it('TC-027b-neg: VideoGrid VideoTile does NOT apply scaleX(-1) when mirrorSelfView=false', () => {
  mockMirrorSelfView = false;

  render(<VideoGrid roomId="test" />);

  const localVideo = screen.getByTestId('local-video');
  // When mirrorSelfView is false, no transform should be applied
  expect(localVideo).not.toHaveStyle({ transform: 'scaleX(-1)' });
});
