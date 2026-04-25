import { useState, type FormEvent } from 'react';
import { useAuth } from '../stores/auth';
import { useSchweinchen } from '../hooks/useSchweinchen';

interface LoginPageProps {
  onSwitchToSignup: () => void;
}

export function LoginPage({ onSwitchToSignup }: LoginPageProps) {
  const { login } = useAuth();
  const { checkAndShow, SchweinModal } = useSchweinchen();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [hasLoginError, setHasLoginError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function doLogin() {
    setError('');
    setSubmitting(true);
    const result = await login({ username, password });
    if (!result.ok) {
      setError(result.error);
      setHasLoginError(true);
    }
    setSubmitting(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      setError('Username and password required');
      setHasLoginError(true);
      return;
    }

    // Check for schweinchen before proceeding
    const isSchweinchen = checkAndShow(username, () => {
      doLogin();
    });

    if (!isSchweinchen) {
      await doLogin();
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg-base)' }}
    >
      <SchweinModal />
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
            <span style={{ color: 'var(--text-secondary)' }}>0xFF </span>
            <span style={{ color: 'var(--accent)' }}>LOGIN</span>
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

        <form onSubmit={handleSubmit}>
          {/* Username */}
          <div className="mb-4">
            <label
              htmlFor="login-username"
              style={{
                display: 'block',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                marginBottom: 'var(--space-1)',
              }}
            >
              username
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setHasLoginError(false);
                setError('');
              }}
              disabled={submitting}
              style={{
                width: '100%',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: `1px solid ${hasLoginError ? 'var(--error)' : 'var(--border-default)'}`,
                borderRadius: 0,
                padding: 'var(--space-2) var(--space-3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-base)',
                outline: 'none',
              }}
              onFocus={(e) => {
                if (!hasLoginError) {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.boxShadow = 'var(--glow-ring)';
                }
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = hasLoginError
                  ? 'var(--error)'
                  : 'var(--border-default)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </div>

          {/* Password */}
          <div className="mb-4">
            <label
              htmlFor="login-password"
              style={{
                display: 'block',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                marginBottom: 'var(--space-1)',
              }}
            >
              password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setHasLoginError(false);
                setError('');
              }}
              disabled={submitting}
              style={{
                width: '100%',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: `1px solid ${hasLoginError ? 'var(--error)' : 'var(--border-default)'}`,
                borderRadius: 0,
                padding: 'var(--space-2) var(--space-3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-base)',
                outline: 'none',
              }}
              onFocus={(e) => {
                if (!hasLoginError) {
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.boxShadow = 'var(--glow-ring)';
                }
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = hasLoginError
                  ? 'var(--error)'
                  : 'var(--border-default)';
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
            {submitting ? 'authenticating...' : 'LOGIN'}
          </button>
        </form>

        {/* Switch to signup */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onSwitchToSignup}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              textDecoration: 'none',
              letterSpacing: '0.02em',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            create account
          </button>
        </div>
      </div>
    </div>
  );
}
