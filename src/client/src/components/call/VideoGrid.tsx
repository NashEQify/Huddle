/**
 * VideoGrid — Renders camera video tiles for in-call participants
 *
 * Layout rules (from spec 45.6):
 * - 1 tile: single column, max-width 640px, centered
 * - 2 tiles: 2-column CSS grid (1fr 1fr)
 * - 3-4 tiles: 2-column CSS grid
 * - 5-6 tiles: 2-column CSS grid
 * - 7-8 tiles: 2-column CSS grid, scrollable
 * - 9+ tiles: 3-column CSS grid, scrollable
 *
 * All grid-mode tiles use aspect-ratio: 16/9 via CSS class.
 * DM strip tiles are exempt (fixed height: 160px).
 * Speaking indicator: inset box-shadow (no layout shift).
 * Self-preview is always tile 0 (top-left).
 * No border-radius, no decorative drop shadows, no spinners.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrackPublication,
  type LocalTrackPublication,
  type Participant,
} from 'livekit-client';
import { useCall } from '../../stores/call';
import { useMediaSettings } from '../../hooks/useMediaSettings';

interface VideoGridProps {
  /** The scope key for current room call */
  roomId: string;
  /** Layout mode: 'grid' for rooms, 'strip' for DMs */
  mode?: 'grid' | 'strip';
  /** When true, VideoGrid fills all available vertical space (expanded video mode) */
  expanded?: boolean;
}

interface VideoTrackInfo {
  participantId: string;
  username: string;
  track: MediaStreamTrack;
  isMuted: boolean;
  isSpeaking: boolean;
  isLocal: boolean;
}

export function VideoGrid({ roomId, mode = 'grid', expanded = false }: VideoGridProps) {
  const { state, isUserSpeaking } = useCall();
  const { videoMirrorSelfView } = useMediaSettings();
  const [videoTracks, setVideoTracks] = useState<VideoTrackInfo[]>([]);

  // Determine if active call scope matches this component's scope
  const scopeMatches = state.activeScope ? state.activeScope.id === roomId : false;

  const room = state.room;

  // Subscribe to track changes
  useEffect(() => {
    if (!room) {
      setVideoTracks([]);
      return;
    }

    function updateTracks() {
      if (!room) return;
      const tracks: VideoTrackInfo[] = [];

      // Local participant — skip if camera track is muted/stopped
      const local = room.localParticipant;
      const localCamPub = local.getTrackPublication(Track.Source.Camera);
      if (
        localCamPub?.track?.mediaStreamTrack &&
        !localCamPub.isMuted &&
        localCamPub.track.mediaStreamTrack.readyState === 'live'
      ) {
        tracks.push({
          participantId: local.identity,
          username: local.identity,
          track: localCamPub.track.mediaStreamTrack,
          isMuted: local.getTrackPublication(Track.Source.Microphone)?.isMuted ?? false,
          isSpeaking: false,
          isLocal: true,
        });
      }

      // Remote participants — skip if camera track is muted/stopped
      for (const participant of room.remoteParticipants.values()) {
        const camPub = participant.getTrackPublication(Track.Source.Camera);
        if (
          camPub?.track?.mediaStreamTrack &&
          !camPub.isMuted &&
          camPub.track.mediaStreamTrack.readyState === 'live'
        ) {
          tracks.push({
            participantId: participant.identity,
            username: participant.identity,
            track: camPub.track.mediaStreamTrack,
            isMuted: participant.getTrackPublication(Track.Source.Microphone)?.isMuted ?? false,
            isSpeaking: false,
            isLocal: false,
          });
        }
      }

      setVideoTracks(tracks);
    }

    updateTracks();

    room.on(RoomEvent.TrackSubscribed, updateTracks);
    room.on(RoomEvent.TrackUnsubscribed, updateTracks);
    room.on(RoomEvent.TrackPublished, updateTracks);
    room.on(RoomEvent.TrackUnpublished, updateTracks);
    room.on(RoomEvent.LocalTrackPublished, updateTracks);
    room.on(RoomEvent.LocalTrackUnpublished, updateTracks);
    room.on(RoomEvent.TrackMuted, updateTracks);
    room.on(RoomEvent.TrackUnmuted, updateTracks);

    return () => {
      room.off(RoomEvent.TrackSubscribed, updateTracks);
      room.off(RoomEvent.TrackUnsubscribed, updateTracks);
      room.off(RoomEvent.TrackPublished, updateTracks);
      room.off(RoomEvent.TrackUnpublished, updateTracks);
      room.off(RoomEvent.LocalTrackPublished, updateTracks);
      room.off(RoomEvent.LocalTrackUnpublished, updateTracks);
      room.off(RoomEvent.TrackMuted, updateTracks);
      room.off(RoomEvent.TrackUnmuted, updateTracks);
    };
  }, [room]);

  // No active call or scope mismatch — render nothing
  if (!scopeMatches) return null;
  if (videoTracks.length === 0) return null;

  // Sort: self-preview first
  const sorted = [...videoTracks].sort((a, b) => {
    if (a.isLocal && !b.isLocal) return -1;
    if (!a.isLocal && b.isLocal) return 1;
    return 0;
  });

  const count = sorted.length;

  // DM strip mode: max 2 tiles, aspect-ratio based sizing, max-height capped
  if (mode === 'strip') {
    return (
      <div
        data-testid="video-strip-outer"
        style={{
          background: 'var(--bg-surface)',
          padding: 'var(--space-2)',
          borderBottom: '1px solid var(--border-default)',
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          data-testid="video-strip-inner"
          style={{
            display: 'grid',
            gridTemplateColumns: sorted.length === 1 ? '1fr' : '1fr 1fr',
            gap: 'var(--space-2)',
            width: '100%',
            maxWidth: sorted.length === 1 ? '400px' : '100%',
          }}
        >
          {sorted.slice(0, 2).map((info) => (
            <VideoTile
              key={info.participantId}
              info={info}
              speaking={isUserSpeaking(info.participantId)}
              mirrorSelfView={videoMirrorSelfView}
              isStrip={true}
              tileCount={count}
              style={{}}
            />
          ))}
        </div>
      </div>
    );
  }

  // Room grid mode
  const isScrollable = count >= 5;
  const gridStyle = getGridStyle(count);

  // Outer container classes
  const outerClasses = [
    'video-grid-container',
    ...(isScrollable ? ['video-grid-container--scrollable'] : []),
  ].join(' ');

  // Outer container style
  const outerStyle: React.CSSProperties = expanded
    ? {
        background: 'var(--bg-surface)',
        padding: 'var(--space-2)',
        borderBottom: '1px solid var(--border-default)',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        background: 'var(--bg-surface)',
        padding: 'var(--space-2)',
        borderBottom: '1px solid var(--border-default)',
        flexShrink: 0,
        ...(isScrollable ? { maxHeight: '500px', overflowY: 'auto' as const } : {}),
      };

  return (
    <div
      data-testid="video-grid-outer"
      className={outerClasses}
      style={outerStyle}
    >
      <div
        data-testid="video-grid-inner"
        className="video-grid-inner"
        style={expanded ? { ...gridStyle, flex: 1 } : gridStyle}
      >
        {sorted.map((info) => (
          <VideoTile
            key={info.participantId}
            info={info}
            speaking={isUserSpeaking(info.participantId)}
            mirrorSelfView={videoMirrorSelfView}
            isStrip={false}
            tileCount={count}
            style={getTileStyle(count)}
          />
        ))}
      </div>
    </div>
  );
}

// ── VideoTile ────────────────────────────────────────────

function VideoTile({
  info,
  speaking,
  mirrorSelfView,
  isStrip,
  tileCount,
  style,
}: {
  info: VideoTrackInfo;
  speaking: boolean;
  mirrorSelfView: boolean;
  isStrip: boolean;
  tileCount: number;
  style?: React.CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && info.track) {
      video.srcObject = new MediaStream([info.track]);
    }
    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [info.track]);

  // Mirror transform: only for local participant when mirrorSelfView is ON
  const videoMirrorStyle: React.CSSProperties =
    info.isLocal && mirrorSelfView ? { transform: 'scaleX(-1)' } : {};

  // Speaking highlight via inset box-shadow (no layout shift)
  const boxShadow = speaking
    ? 'inset 0 0 0 2px var(--accent)'
    : 'none';

  return (
    <div
      data-testid="video-tile"
      className="video-grid-tile"
      style={{
        position: 'relative',
        background: 'var(--bg-input)',
        overflow: 'hidden',
        border: '1px solid var(--border-default)',
        boxShadow,
        transition: 'box-shadow 200ms',
        ...style,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={info.isLocal}
        data-testid={info.isLocal ? 'local-video' : 'remote-video'}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          ...videoMirrorStyle,
        }}
      />

      {/* Username label — bottom-left */}
      <span
        data-testid="username-badge"
        style={{
          position: 'absolute',
          bottom: 'var(--space-2)',
          left: 'var(--space-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          background: 'rgba(26, 26, 46, 0.8)',
          padding: '2px 6px',
          letterSpacing: '0.02em',
        }}
      >
        [ {info.isLocal ? 'you' : info.username} ]
      </span>

      {/* Muted indicator — bottom-right */}
      {info.isMuted && (
        <span
          data-testid="muted-badge"
          style={{
            position: 'absolute',
            bottom: 'var(--space-2)',
            right: 'var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--error)',
            background: 'rgba(26, 26, 46, 0.8)',
            padding: '2px 6px',
          }}
        >
          [M]
        </span>
      )}
    </div>
  );
}

// ── Layout Helpers ───────────────────────────────────────

function getGridStyle(count: number): React.CSSProperties {
  if (count === 1) {
    return {
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: 'var(--space-2)',
    };
  }
  if (count <= 8) {
    return {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 'var(--space-2)',
    };
  }
  // 9+: 3-column
  return {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 'var(--space-2)',
  };
}

function getTileStyle(count: number): React.CSSProperties {
  if (count === 1) {
    return { maxWidth: '640px', justifySelf: 'center' };
  }
  return {};
}
