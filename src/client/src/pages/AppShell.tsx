import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../stores/auth';
import { useWs } from '../stores/ws';
import { useNavigation } from '../stores/navigation';
import { useCall } from '../stores/call';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { Sidebar } from '../components/Sidebar';
import { RoomView } from '../components/chat/RoomView';
import { DmView } from '../components/chat/DmView';
import { SettingsPage } from './SettingsPage';
import { WelcomeScreen } from './WelcomeScreen';
import { IncomingCallOverlay } from '../components/call/IncomingCallOverlay';
import { WaveformIcon } from '../components/visualizer/WaveformIcon';
import { AudioVisualizer, type AudioVisualizerHandle } from '../components/visualizer/AudioVisualizer';
import { ensureAudioContext } from '../lib/notification-sound';
import { api } from '../lib/api';
import type { AuthProfile } from '@huddle/shared';

// ── Helpers ──────────────────────────────────────────────

function getAvatarUrl(profile: AuthProfile | null): string | null {
  if (!profile) return null;
  if (profile.avatarKind === 'uploaded' && profile.portraitUrl) {
    return profile.portraitUrl;
  }
  if (profile.avatarKind === 'built_in' && profile.builtInAvatarId) {
    return `/avatars/${profile.builtInAvatarId}.png`;
  }
  return null;
}

export function AppShell() {
  const { user, profile, logout, updateProfile } = useAuth();
  const { connect, disconnect } = useWs();
  const { activeView, navigateToSettings, navigateToWelcome, navigateToRoom, navigateToDm } = useNavigation();
  const { state: callState, leaveCall } = useCall();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isBurgerOpen, setIsBurgerOpen] = useState(false);
  const burgerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<AudioVisualizerHandle>(null);

  // Inline title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Call name resolution
  const [callDisplayName, setCallDisplayName] = useState<string>('');

  // Connect WebSocket when AppShell mounts (user is authenticated)
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Resume AudioContext on first user interaction
  useEffect(() => {
    const handler = () => {
      ensureAudioContext();
      document.removeEventListener('click', handler);
      document.removeEventListener('keydown', handler);
    };
    document.addEventListener('click', handler, { once: true });
    document.addEventListener('keydown', handler, { once: true });
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('keydown', handler);
    };
  }, []);

  // Close sidebar on navigation change (mobile)
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [activeView]);

  // CGL-018 / F-CSD-118: sidebar navigation focus management.
  // - Room/DM navigation → focus the message input.
  // - Welcome navigation → focus the first sidebar section.
  // Skip when a settings overlay is open — the overlay owns focus
  // per CGL-017. Focus is scheduled via requestAnimationFrame so
  // the target component has time to mount.
  useEffect(() => {
    if (activeView.type === 'settings') return;
    const raf = requestAnimationFrame(() => {
      if (activeView.type === 'room' || activeView.type === 'dm') {
        const el = document.querySelector<HTMLTextAreaElement>(
          'textarea[data-message-input]'
        );
        el?.focus();
      } else if (activeView.type === 'welcome') {
        const section = document.querySelector<HTMLElement>(
          '[data-sidebar-section]'
        );
        if (section) {
          const focusable = section.querySelector<HTMLElement>(
            'button, a[href], [tabindex]:not([tabindex="-1"])'
          );
          if (focusable) {
            focusable.focus();
          } else {
            section.tabIndex = -1;
            section.focus();
          }
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activeView]);

  // Close burger menu on outside click
  useEffect(() => {
    if (!isBurgerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (burgerRef.current && !burgerRef.current.contains(e.target as Node)) {
        setIsBurgerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isBurgerOpen]);

  // Resolve call display name when activeScope changes
  useEffect(() => {
    if (!callState.activeScope) {
      setCallDisplayName('');
      return;
    }
    const scope = callState.activeScope;
    if (scope.type === 'room') {
      // Fetch room name
      api.get<{ rooms: Array<{ id: string; name: string }> }>('/api/rooms').then((result) => {
        if (result.ok) {
          const room = result.data.rooms.find((r) => r.id === scope.id);
          setCallDisplayName(room?.name ?? scope.id);
        }
      });
    } else if (scope.type === 'direct') {
      // For DM calls, find the other user from the call participants
      const otherParticipant = callState.participants.find((p) => p.userId !== user?.id);
      if (otherParticipant) {
        // Look up username from users list
        api.get<{ users: Array<{ id: string; username: string }> }>('/api/users').then((result) => {
          if (result.ok) {
            const otherUser = result.data.users.find((u) => u.id === otherParticipant.userId);
            setCallDisplayName(otherUser?.username ?? 'DM');
          }
        });
      } else {
        setCallDisplayName('DM');
      }
    }
  }, [callState.activeScope, callState.participants, user?.id]);

  // Disconnect on logout
  const handleLogout = useCallback(() => {
    disconnect();
    logout();
    setIsBurgerOpen(false);
  }, [disconnect, logout]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  // Inline title edit handlers
  const startEditTitle = useCallback(() => {
    setEditTitle(profile?.title ?? '');
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, [profile?.title]);

  const saveTitle = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed.length > 40) {
      setIsEditingTitle(false);
      return;
    }
    const result = await api.patch<{ profile: AuthProfile }>('/api/settings/profile', {
      title: trimmed,
    });
    if (result.ok) {
      updateProfile(result.data.profile);
    }
    setIsEditingTitle(false);
  }, [editTitle, updateProfile]);

  const randomizeTitle = useCallback(async () => {
    const result = await api.get<{ title: string }>('/api/settings/random-title');
    if (result.ok && result.data.title) {
      // Save directly
      const saveResult = await api.patch<{ profile: AuthProfile }>('/api/settings/profile', {
        title: result.data.title,
      });
      if (saveResult.ok) {
        updateProfile(saveResult.data.profile);
      }
    }
  }, [updateProfile]);

  // Navigate to call scope
  const navigateToCall = useCallback(() => {
    if (!callState.activeScope) return;
    const scope = callState.activeScope;
    if (scope.type === 'room') {
      navigateToRoom(scope.id);
    } else if (scope.type === 'direct') {
      // Need to find the other user ID for this direct conversation
      // Use the participants from the call state
      const otherParticipant = callState.participants.find((p) => p.userId !== user?.id);
      if (otherParticipant) {
        navigateToDm(otherParticipant.userId);
      }
    }
  }, [callState.activeScope, callState.participants, user?.id, navigateToRoom, navigateToDm]);

  if (!user) return null;

  const isInCall = callState.activeScope !== null;
  const avatarUrl = getAvatarUrl(profile);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
        overflow: 'hidden',
      }}
    >
      <IncomingCallOverlay />
      <AudioVisualizer ref={visualizerRef} />
      <ConnectionBanner />

      {/* Header Bar */}
      <header
        style={{
          background: 'var(--bg-surface)',
          borderBottom: isInCall
            ? '2px solid var(--error)'
            : '1px solid var(--border-default)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          gap: 'var(--space-3)',
        }}
      >
        {/* Mobile sidebar toggle -- visible only on mobile */}
        <button
          type="button"
          className="mobile-sidebar-toggle"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          style={{
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: 'var(--space-1) var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-base)',
            cursor: 'pointer',
            transition: 'color 150ms, border-color 150ms',
            minWidth: '36px',
            minHeight: '36px',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--accent)';
            e.currentTarget.style.borderColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.borderColor = 'var(--border-default)';
          }}
        >
          {isSidebarOpen ? 'X' : '='}
        </button>

        {/* User Avatar (click to open menu) + Username + Title */}
        <div ref={burgerRef} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: 0 }}>
          {/* Avatar 48px — click opens menu dropdown */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={user.username}
                onClick={() => setIsBurgerOpen((prev) => !prev)}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 0,
                  display: 'block',
                  objectFit: 'cover',
                  cursor: 'pointer',
                  border: isBurgerOpen ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'border-color 150ms',
                }}
              />
            ) : (
              <div
                onClick={() => setIsBurgerOpen((prev) => !prev)}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 0,
                  background: 'var(--bg-input)',
                  border: isBurgerOpen ? '2px solid var(--accent)' : '1px solid var(--border-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  transition: 'border-color 150ms',
                }}
              >
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Menu Dropdown — anchored to avatar */}
            {isBurgerOpen && (
              <>
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 98,
                  }}
                  onClick={() => setIsBurgerOpen(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 'var(--space-1)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    zIndex: 99,
                    minWidth: '160px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      navigateToSettings();
                      setIsBurgerOpen(false);
                    }}
                    style={burgerItemStyle}
                    onMouseEnter={burgerItemHoverIn}
                    onMouseLeave={burgerItemHoverOut}
                  >
                    Settings
                  </button>
                  <div
                    style={{
                      borderTop: '1px solid var(--border-default)',
                      margin: '0',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleLogout}
                    style={{
                      ...burgerItemStyle,
                      color: 'var(--error)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-surface)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    Abmelden
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Username */}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-4xl)',
              color: 'var(--warning)',
              fontWeight: 700,
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {user.username}
          </span>

          {/* Title area — fixed width so ↻ and Settings don't jump */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              width: 'min(480px, calc(100vw - 200px))',
              flexShrink: 1,
              minWidth: 0,
              marginTop: '10px',
            }}
          >
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                onBlur={saveTitle}
                maxLength={40}
                style={{
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--accent)',
                  borderRadius: 0,
                  padding: '2px var(--space-2)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xl)',
                  fontWeight: 700,
                  outline: 'none',
                  flex: 1,
                  minWidth: 0,
                }}
              />
            ) : (
              <span
                onClick={startEditTitle}
                title="Click to edit title"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xl)',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
              >
                {profile?.title ? `"${profile.title}"` : '(no title)'}
              </span>
            )}

            {/* Randomize title — recycle arrows icon */}
            <button
              type="button"
              onClick={randomizeTitle}
              title="Random title"
              aria-label="Random title"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 'var(--text-2xl)',
                cursor: 'pointer',
                padding: '0 2px',
                flexShrink: 0,
                transition: 'color 150ms',
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              &#x21BB;
            </button>

            {/* Settings button */}
            <button
              type="button"
              onClick={() => navigateToSettings()}
              title="Settings"
              aria-label="Settings"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-default)',
                borderRadius: 0,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                padding: 'var(--space-1) var(--space-3)',
                flexShrink: 0,
                transition: 'color 150ms, border-color 150ms',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
                e.currentTarget.style.borderColor = 'var(--accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-default)';
              }}
            >
              Settings
            </button>
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Call Indicator */}
        {isInCall && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={navigateToCall}
              style={{
                background: 'transparent',
                border: 'none',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: 'var(--accent)',
                cursor: 'pointer',
                padding: 0,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                transition: 'color 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.textDecoration = 'none';
              }}
            >
              IN CALL: {callDisplayName || '...'}
            </button>
            <button
              type="button"
              onClick={leaveCall}
              title="Leave call"
              style={{
                background: 'transparent',
                border: '1px solid var(--error)',
                borderRadius: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: 'var(--error)',
                cursor: 'pointer',
                padding: 'var(--space-1) var(--space-3)',
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
              [X] LEAVE
            </button>
          </div>
        )}

        {/* Visualizer icon — between call indicator and brand */}
        <WaveformIcon onClick={() => visualizerRef.current?.open()} />

        {/* Brand — far right */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-4xl)',
            fontWeight: 700,
            color: 'var(--accent)',
            letterSpacing: '0.05em',
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          Huddle
        </span>
      </header>

      {/* Main Layout: Sidebar + Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <Sidebar isMobileOpen={isSidebarOpen} onMobileClose={closeSidebar} />

        {/* Content Area */}
        <main
          className="mobile-main-content"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <ContentArea view={activeView} />
        </main>
      </div>

      {/* Settings Overlay */}
      {activeView.type === 'settings' && (
        <OverlayPanel onClose={navigateToWelcome}>
          <SettingsPage onBack={navigateToWelcome} />
        </OverlayPanel>
      )}

    </div>
  );
}

// ── Burger Menu Item Style ─────────────────────────────────

const burgerItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  padding: 'var(--space-2) var(--space-4)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 150ms',
};

function burgerItemHoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'var(--bg-surface)';
}

function burgerItemHoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.background = 'transparent';
}

// ── Overlay Panel ────────────────────────────────────────

/**
 * Returns all tabbable descendants of `root` in document order.
 * Used by OverlayPanel's focus trap (CGL-017 / F-CSD-140).
 */
function getTabbables(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return nodes.filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  });
}

function OverlayPanel({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  // CGL-017 / F-CSD-140: focus trap + initial focus on PROFILE tab +
  // restoration to the opener on close.
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Capture opener on mount; restore on unmount.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  // Initial focus: first settings tab (PROFILE) if present, else first tabbable.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const raf = requestAnimationFrame(() => {
      const profileTab = panel.querySelector<HTMLElement>('#tab-profile');
      if (profileTab) {
        profileTab.focus();
      } else {
        const tabbables = getTabbables(panel);
        if (tabbables.length > 0) tabbables[0].focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Escape + Tab trap.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const tabbables = getTabbables(panelRef.current);
        if (tabbables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = tabbables[0];
        const last = tabbables[tabbables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 'var(--space-8)',
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 10, 20, 0.7)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        style={{
          position: 'relative',
          zIndex: 101,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 0,
          maxWidth: '900px',
          width: '100%',
          maxHeight: 'calc(100vh - 64px)',
          overflow: 'auto',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'sticky',
            top: 0,
            float: 'right',
            zIndex: 102,
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: 'var(--space-1) var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
            margin: 'var(--space-2)',
            transition: 'color 150ms, border-color 150ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--accent)';
            e.currentTarget.style.borderColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.borderColor = 'var(--border-default)';
          }}
        >
          X
        </button>
        {children}
      </div>
    </div>
  );
}

// ── Content Area ─────────────────────────────────────────

function ContentArea({
  view,
}: {
  view: ReturnType<typeof useNavigation>['activeView'];
}) {
  if (view.type === 'room') {
    return <RoomView key={view.roomId} roomId={view.roomId} />;
  }

  if (view.type === 'dm') {
    return <DmView key={view.userId} otherUserId={view.userId} />;
  }

  // Welcome view (default) -- also shown when settings/admin overlay is open
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <WelcomeScreen />
    </div>
  );
}
