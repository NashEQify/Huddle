import { useState, type FormEvent } from 'react';
import { useAuth } from '../stores/auth';

export function ForcePasswordChangePage() {
  const { changePassword } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [newPasswordRepeat, setNewPasswordRepeat] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!newPassword || !newPasswordRepeat) {
      setError('Both fields are required');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 64) {
      setError('Password must be 8-64 characters');
      return;
    }
    if (newPassword !== newPasswordRepeat) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    const result = await changePassword({ newPassword, newPasswordRepeat });
    if (!result.ok) {
      setError(result.error);
    }
    setSubmitting(false);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg-base)' }}
    >
      <div
        className="w-full max-w-sm"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          padding: 'var(--space-6)',
        }}
      >
        {/* Header */}
        <div className="mb-6">
          <div
            className="text-center mb-2"
            style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>[ </span>
            <span style={{ color: 'var(--text-secondary)' }}>0xFE </span>
            <span style={{ color: 'var(--accent)' }}>PASSWORD</span>
            <span style={{ color: 'var(--text-secondary)' }}> ]</span>
          </div>
          <div
            className="text-center"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              color: 'var(--accent)',
              letterSpacing: '0.05em',
            }}
          >
            Huddle
          </div>
        </div>

        {/* Info text */}
        <div
          className="mb-6"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-mono)',
            lineHeight: 1.5,
          }}
        >
          your password was reset by an admin. set a new password to continue.
        </div>

        <form onSubmit={handleSubmit}>
          {/* New Password */}
          <div className="mb-4">
            <label
              htmlFor="new-password"
              style={{
                display: 'block',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                marginBottom: 'var(--space-1)',
              }}
            >
              new password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={submitting}
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
          </div>

          {/* Repeat Password */}
          <div className="mb-4">
            <label
              htmlFor="repeat-password"
              style={{
                display: 'block',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                marginBottom: 'var(--space-1)',
              }}
            >
              repeat password
            </label>
            <input
              id="repeat-password"
              type="password"
              autoComplete="new-password"
              value={newPasswordRepeat}
              onChange={(e) => setNewPasswordRepeat(e.target.value)}
              disabled={submitting}
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
          </div>

          {/* Error */}
          {error && (
            <div
              className="mb-4"
              style={{
                color: 'var(--error)',
                fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              background: 'transparent',
              color: submitting ? 'var(--text-muted)' : 'var(--accent)',
              border: `1px solid ${submitting ? 'var(--border-default)' : 'var(--accent)'}`,
              borderRadius: 0,
              padding: 'var(--space-2) var(--space-4)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: submitting ? 'default' : 'pointer',
              transition: 'background 150ms, color 150ms',
            }}
            onMouseEnter={(e) => {
              if (!submitting) {
                e.currentTarget.style.background = 'var(--accent)';
                e.currentTarget.style.color = 'var(--bg-base)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = submitting
                ? 'var(--text-muted)'
                : 'var(--accent)';
            }}
          >
            {submitting ? 'saving...' : 'SET NEW PASSWORD'}
          </button>
        </form>
      </div>
    </div>
  );
}
