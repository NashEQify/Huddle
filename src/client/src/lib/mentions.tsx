import type { ReactNode } from 'react';

/**
 * Parse message content for @username mentions and return ReactNode array
 * with highlighted mentions.
 */
export function parseMentions(
  text: string,
  usernames: string[],
  currentUsername?: string
): ReactNode[] {
  if (!text || usernames.length === 0) {
    return [text];
  }

  // Build a regex that matches @username patterns for known users
  // Sort by length descending so longer usernames match first
  const sortedUsernames = [...usernames].sort((a, b) => b.length - a.length);
  const escapedNames = sortedUsernames.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const pattern = new RegExp(`(@(?:${escapedNames.join('|')}))(?=\\s|$|[.,!?;:])`, 'gi');

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const mentionText = match[1];
    const mentionedName = mentionText.slice(1); // Remove @
    const isSelfMention =
      currentUsername !== undefined &&
      mentionedName.toLowerCase() === currentUsername.toLowerCase();

    parts.push(
      <span
        key={`mention-${match.index}`}
        style={{
          color: 'var(--accent)',
          fontWeight: 700,
          background: isSelfMention ? 'var(--accent-glow)' : 'transparent',
          padding: isSelfMention ? '0 2px' : undefined,
        }}
      >
        {mentionText}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}
