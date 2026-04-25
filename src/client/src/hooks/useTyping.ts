/**
 * useTyping — Client-side typing indicator hook
 *
 * Manages sending typing.start/typing.stop WS events
 * and receiving typing.update events for the current scope.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WsEventType } from '@huddle/shared';
import { useWs } from '../stores/ws';
import { useAuth } from '../stores/auth';

interface TypingState {
  /** User IDs currently typing in this scope (excluding self) */
  typingUserIds: string[];
  /** Call this on every keystroke in the message input */
  handleKeystroke: () => void;
  /** Call this right before sending a message */
  handleSendStart: () => void;
}

const IDLE_TIMEOUT_MS = 3_000;

export function useTyping(
  scopeType: 'room' | 'direct',
  scopeId: string | null
): TypingState {
  const { send, onMessage } = useWs();
  const { user } = useAuth();

  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);

  // Ref-based state for the sending side (avoids re-renders on every keystroke)
  const isTypingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentScopeRef = useRef<{ scopeType: string; scopeId: string } | null>(null);

  // Update current scope ref
  useEffect(() => {
    currentScopeRef.current = scopeId ? { scopeType, scopeId } : null;
  }, [scopeType, scopeId]);

  // ── Send typing.start ──────────────────────────────────
  const sendTypingStart = useCallback(() => {
    if (!scopeId) return;
    send({
      type: 'typing.start',
      payload: { scopeType, scopeId },
    });
  }, [send, scopeType, scopeId]);

  // ── Send typing.stop ───────────────────────────────────
  const sendTypingStop = useCallback(() => {
    if (!scopeId) return;
    send({
      type: 'typing.stop',
      payload: { scopeType, scopeId },
    });
  }, [send, scopeType, scopeId]);

  // ── Handle keystroke (called on every keypress) ────────
  const handleKeystroke = useCallback(() => {
    if (!scopeId) return;

    // If not already in typing state, send typing.start
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      sendTypingStart();
    }

    // Reset the idle timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    // After 3s of no keystrokes, send typing.stop
    idleTimerRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        sendTypingStop();
      }
      idleTimerRef.current = null;
    }, IDLE_TIMEOUT_MS);
  }, [scopeId, sendTypingStart, sendTypingStop]);

  // ── Handle send start (called before message send) ────
  const handleSendStart = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      sendTypingStop();
    }
  }, [sendTypingStop]);

  // ── Cleanup on scope change ────────────────────────────
  // When scope changes, send typing.stop for the old scope
  const prevScopeRef = useRef<{ scopeType: string; scopeId: string } | null>(null);

  useEffect(() => {
    const prevScope = prevScopeRef.current;
    const newScope = scopeId ? { scopeType, scopeId } : null;

    if (
      prevScope &&
      isTypingRef.current &&
      (prevScope.scopeType !== newScope?.scopeType ||
        prevScope.scopeId !== newScope?.scopeId)
    ) {
      // Send typing.stop for the previous scope
      send({
        type: 'typing.stop',
        payload: { scopeType: prevScope.scopeType, scopeId: prevScope.scopeId },
      });
      isTypingRef.current = false;
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    }

    prevScopeRef.current = newScope;

    // Reset typing state for new scope
    setTypingUserIds([]);
  }, [scopeType, scopeId, send]);

  // ── Cleanup on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      // Note: can't reliably send WS on unmount, server 5s timeout handles it
    };
  }, []);

  // ── Receive typing.update events ───────────────────────
  useEffect(() => {
    return onMessage('typing.update', (payload) => {
      const data = payload as {
        scopeType: string;
        scopeId: string;
        typingUserIds: string[];
      };

      // Only update if this event is for our current scope
      if (data.scopeType === scopeType && data.scopeId === scopeId) {
        // Filter out our own user ID
        const filtered = data.typingUserIds.filter((id) => id !== user?.id);
        setTypingUserIds(filtered);
      }
    });
  }, [onMessage, scopeType, scopeId, user?.id]);

  return {
    typingUserIds,
    handleKeystroke,
    handleSendStart,
  };
}
