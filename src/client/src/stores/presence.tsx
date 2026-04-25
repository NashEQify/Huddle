import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  PresenceSyncPayload,
  PresenceOnlinePayload,
  PresenceOfflinePayload,
} from '@huddle/shared';
import { useWs } from './ws';

// ── Types ────────────────────────────────────────────────

interface PresenceContextType {
  onlineUserIds: Set<string>;
  isUserOnline: (userId: string) => boolean;
}

// ── Context ──────────────────────────────────────────────

const PresenceContext = createContext<PresenceContextType | null>(null);

// ── Provider ─────────────────────────────────────────────

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { onMessage } = useWs();
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  // Handle presence.sync — full snapshot
  useEffect(() => {
    return onMessage('presence.sync', (payload) => {
      const data = payload as PresenceSyncPayload;
      const online = new Set<string>();
      for (const user of data.users) {
        if (user.isActive) {
          online.add(user.userId);
        }
      }
      setOnlineUserIds(online);
    });
  }, [onMessage]);

  // Handle presence.online — user came online
  useEffect(() => {
    return onMessage('presence.online', (payload) => {
      const data = payload as PresenceOnlinePayload;
      setOnlineUserIds((prev) => {
        if (prev.has(data.userId)) return prev;
        const next = new Set(prev);
        next.add(data.userId);
        return next;
      });
    });
  }, [onMessage]);

  // Handle presence.offline — user went offline
  useEffect(() => {
    return onMessage('presence.offline', (payload) => {
      const data = payload as PresenceOfflinePayload;
      setOnlineUserIds((prev) => {
        if (!prev.has(data.userId)) return prev;
        const next = new Set(prev);
        next.delete(data.userId);
        return next;
      });
    });
  }, [onMessage]);

  const isUserOnline = useCallback(
    (userId: string): boolean => onlineUserIds.has(userId),
    [onlineUserIds]
  );

  const value = useMemo(
    () => ({ onlineUserIds, isUserOnline }),
    [onlineUserIds, isUserOnline]
  );

  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────

export function usePresence(): PresenceContextType {
  const ctx = useContext(PresenceContext);
  if (!ctx) {
    throw new Error('usePresence must be used within PresenceProvider');
  }
  return ctx;
}
