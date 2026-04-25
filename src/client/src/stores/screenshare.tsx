/**
 * Screenshare Store -- Tracks active room and DM screenshares
 *
 * Room screenshare: one per room, scoped to joined members
 * DM screenshare: one per DM, scoped to DM participants
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { Room, RoomEvent, Track, ScreenSharePresets } from 'livekit-client';
import type {
  ScreenshareStartedPayload,
  ScreenshareEndedPayload,
  ScreenshareTakeoverPayload,
  CallScope,
} from '@huddle/shared';
import { useWs } from './ws';
import { useCall } from './call';
import { api } from '../lib/api';
import { getLivekitUrl } from '../lib/livekit-url';

// ── Types ────────────────────────────────────────────────

export interface ActiveScreenshare {
  mode: 'room' | 'direct';
  scopeId: string;
  userId: string;
  sourceRoomId?: string;
  sourceRoomName?: string;
}

interface ScreenshareState {
  /** All known active screenshares */
  screenshares: ActiveScreenshare[];
  /** LiveKit Room instance for the user's own screenshare (if active) */
  localScreenshareRoom: Room | null;
  /** The mode of the user's active screenshare */
  localScreenshareMode: 'room' | 'direct' | null;
  /** The scopeId (roomId or directId) of the user's active screenshare */
  localScreenshareScopeId: string | null;
  /** Whether we're currently starting a screenshare */
  isStarting: boolean;
}

export interface ScreenshareResult {
  ok: boolean;
  error?: string;
}

interface ScreenshareContextType {
  state: ScreenshareState;
  /** Start a room screenshare. Auto-joins the room call if needed. */
  startRoomScreenshare: (roomId: string) => Promise<ScreenshareResult>;
  /** Start a DM screenshare. Auto-joins the DM call if needed. */
  startDmScreenshare: (directId: string) => Promise<ScreenshareResult>;
  /** Stop the current screenshare */
  stopScreenshare: () => void;
  /** Get the active room screenshare for a specific room */
  getRoomScreenshare: (roomId: string) => ActiveScreenshare | undefined;
  /** Get the active DM screenshare for a specific DM */
  getDmScreenshare: (directId: string) => ActiveScreenshare | undefined;
  /** Get all active room screenshares */
  getRoomScreenshares: () => ActiveScreenshare[];
  /** Check if current user has an active screenshare */
  hasActiveScreenshare: boolean;
}

// ── Context ──────────────────────────────────────────────

const ScreenshareContext = createContext<ScreenshareContextType | null>(null);

// ── Provider ─────────────────────────────────────────────

export function ScreenshareProvider({ children }: { children: ReactNode }) {
  const { onMessage } = useWs();
  const { joinCall, state: callState } = useCall();

  const [screenshares, setScreenshares] = useState<ActiveScreenshare[]>([]);
  const [localRoom, setLocalRoom] = useState<Room | null>(null);
  const [localMode, setLocalMode] = useState<'room' | 'direct' | null>(null);
  const [localScopeId, setLocalScopeId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const localRoomRef = useRef<Room | null>(null);
  const isStartingRef = useRef(false);
  const activeScopeRef = useRef(callState.activeScope);
  activeScopeRef.current = callState.activeScope;
  // CGL-007: refs so the takeover WS listener can inspect current local share
  const localModeRef = useRef<'room' | 'direct' | null>(null);
  localModeRef.current = localMode;
  const localScopeIdRef = useRef<string | null>(null);
  localScopeIdRef.current = localScopeId;

  // ── Fetch initial screenshares ──────────────────────────

  useEffect(() => {
    let mounted = true;
    (async () => {
      const result = await api.get<{ screenshares: ActiveScreenshare[] }>(
        '/api/livekit/screenshares'
      );
      if (result.ok && mounted) {
        setScreenshares(
          result.data.screenshares.filter((s) => s.mode === 'room' || s.mode === 'direct')
        );
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ── WS Event Listeners ──────────────────────────────────

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onMessage('screenshare.started', (payload) => {
        const data = payload as ScreenshareStartedPayload;
        // Track room and DM screenshares
        if (data.mode !== 'room' && data.mode !== 'direct') return;
        setScreenshares((prev) => {
          // Replace existing entry for same mode+scopeId (takeover)
          const filtered = prev.filter(
            (s) => !(s.mode === data.mode && s.scopeId === data.scopeId)
          );
          return [
            ...filtered,
            {
              mode: data.mode as 'room' | 'direct',
              scopeId: data.scopeId,
              userId: data.userId,
              sourceRoomId: data.sourceRoomId,
              sourceRoomName: data.sourceRoomName,
            },
          ];
        });
      })
    );

    unsubs.push(
      onMessage('screenshare.ended', (payload) => {
        const data = payload as ScreenshareEndedPayload;
        if (data.mode !== 'room' && data.mode !== 'direct') return;
        setScreenshares((prev) =>
          prev.filter((s) => !(s.mode === data.mode && s.scopeId === data.scopeId))
        );
      })
    );

    // CGL-007: Server emits `screenshare.takeover` targeted to the prior
    // publisher (via `sendToUser`) when another user begins publishing to
    // the same (mode, scopeId). The prior publisher MUST disconnect its
    // local screenshare Room so that the old track does not linger on the
    // LiveKit room alongside the new publisher's track.
    // Per spec 50-screenshare §4: "the previous screenshare is ended first".
    unsubs.push(
      onMessage('screenshare.takeover', (payload) => {
        const data = payload as ScreenshareTakeoverPayload;
        if (data.mode !== 'room' && data.mode !== 'direct') return;
        // Defensive: only tear down if the local share actually matches the
        // takeover scope. Because the server targets this event via
        // sendToUser() only the prior publisher receives it, but a stale
        // event after the user has already stopped should be a no-op.
        if (
          localModeRef.current === data.mode &&
          localScopeIdRef.current === data.scopeId
        ) {
          cleanupRef.current();
        }
      })
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [onMessage]);

  // ── Stop Screenshare ────────────────────────────────────

  const cleanup = useCallback(() => {
    const room = localRoomRef.current;
    if (room) {
      room.disconnect();
      localRoomRef.current = null;
    }
    setLocalRoom(null);
    setLocalMode(null);
    setLocalScopeId(null);
  }, []);

  // CGL-007: ref-forwarded cleanup so the WS effect (which ordering-wise
  // lives above the `cleanup` definition) can invoke the latest cleanup
  // when a `screenshare.takeover` event arrives.
  const cleanupRef = useRef(cleanup);
  cleanupRef.current = cleanup;

  // ── Generic start screenshare (shared logic) ────────────

  const startScreenshareInternal = useCallback(
    async (
      mode: 'room' | 'direct',
      scopeId: string,
    ): Promise<ScreenshareResult> => {
      if (isStartingRef.current) return { ok: false, error: 'Already starting a screenshare' };
      isStartingRef.current = true;
      setIsStarting(true);

      // Capture screen FIRST while user gesture is still valid.
      // If we do async work (joinCall, token fetch, room.connect) before
      // getDisplayMedia(), the browser's user gesture context expires (~5s)
      // and the call fails silently.
      let screenStream: MediaStream;
      try {
        if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
          isStartingRef.current = false;
          setIsStarting(false);
          return { ok: false, error: 'Screen sharing is not supported on this device' };
        }
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1920, height: 1080, frameRate: 30 },
          audio: false,
        });
      } catch (err) {
        // User cancelled or browser blocked
        isStartingRef.current = false;
        setIsStarting(false);
        const errMsg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Screen capture failed: ${errMsg}` };
      }

      try {
        // Auto-join call if not already in one (per Invariant E, no prompt)
        if (!activeScopeRef.current) {
          console.log(`[SS] Auto-joining call for ${mode} screenshare...`);
          const callScope: CallScope = mode === 'room'
            ? { type: 'room', id: scopeId }
            : { type: 'direct', id: scopeId };
          const joinResult = await joinCall(callScope, false);
          if (!joinResult.ok) {
            // Stop the captured stream since we can't proceed
            for (const track of screenStream.getTracks()) track.stop();
            isStartingRef.current = false;
            setIsStarting(false);
            return { ok: false, error: `Failed to join ${mode} call` };
          }
        } else {
          // Verify active call matches screenshare scope
          const activeType = activeScopeRef.current.type;
          const activeId = activeScopeRef.current.id;
          const targetType = mode === 'room' ? 'room' : 'direct';
          if (activeType !== targetType || activeId !== scopeId) {
            for (const track of screenStream.getTracks()) track.stop();
            isStartingRef.current = false;
            setIsStarting(false);
            return { ok: false, error: 'Leave your current call first to screenshare here' };
          }
        }

        // Get token for screenshare room
        const prefix = mode === 'room' ? 'ss:room' : 'ss:dm';
        const livekitRoomName = `${prefix}:${scopeId}`;
        console.log(`[SS] Getting token for ${mode} screenshare...`);
        const tokenResult = await api.post<{ token: string }>(
          '/api/livekit/token',
          { roomName: livekitRoomName }
        );

        if (!tokenResult.ok) {
          for (const track of screenStream.getTracks()) track.stop();
          isStartingRef.current = false;
          setIsStarting(false);
          return { ok: false, error: 'Failed to get screenshare token' };
        }

        // Create LiveKit room for screenshare
        console.log('[SS] Connecting to LiveKit room...');
        const room = new Room();
        localRoomRef.current = room;

        await room.connect(await getLivekitUrl(), tokenResult.data.token);
        console.log('[SS] Connected. Publishing pre-captured screen track...');

        // Publish the already-captured track (no getDisplayMedia needed here)
        const videoTrack = screenStream.getVideoTracks()[0];
        try {
          await room.localParticipant.publishTrack(videoTrack, {
            source: Track.Source.ScreenShare,
            videoEncoding: ScreenSharePresets.h1080fps30.encoding,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[SS] Screen share publish failed:', errMsg, err);
          for (const track of screenStream.getTracks()) track.stop();
          room.disconnect();
          localRoomRef.current = null;
          isStartingRef.current = false;
          setIsStarting(false);
          return { ok: false, error: `Screen capture failed: ${errMsg}` };
        }

        console.log('[SS] Screen capture started successfully');

        // Handle user stopping sharing via the browser's native "Stop sharing" button
        videoTrack.onended = () => {
          cleanup();
        };

        // Track ended (user stops sharing via browser UI)
        room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare) {
            cleanup();
          }
        });

        room.on(RoomEvent.Disconnected, () => {
          cleanup();
        });

        setLocalRoom(room);
        setLocalMode(mode);
        setLocalScopeId(scopeId);
        isStartingRef.current = false;
        setIsStarting(false);
        return { ok: true };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[SS] Failed to start ${mode} screenshare:`, errMsg, err);
        // Stop the captured stream on any failure
        for (const track of screenStream.getTracks()) track.stop();
        if (localRoomRef.current) {
          localRoomRef.current.disconnect();
          localRoomRef.current = null;
        }
        isStartingRef.current = false;
        setIsStarting(false);
        return { ok: false, error: `Screenshare failed: ${errMsg}` };
      }
    },
    [joinCall, cleanup]
  );

  // ── Start Room Screenshare ──────────────────────────────

  const startRoomScreenshare = useCallback(
    async (roomId: string): Promise<ScreenshareResult> => {
      return startScreenshareInternal('room', roomId);
    },
    [startScreenshareInternal]
  );

  // ── Start DM Screenshare ────────────────────────────────

  const startDmScreenshare = useCallback(
    async (directId: string): Promise<ScreenshareResult> => {
      return startScreenshareInternal('direct', directId);
    },
    [startScreenshareInternal]
  );

  const stopScreenshare = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // ── Stop screenshare when call is left (spec: screenshare requires call) ──

  const prevActiveScopeRef = useRef(callState.activeScope);
  useEffect(() => {
    const prev = prevActiveScopeRef.current;
    prevActiveScopeRef.current = callState.activeScope;

    // If user was in a call and now is not, stop their local screenshare
    if (prev !== null && callState.activeScope === null) {
      cleanup();
    }
  }, [callState.activeScope, cleanup]);

  // ── Helpers ──────────────────────────────────────────────

  const getRoomScreenshare = useCallback(
    (roomId: string) =>
      screenshares.find((s) => s.mode === 'room' && s.scopeId === roomId),
    [screenshares]
  );

  const getDmScreenshare = useCallback(
    (directId: string) =>
      screenshares.find((s) => s.mode === 'direct' && s.scopeId === directId),
    [screenshares]
  );

  const getRoomScreenshares = useCallback(
    () => screenshares.filter((s) => s.mode === 'room'),
    [screenshares]
  );

  const hasActiveScreenshare = localMode !== null;

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      const room = localRoomRef.current;
      if (room) {
        room.disconnect();
      }
    };
  }, []);

  const state = useMemo<ScreenshareState>(() => ({
    screenshares,
    localScreenshareRoom: localRoom,
    localScreenshareMode: localMode,
    localScreenshareScopeId: localScopeId,
    isStarting,
  }), [screenshares, localRoom, localMode, localScopeId, isStarting]);

  const contextValue = useMemo<ScreenshareContextType>(() => ({
    state,
    startRoomScreenshare,
    startDmScreenshare,
    stopScreenshare,
    getRoomScreenshare,
    getDmScreenshare,
    getRoomScreenshares,
    hasActiveScreenshare,
  }), [state, startRoomScreenshare, startDmScreenshare, stopScreenshare, getRoomScreenshare, getDmScreenshare, getRoomScreenshares, hasActiveScreenshare]);

  return (
    <ScreenshareContext.Provider value={contextValue}>
      {children}
    </ScreenshareContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────

export function useScreenshare(): ScreenshareContextType {
  const ctx = useContext(ScreenshareContext);
  if (!ctx) {
    throw new Error('useScreenshare must be used within ScreenshareProvider');
  }
  return ctx;
}
