/**
 * AdminPage — Admin Console
 *
 * Sections: Users, Rooms, System
 * Per spec 80-admin.md — TTY aesthetic, box-drawing, tables.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

interface AdminRoom {
  id: string;
  name: string;
  memberCount: number;
  hasActiveCall: boolean;
}

interface SystemStatus {
  totalUsers: number;
  onlineUsers: number;
  totalRooms: number;
  activeCalls: number;
  activeScreenshares: number;
  uploadSizeBytes: number;
  dbSizeBytes: number;
}

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'rooms' | 'system'>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // ── Fetch Data ──────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    const result = await api.get<{ users: AdminUser[] }>('/api/admin/users');
    if (result.ok) setUsers(result.data.users);
  }, []);

  const fetchRooms = useCallback(async () => {
    const result = await api.get<{ rooms: AdminRoom[] }>('/api/admin/rooms');
    if (result.ok) setRooms(result.data.rooms);
  }, []);

  const fetchSystem = useCallback(async () => {
    const result = await api.get<SystemStatus>('/api/admin/system');
    if (result.ok) setSystem(result.data);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchUsers(), fetchRooms(), fetchSystem()]).then(() =>
      setIsLoading(false)
    );
  }, [fetchUsers, fetchRooms, fetchSystem]);

  // ── Actions ─────────────────────────────────────────────

  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearMessage = () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setActionMessage(null), 5000);
  };

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []);

  const handleResetPassword = useCallback(
    async (userId: string, username: string) => {
      const input = prompt(
        `Reset password for ${username}?\n\nEnter a temporary password (8+ chars) or leave empty to auto-generate:`
      );
      // null = cancelled
      if (input === null) return;
      const customPw = input.trim();
      if (customPw && customPw.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
      }
      const body = customPw ? { tempPassword: customPw } : {};
      const result = await api.post<{ tempPassword: string }>(
        `/api/admin/users/${userId}/reset-password`,
        body
      );
      if (result.ok) {
        setTempPassword(result.data.tempPassword);
        setActionMessage(`Password reset for ${username}. Temp password shown below.`);
      }
    },
    []
  );

  const handleToggleActive = useCallback(
    async (userId: string, currentActive: boolean, username: string) => {
      const action = currentActive ? 'deactivate' : 'reactivate';
      // CGL-020 / F-CSD-170: confirm before deactivating. Reactivation is
      // safe, so no confirmation is needed in that direction.
      if (
        currentActive &&
        !confirm(
          `Deactivate user '${username}'?\n\nThey will be logged out of all sessions and unable to sign in. This can be reversed.`
        )
      ) {
        return;
      }
      const result = await api.patch<{ user: AdminUser }>(
        `/api/admin/users/${userId}/${action}`
      );
      if (result.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, isActive: result.data.user.isActive } : u
          )
        );
        setActionMessage(`User ${action}d successfully.`);
        clearMessage();
      }
    },
    []
  );

  const handleToggleAdmin = useCallback(
    async (userId: string, currentIsAdmin: boolean) => {
      const action = currentIsAdmin ? 'remove admin from' : 'make admin';
      if (!confirm(`${action} this user?`)) return;
      const result = await api.patch<{ user: AdminUser }>(
        `/api/admin/users/${userId}/admin`,
        { isAdmin: !currentIsAdmin }
      );
      if (result.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, isAdmin: result.data.user.isAdmin } : u
          )
        );
        setActionMessage(`Admin status updated.`);
        clearMessage();
      }
    },
    []
  );

  const handleDeleteRoom = useCallback(
    async (roomId: string, roomName: string) => {
      if (!confirm(`Delete room '${roomName}'? This cannot be undone.`)) return;
      const result = await api.delete<{ deleted: true }>(
        `/api/rooms/${roomId}`
      );
      if (result.ok) {
        setRooms((prev) => prev.filter((r) => r.id !== roomId));
        setActionMessage(`Room '${roomName}' deleted.`);
        clearMessage();
      }
    },
    []
  );

  const handleRenameRoom = useCallback(
    async (roomId: string, newName: string) => {
      const result = await api.patch<{ room: { id: string; name: string } }>(
        `/api/admin/rooms/${roomId}`,
        { name: newName }
      );
      if (result.ok) {
        setRooms((prev) =>
          prev.map((r) =>
            r.id === roomId ? { ...r, name: result.data.room.name } : r
          )
        );
        setActionMessage('Room renamed.');
        clearMessage();
      }
    },
    []
  );

  const handleForceEndCall = useCallback(
    async (scopeType: string, scopeId: string, scopeLabel: string) => {
      // CGL-021 / F-CSD-174: confirm before force-ending a call. All
      // participants will be disconnected immediately.
      if (
        !confirm(
          `Force-end the active call in '${scopeLabel}'?\n\nAll participants will be disconnected.`
        )
      ) {
        return;
      }
      const result = await api.post<{ ok: boolean }>('/api/admin/calls/end', {
        scopeType,
        scopeId,
      });
      if (result.ok) {
        setActionMessage('Call force-ended.');
        clearMessage();
        fetchRooms();
      }
    },
    [fetchRooms]
  );

  // ── Render ──────────────────────────────────────────────

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: '1px solid var(--border-default)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          [ 0xAD
        </span>
        <span
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 700,
            color: 'var(--warning)',
          }}
        >
          ADMIN CONSOLE
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>]</span>
      </div>

      {/* Action message */}
      {actionMessage && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--accent-muted)',
            fontSize: 'var(--text-sm)',
            color: 'var(--accent)',
          }}
        >
          {actionMessage}
        </div>
      )}

      {/* Temp password display — CGL-019 / F-CSD-163 */}
      {tempPassword && (
        <TempPasswordBox
          password={tempPassword}
          onDismiss={() => setTempPassword(null)}
        />
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        {(['users', 'rooms', 'system'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              background:
                activeTab === tab ? 'var(--bg-elevated)' : 'transparent',
              color:
                activeTab === tab ? 'var(--accent)' : 'var(--text-secondary)',
              border: 'none',
              borderBottom:
                activeTab === tab
                  ? '2px solid var(--accent)'
                  : '2px solid transparent',
              borderRadius: 0,
              padding: 'var(--space-2) var(--space-4)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              transition: 'background 150ms, color 150ms',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 'var(--space-4)' }}>
        {isLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            loading...
          </div>
        ) : (
          <>
            {activeTab === 'users' && (
              <UsersTab
                users={users}
                onResetPassword={handleResetPassword}
                onToggleActive={handleToggleActive}
                onToggleAdmin={handleToggleAdmin}
              />
            )}
            {activeTab === 'rooms' && (
              <RoomsTab
                rooms={rooms}
                onDeleteRoom={handleDeleteRoom}
                onRenameRoom={handleRenameRoom}
                onForceEndCall={handleForceEndCall}
              />
            )}
            {activeTab === 'system' && system && <SystemTab status={system} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Users Tab ──────────────────────────────────────────────

function UsersTab({
  users,
  onResetPassword,
  onToggleActive,
  onToggleAdmin,
}: {
  users: AdminUser[];
  onResetPassword: (userId: string, username: string) => void;
  onToggleActive: (userId: string, currentActive: boolean, username: string) => void;
  onToggleAdmin: (userId: string, currentIsAdmin: boolean) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {users.length} users total
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Username', 'Email', 'Admin', 'Active', 'Created', 'Actions'].map(
              (h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: 'var(--space-2)',
                    borderBottom: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--text-xs)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td style={cellStyle}>{user.username}</td>
              <td style={cellStyle}>{user.email}</td>
              <td style={cellStyle}>
                {user.isAdmin ? (
                  <span style={{ color: 'var(--warning)' }}>yes</span>
                ) : (
                  'no'
                )}
              </td>
              <td style={cellStyle}>
                {user.isActive ? (
                  <span style={{ color: 'var(--success)' }}>active</span>
                ) : (
                  <span style={{ color: 'var(--error)' }}>deactivated</span>
                )}
              </td>
              <td style={cellStyle}>
                {new Date(user.createdAt).toLocaleDateString()}
              </td>
              <td style={cellStyle}>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  <button
                    type="button"
                    onClick={() => onResetPassword(user.id, user.username)}
                    style={{ ...btnStyle, fontSize: 'var(--text-xs)' }}
                  >
                    [ RESET PW ]
                  </button>
                  {!user.isAdmin && (
                    <button
                      type="button"
                      onClick={() => onToggleActive(user.id, user.isActive, user.username)}
                      style={{
                        ...btnStyle,
                        fontSize: 'var(--text-xs)',
                        color: user.isActive ? 'var(--error)' : 'var(--success)',
                        borderColor: user.isActive
                          ? 'var(--error)'
                          : 'var(--success)',
                      }}
                    >
                      {user.isActive ? '[ DEACTIVATE ]' : '[ REACTIVATE ]'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggleAdmin(user.id, user.isAdmin)}
                    style={{
                      ...btnStyle,
                      fontSize: 'var(--text-xs)',
                      color: user.isAdmin ? 'var(--warning)' : 'var(--accent)',
                      borderColor: user.isAdmin ? 'var(--warning)' : 'var(--accent)',
                    }}
                  >
                    {user.isAdmin ? '[ REMOVE ADMIN ]' : '[ MAKE ADMIN ]'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Rooms Tab ──────────────────────────────────────────────

function RoomsTab({
  rooms,
  onDeleteRoom,
  onRenameRoom,
  onForceEndCall,
}: {
  rooms: AdminRoom[];
  onDeleteRoom: (roomId: string, roomName: string) => void;
  onRenameRoom: (roomId: string, newName: string) => void;
  onForceEndCall: (scopeType: string, scopeId: string, scopeLabel: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const startEdit = (room: AdminRoom) => {
    setEditingId(room.id);
    setEditName(room.name);
  };

  const saveEdit = () => {
    if (editingId && editName.trim()) {
      onRenameRoom(editingId, editName.trim());
      setEditingId(null);
    }
  };

  return (
    <div>
      <div
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {rooms.length} rooms total
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Name', 'Members', 'Active Call', 'Actions'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: 'left',
                  padding: 'var(--space-2)',
                  borderBottom: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.id}>
              <td style={cellStyle}>
                {editingId === room.id ? (
                  <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      style={{
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 0,
                        padding: '2px 6px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-primary)',
                        width: '200px',
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={saveEdit}
                      style={{ ...btnStyle, fontSize: 'var(--text-xs)' }}
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <span
                    onClick={() => startEdit(room)}
                    style={{ cursor: 'pointer' }}
                    title="Click to rename"
                  >
                    {room.name}
                  </span>
                )}
              </td>
              <td style={cellStyle}>{room.memberCount}</td>
              <td style={cellStyle}>
                {room.hasActiveCall ? (
                  <span style={{ color: 'var(--accent)' }}>yes</span>
                ) : (
                  'no'
                )}
              </td>
              <td style={cellStyle}>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  {room.hasActiveCall && (
                    <button
                      type="button"
                      onClick={() => onForceEndCall('room', room.id, room.name)}
                      style={{
                        ...btnStyle,
                        fontSize: 'var(--text-xs)',
                        color: 'var(--warning)',
                        borderColor: 'var(--warning)',
                      }}
                    >
                      [ END CALL ]
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteRoom(room.id, room.name)}
                    style={{
                      ...btnStyle,
                      fontSize: 'var(--text-xs)',
                      color: 'var(--error)',
                      borderColor: 'var(--error)',
                    }}
                  >
                    [ DELETE ]
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── System Tab ─────────────────────────────────────────────

function SystemTab({ status }: { status: SystemStatus }) {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const entries = [
    { label: 'Total Users', value: status.totalUsers.toString() },
    { label: 'Online Users', value: status.onlineUsers.toString() },
    { label: 'Total Rooms', value: status.totalRooms.toString() },
    { label: 'Active Calls', value: status.activeCalls.toString() },
    { label: 'Active Screenshares', value: status.activeScreenshares.toString() },
    { label: 'Upload Storage', value: formatBytes(status.uploadSizeBytes) },
    { label: 'Database Size', value: formatBytes(status.dbSizeBytes) },
  ];

  return (
    <div>
      <div
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
          marginBottom: 'var(--space-3)',
        }}
      >
        System overview (refresh page to update)
      </div>

      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.label}>
              <td
                style={{
                  ...cellStyle,
                  color: 'var(--text-secondary)',
                  paddingRight: 'var(--space-6)',
                }}
              >
                {entry.label}
              </td>
              <td style={{ ...cellStyle, color: 'var(--text-primary)' }}>
                {entry.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Temp Password Box (CGL-019 / F-CSD-163) ───────────────

/**
 * Admin reset-password output with:
 *   (a) box-drawing monospace frame around the temp password,
 *   (b) [ COPY ] button with transient "copied" feedback,
 *   (c) "shown once" warning text,
 *   (d) dismiss action.
 */
function TempPasswordBox({
  password,
  onDismiss,
}: {
  password: string;
  onDismiss: () => void;
}) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password);
      } else {
        // Fallback: execCommand (best effort for old contexts)
        const ta = document.createElement('textarea');
        ta.value = password;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyFeedback('copied');
    } catch {
      setCopyFeedback('copy failed — select manually');
    }
    setTimeout(() => setCopyFeedback(null), 2000);
  }, [password]);

  // Build a box-drawing frame matching password width + a little padding.
  const pad = 4; // spaces on each side of password inside the frame
  const inner = ' '.repeat(pad) + password + ' '.repeat(pad);
  const top = '┌' + '─'.repeat(inner.length) + '┐';
  const mid = '│' + inner + '│';
  const bot = '└' + '─'.repeat(inner.length) + '┘';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--warning)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ color: 'var(--warning)', marginBottom: 'var(--space-2)' }}>
        TEMPORARY PASSWORD — shown ONCE, copy it now
      </div>
      <pre
        style={{
          margin: 0,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-base)',
          letterSpacing: '0.05em',
          lineHeight: 1.1,
          whiteSpace: 'pre',
        }}
      >
{top}
{mid}
{bot}
      </pre>
      <div
        style={{
          marginTop: 'var(--space-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <button
          type="button"
          onClick={handleCopy}
          style={{
            ...btnStyle,
            color: 'var(--accent)',
            borderColor: 'var(--accent)',
            fontSize: 'var(--text-xs)',
          }}
        >
          [ COPY ]
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            ...btnStyle,
            fontSize: 'var(--text-xs)',
          }}
        >
          [ DISMISS ]
        </button>
        {copyFeedback && (
          <span style={{ color: 'var(--success)', fontSize: 'var(--text-xs)' }}>
            {copyFeedback}
          </span>
        )}
        <span
          style={{
            color: 'var(--error)',
            fontSize: 'var(--text-xs)',
            marginLeft: 'auto',
          }}
        >
          Warning: this password cannot be retrieved later.
        </span>
      </div>
    </div>
  );
}

// ── Shared Styles ──────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)',
  borderRadius: 0,
  padding: 'var(--space-1) var(--space-2)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  transition: 'background 150ms, color 150ms, border-color 150ms',
  whiteSpace: 'nowrap',
};

const cellStyle: React.CSSProperties = {
  padding: 'var(--space-2)',
  borderBottom: '1px solid var(--border-default)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-muted)',
};
