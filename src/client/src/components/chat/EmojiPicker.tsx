import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

const EMOJI_SET = [
  // Core
  '\u{1F44D}', // thumbs up
  '\u{1F44E}', // thumbs down
  '\u{2764}\u{FE0F}', // heart
  '\u{1F602}', // joy
  '\u{1F62D}', // crying
  '\u{1F525}', // fire
  '\u{1F480}', // skull
  // Emotions
  '\u{1F624}', // angry
  '\u{1F914}', // thinking
  '\u{1F60E}', // sunglasses
  '\u{1FAE1}', // salute
  '\u{1F921}', // clown
  '\u{1F631}', // scream
  // Gaming
  '\u{1F3AE}', // gamepad
  '\u{2694}\u{FE0F}', // swords
  '\u{1F3C6}', // trophy
  '\u{1F3AF}', // target
  '\u{1F4AF}', // 100
  // Fun
  '\u{1F346}', // eggplant
  '\u{1F5FF}', // moai
  '\u{1F440}', // eyes
  '\u{1F4A9}', // poop
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function EmojiPicker({ onSelect, onClose, anchorRef }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the picker relative to the anchor element
  useLayoutEffect(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    // Picker is ~240px wide (7 * 32px + padding + gaps) and ~120px tall (3.x rows)
    const pickerWidth = 240;
    const pickerHeight = 130;

    // Default: open below the trigger button
    let top = rect.bottom + 4;
    let left = rect.right - pickerWidth;

    // If it would go below viewport, open above instead
    if (top + pickerHeight > window.innerHeight - 4) {
      top = rect.top - pickerHeight - 4;
    }
    // If it would go off the left edge, push right
    if (left < 4) {
      left = 4;
    }
    // If it would go off the right edge, push left
    if (left + pickerWidth > window.innerWidth - 4) {
      left = window.innerWidth - pickerWidth - 4;
    }

    setPos({ top, left });
  }, [anchorRef]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Also check if the click was on the anchor (toggle button)
        if (anchorRef?.current?.contains(e.target as Node)) return;
        onClose();
      }
    };
    // Use setTimeout to avoid immediate close from the click that opened the picker
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // If using portal with anchor, render fixed-position at calculated coords
  const usePortal = !!anchorRef;

  const pickerContent = (
    <div
      ref={ref}
      data-testid="emoji-picker"
      style={{
        position: usePortal ? 'fixed' : 'absolute',
        ...(usePortal && pos
          ? { top: pos.top, left: pos.left }
          : { bottom: '100%', right: 0 }),
        marginBottom: usePortal ? undefined : 'var(--space-1)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 0,
        padding: 'var(--space-2)',
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '2px',
        zIndex: 10000,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {EMOJI_SET.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onSelect(emoji);
            onClose();
          }}
          style={{
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: 0,
            padding: '4px',
            fontSize: '18px',
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            transition: 'background 150ms, border-color 150ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-surface)';
            e.currentTarget.style.borderColor = 'var(--border-default)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'transparent';
          }}
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );

  if (usePortal) {
    return createPortal(pickerContent, document.body);
  }

  return pickerContent;
}

export { EMOJI_SET };
