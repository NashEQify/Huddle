import { useState, type FormEvent } from 'react';
import { useAuth } from '../stores/auth';
import { useSchweinchen } from '../hooks/useSchweinchen';

interface SignupPageProps {
  onSwitchToLogin: () => void;
}

const USERNAME_REGEX = /^[a-zA-Z0-9_ -]{2,24}$/;
const CONSECUTIVE_SPACES = /  /;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupPage({ onSwitchToLogin }: SignupPageProps) {
  const { signup } = useAuth();
  const { checkAndShow, SchweinModal } = useSchweinchen();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function validateField(field: string, value: string) {
    const errs = { ...fieldErrors };
    switch (field) {
      case 'username': {
        const trimmed = value.trim();
        if (trimmed && (!USERNAME_REGEX.test(trimmed) || CONSECUTIVE_SPACES.test(trimmed))) {
          errs.username = '2-24 chars: letters, numbers, space, underscore, hyphen';
        } else {
          delete errs.username;
        }
      }
        break;
      case 'email':
        if (value && !EMAIL_REGEX.test(value)) {
          errs.email = 'Invalid email format';
        } else {
          delete errs.email;
        }
        break;
      case 'password':
        if (value && (value.length < 8 || value.length > 64)) {
          errs.password = '8-64 characters required';
        } else {
          delete errs.password;
        }
        if (passwordRepeat && value !== passwordRepeat) {
          errs.passwordRepeat = 'Passwords do not match';
        } else {
          delete errs.passwordRepeat;
        }
        break;
      case 'passwordRepeat':
        if (value && value !== password) {
          errs.passwordRepeat = 'Passwords do not match';
        } else {
          delete errs.passwordRepeat;
        }
        break;
    }
    setFieldErrors(errs);
  }

  async function doSignup() {
    setError('');
    setSubmitting(true);
    const result = await signup({ username: username.trim(), email, password, passwordRepeat });
    if (!result.ok) {
      setError(result.error);
      // "Name already taken" → highlight username field
      if (result.error.toLowerCase().includes('taken')) {
        setFieldErrors((prev) => ({ ...prev, username: result.error }));
      }
    }
    setSubmitting(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    // Client-side validation — set per-field errors for red borders
    const errs: Record<string, string> = {};

    if (!username || !email || !password || !passwordRepeat) {
      if (!username) errs.username = 'Required';
      if (!email) errs.email = 'Required';
      if (!password) errs.password = 'Required';
      if (!passwordRepeat) errs.passwordRepeat = 'Required';
      setFieldErrors(errs);
      setError('All fields are required');
      return;
    }
    const trimmedUsername = username.trim();
    if (!USERNAME_REGEX.test(trimmedUsername) || CONSECUTIVE_SPACES.test(trimmedUsername)) {
      setFieldErrors({ username: '2-24 chars, letters, numbers, space, underscore, hyphen' });
      setError('Username: 2-24 chars, letters, numbers, space, underscore, hyphen');
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      setFieldErrors({ email: 'Invalid email format' });
      setError('Invalid email format');
      return;
    }
    if (password.length < 8 || password.length > 64) {
      setFieldErrors({ password: '8-64 characters required' });
      setError('Password must be 8-64 characters');
      return;
    }
    if (password !== passwordRepeat) {
      setFieldErrors({ passwordRepeat: 'Passwords do not match' });
      setError('Passwords do not match');
      return;
    }

    // Check for schweinchen before proceeding
    const isSchweinchen = checkAndShow(username, () => {
      doSignup();
    });

    if (!isSchweinchen) {
      await doSignup();
    }
  }

  function renderInput(
    id: string,
    label: string,
    type: string,
    value: string,
    onChange: (v: string) => void,
    autoComplete: string,
    autoFocus?: boolean
  ) {
    const fieldError = fieldErrors[id];
    return (
      <div className="mb-4">
        <label
          htmlFor={id}
          style={{
            display: 'block',
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-1)',
          }}
        >
          {label}
        </label>
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            validateField(id, e.target.value);
          }}
          onBlur={() => validateField(id, value)}
          disabled={submitting}
          style={{
            width: '100%',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: `1px solid ${fieldError ? 'var(--error)' : 'var(--border-default)'}`,
            borderRadius: 0,
            padding: 'var(--space-2) var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-base)',
            outline: 'none',
          }}
          onFocus={(e) => {
            if (!fieldError) {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = 'var(--glow-ring)';
            }
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.borderColor = fieldError
              ? 'var(--error)'
              : 'var(--border-default)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        {fieldError && (
          <div
            style={{
              color: 'var(--error)',
              fontSize: 'var(--text-xs)',
              marginTop: 'var(--space-1)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {fieldError}
          </div>
        )}
      </div>
    );
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
            <span style={{ color: 'var(--text-secondary)' }}>0x01 </span>
            <span style={{ color: 'var(--accent)' }}>SIGN UP</span>
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
          {renderInput(
            'username',
            'username',
            'text',
            username,
            setUsername,
            'username',
            true
          )}
          {renderInput('email', 'email', 'email', email, setEmail, 'email')}
          {renderInput(
            'password',
            'password',
            'password',
            password,
            setPassword,
            'new-password'
          )}
          {renderInput(
            'passwordRepeat',
            'repeat password',
            'password',
            passwordRepeat,
            setPasswordRepeat,
            'new-password'
          )}

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
            {submitting ? 'creating account...' : 'SIGN UP'}
          </button>
        </form>

        {/* Switch to login */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onSwitchToLogin}
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
            already have an account? log in
          </button>
        </div>
      </div>
    </div>
  );
}
