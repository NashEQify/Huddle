/**
 * VideoGrid Reflow Tests (L4)
 * TC-018
 *
 * Tests that camera off removes tiles, grid re-flows, and count=0 unmounts VideoGrid.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';
import { VideoGrid } from '../VideoGrid';
import {
  createMockLocalParticipant,
  createMockRemoteParticipant,
  createMockRoom,
  type MockParticipant,
} from './video-grid-test-helpers';

// ── Stateful mock — room changes via test wrapper ──

let mockRoom: any = null;

vi.mock('../../../stores/call', () => ({
  useCall: () => ({
    state: {
      room: mockRoom,
      activeScope: mockRoom ? { type: 'room', id: 'test' } : null,
    },
    isUserSpeaking: () => false,
  }),
}));

vi.mock('../../../hooks/useMediaSettings', () => ({
  useMediaSettings: () => ({
    videoMirrorSelfView: true,
  }),
}));

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

describe('VideoGrid Reflow', () => {
  // TC-018 (AC-16, L4 E2E, Positiv)
  it('TC-018: Camera off removes tile, grid re-flows; count=0 unmounts VideoGrid', () => {
    // Start with 4 participants
    const local = createMockLocalParticipant('user-0');
    const remotes = [
      createMockRemoteParticipant('user-1'),
      createMockRemoteParticipant('user-2'),
      createMockRemoteParticipant('user-3'),
    ];
    mockRoom = createMockRoom(local, remotes);

    const { rerender } = render(<VideoGrid roomId="test" />);

    // Before remove: 4 tiles
    expect(screen.getAllByTestId('video-tile')).toHaveLength(4);
    const inner = screen.getByTestId('video-grid-inner');
    expect(inner.getAttribute('style')).toContain('grid-template-columns: 1fr 1fr');

    // Simulate camera off for user-3: reduce to 3 remotes
    const remotes3 = [
      createMockRemoteParticipant('user-1'),
      createMockRemoteParticipant('user-2'),
    ];
    mockRoom = createMockRoom(local, remotes3);
    rerender(<VideoGrid roomId="test" />);

    // After remove: 3 tiles, grid stays 2-column
    expect(screen.getAllByTestId('video-tile')).toHaveLength(3);
    expect(screen.getByTestId('video-grid-inner').getAttribute('style')).toContain(
      'grid-template-columns: 1fr 1fr',
    );

    // Reduce to 0: no camera tracks
    const localNoCam = createMockLocalParticipant('user-0', { hasCam: false });
    mockRoom = createMockRoom(localNoCam, []);
    rerender(<VideoGrid roomId="test" />);

    // VideoGrid unmounts entirely
    expect(screen.queryByTestId('video-grid-outer')).toBeNull();
  });
});
