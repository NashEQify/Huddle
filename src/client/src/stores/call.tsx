/**
 * Call Store — LiveKit connection management and call state
 *
 * Manages: active call scope, participants, speaking state (with hysteresis),
 * mute/camera toggles, call duration timer.
 */

import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  ConnectionQuality,
  LocalParticipant,
  RemoteParticipant,
  VideoPresets,
  createLocalAudioTrack,
  type Participant,
} from 'livekit-client';
import type {
  CallScope,
  CallParticipant,
  CallStartedPayload,
  CallEndedPayload,
  CallJoinedPayload,
  CallLeftPayload,
  CallParticipantsPayload,
  CallSpeakingPayload,
} from '@huddle/shared';
// ── Background Blur: Self-Hosted MediaPipe Assets ──────────
// Lazy-loaded to prevent track-processors from crashing the call store at module load.
//
// Assets are self-hosted under /mediapipe/ instead of fetched from jsdelivr +
// storage.googleapis.com. Previously, the external CDN fetches silently failed
// in some environments (Brave Shields, offline dev, strict networks), causing
// blur to "toggle without effect" — the user saw no change and no error.
// See IT-1 (2026-04-10): Root-cause for "blur geht gar nicht".
const MEDIAPIPE_WASM_PATH = '/mediapipe/wasm';
const MEDIAPIPE_MODEL_PATH = '/mediapipe/selfie_segmenter.tflite';
// MediaPipe BackgroundBlur radius. Default in track-processors is 10
// (subtle). Higher = stronger blur. Tested values: 10 = barely visible,
// 15 = clearly blurred but recognizable shapes, 20 = strong blur,
// 25 = heavy blur (room layout starts to disappear).
const BLUR_RADIUS = 20;

let _blurModule: {
  BackgroundProcessor: typeof import('@livekit/track-processors').BackgroundProcessor;
  supportsBackgroundProcessors: typeof import('@livekit/track-processors').supportsBackgroundProcessors;
} | null = null;

// Firefox + track-processors = page freeze (TensorFlow.js falls back to CPU,
// no WebGL acceleration). Block blur entirely on Firefox.
const isFirefox = /firefox/i.test(navigator.userAgent);

async function getBlurModule() {
  if (isFirefox) {
    console.info('[Call] Background blur disabled on Firefox (performance)');
    return null;
  }
  if (!_blurModule) {
    try {
      const mod = await import('@livekit/track-processors');
      _blurModule = {
        BackgroundProcessor: mod.BackgroundProcessor,
        supportsBackgroundProcessors: mod.supportsBackgroundProcessors,
      };
    } catch (err) {
      console.error('[Call] Failed to load @livekit/track-processors:', err);
      return null;
    }
  }
  return _blurModule;
}

/** Build a configured BackgroundBlur processor using self-hosted MediaPipe assets.
 *  Must be used instead of the deprecated `BackgroundBlur(radius)` helper because
 *  that helper does NOT expose the `assetPaths` option — which we need to point
 *  MediaPipe at our local wasm + model instead of the external CDN defaults. */
function createBlurProcessor(
  mod: NonNullable<typeof _blurModule>,
  blurRadius = BLUR_RADIUS,
) {
  return mod.BackgroundProcessor(
    {
      mode: 'background-blur',
      blurRadius,
      assetPaths: {
        tasksVisionFileSet: MEDIAPIPE_WASM_PATH,
        modelAssetPath: MEDIAPIPE_MODEL_PATH,
      },
    },
    'background-blur',
  );
}
import { useWs } from './ws';
import { useAuth } from './auth';
import { usePresence } from './presence';
import { api } from '../lib/api';
import { getMediaSettings } from '../hooks/useMediaSettings';
import { createGainPipeline, type GainPipelineResult } from '../lib/audio-utils';
import { getLivekitUrl } from '../lib/livekit-url';
import { buildCameraConstraints } from '../lib/camera-constraints';

// ── Types ────────────────────────────────────────────────

export type JoinCallFailReason =
  | 'already_in_call'
  | 'connecting'
  | 'offline'
  | 'token_failed'
  | 'connect_failed';

export interface JoinCallResult {
  ok: boolean;
  reason?: JoinCallFailReason;
}

interface CallState {
  /** Currently active scope for this user (null = not in a call) */
  activeScope: CallScope | null;
  /** LiveKit Room instance */
  room: Room | null;
  /** Connection state */
  connectionState: ConnectionState;
  /** Are we currently connecting? */
  isConnecting: boolean;
  /** Local muted state */
  isMuted: boolean;
  /** Local camera state */
  hasCamera: boolean;
  /** Background blur active on camera */
  blurEnabled: boolean;
  /** Call joined timestamp (for duration timer) */
  joinedAt: number | null;
  /** Participants in the call (from WS events) */
  participants: CallParticipant[];
  /** Speaking map (userId -> isSpeaking) derived from LiveKit audio levels */
  speakingMap: Map<string, boolean>;
  /** Known active calls per scope (from WS events) */
  activeCalls: Map<string, { scope: CallScope; participants: CallParticipant[]; startedAt: number }>;
  /** Local connection quality */
  connectionQuality: ConnectionQuality;
}

interface IncomingDmCall {
  directId: string;
  callerId: string;
}

interface CallContextType {
  /** Current call state */
  state: CallState;
  /** Join a call. Returns result with reason on failure. For DM calls, pass dmOtherUserId to check online status. */
  joinCall: (scope: CallScope, withCamera?: boolean, dmOtherUserId?: string) => Promise<JoinCallResult>;
  /** Leave the current call */
  leaveCall: () => void;
  /** Toggle microphone mute */
  toggleMute: () => void;
  /** Toggle camera */
  toggleCamera: () => void;
  /** Toggle background blur on camera */
  toggleBlur: () => void;
  /** End call for all participants */
  endCallForAll: (scope: CallScope) => void;
  /** Check if there's an active call for a scope */
  getActiveCall: (scopeKey: string) => { scope: CallScope; participants: CallParticipant[]; startedAt: number } | undefined;
  /** Check if a user is speaking */
  isUserSpeaking: (userId: string) => boolean;
  /** Check if a user is currently in any active call (CGL-014) */
  isUserInAnyCall: (userId: string) => boolean;
  /** Incoming DM call (global — visible on all views) */
  incomingDmCall: IncomingDmCall | null;
  /** Accept the incoming DM call (joins the call). Returns result with reason on failure. */
  acceptIncomingCall: () => Promise<JoinCallResult>;
  /** Decline the incoming DM call (local dismiss, no server action). */
  declineIncomingCall: () => void;
}

function scopeToKey(scope: CallScope): string {
  return `${scope.type}:${scope.id}`;
}

function scopeToLivekitRoom(scope: CallScope): string {
  return scope.type === 'room' ? `call:${scope.id}` : `call:dm:${scope.id}`;
}

// ── Context ──────────────────────────────────────────────

const CallContext = createContext<CallContextType | null>(null);

// ── Speaking Hysteresis ──────────────────────────────────

const SPEAKING_THRESHOLD = 0.01;
const SPEAKING_DECAY_MS = 500;

// ── Provider ─────────────────────────────────────────────

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { send, onMessage } = useWs();
  const { isUserOnline } = usePresence();

  const [activeScope, setActiveScope] = useState<CallScope | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [blurEnabled, setBlurEnabled] = useState(
    () => localStorage.getItem('video.backgroundBlur') === 'true',
  );
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [speakingMap, setSpeakingMap] = useState<Map<string, boolean>>(new Map());
  const [activeCalls, setActiveCalls] = useState<Map<string, { scope: CallScope; participants: CallParticipant[]; startedAt: number }>>(new Map());
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(ConnectionQuality.Excellent);

  const [incomingDmCall, setIncomingDmCall] = useState<IncomingDmCall | null>(null);

  const roomRef = useRef<Room | null>(null);
  const gainPipelineRef = useRef<GainPipelineResult | null>(null);
  const activeScopeRef = useRef<CallScope | null>(null);
  activeScopeRef.current = activeScope;
  const incomingDmCallRef = useRef<IncomingDmCall | null>(null);
  incomingDmCallRef.current = incomingDmCall;

  // Concurrent join guard
  const isConnectingRef = useRef(false);

  // DM call ring timeout: if caller is alone for 30s, auto-leave
  const dmRingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Speaking decay timers
  const speakingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Local speaking state tracking — so we only broadcast on transitions
  const lastLocalSpeakingRef = useRef<boolean>(false);

  // ── LiveKit Event Handlers ──────────────────────────────

  const handleActiveSpeakersChanged = useCallback((speakers: Participant[]) => {
    const speakingIds = new Set(speakers.map((s) => s.identity));
    const localId = user?.id;
    const amISpeaking = localId ? speakingIds.has(localId) : false;

    setSpeakingMap((prev) => {
      const next = new Map(prev);

      // Mark speakers as speaking
      for (const id of speakingIds) {
        next.set(id, true);
        // Clear any pending decay timer
        const existing = speakingTimersRef.current.get(id);
        if (existing) {
          clearTimeout(existing);
          speakingTimersRef.current.delete(id);
        }
      }

      // For users who stopped speaking, set decay timer
      for (const [id, wasSpeaking] of prev) {
        if (wasSpeaking && !speakingIds.has(id)) {
          if (!speakingTimersRef.current.has(id)) {
            const timer = setTimeout(() => {
              setSpeakingMap((m) => {
                const updated = new Map(m);
                updated.set(id, false);
                return updated;
              });
              speakingTimersRef.current.delete(id);
            }, SPEAKING_DECAY_MS);
            speakingTimersRef.current.set(id, timer);
          }
        }
      }

      return next;
    });

    // Broadcast ONLY local speaking state transitions via WebSocket.
    // Per CGL-001 spoofing fix (server-authoritative userId): we send our
    // own isSpeaking flag; the server injects our session userId before
    // relaying to other clients. We never broadcast other users' states.
    if (amISpeaking !== lastLocalSpeakingRef.current && activeScopeRef.current) {
      lastLocalSpeakingRef.current = amISpeaking;
      send({
        type: 'call.speaking',
        payload: {
          scope: activeScopeRef.current,
          isSpeaking: amISpeaking,
        },
      });
    }
  }, [send, user?.id]);

  // ── Cleanup (must be declared before connectToRoom/joinCall) ──

  const isCleaningUpRef = useRef(false);
  const cleanup = useCallback(() => {
    if (isCleaningUpRef.current) return;
    isCleaningUpRef.current = true;

    // Clean up GainNode pipeline
    if (gainPipelineRef.current) {
      gainPipelineRef.current.cleanup();
      gainPipelineRef.current = null;
    }

    const room = roomRef.current;
    if (room) {
      room.disconnect();
      roomRef.current = null;
    }
    setActiveScope(null);
    setConnectionState(ConnectionState.Disconnected);
    setConnectionQuality(ConnectionQuality.Excellent);
    setIsMuted(false);
    setHasCamera(false);
    setBlurEnabled(localStorage.getItem('video.backgroundBlur') === 'true');
    setJoinedAt(null);
    setParticipants([]);
    setSpeakingMap(new Map());

    // Clear DM ring timeout
    if (dmRingTimeoutRef.current) {
      clearTimeout(dmRingTimeoutRef.current);
      dmRingTimeoutRef.current = null;
    }

    // Clear all speaking timers
    for (const timer of speakingTimersRef.current.values()) {
      clearTimeout(timer);
    }
    speakingTimersRef.current.clear();

    // Reset after microtask to cover all sync re-entries
    queueMicrotask(() => { isCleaningUpRef.current = false; });
  }, []);

  // ── Join Call ───────────────────────────────────────────

  /**
   * Connect to a LiveKit room with the given token.
   * Extracted so joinCall can retry on connect failure.
   */
  const connectToRoom = useCallback(async (
    scope: CallScope,
    token: string,
    lkUrl: string,
    livekitRoomName: string,
    withCamera: boolean,
  ): Promise<{ ok: true; room: Room } | { ok: false }> => {
    let room: Room | null = null;
    try {
      // Create LiveKit Room — NO webAudioMix. We handle remote audio
      // playback explicitly via track.attach() in TrackSubscribed handler.
      // adaptiveStream: scales down quality when bandwidth is limited.
      // Keeps full quality when bandwidth is fine, degrades gracefully when not.
      room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      // Wire up event listeners (before connect, but ref set after connect succeeds)
      room.on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
        setConnectionState(s);
      });

      room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged);

      // Attach remote audio tracks to <audio> elements for playback.
      // This is the explicit approach — more reliable than webAudioMix
      // which depends on AudioContext resume timing.
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio && participant.identity !== user?.id) {
          const el = track.attach();
          el.id = `lk-audio-${participant.identity}`;
          document.body.appendChild(el);
          console.log('[Call] Attached remote audio for', participant.identity);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach((el) => el.remove());
          console.log('[Call] Detached remote audio for', participant.identity);
        }
      });

      room.on(RoomEvent.TrackMuted, (publication, participant) => {
        if (publication.source === Track.Source.Microphone && participant.identity === user?.id) {
          setIsMuted(true);
        }
      });

      room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        if (publication.source === Track.Source.Microphone && participant.identity === user?.id) {
          setIsMuted(false);
        }
      });

      room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
        if (participant instanceof LocalParticipant) {
          setConnectionQuality(quality);
        }
      });

      room.on(RoomEvent.Reconnecting, () => {
        // Don't cleanup -- LiveKit is trying to reconnect automatically
        setConnectionState(ConnectionState.Reconnecting);
      });

      room.on(RoomEvent.Reconnected, () => {
        setConnectionState(ConnectionState.Connected);
      });

      room.on(RoomEvent.Disconnected, () => {
        // This fires AFTER LiveKit's built-in reconnect has failed
        cleanup();
      });

      // Read stored settings (spec 70.8)
      const mediaSettings = getMediaSettings();

      // Connect with increased peerConnectionTimeout (30s) to handle
      // machines with many network interfaces generating 20+ ICE candidates
      await room.connect(lkUrl, token, { peerConnectionTimeout: 30_000 });
      roomRef.current = room;

      // Switch output device if stored (spec 70.8 step 2)
      if (mediaSettings.audioOutputDeviceId) {
        try {
          await room.switchActiveDevice('audiooutput', mediaSettings.audioOutputDeviceId);
        } catch {
          // Fall back to browser default silently
        }
      }

      // Enable microphone via GainNode pipeline (spec 70.3, 70.8 step 3)
      try {
        const audioTrack = await createLocalAudioTrack({
          deviceId: mediaSettings.audioInputDeviceId || undefined,
          noiseSuppression: mediaSettings.audioNoiseSuppression,
        });

        // Apply GainNode pipeline for input gain control
        const pipeline = createGainPipeline(
          audioTrack.mediaStreamTrack,
          mediaSettings.audioInputGain,
        );
        gainPipelineRef.current = pipeline;

        // Resume AudioContext — may be suspended if user-gesture context
        // expired during async token fetch + room.connect
        if (pipeline.audioContext.state === 'suspended') {
          await pipeline.audioContext.resume();
        }

        // Publish the processed (post-gain) track as Microphone source
        await room.localParticipant.publishTrack(pipeline.processedTrack, {
          source: Track.Source.Microphone,
        });
      } catch (err) {
        // CGL-006: The GainNode pipeline failed (AudioContext creation refused,
        // getUserMedia edge case, etc). The call can still function with audio
        // via LiveKit's built-in setMicrophoneEnabled path — but that bypasses
        // the GainNode pipeline, so the "Input Gain" slider has NO EFFECT in
        // this mode. This is degradation, not recovery. Log loudly so it
        // surfaces in DevTools rather than being silently mysterious.
        console.error(
          '[Call] GainNode pipeline setup failed — falling back to LiveKit default mic path. '
            + 'Input gain slider will have no effect until call is rejoined. Original error:',
          err,
        );
        gainPipelineRef.current = null;
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          console.warn('[Call] Mic active via fallback path (no GainNode, no input-gain control)');
        } catch (fallbackErr) {
          console.error('[Call] Fallback mic enable also failed — call continues without mic:', fallbackErr);
        }
      }

      // Enable camera if requested (spec 70.8 step 4)
      if (withCamera) {
        try {
          const camConstraints = await buildCameraConstraints(
            mediaSettings.videoCameraDeviceId || undefined,
          );
          await room.localParticipant.setCameraEnabled(true, {
            ...camConstraints,
            resolution: VideoPresets.h1080.resolution,
          });
          setHasCamera(true);

          // Apply background blur if enabled in settings
          const blurSetting = localStorage.getItem('video.backgroundBlur') === 'true';
          if (blurSetting) {
            try {
              const blur = await getBlurModule();
              if (blur && blur.supportsBackgroundProcessors()) {
                const camTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
                if (camTrack) {
                  // Second arg `showProcessedStreamLocally: true` MUST be set —
                  // otherwise the local self-view shows the raw camera while
                  // remote participants see the blurred version. Without it
                  // the user sees "blur doesn't work" (their own preview is
                  // unblurred even though the published track is blurred).
                  await camTrack.setProcessor(createBlurProcessor(blur), true);
                  setBlurEnabled(true);
                }
              } else if (blur) {
                console.warn('[Call] Background blur unsupported in this browser (OffscreenCanvas/WebGL2/VideoFrame check failed)');
              }
            } catch (blurErr) {
              console.error('[Call] Failed to apply background blur on join:', blurErr);
            }
          }
        } catch (err) {
          console.error('Camera failed:', err);
          // Continue with audio-only per spec 40.3
        }
      }

      return { ok: true, room };
    } catch (err) {
      console.error('[Call] connectToRoom failed:', err, 'url:', lkUrl, 'room:', livekitRoomName);
      if (room) room.disconnect();
      return { ok: false };
    }
  }, [user?.id, handleActiveSpeakersChanged, cleanup]);

  const joinCall = useCallback(async (scope: CallScope, withCamera = false, dmOtherUserId?: string): Promise<JoinCallResult> => {
    // Single active call constraint
    if (activeScopeRef.current) {
      console.warn('[Call] Already in a call, cannot join');
      return { ok: false, reason: 'already_in_call' };
    }
    if (isConnectingRef.current) {
      console.warn('[Call] Join already in progress');
      return { ok: false, reason: 'connecting' };
    }
    isConnectingRef.current = true;

    // DM call: prevent calling an offline user
    if (scope.type === 'direct' && dmOtherUserId && !isUserOnline(dmOtherUserId)) {
      console.warn('[Call] Other user is offline');
      isConnectingRef.current = false;
      return { ok: false, reason: 'offline' };
    }

    setIsConnecting(true);

    try {
      // Get LiveKit token
      const livekitRoomName = scopeToLivekitRoom(scope);
      const tokenResult = await api.post<{ token: string }>('/api/livekit/token', {
        roomName: livekitRoomName,
      });

      if (!tokenResult.ok) {
        console.error('[Call] Token request failed:', tokenResult.error);
        isConnectingRef.current = false;
        setIsConnecting(false);
        return { ok: false, reason: 'token_failed' };
      }

      const token = tokenResult.data.token;

      // Determine LiveKit server URL (await ensures config fetch is complete)
      const lkUrl = await getLivekitUrl();
      console.log('[Call] Connecting to LiveKit:', lkUrl, 'room:', livekitRoomName);

      // Try to connect, with one automatic retry on failure
      let result = await connectToRoom(scope, token, lkUrl, livekitRoomName, withCamera);
      if (!result.ok) {
        console.log('[Call] First connect attempt failed, retrying in 1s...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await connectToRoom(scope, token, lkUrl, livekitRoomName, withCamera);
      }

      if (!result.ok) {
        console.error('[Call] Connect failed after retry. URL was:', lkUrl);
        setIsConnecting(false);
        isConnectingRef.current = false;
        cleanup();
        return { ok: false, reason: 'connect_failed' };
      }

      setActiveScope(scope);
      setJoinedAt(Date.now());
      setIsMuted(false);
      setIsConnecting(false);
      setIncomingDmCall(null);
      isConnectingRef.current = false;

      // DM call: start 30s ring timeout — if no second participant joins,
      // auto-leave (spec 40.8 "didn't pick up").
      //
      // CRITICAL: only start the timer if we are ACTUALLY alone in the room.
      // If the other user was already in the call when we joined (i.e. WE are
      // the second joiner answering their call), we must NOT start a ring
      // timer — the server emits `call.joined` only for the NEW joiner, so
      // we would never receive a clear-event for the already-present user,
      // and the timer would fire 30s later and kill a live call.
      //
      // Additionally, the callback re-checks `remoteParticipants.size` at
      // fire time as a second guard in case `call.joined`/`call.participants`
      // were delivered but missed by the clear-path.
      if (scope.type === 'direct' && result.room.remoteParticipants.size === 0) {
        dmRingTimeoutRef.current = setTimeout(() => {
          dmRingTimeoutRef.current = null;
          const current = activeScopeRef.current;
          const room = roomRef.current;
          const stillAlone = room ? room.remoteParticipants.size === 0 : true;
          if (
            current &&
            current.type === 'direct' &&
            current.id === scope.id &&
            stillAlone
          ) {
            console.log('[Call] DM ring timeout — no answer after 30s, leaving call');
            cleanup();
          }
        }, 30_000);
      }

      return { ok: true };
    } catch (err) {
      console.error('Failed to join call:', err);
      setIsConnecting(false);
      isConnectingRef.current = false;
      cleanup();
      return { ok: false, reason: 'connect_failed' };
    }
  }, [connectToRoom, isUserOnline, cleanup]);

  // ── Leave Call ──────────────────────────────────────────

  const leaveCall = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // ── Toggle Mute ─────────────────────────────────────────

  const isMutingRef = useRef(false);
  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room || isMutingRef.current) return;
    isMutingRef.current = true;

    // Read muted state from the track publication to avoid stale closure
    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micPub) {
      const currentlyMuted = micPub.isMuted;
      const newMuted = !currentlyMuted;
      try {
        if (newMuted) {
          await micPub.mute();
        } else {
          await micPub.unmute();
        }
        setIsMuted(newMuted);
      } catch (err) {
        console.error('Mute toggle failed:', err);
      }
    }
    isMutingRef.current = false;
  }, []);

  // ── Toggle Camera ───────────────────────────────────────

  const isTogglingCameraRef = useRef(false);
  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room || isTogglingCameraRef.current) return;
    isTogglingCameraRef.current = true;

    // Read camera state from the track publication to avoid stale closure
    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const currentlyEnabled = camPub ? !camPub.isMuted && camPub.track != null : false;
    const newCamera = !currentlyEnabled;
    try {
      // CGL-005 + iOS facingMode (T14 819bfda): buildCameraConstraints returns
      // either `deviceId` (desktop) or `facingMode` (iOS, where deviceId is
      // ignored by WebKit) — preserving the user's camera choice across
      // camera off→on toggles on both platforms. 1080p resolution is applied
      // on top. Without this, LiveKit picks the browser default on re-enable
      // (regression from the 1080p refactor commit 8adadf1).
      const toggleCamOptions = newCamera
        ? {
            ...(await buildCameraConstraints(
              getMediaSettings().videoCameraDeviceId || undefined,
            )),
            resolution: VideoPresets.h1080.resolution,
          }
        : undefined;
      await room.localParticipant.setCameraEnabled(newCamera, toggleCamOptions);
      setHasCamera(newCamera);

      // Apply background blur if turning camera on and blur is enabled
      if (newCamera) {
        const blurSetting = localStorage.getItem('video.backgroundBlur') === 'true';
        if (blurSetting) {
          try {
            const blur = await getBlurModule();
            if (blur && blur.supportsBackgroundProcessors()) {
              const camTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
              if (camTrack) {
                // showProcessedStreamLocally: true — local self-view sees the blur
                await camTrack.setProcessor(createBlurProcessor(blur), true);
                setBlurEnabled(true);
              }
            } else if (blur) {
              console.warn('[Call] Background blur unsupported in this browser on camera re-enable');
            }
          } catch (blurErr) {
            console.error('[Call] Failed to apply background blur on camera re-enable:', blurErr);
          }
        }
      }
    } catch (err) {
      console.error('Camera toggle failed:', err);
    }
    isTogglingCameraRef.current = false;
  }, []);

  // ── Toggle Background Blur ──────────────────────────────

  const isTogglingBlurRef = useRef(false);
  const toggleBlur = useCallback(async () => {
    const room = roomRef.current;
    if (!room || isTogglingBlurRef.current) return;
    isTogglingBlurRef.current = true;

    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const camTrack = camPub?.track;
    if (!camTrack) {
      isTogglingBlurRef.current = false;
      return;
    }

    const currentBlur = localStorage.getItem('video.backgroundBlur') === 'true';
    const newBlur = !currentBlur;
    localStorage.setItem('video.backgroundBlur', String(newBlur));

    try {
      if (newBlur) {
        const blur = await getBlurModule();
        if (!blur) {
          console.warn('[Call] Background blur disabled (module unavailable or Firefox)');
          localStorage.setItem('video.backgroundBlur', 'false');
          setBlurEnabled(false);
          isTogglingBlurRef.current = false;
          return;
        }
        if (!blur.supportsBackgroundProcessors()) {
          console.warn('[Call] Background blur unsupported by browser (OffscreenCanvas/WebGL2/VideoFrame required)');
          localStorage.setItem('video.backgroundBlur', 'false');
          setBlurEnabled(false);
          isTogglingBlurRef.current = false;
          return;
        }
        // showProcessedStreamLocally: true — local self-view sees the blur
        await camTrack.setProcessor(createBlurProcessor(blur), true);
      } else {
        await camTrack.stopProcessor();
      }
      setBlurEnabled(newBlur);
    } catch (err) {
      console.error('[Call] Failed to toggle background blur:', err);
      // Revert both state and localStorage on failure (CGL-012 state/LS divergence fix)
      localStorage.setItem('video.backgroundBlur', String(currentBlur));
      setBlurEnabled(currentBlur);
    }

    isTogglingBlurRef.current = false;
  }, []);

  // ── End Call for All ────────────────────────────────────

  const endCallForAll = useCallback((scope: CallScope) => {
    send({
      type: 'call.force_end',
      payload: { scope },
    });
  }, [send]);

  // ── Accept / Decline Incoming DM Call ──────────────────

  const acceptIncomingCall = useCallback(async (): Promise<JoinCallResult> => {
    const incoming = incomingDmCallRef.current;
    if (!incoming) {
      console.warn('[Call] No incoming call to accept');
      return { ok: false, reason: 'connect_failed' };
    }
    console.log('[Call] Accepting incoming DM call, directId:', incoming.directId);
    const scope: CallScope = { type: 'direct', id: incoming.directId };
    const result = await joinCall(scope, false);
    console.log('[Call] Accept result:', result.ok, result.reason || '');
    if (result.ok) {
      setIncomingDmCall(null);
    } else {
      console.error('[Call] Accept FAILED for directId:', incoming.directId, 'reason:', result.reason);
    }
    return result;
  }, [joinCall]);

  const declineIncomingCall = useCallback(() => {
    const incoming = incomingDmCallRef.current;
    if (incoming) {
      // Notify the server so the caller is informed and the room is deleted
      send({
        type: 'dm.call.decline',
        payload: {
          directId: incoming.directId,
          callerId: incoming.callerId,
        },
      });
    }
    setIncomingDmCall(null);
  }, [send]);

  // ── WS Event Listeners ─────────────────────────────────

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(onMessage('call.started', (payload) => {
      const data = payload as CallStartedPayload;
      const key = scopeToKey(data.scope);
      setActiveCalls((prev) => {
        const next = new Map(prev);
        next.set(key, { scope: data.scope, participants: [], startedAt: Date.now() });
        return next;
      });
    }));

    unsubs.push(onMessage('call.ended', (payload) => {
      const data = payload as CallEndedPayload;
      const key = scopeToKey(data.scope);
      setActiveCalls((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });

      // If this was our active call, clean up
      const current = activeScopeRef.current;
      if (current && scopeToKey(current) === key) {
        cleanup();
      }

      // Clear incoming DM call banner if applicable
      const incoming = incomingDmCallRef.current;
      if (incoming && data.scope.type === 'direct' && data.scope.id === incoming.directId) {
        setIncomingDmCall(null);
      }
    }));

    unsubs.push(onMessage('call.joined', (payload) => {
      const data = payload as CallJoinedPayload;
      const key = scopeToKey(data.scope);

      // If someone else joined our DM call, clear the ring timeout
      const current = activeScopeRef.current;
      if (
        current &&
        current.type === 'direct' &&
        scopeToKey(current) === key &&
        data.userId !== user?.id &&
        dmRingTimeoutRef.current
      ) {
        clearTimeout(dmRingTimeoutRef.current);
        dmRingTimeoutRef.current = null;
      }

      setActiveCalls((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        if (existing) {
          const alreadyIn = existing.participants.some((p) => p.userId === data.userId);
          if (!alreadyIn) {
            next.set(key, {
              ...existing,
              participants: [...existing.participants, {
                userId: data.userId,
                isMuted: false,
                isSpeaking: false,
                hasCamera: false,
              }],
            });
          }
        } else {
          next.set(key, {
            scope: data.scope,
            participants: [{
              userId: data.userId,
              isMuted: false,
              isSpeaking: false,
              hasCamera: false,
            }],
            startedAt: Date.now(),
          });
        }
        return next;
      });
    }));

    unsubs.push(onMessage('call.left', (payload) => {
      const data = payload as CallLeftPayload;
      const key = scopeToKey(data.scope);
      setActiveCalls((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        if (existing) {
          const remaining = existing.participants.filter(
            (p) => p.userId !== data.userId
          );
          if (remaining.length === 0) {
            next.delete(key);
          } else {
            next.set(key, { ...existing, participants: remaining });
          }
        }
        return next;
      });

      // Clean up speaking state for the leaving user
      setSpeakingMap((prev) => {
        if (!prev.has(data.userId)) return prev;
        const next = new Map(prev);
        next.delete(data.userId);
        return next;
      });

      // Clear incoming DM call banner if the caller left
      const incoming = incomingDmCallRef.current;
      if (
        incoming &&
        data.scope.type === 'direct' &&
        data.scope.id === incoming.directId &&
        data.userId === incoming.callerId
      ) {
        setIncomingDmCall(null);
      }
    }));

    unsubs.push(onMessage('call.participants', (payload) => {
      const data = payload as CallParticipantsPayload;
      const key = scopeToKey(data.scope);
      setActiveCalls((prev) => {
        const next = new Map(prev);
        if (data.participants.length > 0) {
          const existing = next.get(key);
          next.set(key, {
            scope: data.scope,
            participants: data.participants,
            startedAt: existing?.startedAt ?? Date.now(),
          });
        } else {
          next.delete(key);
        }
        return next;
      });

      // If this is our active call, update local participants
      const current = activeScopeRef.current;
      if (current && scopeToKey(current) === key) {
        setParticipants(data.participants);

        // Backstop for DM ring timeout: if the participants list shows anyone
        // besides us, the other side is in the call — clear the ring timer.
        // Covers the "we joined second and never got a call.joined for the
        // already-present user" race.
        if (
          current.type === 'direct' &&
          dmRingTimeoutRef.current &&
          data.participants.some((p) => p.userId !== user?.id)
        ) {
          clearTimeout(dmRingTimeoutRef.current);
          dmRingTimeoutRef.current = null;
        }
      }
    }));

    // Listen for speaking state relayed via WebSocket
    // (used by clients NOT in the call to show speaking indicators).
    //
    // Per CGL-001 spoofing fix: payload is now per-user — `{ scope, userId,
    // isSpeaking }` with server-injected userId. Each broadcast announces ONE
    // user's transition, so receivers update that user's state without
    // decaying others.
    unsubs.push(onMessage('call.speaking', (payload) => {
      const data = payload as CallSpeakingPayload;
      // Skip if we're in this call — we have direct LiveKit data
      const current = activeScopeRef.current;
      if (current && scopeToKey(current) === scopeToKey(data.scope)) {
        return;
      }

      const { userId: targetId, isSpeaking } = data;
      if (!targetId) return;

      setSpeakingMap((prev) => {
        const next = new Map(prev);

        if (isSpeaking) {
          next.set(targetId, true);
          const existing = speakingTimersRef.current.get(targetId);
          if (existing) {
            clearTimeout(existing);
            speakingTimersRef.current.delete(targetId);
          }
        } else if (prev.get(targetId)) {
          // Schedule decay-to-false if not already pending
          if (!speakingTimersRef.current.has(targetId)) {
            const timer = setTimeout(() => {
              setSpeakingMap((m) => {
                const updated = new Map(m);
                updated.set(targetId, false);
                return updated;
              });
              speakingTimersRef.current.delete(targetId);
            }, SPEAKING_DECAY_MS);
            speakingTimersRef.current.set(targetId, timer);
          }
        }

        return next;
      });
    }));

    // ── DM call declined (caller receives this) ──────────
    unsubs.push(onMessage('dm.call.declined', (payload) => {
      const data = payload as { directId: string; declinedBy: string };
      // If the caller is in this DM call, cleanup happens automatically
      // via the room_finished webhook (which fires call.ended).
      // Just log it for debugging.
      console.log('[Call] DM call declined by', data.declinedBy, 'directId:', data.directId);
    }));

    // ── Incoming DM call (global) ─────────────────────────
    unsubs.push(onMessage('dm.call.incoming', (payload) => {
      const data = payload as { directId: string; callerId: string };
      // Only show if not already in a call
      if (!activeScopeRef.current) {
        setIncomingDmCall({ directId: data.directId, callerId: data.callerId });
      }
    }));

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [onMessage, cleanup]);

  // ── Helper: get active call ─────────────────────────────

  const getActiveCall = useCallback(
    (scopeKey: string) => activeCalls.get(scopeKey),
    [activeCalls]
  );

  // ── Helper: is user speaking ────────────────────────────

  const isUserSpeaking = useCallback(
    (userId: string) => speakingMap.get(userId) ?? false,
    [speakingMap]
  );

  // ── Helper: is user in any active call (CGL-014) ────────
  //
  // Walks all known active calls (room + DM) and checks if the userId is
  // listed as a participant. Used by the sidebar + member-strip avatars to
  // show a mic-in-call overlay. Also includes the local user if we're
  // currently in a call (our own participant may arrive via LiveKit events
  // slightly after the activeCalls map is populated via WS).

  const isUserInAnyCall = useCallback(
    (userId: string) => {
      if (activeScope && user?.id === userId) return true;
      for (const { participants } of activeCalls.values()) {
        if (participants.some((p) => p.userId === userId)) return true;
      }
      return false;
    },
    [activeCalls, activeScope, user?.id]
  );

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      if (room) {
        room.disconnect();
      }
    };
  }, []);

  const state = useMemo<CallState>(() => ({
    activeScope,
    room: activeScope ? roomRef.current : null,
    connectionState,
    isConnecting,
    isMuted,
    hasCamera,
    blurEnabled,
    joinedAt,
    participants,
    speakingMap,
    activeCalls,
    connectionQuality,
  }), [activeScope, connectionState, isConnecting, isMuted, hasCamera, blurEnabled, joinedAt, participants, speakingMap, activeCalls, connectionQuality]);

  const contextValue = useMemo<CallContextType>(() => ({
    state,
    joinCall,
    leaveCall,
    toggleMute,
    toggleCamera,
    toggleBlur,
    endCallForAll,
    getActiveCall,
    isUserSpeaking,
    isUserInAnyCall,
    incomingDmCall,
    acceptIncomingCall,
    declineIncomingCall,
  }), [state, joinCall, leaveCall, toggleMute, toggleCamera, toggleBlur, endCallForAll, getActiveCall, isUserSpeaking, isUserInAnyCall, incomingDmCall, acceptIncomingCall, declineIncomingCall]);

  return (
    <CallContext.Provider value={contextValue}>
      {children}
    </CallContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────

export function useCall(): CallContextType {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used within CallProvider');
  }
  return ctx;
}

// ── Helper: scope key ────────────────────────────────────

export { scopeToKey };

