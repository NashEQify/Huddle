import type { ReactionGroup } from '@huddle/shared';

interface ReactionBadgesProps {
  reactions: ReactionGroup[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
}

export function ReactionBadges({ reactions, currentUserId, onToggle }: ReactionBadgesProps) {
  if (reactions.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        justifyContent: 'flex-start',
        overflowX: 'auto',
        gap: '4px',
        margin: 0,
        padding: 0,
      }}
    >
      {reactions.map((group) => {
        const hasReacted = group.userIds.includes(currentUserId);
        return (
          <button
            key={group.emoji}
            type="button"
            onClick={() => onToggle(group.emoji)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 6px',
              background: hasReacted ? 'var(--accent-glow)' : 'transparent',
              border: `1px solid ${hasReacted ? 'var(--accent-dim)' : 'var(--border-default)'}`,
              borderRadius: 0,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: hasReacted ? 'var(--accent)' : 'var(--text-secondary)',
              transition: 'background 150ms, border-color 150ms',
              lineHeight: 1.4,
            }}
            onMouseEnter={(e) => {
              if (!hasReacted) {
                e.currentTarget.style.borderColor = 'var(--accent-muted)';
              }
            }}
            onMouseLeave={(e) => {
              if (!hasReacted) {
                e.currentTarget.style.borderColor = 'var(--border-default)';
              }
            }}
            aria-label={`${group.emoji} ${group.count} reaction${group.count > 1 ? 's' : ''}`}
          >
            <span style={{ fontSize: '14px' }}>{group.emoji}</span>
            <span>{group.count}</span>
          </button>
        );
      })}
    </div>
  );
}
