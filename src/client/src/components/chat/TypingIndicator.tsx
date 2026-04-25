import type { UserResponse } from '@huddle/shared';

interface TypingIndicatorProps {
  typingUserIds: string[];
  users: UserResponse[];
}

/**
 * Typing indicator displayed below the message list, above the input.
 * Height is reserved (fixed) to prevent layout shift.
 */
export function TypingIndicator({ typingUserIds, users }: TypingIndicatorProps) {
  // Resolve user IDs to usernames
  const userMap = new Map(users.map((u) => [u.id, u.username]));

  let text = '';
  if (typingUserIds.length === 1) {
    const name = userMap.get(typingUserIds[0]!) ?? 'Someone';
    text = `${name} is typing...`;
  } else if (typingUserIds.length === 2) {
    const name1 = userMap.get(typingUserIds[0]!) ?? 'Someone';
    const name2 = userMap.get(typingUserIds[1]!) ?? 'Someone';
    text = `${name1} and ${name2} are typing...`;
  } else if (typingUserIds.length > 2) {
    text = 'Several people are typing...';
  }

  return (
    <div
      style={{
        flexShrink: 0,
        height: '20px', // Reserved height to prevent layout shift
        padding: '0 var(--space-4)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        letterSpacing: '0.02em',
        lineHeight: '20px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        opacity: text ? 1 : 0,
        transition: 'opacity 150ms ease',
      }}
    >
      {text}
    </div>
  );
}
