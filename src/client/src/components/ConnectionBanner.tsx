import { useWs } from '../stores/ws';

export function ConnectionBanner() {
  const { isConnected } = useWs();

  if (isConnected) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border-default)',
        padding: 'var(--space-2) var(--space-4)',
        textAlign: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        color: 'var(--warning)',
        letterSpacing: '0.02em',
        animation: 'banner-fade-in 150ms ease-in',
      }}
    >
      Connection lost &mdash; reconnecting...
    </div>
  );
}
