interface SectionHeaderProps {
  hexCode: string;
  label: string;
  isCollapsed: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function SectionHeader({
  hexCode,
  label,
  isCollapsed,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
}: SectionHeaderProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onToggle}
      style={{
        padding: 'var(--space-2) var(--space-3)',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        letterSpacing: '0.05em',
        transition: 'background 150ms',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-elevated)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
        {isCollapsed ? '+' : '-'}
      </span>
      <span>
        <span style={{ color: 'var(--text-secondary)' }}>[ </span>
        <span style={{ color: 'var(--text-secondary)' }}>{hexCode} </span>
        <span style={{ color: 'var(--accent)' }}>{label}</span>
        <span style={{ color: 'var(--text-secondary)' }}> ]</span>
      </span>
    </div>
  );
}
