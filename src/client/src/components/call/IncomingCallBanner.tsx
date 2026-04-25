/**
 * IncomingCallBanner — Shows when the other DM participant has started a call
 *
 * Per spec 40.8: "{username} started a call [ JOIN ] [ IGNORE ]"
 * - IGNORE dismisses the banner locally (does not end call)
 * - Banner disappears when: user joins, caller leaves, or user clicks IGNORE
 */

import { useCallback } from 'react';
import { Phone } from 'lucide-react';
import type { CallScope } from '@huddle/shared';
import { useCall } from '../../stores/call';
import { IconButton } from '../ui/IconButton';

interface IncomingCallBannerProps {
  callerUsername: string;
  directId: string;
  onDismiss: () => void;
}

export function IncomingCallBanner({
  callerUsername,
  directId,
  onDismiss,
}: IncomingCallBannerProps) {
  const { joinCall, state } = useCall();

  const handleJoin = useCallback(async () => {
    const scope: CallScope = { type: 'direct', id: directId };
    const result = await joinCall(scope, false);
    if (result.ok) {
      onDismiss();
    }
  }, [directId, joinCall, onDismiss]);

  const isConnecting = state.isConnecting;

  return (
    <div
      style={{
        flexShrink: 0,
        padding: 'var(--space-2) var(--space-4)',
        borderTop: '1px solid var(--accent-muted)',
        background: 'var(--bg-surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
      }}
      data-testid="incoming-call-banner"
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-primary)',
        }}
      >
        {callerUsername} started a call
      </span>

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        {isConnecting ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
            }}
          >
            connecting...
          </span>
        ) : (
          <IconButton
            icon={Phone}
            label="Join call"
            color="var(--success)"
            size={16}
            onClick={handleJoin}
            style={{ minWidth: '32px', minHeight: '32px', padding: '4px' }}
          />
        )}
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: 'var(--space-1) var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            cursor: 'pointer',
            transition: 'background 150ms, color 150ms',
          }}
        >
          [ IGNORE ]
        </button>
      </div>
    </div>
  );
}
