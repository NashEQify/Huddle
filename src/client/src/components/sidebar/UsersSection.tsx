import { useEffect, useState, useCallback, useRef } from 'react';
import type { UserResponse } from '@huddle/shared';
import { api } from '../../lib/api';
import { usePresence } from '../../stores/presence';
import { useNavigation } from '../../stores/navigation';
import { useAuth } from '../../stores/auth';
import { useCall } from '../../stores/call';
import { useWs } from '../../stores/ws';
import { useUnread } from '../../stores/unread';
import { CallIndicatorOverlay } from '../call/CallIndicatorOverlay';
import { SectionHeader } from './SectionHeader';

interface UsersSectionProps {
  isCollapsed: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return '';
  const now = Date.now();
  const seen = new Date(lastSeenAt).getTime();
  const diffMs = now - seen;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMinutes < 60) {
    return `${Math.max(1, diffMinutes)}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  // Older: show date
  const date = new Date(lastSeenAt);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export function UsersSection({
  isCollapsed,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
}: UsersSectionProps) {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [incomingCallers, setIncomingCallers] = useState<Set<string>>(new Set());
  // CGL-009: directId → callerId reverse-index for the incomingCallers set.
  // `call.ended` carries only `scope.id` (the directId), but the sidebar
  // indicator is keyed by `callerId`. Without this map we cannot selectively
  // remove one ended DM call without wiping concurrent entries.
  const incomingByDirectRef = useRef<Map<string, string>>(new Map());
  const { isUserOnline } = usePresence();
  const { activeView, navigateToDm } = useNavigation();
  const { user: currentUser } = useAuth();
  const { onMessage } = useWs();

  const fetchUsers = useCallback(async () => {
    const result = await api.get<{ users: UserResponse[] }>('/api/users');
    if (result.ok) {
      setUsers(result.data.users);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Listen for user profile updates (avatar, title changes)
  useEffect(() => {
    return onMessage('user.updated', (payload) => {
      const data = payload as {
        userId: string;
        profile: {
          title: string;
          avatarKind: string;
          builtInAvatarUrl: string | null;
          portraitUrl: string | null;
        };
      };
      setUsers((prev) =>
        prev.map((u) =>
          u.id === data.userId
            ? { ...u, profile: { ...u.profile, ...data.profile } as UserResponse['profile'] }
            : u
        )
      );
    });
  }, [onMessage]);

  // Re-fetch user list when an unknown user comes online (e.g. new signup)
  const usersRef = useRef(users);
  usersRef.current = users;

  useEffect(() => {
    return onMessage('presence.online', (payload) => {
      const data = payload as { userId: string };
      const known = usersRef.current.some((u) => u.id === data.userId);
      if (!known) {
        fetchUsers();
      }
    });
  }, [onMessage, fetchUsers]);

  // Listen for incoming DM calls
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onMessage('dm.call.incoming', (payload) => {
        const data = payload as { directId: string; callerId: string };
        // CGL-009: remember which caller initiated this DM call so we can
        // selectively remove them on `call.ended`.
        incomingByDirectRef.current.set(data.directId, data.callerId);
        setIncomingCallers((prev) => {
          const next = new Set(prev);
          next.add(data.callerId);
          return next;
        });
        // CGL / F-CSD-046: Ring-sound playback is owned by IncomingCallOverlay
        // (single source via startCallRingLoop). Previously UsersSection also
        // fired a one-shot playCallRingSound() here, resulting in a doubled
        // initial burst overlapping the overlay's first loop iteration. The
        // overlay mounts immediately on the same `dm.call.incoming` event, so
        // no audible coverage is lost by removing this call site.
      })
    );

    // Clear incoming indicator when call ends
    // CGL-009: remove only the caller matching the ended DM, not the entire
    // set. A second concurrent incoming call would previously disappear when
    // the first ended; now each is cleared independently.
    unsubs.push(
      onMessage('call.ended', (payload) => {
        const data = payload as { scope: { type: string; id: string } };
        if (data.scope.type !== 'direct') return;
        const callerId = incomingByDirectRef.current.get(data.scope.id);
        if (!callerId) return;
        incomingByDirectRef.current.delete(data.scope.id);
        setIncomingCallers((prev) => {
          if (!prev.has(callerId)) return prev;
          const next = new Set(prev);
          next.delete(callerId);
          return next;
        });
      })
    );

    unsubs.push(
      onMessage('call.left', (payload) => {
        const data = payload as { scope: { type: string; id: string }; userId: string };
        if (data.scope.type === 'direct') {
          setIncomingCallers((prev) => {
            const next = new Set(prev);
            next.delete(data.userId);
            return next;
          });
        }
      })
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [onMessage]);

  // Sort: online first, then offline; within each group A-Z by username
  const sortedUsers = [...users].sort((a, b) => {
    const aOnline = isUserOnline(a.id);
    const bOnline = isUserOnline(b.id);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return a.username.localeCompare(b.username);
  });

  const isActiveDm = (userId: string) =>
    activeView.type === 'dm' && activeView.userId === userId;

  return (
    <div>
      <SectionHeader
        hexCode="0x20"
        label="USERS"
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      />

      {!isCollapsed && (
        <div style={{ padding: '0 var(--space-2)' }}>
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

          {!isLoading && sortedUsers.length === 0 && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                padding: 'var(--space-2) var(--space-3)',
              }}
            >
              No users
            </div>
          )}

          {sortedUsers
            .filter((user) => user.id !== currentUser?.id)
            .map((user) => (
            <UserItem
              key={user.id}
              user={user}
              isOnline={isUserOnline(user.id)}
              isActive={isActiveDm(user.id)}
              isSelf={false}
              hasIncomingCall={incomingCallers.has(user.id)}
              onClick={() => navigateToDm(user.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── User Item ───────────────────────────────────────────

function UserItem({
  user,
  isOnline,
  isActive,
  isSelf,
  hasIncomingCall,
  onClick,
}: {
  user: UserResponse;
  isOnline: boolean;
  isActive: boolean;
  isSelf: boolean;
  hasIncomingCall: boolean;
  onClick: () => void;
}) {
  const { hasUnread } = useUnread();
  const { isUserInAnyCall } = useCall();
  const isUnread = !isSelf && hasUnread(`dm-user:${user.id}`);
  const isInCall = isUserInAnyCall(user.id);
  const avatarUrl = user.profile?.avatarKind === 'uploaded' && user.profile.portraitUrl
    ? user.profile.portraitUrl
    : user.profile?.builtInAvatarUrl ?? null;

  const lastSeen = !isOnline ? formatLastSeen(user.lastSeenAt) : '';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        width: '100%',
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        borderTop: 'none',
        borderRight: 'none',
        borderBottom: 'none',
        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 0,
        padding: 'var(--space-2) var(--space-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 150ms',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'var(--bg-elevated)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      {/* Avatar with online indicator */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={user.username}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: 0,
              display: 'block',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: 0,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
            }}
          >
            {user.username.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Online indicator: 8px square, --success color */}
        {isOnline && (
          <span
            style={{
              position: 'absolute',
              bottom: '-2px',
              left: '-2px',
              width: '8px',
              height: '8px',
              background: 'var(--success)',
              display: 'block',
            }}
          />
        )}

        {/* CGL-014: in-call indicator at bottom-right */}
        {isInCall && <CallIndicatorOverlay size={14} title={`${user.username} is in a call`} />}
      </div>

      {/* Unread dot -- 6px square, accent color */}
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

      {/* Name + title + last seen — stacked vertically */}
      <div style={{ overflow: 'hidden', minWidth: 0, flex: 1 }}>
        {/* Line 1: Username */}
        <div
          style={{
            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.3,
          }}
        >
          {user.username}
          {isSelf && (
            <span style={{ color: 'var(--text-muted)' }}> (you)</span>
          )}
        </div>

        {/* Line 2: Title */}
        {user.profile?.title && (
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--text-xs)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.3,
            }}
          >
            {user.profile.title}
          </div>
        )}

        {/* Line 3: Last seen for offline users */}
        {!isOnline && lastSeen && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
              lineHeight: 1.3,
            }}
          >
            {lastSeen}
          </div>
        )}
      </div>

      {/* Incoming call indicator */}
      {hasIncomingCall && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--accent)',
            flexShrink: 0,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
          title="Incoming call"
        >
          [CALL]
        </span>
      )}
    </button>
  );
}
