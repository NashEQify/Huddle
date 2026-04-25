/**
 * ScreensharePreview -- Inline preview for room or DM screenshare
 *
 * Shows a video preview at the top of the chat when a screenshare is active.
 * Double-click opens the ScreenshareWindow.
 * Per spec 50.2: "show a preview at top of chat. Double-click opens resizable window."
 */

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrackPublication } from 'livekit-client';
import { PictureInPicture2, Maximize, X } from 'lucide-react';
import { useScreenshare } from '../../stores/screenshare';
import { api } from '../../lib/api';
import { getLivekitUrl } from '../../lib/livekit-url';
import { IconButton } from '../ui/IconButton';

/** Cross-browser fullscreen — handles webkit prefix (Safari) */
function requestFullscreen(el: HTMLElement): void {
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  } else if ((el as any).webkitRequestFullscreen) {
    (el as any).webkitRequestFullscreen();
  }
}

interface ScreensharePreviewProps {
  /** For room screenshare */
  roomId?: string;
  /** For DM screenshare */
  directId?: string;
}

export function ScreensharePreview({ roomId, directId }: ScreensharePreviewProps) {
  const { getRoomScreenshare, getDmScreenshare, state } = useScreenshare();

  const mode = roomId ? 'room' : 'direct';
  const scopeId = roomId ?? directId ?? '';

  const activeScreenshare = mode === 'room'
    ? getRoomScreenshare(scopeId)
    : getDmScreenshare(scopeId);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [showWindow, setShowWindow] = useState(false);

  // Check if this is OUR own screenshare -- if so, use local track
  const isLocalScreenshare =
    state.localScreenshareMode === mode &&
    state.localScreenshareScopeId === scopeId;

  // Subscribe to the screenshare LiveKit room as a viewer
  useEffect(() => {
    if (!activeScreenshare || isLocalScreenshare) {
      setTrack(null);
      return;
    }

    let cancelled = false;
    let viewerRoom: Room | null = null;

    (async () => {
      // Get a view-only token for the screenshare room
      const prefix = mode === 'room' ? 'ss:room' : 'ss:dm';
      const livekitRoomName = `${prefix}:${scopeId}`;
      const tokenResult = await api.post<{ token: string }>(
        '/api/livekit/token',
        { roomName: livekitRoomName }
      );
      if (!tokenResult.ok || cancelled) return;

      // No adaptiveStream for screenshare — always receive full 1080p quality.
      // adaptiveStream scales down based on video element size which would
      // degrade quality in the small preview; users expand/fullscreen to view.
      viewerRoom = new Room({ adaptiveStream: false });
      roomRef.current = viewerRoom;

      await viewerRoom.connect(await getLivekitUrl(), tokenResult.data.token);
      if (cancelled) {
        viewerRoom.disconnect();
        return;
      }

      // Find existing screen share track
      for (const participant of viewerRoom.remoteParticipants.values()) {
        const ssPub = participant.getTrackPublication(Track.Source.ScreenShare);
        if (ssPub?.track?.mediaStreamTrack) {
          setTrack(ssPub.track.mediaStreamTrack);
          break;
        }
      }

      // Listen for new tracks
      viewerRoom.on(RoomEvent.TrackSubscribed, (_track, pub) => {
        if (pub.source === Track.Source.ScreenShare && pub.track?.mediaStreamTrack) {
          setTrack(pub.track.mediaStreamTrack);
        }
      });

      viewerRoom.on(RoomEvent.TrackUnsubscribed, (_track, pub) => {
        if (pub.source === Track.Source.ScreenShare) {
          setTrack(null);
        }
      });
    })();

    return () => {
      cancelled = true;
      if (viewerRoom) {
        viewerRoom.disconnect();
        roomRef.current = null;
      }
      setTrack(null);
    };
  }, [activeScreenshare?.userId, scopeId, mode, isLocalScreenshare]);

  // Get local screenshare track
  useEffect(() => {
    if (!isLocalScreenshare || !state.localScreenshareRoom) return;

    const room = state.localScreenshareRoom;
    const ssPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (ssPub?.track?.mediaStreamTrack) {
      setTrack(ssPub.track.mediaStreamTrack);
    }

    const handleTrackPublished = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (pub?.track?.mediaStreamTrack) {
        setTrack(pub.track.mediaStreamTrack);
      }
    };

    room.on(RoomEvent.LocalTrackPublished, handleTrackPublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleTrackPublished);
    };
  }, [isLocalScreenshare, state.localScreenshareRoom]);

  // Attach track to video element
  useEffect(() => {
    const video = videoRef.current;
    if (video && track) {
      video.srcObject = new MediaStream([track]);
    }
    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [track]);

  if (!activeScreenshare && !isLocalScreenshare) return null;
  if (!track) return null;

  const sharerLabel = isLocalScreenshare
    ? 'you'
    : activeScreenshare?.userId ?? 'unknown';

  return (
    <>
      <div
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-input)',
          position: 'relative',
          maxHeight: '300px',
          cursor: 'pointer',
        }}
        ref={previewContainerRef}
        onDoubleClick={() => {
          if (previewContainerRef.current) requestFullscreen(previewContainerRef.current);
        }}
        data-testid="screenshare-preview"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            maxHeight: '300px',
            objectFit: 'contain',
            display: 'block',
          }}
        />
        <span
          style={{
            position: 'absolute',
            bottom: 'var(--space-1)',
            left: 'var(--space-1)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            background: 'rgba(26, 26, 46, 0.7)',
            padding: '1px 4px',
          }}
        >
          [ screenshare: {sharerLabel} ]
        </span>
        <div
          style={{
            position: 'absolute',
            bottom: 'var(--space-1)',
            right: 'var(--space-1)',
            display: 'flex',
            gap: '4px',
          }}
        >
          <IconButton
            icon={PictureInPicture2}
            label="Open screenshare window"
            color="var(--text-primary)"
            size={16}
            onClick={(e) => { e.stopPropagation(); setShowWindow(true); }}
            style={{ minWidth: '32px', minHeight: '32px', padding: '4px', background: 'rgba(26, 26, 46, 0.7)' }}
          />
          <IconButton
            icon={Maximize}
            label="Fullscreen"
            color="var(--text-primary)"
            size={16}
            onClick={(e) => {
              e.stopPropagation();
              videoRef.current?.requestFullscreen?.();
            }}
            style={{ minWidth: '32px', minHeight: '32px', padding: '4px', background: 'rgba(26, 26, 46, 0.7)' }}
          />
        </div>
      </div>

      {/* Screenshare Window (modal overlay) */}
      {showWindow && (
        <ScreenshareWindow
          track={track}
          sharerLabel={sharerLabel}
          onClose={() => setShowWindow(false)}
        />
      )}
    </>
  );
}

// ── Screenshare Window ──────────────────────────────────

function ScreenshareWindow({
  track,
  sharerLabel,
  onClose,
}: {
  track: MediaStreamTrack;
  sharerLabel: string;
  onClose: () => void;
}) {
  const windowVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = windowVideoRef.current;
    if (video && track) {
      const stream = new MediaStream([track]);
      video.srcObject = stream;
    }
    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [track]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(10, 10, 20, 0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-2) var(--space-4)',
          background: 'rgba(26, 26, 46, 0.9)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          [ screenshare: {sharerLabel} ]
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <IconButton
            icon={Maximize}
            label="Fullscreen"
            color="var(--text-primary)"
            onClick={() => { if (windowVideoRef.current) requestFullscreen(windowVideoRef.current); }}
          />
          <IconButton
            icon={X}
            label="Close screenshare window"
            color="var(--text-primary)"
            onClick={onClose}
          />
        </div>
      </div>

      {/* Video — double-click for browser fullscreen */}
      <video
        ref={windowVideoRef}
        autoPlay
        playsInline
        muted
        onDoubleClick={() => { if (windowVideoRef.current) requestFullscreen(windowVideoRef.current); }}
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          objectFit: 'contain',
          cursor: 'pointer',
        }}
      />
    </div>
  );
}

// ── Shared Styles ────────────────────────────────────────

const previewBtnStyle: React.CSSProperties = {
  background: 'rgba(26, 26, 46, 0.7)',
  border: 'none',
  borderRadius: 0,
  padding: '1px 4px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
};

const windowBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 0,
  padding: 'var(--space-1) var(--space-2)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  textTransform: 'uppercase',
};
