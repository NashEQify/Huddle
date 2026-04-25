/**
 * IconButton -- Reusable icon button following Spec 05.3 pattern.
 *
 * 44px min touch target, hover with bg-elevated, no border-radius.
 * Every icon button gets aria-label + title for accessibility/tooltip.
 */

import type { LucideIcon } from 'lucide-react';
import { useState, type CSSProperties, type MouseEvent } from 'react';

interface IconButtonProps {
  icon: LucideIcon;
  /** Describes the action (used for aria-label + title tooltip) */
  label: string;
  /** CSS color value or CSS variable. Defaults to var(--text-primary) */
  color?: string;
  /** Icon size in px. Defaults to 18 */
  size?: number;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Additional inline styles merged onto the button */
  style?: CSSProperties;
  'data-testid'?: string;
}

export function IconButton({
  icon: Icon,
  label,
  color = 'var(--text-primary)',
  size = 18,
  disabled = false,
  onClick,
  style,
  ...rest
}: IconButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        minWidth: '44px',
        minHeight: '44px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isHovered && !disabled ? 'var(--bg-elevated)' : 'transparent',
        border: 'none',
        borderRadius: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--text-muted)' : color,
        opacity: disabled ? 0.5 : 1,
        padding: 'var(--space-2)',
        transition: 'background 150ms, color 150ms',
        flexShrink: 0,
        ...style,
      }}
      data-testid={rest['data-testid']}
    >
      <Icon size={size} strokeWidth={1.5} />
    </button>
  );
}
