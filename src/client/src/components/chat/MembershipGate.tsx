import { useState, useEffect } from 'react';
import type { MembershipState } from '@huddle/shared';
import type { ReactNode } from 'react';

interface MembershipGateProps {
  membership: MembershipState | null;
  hasPassword: boolean;
  onJoin: (password?: string) => Promise<{ code: string; message: string } | undefined>;
  children: ReactNode;
}

export function MembershipGate({ membership, hasPassword, onJoin, children }: MembershipGateProps) {
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  // Reset password state when hasPassword changes
  useEffect(() => {
    setPasswordInput('');
    setPasswordError(null);
  }, [hasPassword]);

  // Joined or left: show content (left = read-only, handled by parent)
  if (membership === 'joined' || membership === 'left') {
    return <>{children}</>;
  }

  const handleJoin = async () => {
    setPasswordError(null);
    setIsJoining(true);
    const error = await onJoin(hasPassword ? passwordInput : undefined);
    setIsJoining(false);
    if (error) {
      setPasswordError(error.message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleJoin();
    }
  };

  // Not joined / null: show join CTA
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-8)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: 'var(--space-2)' }}>
          <span style={{ color: 'var(--text-secondary)' }}>[ </span>
          <span style={{ color: 'var(--text-secondary)' }}>0x00 </span>
          <span style={{ color: 'var(--accent)' }}>NOT A MEMBER</span>
          <span style={{ color: 'var(--text-secondary)' }}> ]</span>
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          {hasPassword
            ? 'This room is password-protected.'
            : 'Join this room to see messages and participate.'}
        </div>
      </div>

      {hasPassword && (
        <div style={{ width: '280px', maxWidth: '100%' }}>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter room password"
            style={{
              width: '100%',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 0,
              padding: 'var(--space-2) var(--space-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-base)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = 'var(--glow-ring)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-default)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          {passwordError && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--error)',
                marginTop: 'var(--space-1)',
              }}
            >
              {passwordError}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={isJoining}
        onClick={handleJoin}
        style={{
          background: 'transparent',
          color: isJoining ? 'var(--text-muted)' : 'var(--accent)',
          border: `1px solid ${isJoining ? 'var(--border-default)' : 'var(--accent)'}`,
          borderRadius: 0,
          padding: 'var(--space-2) var(--space-4)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          cursor: isJoining ? 'not-allowed' : 'pointer',
        }}
      >
        {isJoining ? '[ JOINING... ]' : '[ JOIN ROOM ]'}
      </button>
    </div>
  );
}
