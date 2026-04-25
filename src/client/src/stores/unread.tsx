/**
 * Unread Store -- Tracks unread state for rooms and DMs
 *
 * Server-side read positions (ReadPosition model) persist across reloads.
 * On WS connect the server sends `unread.init` with scope keys that have
 * unread messages. Real-time `message.new` events continue to drive live
 * updates. When the user navigates to a scope, `mark_read` is sent to the
 * server to upsert the read position.
 *
 * Keys:
 * - Rooms:  "room:{roomId}"
 * - DMs:    "dm-user:{userId}"  (keyed by the other user's ID, not directId)
 *
 * Filtering:
 * - Only joined rooms produce unread indicators (per spec 20.1)
 * - DMs always produce unread indicators
 * - Self-authored messages never increment unread count
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  MessageNewPayload,
  UnreadInitPayload,
} from '@huddle/shared';
import { useWs } from './ws';
import { useNavigation, type ActiveView } from './navigation';
import { useAuth } from './auth';
import { playMessageSound } from '../lib/notification-sound';
import {
  requestNotificationPermission,
  showNotification,
} from '../lib/notifications';
import { api } from '../lib/api';

// ── Types ────────────────────────────────────────────────

interface UnreadContextType {
  /** Check if a scope key has any unread messages */
  hasUnread: (scopeKey: string) => boolean;
  /** Get the unread count for a specific scope */
  getUnreadCount: (scopeKey: string) => number;
  /** Total unread count across all scopes */
  totalUnreadCount: number;
  /** Clear unread state for a scope (called on navigation) */
  clearUnread: (scopeKey: string) => void;
}

// ── Context ──────────────────────────────────────────────

const UnreadContext = createContext<UnreadContextType | null>(null);

// ── Helpers ──────────────────────────────────────────────

/** Derive the unread scope key from the current active view */
function activeViewToScopeKey(view: ActiveView): string | null {
  switch (view.type) {
    case 'room':
      return `room:${view.roomId}`;
    case 'dm':
      return `dm-user:${view.userId}`;
    default:
      return null;
  }
}

/** Send mark_read to the server via WS */
function sendMarkRead(
  send: (msg: { type: 'mark_read'; payload: { scopeType: 'room' | 'direct'; scopeId: string } }) => void,
  view: ActiveView,
  directIdCache: Map<string, string>,
): void {
  if (view.type === 'room') {
    send({
      type: 'mark_read',
      payload: { scopeType: 'room', scopeId: view.roomId },
    });
  } else if (view.type === 'dm') {
    const directId = directIdCache.get(view.userId);
    if (directId) {
      send({
        type: 'mark_read',
        payload: { scopeType: 'direct', scopeId: directId },
      });
    }
    // If no directId yet, the DM entity doesn't exist — nothing to mark
  }
}

// ── Provider ─────────────────────────────────────────────

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { onMessage, send } = useWs();
  const { activeView } = useNavigation();
  const { user } = useAuth();

  // Map<scopeKey, unreadCount>
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(
    new Map(),
  );

  // Cache: dm-user userId -> directConversation.id
  const directIdCacheRef = useRef<Map<string, string>>(new Map());

  // Track whether we've already requested notification permission
  const hasRequestedPermissionRef = useRef(false);

  // Ref for activeView so WS callback always has latest value
  const activeViewRef = useRef<ActiveView>(activeView);
  activeViewRef.current = activeView;

  // Ref for current user ID
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  // Ref for send so callbacks always have latest
  const sendRef = useRef(send);
  sendRef.current = send;

  // ── Listen to unread.init WS event ─────────────────────

  useEffect(() => {
    return onMessage('unread.init', (payload) => {
      const data = payload as UnreadInitPayload;
      const currentScopeKey = activeViewToScopeKey(activeViewRef.current);

      setUnreadCounts(() => {
        const next = new Map<string, number>();
        for (const scopeKey of data.unreadScopes) {
          // Don't set unread for the currently active scope
          if (scopeKey === currentScopeKey) continue;
          next.set(scopeKey, 1); // dot only, count=1 is sufficient
        }
        return next;
      });

      // If the user is currently viewing a scope that was in the unread list,
      // send mark_read immediately so the server knows it's been seen
      if (currentScopeKey && data.unreadScopes.includes(currentScopeKey)) {
        sendMarkRead(sendRef.current, activeViewRef.current, directIdCacheRef.current);
      }
    });
  }, [onMessage]);

  // ── Listen to message.new WS events ───────────────────

  useEffect(() => {
    return onMessage('message.new', (payload) => {
      const msg = payload as MessageNewPayload;

      // Never count self-authored messages
      if (msg.authorId === userIdRef.current) return;

      // Determine the scope key for this message
      let scopeKey: string | null = null;

      if (msg.scopeType === 'room') {
        scopeKey = `room:${msg.scopeId}`;
      } else if (msg.scopeType === 'direct') {
        // For DMs, key by the author's userId (the other person sending us a message)
        scopeKey = `dm-user:${msg.authorId}`;
        // Cache the directId for mark_read resolution
        directIdCacheRef.current.set(msg.authorId, msg.scopeId);
      }

      if (!scopeKey) return;

      // Check if this scope is currently active (user is looking at it)
      const currentScopeKey = activeViewToScopeKey(activeViewRef.current);
      if (currentScopeKey === scopeKey && document.hasFocus()) return;

      // Increment unread count
      setUnreadCounts((prev) => {
        const next = new Map(prev);
        next.set(scopeKey, (prev.get(scopeKey) ?? 0) + 1);
        return next;
      });

      // Play notification sound when tab is unfocused OR the incoming message
      // is for a scope different from the one currently viewed.
      // CGL-008 / spec 20.3: sound triggers on blur OR scope-mismatch, not
      // only on blur.
      if (!document.hasFocus() || currentScopeKey !== scopeKey) {
        playMessageSound();
      }

      // Browser notifications disabled for messages — only used for incoming calls
      // (see IncomingCallOverlay.tsx)
    });
  }, [onMessage]);

  // ── Resolve directId for DM views ──────────────────────
  // When navigating to a DM, ensure we have the directId cached for mark_read

  useEffect(() => {
    if (activeView.type === 'dm') {
      const otherUserId = activeView.userId;
      if (!directIdCacheRef.current.has(otherUserId)) {
        api
          .get<{ directId: string | null }>(`/api/direct/${otherUserId}`)
          .then((result) => {
            if (result.ok && result.data.directId) {
              directIdCacheRef.current.set(otherUserId, result.data.directId);
              // Now send mark_read since we have the directId
              sendRef.current({
                type: 'mark_read',
                payload: { scopeType: 'direct', scopeId: result.data.directId },
              });
            }
          });
      }
    }
  }, [activeView]);

  // ── Clear unread on navigation + send mark_read ────────

  useEffect(() => {
    const scopeKey = activeViewToScopeKey(activeView);
    if (scopeKey) {
      setUnreadCounts((prev) => {
        if (!prev.has(scopeKey) || prev.get(scopeKey) === 0) return prev;
        const next = new Map(prev);
        next.delete(scopeKey);
        return next;
      });

      // Send mark_read to server
      sendMarkRead(send, activeView, directIdCacheRef.current);
    }
  }, [activeView, send]);

  // ── Clear active scope on window focus + send mark_read ─

  useEffect(() => {
    const handleFocus = () => {
      const scopeKey = activeViewToScopeKey(activeViewRef.current);
      if (scopeKey) {
        setUnreadCounts((prev) => {
          if (!prev.has(scopeKey) || prev.get(scopeKey) === 0) return prev;
          const next = new Map(prev);
          next.delete(scopeKey);
          return next;
        });

        // Send mark_read to server
        sendMarkRead(sendRef.current, activeViewRef.current, directIdCacheRef.current);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // ── Tab title with unread scope-count ─────────────────
  // CGL-005 / overview.md §F + spec 20.5: the `(N)` prefix is the number of
  // SCOPES with unread messages, not the total message count. (e.g. 3 unread
  // rooms + 1 unread DM = "(4) Huddle", regardless of per-scope counts.)

  const totalUnreadCount = useMemo(() => {
    let scopesWithUnread = 0;
    for (const count of unreadCounts.values()) {
      if (count > 0) scopesWithUnread += 1;
    }
    return scopesWithUnread;
  }, [unreadCounts]);

  useEffect(() => {
    document.title =
      totalUnreadCount > 0
        ? `(${totalUnreadCount}) Huddle`
        : 'Huddle';
  }, [totalUnreadCount]);

  // ── API ───────────────────────────────────────────────

  const hasUnread = useCallback(
    (scopeKey: string): boolean => (unreadCounts.get(scopeKey) ?? 0) > 0,
    [unreadCounts],
  );

  const getUnreadCount = useCallback(
    (scopeKey: string): number => unreadCounts.get(scopeKey) ?? 0,
    [unreadCounts],
  );

  const clearUnread = useCallback((scopeKey: string): void => {
    setUnreadCounts((prev) => {
      if (!prev.has(scopeKey) || prev.get(scopeKey) === 0) return prev;
      const next = new Map(prev);
      next.delete(scopeKey);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      hasUnread,
      getUnreadCount,
      totalUnreadCount,
      clearUnread,
    }),
    [hasUnread, getUnreadCount, totalUnreadCount, clearUnread],
  );

  return (
    <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────

export function useUnread(): UnreadContextType {
  const ctx = useContext(UnreadContext);
  if (!ctx) {
    throw new Error('useUnread must be used within UnreadProvider');
  }
  return ctx;
}
