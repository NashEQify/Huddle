/**
 * IncomingCallOverlay -- Global overlay for incoming DM calls
 *
 * Shows when incomingDmCall is set AND the user is NOT already in a call.
 * Fixed position, centered near top, plays ring sound until dismissed.
 * TTY aesthetic: monospace, mint/sage on dark blue-grey, border-radius: 0.
 */

import { useEffect, useState } from 'react';
import { Phone, PhoneMissed } from 'lucide-react';
import { useCall } from '../../stores/call';
import { useNavigation } from '../../stores/navigation';
import { startCallRingLoop } from '../../lib/notification-sound';
import { requestNotificationPermission, showNotification } from '../../lib/notifications';
import { api } from '../../lib/api';
import { IconButton } from '../ui/IconButton';
import type { UserResponse } from '@huddle/shared';

export function IncomingCallOverlay() {
  const {
    incomingDmCall,
    acceptIncomingCall,
    declineIncomingCall,
    state,
  } = useCall();
  const { navigateToDm } = useNavigation();
  const [callerUsername, setCallerUsername] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  const isInCall = state.activeScope !== null;
  const shouldShow = incomingDmCall !== null && !isInCall;

  // Fetch caller username
  useEffect(() => {
    if (!incomingDmCall) {
      setCallerUsername(null);
      return;
    }

    let cancelled = false;
    api.get<{ users: UserResponse[] }>('/api/users').then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const found = result.data.users.find(
          (u) => u.id === incomingDmCall.callerId
        );
        if (found) {
          setCallerUsername(found.username);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [incomingDmCall?.callerId]);

  // Play ring sound while overlay is visible
  useEffect(() => {
    if (!shouldShow) return;
    const stopRing = startCallRingLoop();
    return stopRing;
  }, [shouldShow]);

  // Browser notification for incoming call.
  // Per spec 20.4 + 40.8: only fire when the page is NOT currently focused.
  // `showNotification` also gates internally, but gating up here avoids
  // prompting for notification permission when the user is focused and the
  // in-app overlay is already visible — the permission dialog on top of the
  // visible overlay is redundant and noisy. (F-CSD-4011)
  //
  // C-005: Cancel the permission-Promise on unmount / shouldShow=false.
  // Without this, a user who declines the call while the permission prompt
  // is still open and THEN grants permission would see a ghost notification
  // for a call that no longer exists. Also add a .catch so a browser-reject
  // doesn't surface as an unhandled promise rejection.
  useEffect(() => {
    if (!shouldShow) return;
    if (document.hasFocus()) return;
    let cancelled = false;
    const name = callerUsername ?? 'Someone';
    requestNotificationPermission()
      .then((granted) => {
        if (cancelled) return;
        if (granted) {
          showNotification('Incoming Call', `${name} is calling you`, () => {
            window.focus();
          });
        }
      })
      .catch((err) => {
        console.warn('[incoming-call] notification permission error', err);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldShow, callerUsername]);

  // Ring timeout: auto-decline after 30s (spec 40.8)
  useEffect(() => {
    if (!shouldShow) return;
    const timer = setTimeout(() => {
      declineIncomingCall();
    }, 30_000);
    return () => clearTimeout(timer);
  }, [shouldShow, declineIncomingCall]);

  // Reset accepting state when overlay hides
  useEffect(() => {
    if (!shouldShow) {
      setIsAccepting(false);
    }
  }, [shouldShow]);

  if (!shouldShow || !incomingDmCall) return null;

  const displayName = callerUsername ?? 'someone';

  const handleAccept = async () => {
    setIsAccepting(true);
    const result = await acceptIncomingCall();
    if (result.ok) {
      navigateToDm(incomingDmCall.callerId);
    } else {
      setIsAccepting(false);
    }
  };

  const handleDecline = () => {
    declineIncomingCall();
  };

  return (
    <div
      data-testid="incoming-call-overlay"
      style={{
        position: 'fixed',
        top: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'var(--bg-surface)',
        border: '1px solid var(--accent)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minWidth: '280px',
        maxWidth: '400px',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--accent)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        [ INCOMING CALL ]
      </span>

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-base)',
          color: 'var(--text-primary)',
        }}
      >
        {displayName} is calling...
      </span>

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        {isAccepting ? (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
            }}
          >
            connecting...
          </span>
        ) : (
          <button
            type="button"
            aria-label="Accept call"
            onClick={handleAccept}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              background: 'transparent',
              color: 'var(--success)',
              border: '1px solid var(--success)',
              borderRadius: 0,
              padding: 'var(--space-2) var(--space-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <Phone size={16} /> Accept
          </button>
        )}

        <button
          type="button"
          aria-label="Decline call"
          disabled={isAccepting}
          onClick={handleDecline}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            background: 'transparent',
            color: 'var(--error)',
            border: '1px solid var(--error)',
            borderRadius: 0,
            padding: 'var(--space-2) var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            cursor: isAccepting ? 'not-allowed' : 'pointer',
            opacity: isAccepting ? 0.5 : 1,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <PhoneMissed size={16} /> Decline
        </button>
      </div>
    </div>
  );
}
