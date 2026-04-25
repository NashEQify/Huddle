/**
 * CallControls — In-room call controls
 *
 * Shows: Join Call button (with dropdown) when not in call,
 * or Mute/Camera/Leave controls when in call.
 * Includes call duration timer.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ConnectionState, ConnectionQuality } from 'livekit-client';
import { Mic, MicOff, Camera, CameraOff, Sparkles, PhoneOff, Phone, Maximize2, Minimize2, MessageSquare } from 'lucide-react';
import type { CallScope } from '@huddle/shared';
import { useCall, scopeToKey, type JoinCallFailReason } from '../../stores/call';
import { useNavigation } from '../../stores/navigation';
import { useAuth } from '../../stores/auth';
import { IconButton } from '../ui/IconButton';
import { CallDurationTimer } from './CallDurationTimer';

interface CallControlsProps {
  scope: CallScope;
  /** Is the user a joined member (can make calls)? */
  canCall: boolean;
  /** For DM calls: the other user's ID (used for offline check) */
  dmOtherUserId?: string;
  /** Whether expanded video mode is active */
  videoExpanded?: boolean;
  /** Callback to toggle expanded video mode */
  onToggleExpand?: () => void;
  /** Whether any camera is active in the current call */
  hasCameras?: boolean;
  /** Whether the chat overlay is open (only relevant when videoExpanded) */
  chatOverlayOpen?: boolean;
  /** Callback to toggle chat overlay */
  onToggleChatOverlay?: () => void;
}

function reasonToMessage(reason: JoinCallFailReason): string {
  switch (reason) {
    case 'already_in_call': return 'Leave current call first.';
    case 'connecting': return 'Already connecting.';
    case 'offline': return 'User is offline.';
    case 'token_failed': return 'Failed to get call token.';
    case 'connect_failed': return 'Failed to connect. Try again.';
  }
}

export function CallControls({
  scope,
  canCall,
  dmOtherUserId,
  videoExpanded,
  onToggleExpand,
  hasCameras,
  chatOverlayOpen,
  onToggleChatOverlay,
}: CallControlsProps) {
  const {
    state,
    joinCall,
    leaveCall,
    toggleMute,
    toggleCamera,
    toggleBlur,
    getActiveCall,
  } = useCall();
  const { navigateToRoom, navigateToDm } = useNavigation();
  const { user } = useAuth();

  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<{ message: string; reason: JoinCallFailReason } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Spec 40-voice §"multi-call error" (line 319): when a user clicks CALL/
  // JOIN CALL while already in a different call, show `Leave current call
  // first.` with a `[ GO TO CALL ]` link navigating to the active call's
  // conversation scope. Mirrors AppShell.navigateToCall: DM scope.id is a
  // directConversationId, not a userId — we recover the peer userId from
  // callState.participants (same technique as AppShell:207-220).
  const navigateToActiveCall = useCallback(() => {
    const activeScope = state.activeScope;
    if (!activeScope) return;
    if (activeScope.type === 'room') {
      navigateToRoom(activeScope.id);
    } else {
      const otherParticipant = state.participants.find((p) => p.userId !== user?.id);
      if (otherParticipant) {
        navigateToDm(otherParticipant.userId);
      }
    }
  }, [state.activeScope, state.participants, user?.id, navigateToRoom, navigateToDm]);

  const scopeKey = scopeToKey(scope);
  const activeCall = getActiveCall(scopeKey);
  const isInThisCall =
    state.activeScope !== null && scopeToKey(state.activeScope) === scopeKey;
  const hasActiveCall = !!activeCall;

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  // Clear error after 3 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  const handleJoin = useCallback(
    async (withCamera: boolean) => {
      setShowDropdown(false);
      setError(null);

      const result = await joinCall(scope, withCamera, dmOtherUserId);
      if (!result.ok && result.reason) {
        setError({ message: reasonToMessage(result.reason), reason: result.reason });
      }
    },
    [scope, joinCall, dmOtherUserId]
  );

  // CGL-004: The earlier Modal-based "CameraJoinPrompt" flow was never wired
  // in — `setShowCameraJoinPrompt(true)` is not called from anywhere. The
  // actual UX is a dropdown item ("Join with camera") below. Dead code +
  // component file removed. Spec 45-video §45.2 needs to be updated to
  // describe the dropdown flow instead of the modal (tracked in spec
  // update pass).

  if (!canCall) return null;

  // ── In-call controls ──────────────────────────────────

  if (isInThisCall) {
    const isReconnecting =
      state.connectionState === ConnectionState.Reconnecting;
    const qualityColor =
      state.connectionQuality === ConnectionQuality.Poor
        ? 'var(--warning)'
        : isReconnecting
          ? 'var(--error)'
          : 'var(--success)';

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        {/* Connection quality indicator */}
        {isReconnecting ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--error)',
            }}
            data-testid="call-reconnecting"
          >
            Reconnecting...
          </span>
        ) : (
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              background: qualityColor,
              borderRadius: '50%',
              flexShrink: 0,
            }}
            data-testid="call-quality"
            title={`Connection: ${state.connectionQuality}`}
          />
        )}

        {state.joinedAt && <CallDurationTimer startedAt={state.joinedAt} />}

        {/* Mute toggle */}
        <IconButton
          icon={state.isMuted ? MicOff : Mic}
          label={state.isMuted ? 'Unmute microphone' : 'Mute microphone'}
          color={state.isMuted ? 'var(--text-muted)' : 'var(--accent)'}
          onClick={toggleMute}
        />

        {/* Camera toggle */}
        <IconButton
          icon={state.hasCamera ? Camera : CameraOff}
          label={state.hasCamera ? 'Turn off camera' : 'Turn on camera'}
          color={state.hasCamera ? 'var(--accent)' : 'var(--text-muted)'}
          onClick={toggleCamera}
        />

        {/* Background blur toggle -- only visible when camera is on */}
        {state.hasCamera && (
          <IconButton
            icon={Sparkles}
            label="Toggle background blur"
            color={state.blurEnabled ? 'var(--accent)' : 'var(--text-muted)'}
            onClick={toggleBlur}
          />
        )}

        {/* Expand/collapse video -- visible when in call and >=1 camera active */}
        {isInThisCall && hasCameras && onToggleExpand && (
          <IconButton
            icon={videoExpanded ? Minimize2 : Maximize2}
            label={videoExpanded ? 'Collapse video' : 'Expand video'}
            color={videoExpanded ? 'var(--accent)' : 'var(--text-muted)'}
            onClick={onToggleExpand}
          />
        )}

        {/* Chat overlay toggle -- visible only in expanded mode */}
        {videoExpanded && onToggleChatOverlay && (
          <IconButton
            icon={MessageSquare}
            label={chatOverlayOpen ? 'Hide chat' : 'Show chat'}
            color={chatOverlayOpen ? 'var(--accent)' : 'var(--text-muted)'}
            onClick={onToggleChatOverlay}
          />
        )}

        {/* Leave call -- always red */}
        <IconButton
          icon={PhoneOff}
          label="Leave call"
          color="var(--error)"
          onClick={leaveCall}
        />
      </div>
    );
  }

  // ── Join call button ──────────────────────────────────

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {error && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--error)',
          }}
        >
          {error.message}
          {error.reason === 'already_in_call' && state.activeScope && (
            <button
              type="button"
              onClick={navigateToActiveCall}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--accent)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.textDecoration = 'none';
              }}
            >
              [ GO TO CALL ]
            </button>
          )}
        </span>
      )}

      {/* Participant count if active call */}
      {hasActiveCall && activeCall && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--accent-dim)',
          }}
        >
          {activeCall.participants.length} in call
        </span>
      )}

      <div ref={dropdownRef} style={{ position: 'relative' }}>
        {state.isConnecting ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              padding: 'var(--space-2) var(--space-3)',
            }}
          >
            connecting...
          </span>
        ) : (
          <IconButton
            icon={Phone}
            label={hasActiveCall ? 'Join call' : 'Start call'}
            color="var(--accent)"
            onClick={() => setShowDropdown((v) => !v)}
          />
        )}

        {showDropdown && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 'var(--space-1)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              zIndex: 50,
              minWidth: '180px',
            }}
          >
            <button
              type="button"
              onClick={() => handleJoin(false)}
              style={dropdownItemStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-surface)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              Join (audio only)
            </button>
            <button
              type="button"
              onClick={() => handleJoin(true)}
              style={dropdownItemStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-surface)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              Join with camera
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared Styles ────────────────────────────────────────

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border-default)',
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 150ms',
};
