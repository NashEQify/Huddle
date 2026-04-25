import { type ReactNode } from 'react';

// Regex to match URLs -- comprehensive but not overly greedy
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/**
 * Parse text and replace URLs with clickable links.
 * Returns an array of ReactNode (strings + <a> elements).
 */
export function linkifyText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  URL_REGEX.lastIndex = 0;

  while ((match = URL_REGEX.exec(text)) !== null) {
    // Text before the URL
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const url = match[0];
    // Clean trailing punctuation that's likely not part of the URL
    const cleaned = url.replace(/[.,;:!?)]+$/, '');
    const trailing = url.slice(cleaned.length);

    parts.push(
      <a
        key={`link-${match.index}`}
        href={cleaned}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--accent)',
          textDecoration: 'none',
          borderBottom: '1px solid var(--accent-muted)',
          transition: 'border-color 150ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent-muted)';
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {cleaned}
      </a>
    );

    if (trailing) {
      parts.push(trailing);
    }

    lastIndex = match.index + url.length;
  }

  // Remaining text after last URL
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}
