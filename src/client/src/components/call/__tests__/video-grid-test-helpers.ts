/**
 * Shared mock helpers for VideoGrid polish tests.
 *
 * Creates mock tracks, participants, and configures the useCall / useMediaSettings mocks.
 */

import { vi } from 'vitest';

function createMockTrack(id: string) {
  return {
    id,
    kind: 'video',
    stop: vi.fn(),
  };
}

function createMockTrackPub(trackId: string) {
  return {
    track: { mediaStreamTrack: createMockTrack(trackId) },
    isMuted: false,
    source: 'camera',
  };
}

function createMockMicPub(muted = false) {
  return {
    isMuted: muted,
  };
}

export interface MockParticipant {
  identity: string;
  getTrackPublication: ReturnType<typeof vi.fn>;
}

export function createMockLocalParticipant(
  id: string,
  opts: { hasCam?: boolean; isMuted?: boolean } = {},
): MockParticipant {
  const { hasCam = true, isMuted = false } = opts;
  const camPub = hasCam ? createMockTrackPub(`local-track-${id}`) : undefined;
  const micPub = createMockMicPub(isMuted);

  return {
    identity: id,
    getTrackPublication: vi.fn((source: string) => {
      if (source === 'camera') return camPub;
      if (source === 'microphone') return micPub;
      return undefined;
    }),
  };
}

export function createMockRemoteParticipant(
  id: string,
  opts: { hasCam?: boolean; isMuted?: boolean } = {},
): MockParticipant {
  const { hasCam = true, isMuted = false } = opts;
  const camPub = hasCam ? createMockTrackPub(`remote-track-${id}`) : undefined;
  const micPub = createMockMicPub(isMuted);

  return {
    identity: id,
    getTrackPublication: vi.fn((source: string) => {
      if (source === 'camera') return camPub;
      if (source === 'microphone') return micPub;
      return undefined;
    }),
  };
}

export function createMockRoom(
  localParticipant: MockParticipant,
  remoteParticipants: MockParticipant[] = [],
) {
  const remoteMap = new Map<string, MockParticipant>();
  for (const rp of remoteParticipants) {
    remoteMap.set(rp.identity, rp);
  }

  return {
    localParticipant,
    remoteParticipants: remoteMap,
    on: vi.fn(),
    off: vi.fn(),
  };
}
