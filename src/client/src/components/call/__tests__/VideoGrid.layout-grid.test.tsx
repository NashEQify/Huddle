/**
 * VideoGrid Layout Grid Tests (L3)
 * TC-008, TC-009, TC-010, TC-011
 *
 * Tests grid column configurations for various tile counts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoGrid } from '../VideoGrid';
import {
  createMockLocalParticipant,
  createMockRemoteParticipant,
  createMockRoom,
} from './video-grid-test-helpers';

// ── Mocks ──

let mockRoom: ReturnType<typeof createMockRoom> | null = null;

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

function createRoomWithCount(count: number) {
  const local = createMockLocalParticipant('user-0');
  const remotes = [];
  for (let i = 1; i < count; i++) {
    remotes.push(createMockRemoteParticipant(`user-${i}`));
  }
  return createMockRoom(local, remotes);
}

describe('VideoGrid Layout Grid', () => {
  // TC-008 (AC-07, L3 Integration, Positiv)
  it('TC-008: 2 tiles: 2-column CSS grid with 1fr 1fr', () => {
    mockRoom = createRoomWithCount(2);

    render(<VideoGrid roomId="test" />);

    const inner = screen.getByTestId('video-grid-inner');
    const style = inner.getAttribute('style') ?? '';
    expect(style).toContain('display: grid');
    expect(style).toContain('grid-template-columns: 1fr 1fr');
    // No flex layout for 2-tile
    expect(style).not.toContain('display: flex');
  });

  // TC-009 (AC-07, L3 Integration, Boundary)
  it('TC-009: 8 tiles: 2-column CSS grid (boundary 7-8 tier)', () => {
    mockRoom = createRoomWithCount(8);

    render(<VideoGrid roomId="test" />);

    const inner = screen.getByTestId('video-grid-inner');
    const style = inner.getAttribute('style') ?? '';
    expect(style).toContain('display: grid');
    expect(style).toContain('grid-template-columns: 1fr 1fr');
    expect(style).not.toContain('1fr 1fr 1fr');
  });

  // TC-010 (AC-08, L3 Integration, Positiv)
  it('TC-010: 5+ tiles: maxHeight 500px, overflowY auto, scrollable CSS class', () => {
    mockRoom = createRoomWithCount(5);

    render(<VideoGrid roomId="test" />);

    const outer = screen.getByTestId('video-grid-outer');
    const outerStyle = outer.getAttribute('style') ?? '';
    expect(outerStyle).toContain('max-height: 500px');
    expect(outerStyle).toContain('overflow-y: auto');
    expect(outer.classList.contains('video-grid-container--scrollable')).toBe(true);
  });

  // Verify 4 tiles do NOT have maxHeight/scroll
  it('TC-010-neg: 4 tiles do not have maxHeight or scrollable class', () => {
    mockRoom = createRoomWithCount(4);

    render(<VideoGrid roomId="test" />);

    const outer = screen.getByTestId('video-grid-outer');
    const outerStyle = outer.getAttribute('style') ?? '';
    expect(outerStyle).not.toContain('max-height');
    expect(outerStyle).not.toContain('overflow-y');
    expect(outer.classList.contains('video-grid-container--scrollable')).toBe(false);
  });

  // TC-011 (AC-09, L3 Integration, Positiv)
  it('TC-011: 9+ tiles: 3-column CSS grid with 1fr 1fr 1fr', () => {
    mockRoom = createRoomWithCount(9);

    render(<VideoGrid roomId="test" />);

    const inner = screen.getByTestId('video-grid-inner');
    const style = inner.getAttribute('style') ?? '';
    expect(style).toContain('display: grid');
    expect(style).toContain('grid-template-columns: 1fr 1fr 1fr');

    // Also scrollable
    const outer = screen.getByTestId('video-grid-outer');
    expect(outer.classList.contains('video-grid-container--scrollable')).toBe(true);
  });
});
