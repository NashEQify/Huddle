import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import type { WsEventType, WsMessage } from '@huddle/shared';
import { useAuth } from './auth';

// ── Types ────────────────────────────────────────────────

type MessageHandler = (payload: unknown) => void;

interface WsContextType {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  send: (message: WsMessage) => void;
  onMessage: (type: WsEventType, handler: MessageHandler) => () => void;
}

// ── Context ──────────────────────────────────────────────

const WsContext = createContext<WsContextType | null>(null);

// ── Reconnection constants ───────────────────────────────

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

// ── Provider ─────────────────────────────────────────────

export function WsProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const { logout } = useAuth();

  // Refs for stable references across renders
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Map<WsEventType, Set<MessageHandler>>());
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const mountedRef = useRef(true);
  // Keep logout in a ref so the connect() callback's closure always sees the
  // latest function without needing to be recreated on each render.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  // Message queue: buffer messages during disconnect, flush on reconnect (max 50)
  const MESSAGE_QUEUE_MAX = 50;
  const messageQueueRef = useRef<WsMessage[]>([]);

  // Build WebSocket URL from current location (same origin)
  const getWsUrl = useCallback((): string => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }, []);

  // Dispatch incoming message to registered handlers
  const dispatchMessage = useCallback((message: WsMessage) => {
    const handlers = listenersRef.current.get(message.type);
    if (handlers) {
      for (const handler of [...handlers]) {  // spread to snapshot — avoid mutation during iteration
        try {
          handler(message.payload);
        } catch (err) {
          console.error(`[WS] Handler error for ${message.type}:`, err);
        }
      }
    }
  }, []);

  // Schedule reconnection with exponential backoff
  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (intentionalCloseRef.current) return;

    const delay = backoffRef.current;
    console.log(`[WS] Reconnecting in ${delay}ms...`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectFn();
    }, delay);

    // Increase backoff for next attempt
    backoffRef.current = Math.min(
      backoffRef.current * BACKOFF_MULTIPLIER,
      MAX_BACKOFF_MS
    );
  }, []);

  // Clear any pending reconnect timer
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Don't connect if already connected or connecting
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    intentionalCloseRef.current = false;
    clearReconnectTimer();

    const url = getWsUrl();
    console.log(`[WS] Connecting to ${url}`);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      console.log('[WS] Connected');
      setIsConnected(true);
      // Reset backoff on successful connection
      backoffRef.current = INITIAL_BACKOFF_MS;

      // Flush queued messages
      const queued = messageQueueRef.current;
      if (queued.length > 0) {
        console.log(`[WS] Flushing ${queued.length} queued messages`);
        messageQueueRef.current = [];
        for (const msg of queued) {
          ws.send(JSON.stringify(msg));
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WsMessage;
        dispatchMessage(message);
      } catch {
        console.warn('[WS] Failed to parse message:', event.data);
      }
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      console.log(`[WS] Closed (code=${event.code}, reason=${event.reason})`);

      // Only update state if this is still the current connection.
      // A stale connection's close event should not overwrite the current state.
      if (wsRef.current === ws) {
        wsRef.current = null;
        setIsConnected(false);
      }

      // Don't reconnect on intentional close, auth rejection, replacement,
      // or account deactivation. Per spec 25-websocket §25.1.1 + §25.3,
      // codes 4000/4001/4004 are terminal.
      // 4000 = replaced by new connection (same user, duplicate tab or StrictMode)
      // 4001 = unauthorized (invalid session)
      // 4004 = account deactivated (admin kicked the user; server calls
      //        `removeAllConnectionsForUser`). Client MUST logout so the
      //        auth-guarded routes unmount and LoginPage re-renders —
      //        otherwise the user stays stuck on an authenticated shell
      //        with a dead connection.
      if (event.code === 4004) {
        // Fire-and-forget: clears auth state → AppContent renders LoginPage.
        // We don't block the onclose path on the network call.
        void logoutRef.current();
        return;
      }
      if (intentionalCloseRef.current || event.code === 4001 || event.code === 4000) {
        return;
      }

      // Only schedule reconnect if this was the current connection
      if (wsRef.current === null) {
        scheduleReconnect(connect);
      }
    };

    ws.onerror = (event) => {
      console.error('[WS] Error:', event);
      // onclose will fire after onerror, handling reconnection
    };
  }, [getWsUrl, dispatchMessage, scheduleReconnect, clearReconnectTimer]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    clearReconnectTimer();

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setIsConnected(false);
  }, [clearReconnectTimer]);

  // Send a message over WebSocket (queues if disconnected, max 50).
  // Per CGL-009 + spec 25-websocket §25.7: on overflow we drop the OLDEST
  // queued message, not the newest — ensures the most recent user actions
  // survive the reconnect window and matches spec wording "oldest dropped".
  const send = useCallback((message: WsMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      const queue = messageQueueRef.current;
      if (queue.length >= MESSAGE_QUEUE_MAX) {
        const dropped = queue.shift();
        console.warn(
          `[WS] Queue full (${MESSAGE_QUEUE_MAX}), dropped oldest:`,
          dropped?.type,
        );
      }
      queue.push(message);
      console.log(`[WS] Queued message (${queue.length}/${MESSAGE_QUEUE_MAX}):`, message.type);
    }
  }, []);

  // Register an event handler. Returns unsubscribe function.
  const onMessage = useCallback(
    (type: WsEventType, handler: MessageHandler): (() => void) => {
      const listeners = listenersRef.current;
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(handler);

      // Return unsubscribe
      return () => {
        const set = listeners.get(type);
        if (set) {
          set.delete(handler);
          if (set.size === 0) {
            listeners.delete(type);
          }
        }
      };
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      intentionalCloseRef.current = true;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmount');
        wsRef.current = null;
      }
    };
  }, [clearReconnectTimer]);

  return (
    <WsContext.Provider
      value={{ isConnected, connect, disconnect, send, onMessage }}
    >
      {children}
    </WsContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────

export function useWs(): WsContextType {
  const ctx = useContext(WsContext);
  if (!ctx) {
    throw new Error('useWs must be used within WsProvider');
  }
  return ctx;
}
