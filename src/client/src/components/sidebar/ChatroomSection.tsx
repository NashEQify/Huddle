import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { RoomResponse, MembershipState } from '@huddle/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';
import { useNavigation } from '../../stores/navigation';
import { useWs } from '../../stores/ws';
import { useCall, scopeToKey } from '../../stores/call';
import { useUnread } from '../../stores/unread';
import { useScreenshare } from '../../stores/screenshare';
import { SectionHeader } from './SectionHeader';
import { CreateRoomDialog } from '../chat/CreateRoomDialog';
import { CallDurationTimer } from '../call/CallDurationTimer';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { IconButton } from '../ui/IconButton';

interface ChatroomSectionProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

const BUCKET_ORDER: (MembershipState | null)[] = ['joined', 'left', 'not_joined', null];

function bucketIndex(membership: MembershipState | null): number {
  if (membership === 'joined') return 0;
  if (membership === 'left') return 1;
  if (membership === 'not_joined') return 2;
  return 3; // null — no membership
}

export function ChatroomSection({
  isCollapsed,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
}: ChatroomSectionProps) {
  const [rooms, setRooms] = useState<RoomResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const { user } = useAuth();
  const { activeView, navigateToRoom, navigateToWelcome } = useNavigation();
  const { onMessage } = useWs();

  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  // Context menu for room deletion
  const contextMenu = useContextMenu();
  const [contextMenuRoomId, setContextMenuRoomId] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    const result = await api.get<{ rooms: RoomResponse[] }>('/api/rooms');
    if (result.ok) {
      setRooms(result.data.rooms);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  // Refresh rooms on WS events (room.created, room.membership, room.deleted)
  useEffect(() => {
    const unsub1 = onMessage('room.created', () => { fetchRooms(); });
    const unsub2 = onMessage('room.membership', () => { fetchRooms(); });
    const unsub3 = onMessage('room.deleted', (payload) => {
      const data = payload as { roomId: string };
      fetchRooms();
      // If user was viewing the deleted room, redirect to Welcome
      if (activeViewRef.current.type === 'room' && activeViewRef.current.roomId === data.roomId) {
        navigateToWelcome();
      }
    });
    const unsub4 = onMessage('room.updated', () => { fetchRooms(); });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [onMessage, fetchRooms, navigateToWelcome]);

  // Sort rooms: by bucket (joined > left > not_joined > null), then by lastActivityAt DESC
  const sortedRooms = [...rooms].sort((a, b) => {
    const bucketA = bucketIndex(a.membership);
    const bucketB = bucketIndex(b.membership);
    if (bucketA !== bucketB) return bucketA - bucketB;
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });

  // Group into buckets for rendering separators
  const buckets: { label: string; rooms: RoomResponse[] }[] = [];
  let currentBucketIdx = -1;

  for (const room of sortedRooms) {
    const idx = bucketIndex(room.membership);
    if (idx !== currentBucketIdx) {
      currentBucketIdx = idx;
      const labels: Record<number, string> = {
        0: 'joined',
        1: 'left',
        2: 'not joined',
        3: 'discoverable',
      };
      buckets.push({ label: labels[idx] ?? '', rooms: [] });
    }
    buckets[buckets.length - 1]!.rooms.push(room);
  }

  const isActiveRoom = (roomId: string) =>
    activeView.type === 'room' && activeView.roomId === roomId;

  // Handle room deletion
  const handleDeleteRoom = useCallback(
    async (roomId: string) => {
      const result = await api.delete<{ deleted: true }>(`/api/rooms/${roomId}`);
      if (result.ok) {
        // If user was viewing the deleted room, redirect to Welcome
        if (activeView.type === 'room' && activeView.roomId === roomId) {
          navigateToWelcome();
        }
        fetchRooms();
      }
    },
    [activeView, navigateToWelcome, fetchRooms]
  );

  // Build context menu items for a room
  const handleRoomContextMenu = useCallback(
    (e: React.MouseEvent, room: RoomResponse) => {
      const isAdmin = user?.isAdmin === true;
      const isCreator = room.createdBy === user?.id;

      // Only show context menu if user can delete
      if (!isAdmin && !isCreator) return;

      contextMenu.open(e);
      setContextMenuRoomId(room.id);
    },
    [user, contextMenu]
  );

  const contextRoom = contextMenuRoomId
    ? rooms.find((r) => r.id === contextMenuRoomId)
    : null;

  const menuItems: ContextMenuItem[] = contextRoom
    ? [
        {
          id: 'delete-room',
          label: 'Delete room',
          icon: Trash2,
          destructive: true,
          confirmQuestion: `Delete "${contextRoom.name}"?`,
          onAction: () => handleDeleteRoom(contextRoom.id),
        },
      ]
    : [];

  return (
    <div>
      <SectionHeader
        hexCode="0x10"
        label="CHATROOMS"
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      />

      {!isCollapsed && (
        <div style={{ padding: '0 var(--space-2)' }}>
          {/* New Room Button — hybrid: icon + short label */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-2)' }}>
            <button
              type="button"
              aria-label="Create new room"
              title="Create new room"
              onClick={() => setShowCreateDialog(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 0,
                padding: 'var(--space-1) var(--space-3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                transition: 'background 150ms',
              }}
            >
              <Plus size={14} /> NEW
            </button>
          </div>

          {isLoading && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                padding: 'var(--space-2) var(--space-3)',
              }}
            >
              loading...
            </div>
          )}

          {!isLoading && sortedRooms.length === 0 && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                padding: 'var(--space-2) var(--space-3)',
              }}
            >
              No rooms yet
            </div>
          )}

          {buckets.map((bucket) => (
            <div key={bucket.label}>
              {/* Bucket header — label for membership group */}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  padding: 'var(--space-2) var(--space-3) var(--space-1)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {bucket.label === 'joined' ? '── JOINED ──' :
                 bucket.label === 'left' ? '── LEFT ──' :
                 bucket.label === 'not joined' ? '── NOT JOINED ──' :
                 '── DISCOVERABLE ──'}
              </div>

              {bucket.rooms.map((room) => (
                <RoomItem
                  key={room.id}
                  room={room}
                  isActive={isActiveRoom(room.id)}
                  onClick={() => navigateToRoom(room.id)}
                  onContextMenu={(e) => handleRoomContextMenu(e, room)}
                  showUnread={room.membership === 'joined'}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Context Menu for room deletion */}
      {contextMenu.isOpen && menuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={contextMenu.close}
        />
      )}

      {/* Create Room Dialog */}
      {showCreateDialog && (
        <CreateRoomDialog onClose={() => { setShowCreateDialog(false); fetchRooms(); }} />
      )}
    </div>
  );
}

// ── Room Item ───────────────────────────────────────────

function RoomItem({
  room,
  isActive,
  onClick,
  onContextMenu,
  showUnread,
}: {
  room: RoomResponse;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  showUnread: boolean;
}) {
  const { getActiveCall } = useCall();
  const { hasUnread } = useUnread();
  const { getRoomScreenshare } = useScreenshare();
  const activeCall = getActiveCall(scopeToKey({ type: 'room', id: room.id }));
  const activeScreenshare = getRoomScreenshare(room.id);
  const isUnread = showUnread && hasUnread(`room:${room.id}`);

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        border: isActive ? '1px solid var(--accent-dim)' : '1px solid var(--border-default)',
        borderLeft: isActive ? '3px solid var(--accent)' : '1px solid var(--border-default)',
        borderRadius: 0,
        padding: 'var(--space-3)',
        marginBottom: 'var(--space-1)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-lg)',
        fontWeight: isActive ? 700 : 400,
        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 150ms, color 150ms',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--bg-elevated)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }
      }}
    >
      {/* Unread dot -- 6px square, accent color, only for joined rooms */}
      {isUnread && (
        <span
          style={{
            width: '6px',
            height: '6px',
            background: 'var(--accent)',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      )}
      {/* Password-protected indicator */}
      {room.hasPassword && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}
          title="Password-protected"
        >
          [PW]
        </span>
      )}
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
          minWidth: 0,
        }}
      >
        {room.name}
      </span>
      {/* Screenshare indicator -- visible when a screenshare is active in this room */}
      {activeScreenshare && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}
          title="Screenshare active"
        >
          [SS]
        </span>
      )}
      {/* Call timer in sidebar -- subtle, visible to all */}
      {activeCall && (
        <CallDurationTimer
          startedAt={activeCall.startedAt}
          fontSize="var(--text-xs)"
        />
      )}
    </button>
  );
}
