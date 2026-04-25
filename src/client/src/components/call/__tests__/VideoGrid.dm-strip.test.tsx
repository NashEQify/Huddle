/**
 * VideoGrid DM Strip Tests (L3)
 * TC-014
 *
 * Tests DM strip mode: gap, container styling, tile borders, height, no aspect-ratio.
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

describe('VideoGrid DM Strip', () => {
  // TC-014 (AC-12, L3 Integration, Positiv)
  it('TC-014: DM strip: gap 8px, container bg+padding+border, tiles height 160px, no aspect-ratio', () => {
    const local = createMockLocalParticipant('user-1');
    const remote = createMockRemoteParticipant('user-2');
    mockRoom = createMockRoom(local, [remote]);

    render(<VideoGrid roomId="test" mode="strip" />);

    // Outer container
    const outer = screen.getByTestId('video-strip-outer');
    const outerStyle = outer.getAttribute('style') ?? '';
    expect(outerStyle).toContain('background: var(--bg-surface)');
    expect(outerStyle).toContain('padding: var(--space-2)');
    expect(outerStyle).toContain('border-bottom: 1px solid var(--border-default)');

    // Inner strip: flex layout with updated gap
    const inner = screen.getByTestId('video-strip-inner');
    const innerStyle = inner.getAttribute('style') ?? '';
    expect(innerStyle).toContain('display: flex');
    expect(innerStyle).toContain('gap: var(--space-2)');
    expect(innerStyle).not.toContain('gap: 2px');

    // Tiles: height 160px, border, no video-grid-tile class (exempt from aspect-ratio)
    const tiles = screen.getAllByTestId('video-tile');
    tiles.forEach((tile) => {
      const tileStyle = tile.getAttribute('style') ?? '';
      expect(tileStyle).toContain('height: 160px');
      expect(tileStyle).toContain('1px solid var(--border-default)');
      // No aspect-ratio class on strip tiles
      expect(tile.classList.contains('video-grid-tile')).toBe(false);
    });
  });
});
