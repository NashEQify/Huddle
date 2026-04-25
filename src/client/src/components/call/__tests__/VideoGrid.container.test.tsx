/**
 * VideoGrid Container Tests (L3)
 * TC-001, TC-002, TC-003, TC-015
 *
 * Tests the outer container styling, gap, idle tile border, and TTY constraints.
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

beforeEach(() => {
  mockSpeakingFn = () => false;
});

describe('VideoGrid Container', () => {
  // TC-001 (AC-01, L3 Integration, Positiv)
  it('TC-001: Outer container has bg-surface, space-2 padding, and bottom border', () => {
    const local = createMockLocalParticipant('user-1');
    mockRoom = createMockRoom(local);

    render(<VideoGrid roomId="test" />);

    const outer = screen.getByTestId('video-grid-outer');
    const style = outer.getAttribute('style') ?? '';

    expect(style).toContain('var(--bg-surface)');
    expect(style).toContain('var(--space-2)');
    expect(style).toContain('border-bottom: 1px solid var(--border-default)');
  });

  // TC-002 (AC-02, L3 Integration, Positiv)
  it('TC-002: Gap between tiles is var(--space-2)', () => {
    const local = createMockLocalParticipant('user-1');
    const remote = createMockRemoteParticipant('user-2');
    mockRoom = createMockRoom(local, [remote]);

    render(<VideoGrid roomId="test" />);

    const inner = screen.getByTestId('video-grid-inner');
    const style = inner.getAttribute('style') ?? '';

    expect(style).toContain('gap: var(--space-2)');
    expect(style).not.toContain('gap: 2px');
    expect(style).not.toContain('gap:2px');
  });

  // TC-003 (AC-03, L3 Integration, Positiv)
  it('TC-003: Idle tile has always-visible 1px solid border-default', () => {
    const local = createMockLocalParticipant('user-1');
    mockRoom = createMockRoom(local);

    render(<VideoGrid roomId="test" />);

    const tile = screen.getByTestId('video-tile');
    const style = tile.getAttribute('style') ?? '';

    expect(style).toContain('1px solid var(--border-default)');
    // No transparent border
    expect(style).not.toContain('transparent');
  });

  // TC-015 (AC-13, L3 Integration, Negativ)
  it('TC-015: No border-radius and no decorative box-shadow in VideoGrid', () => {
    // Render with 3 participants: 2 speaking, 1 muted
    const local = createMockLocalParticipant('user-1');
    const remote1 = createMockRemoteParticipant('user-2', { isMuted: true });
    const remote2 = createMockRemoteParticipant('user-3');
    mockRoom = createMockRoom(local, [remote1, remote2]);
    mockSpeakingFn = (id: string) => id === 'user-1' || id === 'user-3';

    render(<VideoGrid roomId="test" />);

    const container = screen.getByTestId('video-grid-outer');
    const allElements = container.querySelectorAll('*');

    allElements.forEach((el) => {
      const style = el.getAttribute('style') ?? '';
      // No border-radius (except 0)
      expect(style).not.toMatch(/border-radius\s*:\s*(?!0)[^;]+/);
      // Decorative (non-inset) box-shadow is forbidden
      const shadowMatches = style.match(/box-shadow\s*:[^;]+/g) ?? [];
      shadowMatches.forEach((shadow) => {
        if (!shadow.includes('inset') && !shadow.includes('none')) {
          throw new Error(
            `Decorative box-shadow found: ${shadow} on element ${el.tagName}`,
          );
        }
      });
      expect(style).not.toContain('drop-shadow');
      expect(style).not.toContain('filter: drop-shadow');
    });
  });
});
