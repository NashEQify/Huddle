import { useState, useCallback, useEffect } from 'react';
import { ChatroomSection } from './sidebar/ChatroomSection';
import { UsersSection } from './sidebar/UsersSection';

// ── Types ────────────────────────────────────────────────

type SectionId = 'chatrooms' | 'users';

const DEFAULT_ORDER: SectionId[] = ['chatrooms', 'users'];

const STORAGE_KEY_ORDER = 'sidebar-section-order';
const STORAGE_KEY_COLLAPSED = 'sidebar-section-collapsed';

// ── Persistence Helpers ─────────────────────────────────

function loadSectionOrder(): SectionId[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ORDER);
    if (stored) {
      const parsed = JSON.parse(stored) as SectionId[];
      // Validate all expected sections are present
      if (
        parsed.length === DEFAULT_ORDER.length &&
        DEFAULT_ORDER.every((id) => parsed.includes(id))
      ) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return [...DEFAULT_ORDER];
}

function saveSectionOrder(order: SectionId[]): void {
  localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(order));
}

function loadCollapsedState(): Record<SectionId, boolean> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_COLLAPSED);
    if (stored) {
      return JSON.parse(stored) as Record<SectionId, boolean>;
    }
  } catch {
    // Ignore parse errors
  }
  return { chatrooms: false, users: false };
}

function saveCollapsedState(state: Record<SectionId, boolean>): void {
  localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(state));
}

// ── Sidebar Component ───────────────────────────────────

interface SidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ isMobileOpen, onMobileClose }: SidebarProps = {}) {
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(loadSectionOrder);
  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>(loadCollapsedState);
  const [draggedSection, setDraggedSection] = useState<SectionId | null>(null);

  // Persist order changes
  useEffect(() => {
    saveSectionOrder(sectionOrder);
  }, [sectionOrder]);

  // Persist collapsed changes
  useEffect(() => {
    saveCollapsedState(collapsed);
  }, [collapsed]);

  const toggleCollapsed = useCallback((id: SectionId) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      return next;
    });
  }, []);

  // Drag-to-reorder handlers
  const handleDragStart = useCallback((id: SectionId, e: React.DragEvent) => {
    setDraggedSection(id);
    e.dataTransfer.effectAllowed = 'move';
    // Set minimal drag data to enable dragging
    e.dataTransfer.setData('text/plain', id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (targetId: SectionId, e: React.DragEvent) => {
      e.preventDefault();
      if (!draggedSection || draggedSection === targetId) return;

      setSectionOrder((prev) => {
        const next = [...prev];
        const fromIdx = next.indexOf(draggedSection);
        const toIdx = next.indexOf(targetId);
        if (fromIdx === -1 || toIdx === -1) return prev;
        // Remove dragged item and insert at target position
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, draggedSection);
        return next;
      });

      setDraggedSection(null);
    },
    [draggedSection]
  );

  const renderSection = (id: SectionId, index: number) => {
    const commonProps = {
      isCollapsed: collapsed[id],
      onToggle: () => toggleCollapsed(id),
      onDragStart: (e: React.DragEvent) => handleDragStart(id, e),
      onDragOver: handleDragOver,
      onDrop: (e: React.DragEvent) => handleDrop(id, e),
    };

    return (
      <div key={id} data-sidebar-section={id}>
        {/* Box-drawing separator between sections */}
        {index > 0 && (
          <div
            style={{
              color: 'var(--border-default)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              padding: '0 var(--space-3)',
              lineHeight: 1,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {'─────────────────────────'}
          </div>
        )}

        {id === 'chatrooms' && <ChatroomSection {...commonProps} />}
        {id === 'users' && <UsersSection {...commonProps} />}
      </div>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onMobileClose}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(10, 10, 20, 0.5)',
            zIndex: 49,
          }}
        />
      )}
      <aside
        className={`sidebar-container${isMobileOpen ? ' sidebar-open' : ''}`}
        style={{
          width: '240px',
          minWidth: '240px',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border-default)',
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {sectionOrder.map((id, index) => renderSection(id, index))}
      </aside>
    </>
  );
}
