import { useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { useNavigation } from '../../stores/navigation';

interface CreateRoomDialogProps {
  onClose: () => void;
}

export function CreateRoomDialog({ onClose }: CreateRoomDialogProps) {
  const [name, setName] = useState('');
  const [discoverable, setDiscoverable] = useState(true);
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { navigateToRoom } = useNavigation();

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Room name is required');
      return;
    }
    if (trimmed.length > 50) {
      setError('Room name must be 50 characters or less');
      return;
    }

    const trimmedPassword = password.trim();
    if (trimmedPassword.length > 0 && trimmedPassword.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await api.post<{ room: { id: string; name: string } }>('/api/rooms', {
      name: trimmed,
      discoverable,
      ...(trimmedPassword ? { password: trimmedPassword } : {}),
    });

    if (result.ok) {
      navigateToRoom(result.data.room.id);
      onClose();
    } else {
      setError(result.error.message);
    }

    setIsSubmitting(false);
  }, [name, discoverable, password, navigateToRoom, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSubmit, onClose]
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 10, 20, 0.7)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
        }}
      />

      {/* Dialog */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 0,
          padding: 'var(--space-6)',
          width: '400px',
          maxWidth: '90vw',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
          zIndex: 101,
        }}
      >
        {/* Header */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>[ </span>
          <span style={{ color: 'var(--text-secondary)' }}>0x09 </span>
          <span style={{ color: 'var(--accent)' }}>CREATE ROOM</span>
          <span style={{ color: 'var(--text-secondary)' }}> ]</span>
        </div>

        {/* Room Name Input */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label
            htmlFor="room-name"
            style={{
              display: 'block',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-1)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Room Name
          </label>
          <input
            id="room-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={50}
            autoFocus
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
        </div>

        {/* Discoverable Toggle */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={discoverable}
              onChange={(e) => setDiscoverable(e.target.checked)}
              style={{
                accentColor: 'var(--accent)',
                cursor: 'pointer',
              }}
            />
            Discoverable (visible in sidebar for all users)
          </label>
        </div>

        {/* Password Input */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label
            htmlFor="room-password"
            style={{
              display: 'block',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-1)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Password (optional)
          </label>
          <input
            id="room-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={64}
            placeholder="Leave empty for no password"
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
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--error)',
              marginBottom: 'var(--space-3)',
            }}
          >
            {error}
          </div>
        )}

        {/* Buttons */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              borderRadius: 0,
              padding: 'var(--space-2) var(--space-4)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              transition: 'color 150ms, border-color 150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.borderColor = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-default)';
            }}
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim()}
            style={{
              background: 'transparent',
              color: name.trim() ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${name.trim() ? 'var(--accent)' : 'var(--border-default)'}`,
              borderRadius: 0,
              padding: 'var(--space-2) var(--space-4)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: name.trim() ? 'pointer' : 'default',
              transition: 'background 150ms, color 150ms',
              opacity: name.trim() ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (name.trim()) {
                e.currentTarget.style.background = 'var(--accent)';
                e.currentTarget.style.color = 'var(--bg-base)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = name.trim()
                ? 'var(--accent)'
                : 'var(--text-muted)';
            }}
          >
            [ CREATE ]
          </button>
        </div>
      </div>
    </>
  );
}
