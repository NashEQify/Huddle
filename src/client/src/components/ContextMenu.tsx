import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

// ── Types ─────────────────────────────────────────────

export interface ContextMenuItem {
  id: string;
  label: string;
  /** Lucide icon shown before the label (icon + text side by side) */
  icon?: LucideIcon;
  destructive?: boolean;
  /** If set, shows inline confirmation before executing */
  confirmQuestion?: string;
  onAction: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

// ── Singleton state — only one context menu open at a time ──

let closeCurrentMenu: (() => void) | null = null;

function registerMenu(closeFn: () => void) {
  if (closeCurrentMenu && closeCurrentMenu !== closeFn) {
    closeCurrentMenu();
  }
  closeCurrentMenu = closeFn;
}

function unregisterMenu(closeFn: () => void) {
  if (closeCurrentMenu === closeFn) {
    closeCurrentMenu = null;
  }
}

// ── ContextMenu Component ─────────────────────────────

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Register singleton
  useEffect(() => {
    registerMenu(onClose);
    return () => unregisterMenu(onClose);
  }, [onClose]);

  // Position clamping after mount (when we know the menu dimensions)
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const pad = 8;
    let newX = x;
    let newY = y;

    if (newX + rect.width > window.innerWidth - pad) {
      newX = window.innerWidth - rect.width - pad;
    }
    if (newX < pad) newX = pad;

    if (newY + rect.height > window.innerHeight - pad) {
      newY = window.innerHeight - rect.height - pad;
    }
    if (newY < pad) newY = pad;

    if (newX !== x || newY !== y) {
      setPosition({ x: newX, y: newY });
    }
  }, [x, y, confirmingId]); // re-clamp when confirmation changes size

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Close on click-outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use timeout to avoid closing on the same click that opened the menu
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  // Close on scroll (any scrollable ancestor)
  useEffect(() => {
    const handleScroll = () => onClose();
    document.addEventListener('scroll', handleScroll, true);
    return () => document.removeEventListener('scroll', handleScroll, true);
  }, [onClose]);

  const handleItemClick = useCallback(
    (item: ContextMenuItem) => {
      if (item.destructive && item.confirmQuestion && confirmingId !== item.id) {
        setConfirmingId(item.id);
        return;
      }
      item.onAction();
      onClose();
    },
    [confirmingId, onClose]
  );

  const menuContent = (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 9999,
        minWidth: '180px',
        maxWidth: '360px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        padding: 'var(--space-1) 0',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
      role="menu"
    >
      {/* Box-drawing top border */}
      <div
        style={{
          position: 'absolute',
          top: '-1px',
          left: '-1px',
          right: '-1px',
          height: '1px',
          overflow: 'hidden',
          color: 'var(--border-default)',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          lineHeight: '1px',
          pointerEvents: 'none',
        }}
      />

      {items.map((item) => {
        const isConfirming = confirmingId === item.id;

        if (isConfirming && item.confirmQuestion) {
          return (
            <ConfirmationRow
              key={item.id}
              question={item.confirmQuestion}
              onConfirm={() => {
                item.onAction();
                onClose();
              }}
              onCancel={() => setConfirmingId(null)}
            />
          );
        }

        return (
          <MenuItemRow
            key={item.id}
            label={item.label}
            icon={item.icon}
            destructive={item.destructive}
            onClick={() => handleItemClick(item)}
          />
        );
      })}
    </div>
  );

  return createPortal(menuContent, document.body);
}

// ── Menu Item Row ─────────────────────────────────────

function MenuItemRow({
  label,
  icon: Icon,
  destructive,
  onClick,
}: {
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderRadius: 0,
        padding: 'var(--space-2) var(--space-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        textAlign: 'left',
        letterSpacing: '0.02em',
        transition: 'background 150ms, color 150ms',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-elevated)';
        if (destructive) {
          e.currentTarget.style.color = 'var(--error)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
    >
      {Icon && <Icon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />}
      {label}
    </button>
  );
}

// ── Confirmation Row ──────────────────────────────────

function ConfirmationRow({
  question,
  onConfirm,
  onCancel,
}: {
  question: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        padding: 'var(--space-2) var(--space-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-primary)',
        letterSpacing: '0.02em',
      }}
    >
      <div style={{ marginBottom: 'var(--space-2)', whiteSpace: 'normal' }}>
        {question}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={onConfirm}
          style={{
            background: 'transparent',
            border: '1px solid var(--error)',
            borderRadius: 0,
            padding: '2px var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--error)',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            transition: 'background 150ms, color 150ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--error)';
            e.currentTarget.style.color = 'var(--bg-base)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--error)';
          }}
        >
          [ YES ]
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: '2px var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            transition: 'background 150ms, color 150ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-elevated)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          [ NO ]
        </button>
      </div>
    </div>
  );
}

// ── useContextMenu Hook ───────────────────────────────
// Manages context menu state (position + visibility)

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
}

export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ isOpen: true, x: e.clientX, y: e.clientY });
  }, []);

  const openAt = useCallback((x: number, y: number) => {
    setState({ isOpen: true, x, y });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return { ...state, open, openAt, close };
}
