import type { UserResponse } from '@huddle/shared';
import { useCall } from '../../stores/call';
import { CallIndicatorOverlay } from '../call/CallIndicatorOverlay';

interface ActiveUsersStripProps {
  users: UserResponse[];
}

export function ActiveUsersStrip({ users }: ActiveUsersStripProps) {
  if (users.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        borderTop: '1px solid var(--border-default)',
        overflowX: 'auto',
      }}
    >
      {users.map((user) => (
        <AvatarChip key={user.id} user={user} />
      ))}
    </div>
  );
}

function AvatarChip({ user }: { user: UserResponse }) {
  const { isUserSpeaking, isUserInAnyCall } = useCall();
  const speaking = isUserSpeaking(user.id);
  const inCall = isUserInAnyCall(user.id);

  const avatarUrl =
    user.profile?.avatarKind === 'uploaded' && user.profile.portraitUrl
      ? user.profile.portraitUrl
      : user.profile?.builtInAvatarUrl ?? null;

  const displayName = user.profile?.title
    ? `${user.username} "${user.profile.title}"`
    : user.username;

  return (
    <div
      title={displayName}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        flexShrink: 0,
        padding: speaking ? '4px' : '0',
        margin: speaking ? '-4px 0' : '0',
      }}
    >
      {/* CGL-014: relative wrapper so the in-call overlay can absolutely
          position in the bottom-right corner of the 32×32 avatar. */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={user.username}
            className={speaking ? 'avatar-speaking' : undefined}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 0,
              display: 'block',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            className={speaking ? 'avatar-speaking' : undefined}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 0,
              background: 'var(--bg-input)',
              border: speaking ? '1px solid var(--accent)' : '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-xs)',
              color: speaking ? 'var(--accent)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {user.username.charAt(0).toUpperCase()}
          </div>
        )}
        {inCall && <CallIndicatorOverlay size={12} title={`${user.username} is in a call`} />}
      </div>
    </div>
  );
}
