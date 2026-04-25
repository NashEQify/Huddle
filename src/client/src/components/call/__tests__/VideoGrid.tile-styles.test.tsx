/**
 * VideoGrid Tile Styles Tests (L3)
 * TC-004, TC-005, TC-007, TC-012, TC-013, TC-016, TC-017, TC-020
 *
 * Tests tile-level styling: speaking highlight, CSS class, single-tile sizing,
 * badge styling, layout stability, self-preview + mirror.
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
let mockSpeakingFn: (id: string) => boolean = () => false;
let mockMirrorSelfView = true;

vi.mock('../../../stores/call', () => ({
  useCall: () => ({
    state: {
      room: mockRoom,
      activeScope: mockRoom ? { type: 'room', id: 'test' } : null,
    },
    isUserSpeaking: (id: string) => mockSpeakingFn(id),
  }),
}));

vi.mock('../../../hooks/useMediaSettings', () => ({
  useMediaSettings: () => ({
    videoMirrorSelfView: mockMirrorSelfView,
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

beforeEach(() => {
  mockSpeakingFn = () => false;
  mockMirrorSelfView = true;
});

describe('VideoGrid Tile Styles', () => {
  // TC-004 (AC-04, L3 Integration, Positiv)
  it('TC-004: Speaking tile has inset box-shadow, idle border stays', () => {
    const local = createMockLocalParticipant('user-1');
    mockRoom = createMockRoom(local);
    mockSpeakingFn = (id: string) => id === 'user-1';

    render(<VideoGrid roomId="test" />);

    const tile = screen.getByTestId('video-tile');
    const style = tile.getAttribute('style') ?? '';

    // Idle border remains
    expect(style).toContain('1px solid var(--border-default)');
    // Speaking highlight via inset box-shadow
    expect(style).toContain('inset 0 0 0 2px var(--accent)');
    // Transition present
    expect(style).toContain('box-shadow 200ms');
    // No outline approach
    expect(style).not.toContain('outline');
  });

  // TC-005 (AC-05, L3 Integration, Positiv)
  it('TC-005: Grid-mode tile has CSS class video-grid-tile', () => {
    const local = createMockLocalParticipant('user-1');
    mockRoom = createMockRoom(local);

    render(<VideoGrid roomId="test" />);

    const tile = screen.getByTestId('video-tile');
    expect(tile.classList.contains('video-grid-tile')).toBe(true);
  });

  // TC-007 (AC-06, L3 Integration, Positiv)
  it('TC-007: 1 tile: max-width 640px, justify-self center, 1fr grid', () => {
    const local = createMockLocalParticipant('user-1');
    mockRoom = createMockRoom(local);

    render(<VideoGrid roomId="test" />);

    const tile = screen.getByTestId('video-tile');
    const tileStyle = tile.getAttribute('style') ?? '';
    expect(tileStyle).toContain('max-width: 640px');
    expect(tileStyle).toContain('justify-self: center');

    // Inner grid: single column
    const inner = screen.getByTestId('video-grid-inner');
    const innerStyle = inner.getAttribute('style') ?? '';
    expect(innerStyle).toContain('grid-template-columns: 1fr');
    expect(innerStyle).not.toContain('1fr 1fr');
  });

  // TC-012 (AC-10, L3 Integration, Positiv)
  it('TC-012: Username badge: rgba(0.8), padding 2px 6px, offset space-2', () => {
    const local = createMockLocalParticipant('user-1');
    mockRoom = createMockRoom(local);

    render(<VideoGrid roomId="test" />);

    const badge = screen.getAllByTestId('username-badge')[0];
    const style = badge.getAttribute('style') ?? '';

    // Increased opacity: 0.8, not 0.7
    expect(style).toContain('rgba(26, 26, 46, 0.8)');
    expect(style).not.toContain('0.7');
    // Increased padding
    expect(style).toContain('padding: 2px 6px');
    expect(style).not.toContain('1px 4px');
    // Increased offset
    expect(style).toContain('bottom: var(--space-2)');
    expect(style).toContain('left: var(--space-2)');
    expect(style).not.toContain('var(--space-1)');
  });

  // TC-013 (AC-11, L3 Integration, Positiv)
  it('TC-013: Muted badge: same styling as username badge', () => {
    const local = createMockLocalParticipant('user-1', { isMuted: true });
    mockRoom = createMockRoom(local);

    render(<VideoGrid roomId="test" />);

    const badge = screen.getByTestId('muted-badge');
    const style = badge.getAttribute('style') ?? '';

    expect(style).toContain('rgba(26, 26, 46, 0.8)');
    expect(style).toContain('padding: 2px 6px');
    expect(style).toContain('bottom: var(--space-2)');
    expect(style).toContain('right: var(--space-2)');
    expect(style).not.toContain('0.7');
    expect(style).not.toContain('1px 4px');
  });

  // TC-016 (AC-14, L3 Integration, Positiv)
  it('TC-016: No layout shift when speaking state toggles', () => {
    const local = createMockLocalParticipant('user-1');
    const remote = createMockRemoteParticipant('user-2');
    mockRoom = createMockRoom(local, [remote]);
    mockSpeakingFn = () => false;

    const { rerender } = render(<VideoGrid roomId="test" />);

    const tile = screen.getAllByTestId('video-tile')[0];
    const styleBefore = tile.getAttribute('style') ?? '';
    // Border is always 1px solid — no size change when speaking toggles
    expect(styleBefore).toContain('border: 1px solid var(--border-default)');
    expect(styleBefore).toContain('box-shadow: none');

    // Toggle speaking ON
    mockSpeakingFn = (id: string) => id === 'user-1';
    rerender(<VideoGrid roomId="test" />);

    const styleAfter = tile.getAttribute('style') ?? '';
    // Border unchanged
    expect(styleAfter).toContain('border: 1px solid var(--border-default)');
    // box-shadow changed to inset (inset does not affect layout)
    expect(styleAfter).toContain('inset 0 0 0 2px var(--accent)');
  });

  // TC-017 (AC-15, L3 Integration, Regression)
  it('TC-017: Self-preview is tile 0, mirror transform preserved (T-022)', () => {
    mockMirrorSelfView = true;
    const local = createMockLocalParticipant('user-1');
    const remote1 = createMockRemoteParticipant('user-2');
    const remote2 = createMockRemoteParticipant('user-3');
    mockRoom = createMockRoom(local, [remote1, remote2]);

    render(<VideoGrid roomId="test" />);

    const tiles = screen.getAllByTestId('video-tile');
    // First tile must be local
    const firstVideo = tiles[0].querySelector('[data-testid="local-video"]');
    expect(firstVideo).not.toBeNull();

    // Mirror transform on local video
    const localVideo = screen.getByTestId('local-video');
    const videoStyle = localVideo.getAttribute('style') ?? '';
    expect(videoStyle).toContain('scaleX(-1)');

    // Remote videos do not have mirror transform
    const remoteVideos = screen.getAllByTestId('remote-video');
    remoteVideos.forEach((rv) => {
      expect(rv.getAttribute('style') ?? '').not.toContain('scaleX(-1)');
    });
  });

  // TC-020 (FM-2, L3 Integration, Boundary)
  it('TC-020: Single tile constrained to max-width 640px with justify-self center', () => {
    const local = createMockLocalParticipant('user-1');
    mockRoom = createMockRoom(local);

    render(<VideoGrid roomId="test" />);

    const tile = screen.getByTestId('video-tile');
    const style = tile.getAttribute('style') ?? '';

    expect(style).toContain('max-width: 640px');
    expect(style).toContain('justify-self: center');
    // No maxHeight: 400px on grid-mode single tile (aspect-ratio handles height)
    expect(style).not.toContain('max-height: 400px');
  });
});
