import { useEffect, useState } from 'react';
import type { WelcomeData } from '@huddle/shared';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { usePresence } from '../stores/presence';

export function WelcomeScreen() {
  const { user, profile } = useAuth();
  const { onlineUserIds } = usePresence();
  const [data, setData] = useState<WelcomeData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<WelcomeData>('/api/welcome').then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
      } else {
        setError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  // Live online count from presence store (overrides API snapshot)
  const liveOnlineCount = onlineUserIds.size;

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={boxStyle}>
          <span style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)' }}>
            error: failed to load welcome data
          </span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={containerStyle}>
        <div style={boxStyle}>
          <span
            style={{
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
            }}
          >
            loading...
          </span>
        </div>
      </div>
    );
  }

  const lastLoginDisplay = data.lastLoginAt
    ? formatLastLogin(data.lastLoginAt)
    : 'never \u2014 welcome aboard';

  const callsDisplay =
    data.activeCalls > 0 ? String(data.activeCalls) : 'none';

  const screensharesDisplay =
    data.activeScreenshares > 0 ? String(data.activeScreenshares) : 'none';

  const title = profile?.title || null;

  return (
    <div style={containerStyle}>
      <div style={boxStyle}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div
            style={{
              color: 'var(--accent)',
              fontWeight: 700,
              fontSize: 'var(--text-lg)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.3,
            }}
          >
            Huddle v{__APP_VERSION__}
          </div>
          <div
            style={{
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              marginTop: 'var(--space-1)',
            }}
          >
            Last login: {lastLoginDisplay}
          </div>
        </div>

        {/* Welcome line */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-base)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <span style={{ color: 'var(--text-primary)' }}>Welcome back, </span>
          <span style={{ color: 'var(--accent)', fontWeight: 500 }}>
            {user.username}
          </span>
          {title ? (
            <span style={{ color: 'var(--text-muted)' }}>
              {' "'}
              {title}
              {'"'}
            </span>
          ) : null}
        </div>

        {/* System Status Section */}
        <SectionHeader label="SYSTEM STATUS" />
        <div style={sectionBodyStyle}>
          <StatusLine label="Users online">
            <span style={{ color: 'var(--accent)' }}>{liveOnlineCount}</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              /{data.totalUsers}
            </span>
          </StatusLine>
          <StatusLine label="Active calls">
            <span style={{ color: 'var(--text-secondary)' }}>
              {callsDisplay}
            </span>
          </StatusLine>
          <StatusLine label="Screenshares">
            <span style={{ color: 'var(--text-secondary)' }}>
              {screensharesDisplay}
            </span>
          </StatusLine>
        </div>

        {/* MOTD Section */}
        {data.motdQuote ? (
          <>
            <SectionHeader label="MOTD" />
            <div style={sectionBodyStyle}>
              <div
                style={{
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-base)',
                  fontStyle: 'italic',
                  lineHeight: 1.6,
                }}
              >
                &ldquo;{data.motdQuote.text}&rdquo;
              </div>
              <div
                style={{
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-sm)',
                  textAlign: 'right',
                  marginTop: 'var(--space-1)',
                }}
              >
                &mdash; {data.motdQuote.attribution}
              </div>
            </div>
          </>
        ) : null}

        {/* Tip */}
        <div
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            marginTop: 'var(--space-4)',
          }}
        >
          Tip: {data.tip}
        </div>
      </div>
    </div>
  );
}

// ── Sub-Components ──────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-secondary)',
        marginBottom: 'var(--space-2)',
        letterSpacing: '0.05em',
      }}
    >
      {'\u2500\u2500 '}
      {label}
      {' \u2500\u2500'}
    </div>
  );
}

function StatusLine({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-base)',
        lineHeight: 1.6,
      }}
    >
      <span style={{ color: 'var(--text-primary)' }}>{label}: </span>
      {children}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  padding: 'var(--space-6)',
};

const boxStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 0,
  padding: 'var(--space-6)',
  maxWidth: 600,
  width: '100%',
};

const sectionBodyStyle: React.CSSProperties = {
  marginBottom: 'var(--space-4)',
  paddingLeft: 'var(--space-2)',
};

// ── Helpers ─────────────────────────────────────────────

function formatLastLogin(isoString: string): string {
  const date = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');

  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());

  return `${y}-${m}-${d} ${h}:${min}`;
}
