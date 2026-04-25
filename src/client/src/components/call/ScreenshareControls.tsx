/**
 * ScreenshareControls -- Room and DM screenshare button
 *
 * Per spec 50.2: auto-joins call, no confirmation prompt
 * Per spec 50.2: one per room/DM, takeover with confirmation
 */

import { useState, useCallback } from 'react';
import { MonitorUp, MonitorX } from 'lucide-react';
import { useScreenshare } from '../../stores/screenshare';
import { useAuth } from '../../stores/auth';
import { IconButton } from '../ui/IconButton';

interface ScreenshareControlsProps {
  /** Room screenshare: pass roomId */
  roomId?: string;
  roomName?: string;
  /** DM screenshare: pass directId */
  directId?: string;
}

// getDisplayMedia not available on iOS (any browser) and older Android
const canScreenShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

export function ScreenshareControls({ roomId, directId }: ScreenshareControlsProps) {
  const { user } = useAuth();
  const {
    startRoomScreenshare,
    startDmScreenshare,
    stopScreenshare,
    getRoomScreenshare,
    getDmScreenshare,
    state,
  } = useScreenshare();

  const [showTakeoverConfirm, setShowTakeoverConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = roomId ? 'room' : 'direct';
  const scopeId = roomId ?? directId ?? '';

  const activeSS = mode === 'room'
    ? getRoomScreenshare(scopeId)
    : getDmScreenshare(scopeId);

  const isOwnSS =
    state.localScreenshareMode === mode &&
    state.localScreenshareScopeId === scopeId;

  // ── Start Screenshare ──────────────────────────────────

  const handleStartSS = useCallback(async () => {
    setError(null);

    // Check if there's an existing screenshare by someone else
    if (activeSS && activeSS.userId !== user?.id) {
      setShowTakeoverConfirm(true);
      return;
    }

    const result = mode === 'room'
      ? await startRoomScreenshare(scopeId)
      : await startDmScreenshare(scopeId);
    if (!result.ok) {
      setError(result.error || 'Failed to start screenshare.');
      setTimeout(() => setError(null), 3000);
    }
  }, [scopeId, mode, activeSS, user?.id, startRoomScreenshare, startDmScreenshare]);

  const handleTakeoverConfirm = useCallback(async () => {
    setShowTakeoverConfirm(false);
    setError(null);

    const result = mode === 'room'
      ? await startRoomScreenshare(scopeId)
      : await startDmScreenshare(scopeId);
    if (!result.ok) {
      setError(result.error || 'Failed to take over screenshare.');
      setTimeout(() => setError(null), 3000);
    }
  }, [scopeId, mode, startRoomScreenshare, startDmScreenshare]);

  // ── Stop Screenshare ────────────────────────────────────

  const handleStopSS = useCallback(() => {
    stopScreenshare();
  }, [stopScreenshare]);

  if (!canScreenShare) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {error && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--error)',
          }}
        >
          {error}
        </span>
      )}

      {/* Screenshare button */}
      {isOwnSS ? (
        <IconButton
          icon={MonitorX}
          label="Stop sharing"
          color="var(--error)"
          onClick={handleStopSS}
        />
      ) : (
        <IconButton
          icon={MonitorUp}
          label="Share screen"
          color="var(--text-primary)"
          disabled={state.isStarting}
          onClick={handleStartSS}
        />
      )}

      {/* Takeover Confirmation */}
      {showTakeoverConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(10, 10, 20, 0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowTakeoverConfirm(false)}
        >
          <div
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              padding: 'var(--space-6)',
              maxWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-base)',
                color: 'var(--text-primary)',
                marginBottom: 'var(--space-4)',
              }}
            >
              A screenshare is active. Starting yours will end the current screenshare. Continue?
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                onClick={handleTakeoverConfirm}
                style={{
                  ...btnStyle,
                  color: 'var(--accent)',
                  borderColor: 'var(--accent)',
                }}
              >
                [ YES, TAKE OVER ]
              </button>
              <button
                type="button"
                onClick={() => setShowTakeoverConfirm(false)}
                style={{
                  ...btnStyle,
                  color: 'var(--text-secondary)',
                  borderColor: 'var(--border-default)',
                }}
              >
                [ CANCEL ]
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 0,
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  transition: 'background 150ms, color 150ms, border-color 150ms',
  whiteSpace: 'nowrap',
};
