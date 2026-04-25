import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type {
  RoomResponse,
  MembershipState,
  MessageResponse,
  MessageNewPayload,
  MessageReactionPayload,
  MessageDeletedPayload,
  MessageEditedPayload,
  RoomMembershipPayload,
  UserResponse,
} from '@huddle/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';
import { useWs } from '../../stores/ws';
import { usePresence } from '../../stores/presence';
import { MessageList } from './MessageList';
import { MessageInput, type ReplyTarget } from './MessageInput';
// ActiveUsersStrip removed — avatars are now inline in header
import { MembershipGate } from './MembershipGate';
import { TypingIndicator } from './TypingIndicator';
import { useTyping } from '../../hooks/useTyping';
import { CallControls } from '../call/CallControls';
import { CallIndicatorOverlay } from '../call/CallIndicatorOverlay';
import { VideoGrid } from '../call/VideoGrid';
import { ScreensharePreview } from '../call/ScreensharePreview';
import { ScreenshareControls } from '../call/ScreenshareControls';
import { MessageSearch } from './MessageSearch';
import { useCall, scopeToKey } from '../../stores/call';
import { useNavigation } from '../../stores/navigation';
import { CallDurationTimer } from '../call/CallDurationTimer';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { ChatFontSizeButtons } from './ChatFontSizeButtons';
import { IconButton } from '../ui/IconButton';
import { Search, MessageSquare, UserX, User, X, Image } from 'lucide-react';
import { MediaGallery } from './MediaGallery';
import { Track, RoomEvent } from 'livekit-client';

/** Extended message with optimistic fields */
interface LocalMessage extends MessageResponse {
  _pending?: boolean;
  _error?: boolean;
  _tempId?: string;
  _retryContent?: string;
  _retryFiles?: File[];
}

interface RoomViewProps {
  roomId: string;
}

export function RoomView({ roomId }: RoomViewProps) {
  const { user } = useAuth();
  const { onMessage, isConnected } = useWs();
  const { isUserOnline } = usePresence();

  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [membership, setMembership] = useState<MembershipState | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [roomMembers, setRoomMembers] = useState<Array<{ userId: string; state: string }>>([]);

  // v2: reply and edit state
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  // Search + Gallery state
  const [showSearch, setShowSearch] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);

  // Track current roomId in a ref for async callbacks
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  // Track membership in a ref so WS handlers can check it
  const membershipRef = useRef(membership);
  membershipRef.current = membership;

  // Ref for editingMessageId to avoid stale closures in WS handlers
  const editingMessageIdRef = useRef(editingMessageId);
  editingMessageIdRef.current = editingMessageId;

  // Ctrl+F to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Typing indicators
  const { typingUserIds, handleKeystroke, handleSendStart } = useTyping('room', roomId);

  // Call state for this room (used for header timer + red border)
  const { state: callState, getActiveCall } = useCall();
  const roomScopeKey = scopeToKey({ type: 'room', id: roomId });
  const activeCallForRoom = getActiveCall(roomScopeKey);
  const isUserInThisCall =
    callState.activeScope !== null &&
    scopeToKey(callState.activeScope) === roomScopeKey;

  // ── Expanded Video Mode ─────────────────────────────────
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [chatOverlayOpen, setChatOverlayOpen] = useState(false);
  const [cameraCount, setCameraCount] = useState(0);

  // Track camera count from LiveKit room
  useEffect(() => {
    const room = callState.room;
    if (!room || !isUserInThisCall) {
      setCameraCount(0);
      return;
    }

    function countCameras() {
      if (!room) return;
      let count = 0;

      // Local participant camera
      const localCamPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (
        localCamPub?.track?.mediaStreamTrack &&
        !localCamPub.isMuted &&
        localCamPub.track.mediaStreamTrack.readyState === 'live'
      ) {
        count++;
      }

      // Remote participant cameras
      for (const participant of room.remoteParticipants.values()) {
        const camPub = participant.getTrackPublication(Track.Source.Camera);
        if (
          camPub?.track?.mediaStreamTrack &&
          !camPub.isMuted &&
          camPub.track.mediaStreamTrack.readyState === 'live'
        ) {
          count++;
        }
      }

      setCameraCount(count);
    }

    countCameras();

    room.on(RoomEvent.TrackSubscribed, countCameras);
    room.on(RoomEvent.TrackUnsubscribed, countCameras);
    room.on(RoomEvent.TrackPublished, countCameras);
    room.on(RoomEvent.TrackUnpublished, countCameras);
    room.on(RoomEvent.LocalTrackPublished, countCameras);
    room.on(RoomEvent.LocalTrackUnpublished, countCameras);
    room.on(RoomEvent.TrackMuted, countCameras);
    room.on(RoomEvent.TrackUnmuted, countCameras);

    return () => {
      room.off(RoomEvent.TrackSubscribed, countCameras);
      room.off(RoomEvent.TrackUnsubscribed, countCameras);
      room.off(RoomEvent.TrackPublished, countCameras);
      room.off(RoomEvent.TrackUnpublished, countCameras);
      room.off(RoomEvent.LocalTrackPublished, countCameras);
      room.off(RoomEvent.LocalTrackUnpublished, countCameras);
      room.off(RoomEvent.TrackMuted, countCameras);
      room.off(RoomEvent.TrackUnmuted, countCameras);
    };
  }, [callState.room, isUserInThisCall]);

  const hasCameras = cameraCount > 0;

  // Auto-exit expanded mode when call ends or all cameras turn off
  useEffect(() => {
    if (!isUserInThisCall || !hasCameras) {
      setVideoExpanded(false);
      setChatOverlayOpen(false);
    }
  }, [isUserInThisCall, hasCameras]);

  // Reset chatOverlayOpen when videoExpanded goes false
  useEffect(() => {
    if (!videoExpanded) {
      setChatOverlayOpen(false);
    }
  }, [videoExpanded]);

  // ESC handler: close overlay first, then exit expanded mode
  useEffect(() => {
    if (!videoExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (chatOverlayOpen) {
          setChatOverlayOpen(false);
        } else {
          setVideoExpanded(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoExpanded, chatOverlayOpen]);

  const handleToggleExpand = useCallback(() => {
    setVideoExpanded((v) => !v);
  }, []);

  const handleToggleChatOverlay = useCallback(() => {
    setChatOverlayOpen((v) => !v);
  }, []);

  // Reset v2 state on room change
  useEffect(() => {
    setReplyTarget(null);
    setEditingMessageId(null);
  }, [roomId]);

  // ── Fetch Room Data ───────────────────────────────────
  const fetchRoom = useCallback(async () => {
    const result = await api.get<{ rooms: RoomResponse[] }>('/api/rooms');
    if (result.ok && roomIdRef.current === roomId) {
      const found = result.data.rooms.find((r) => r.id === roomId);
      if (found) {
        setRoom(found);
        setMembership(found.membership);
      }
    }
  }, [roomId]);

  // ── Fetch Users (for Active Users Strip) ─────────────
  const fetchUsers = useCallback(async () => {
    const result = await api.get<{ users: UserResponse[] }>('/api/users');
    if (result.ok) {
      setUsers(result.data.users);
    }
  }, []);

  // ── Fetch Room Members ─────────────────────────────────
  const fetchRoomMembers = useCallback(async () => {
    const result = await api.get<{ members: Array<{ userId: string; state: string }> }>(
      `/api/rooms/${roomId}/members`
    );
    if (result.ok) {
      setRoomMembers(result.data.members);
    }
  }, [roomId]);

  // ── Fetch Messages ────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    setIsLoadingMessages(true);
    const result = await api.get<{ messages: MessageResponse[]; hasMore: boolean }>(
      `/api/messages?scopeType=room&scopeId=${roomId}`
    );
    if (result.ok && roomIdRef.current === roomId) {
      setMessages(result.data.messages);
      setHasMore(result.data.hasMore);
    }
    setIsLoadingMessages(false);
  }, [roomId]);

  // ── Load Older Messages ───────────────────────────────
  const isLoadingMoreRef = useRef(false);

  const loadOlderMessages = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMore || messages.length === 0) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const oldestTs = messages[0]?.createdAt;
      const result = await api.get<{ messages: MessageResponse[]; hasMore: boolean }>(
        `/api/messages?scopeType=room&scopeId=${roomId}&before=${oldestTs}`
      );

      if (result.ok && roomIdRef.current === roomId) {
        setMessages((prev) => [...result.data.messages, ...prev]);
        setHasMore(result.data.hasMore);
      }
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [roomId, messages, hasMore]);

  // ── Initial Load ──────────────────────────────────────
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setIsLoadingMessages(true);
    setRoom(null);
    setMembership(null);
    setRoomMembers([]);

    fetchRoom();
    fetchUsers();
    fetchRoomMembers();
  }, [roomId, fetchRoom, fetchUsers, fetchRoomMembers]);

  // Fetch messages only if membership allows it
  useEffect(() => {
    if (membership === 'joined' || membership === 'left') {
      fetchMessages();
    } else {
      setIsLoadingMessages(false);
    }
  }, [membership, fetchMessages]);

  // ── WS: message.new ──────────────────────────────────
  useEffect(() => {
    return onMessage('message.new', (payload) => {
      const msg = payload as MessageNewPayload & Partial<MessageResponse>;
      // Don't show new messages if user has left the room (read-only history)
      if (membershipRef.current === 'left') return;
      if (msg.scopeType === 'room' && msg.scopeId === roomIdRef.current) {
        const messageResponse: LocalMessage = {
          id: msg.id,
          scopeType: msg.scopeType as 'room' | 'direct',
          scopeId: msg.scopeId,
          authorId: msg.authorId,
          content: msg.content,
          createdAt: msg.createdAt,
          author: msg.author,
          attachments: (msg as any).attachments,
          replyTo: (msg as any).replyTo,
        };

        setMessages((prev) => {
          // Dedup by ID (WS may arrive after REST response)
          if (prev.some((m) => m.id === msg.id)) return prev;
          // If this is our own message and we have pending messages, skip — REST response handles it
          if (msg.authorId === user?.id && prev.some((m) => m._pending && m.authorId === msg.authorId)) {
            return prev;
          }
          return [...prev, messageResponse];
        });
      }
    });
  }, [onMessage, user?.id]);

  // ── WS: message.deleted ────────────────────────────────
  useEffect(() => {
    return onMessage('message.deleted', (payload) => {
      const data = payload as MessageDeletedPayload;
      if (data.scopeType === 'room' && data.scopeId === roomIdRef.current) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === data.messageId
              ? { ...msg, content: null, deletedAt: new Date().toISOString(), attachments: [] }
              : msg
          )
        );
        // Cancel edit if the deleted message was being edited
        if (editingMessageIdRef.current === data.messageId) {
          setEditingMessageId(null);
        }
      }
    });
  }, [onMessage]);

  // ── WS: message.edited ─────────────────────────────────
  useEffect(() => {
    return onMessage('message.edited', (payload) => {
      const data = payload as MessageEditedPayload;
      if (data.scopeType === 'room' && data.scopeId === roomIdRef.current) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === data.messageId
              ? { ...msg, content: data.content, editedAt: data.editedAt, editedBy: data.editedBy }
              : msg
          )
        );
      }
    });
  }, [onMessage]);

  // ── WS: room.membership ──────────────────────────────
  useEffect(() => {
    return onMessage('room.membership', (payload) => {
      const data = payload as RoomMembershipPayload;
      if (data.roomId === roomIdRef.current) {
        if (data.userId === user?.id) {
          setMembership(data.state);
        }
        // Re-fetch room members so ActiveUsersStrip stays in sync
        fetchRoomMembers();
      }
    });
  }, [onMessage, user?.id, fetchRoomMembers]);

  // ── WS: room.updated ──────────────────────────────────
  useEffect(() => {
    return onMessage('room.updated', (payload) => {
      const data = payload as { roomId: string; hasPassword?: boolean; roomName?: string };
      if (data.roomId === roomIdRef.current) {
        fetchRoom();
      }
    });
  }, [onMessage, fetchRoom]);

  // ── Membership Actions ────────────────────────────────
  const handleJoin = useCallback(async (password?: string) => {
    const result = await api.patch<{ membership: { state: MembershipState } }>(
      `/api/rooms/${roomId}/join`,
      password ? { password } : undefined
    );
    if (result.ok) {
      setMembership(result.data.membership.state);
      return undefined;
    } else {
      return result.error;
    }
  }, [roomId]);

  const handleLeave = useCallback(async () => {
    const result = await api.patch<{ membership: { state: MembershipState } }>(
      `/api/rooms/${roomId}/leave`
    );
    if (result.ok) {
      setMembership(result.data.membership.state);
    }
  }, [roomId]);

  const handleRejoin = useCallback(async (password?: string) => {
    const result = await api.patch<{ membership: { state: MembershipState } }>(
      `/api/rooms/${roomId}/rejoin`,
      password ? { password } : undefined
    );
    if (result.ok) {
      setMembership(result.data.membership.state);
      return undefined;
    } else {
      return result.error;
    }
  }, [roomId]);

  // ── Header password prompt states ──────────────────────
  const [showRejoinPassword, setShowRejoinPassword] = useState(false);
  const [rejoinPasswordInput, setRejoinPasswordInput] = useState('');
  const [rejoinPasswordError, setRejoinPasswordError] = useState<string | null>(null);
  const [showJoinPassword, setShowJoinPassword] = useState(false);
  const [joinPasswordInput, setJoinPasswordInput] = useState('');
  const [joinPasswordError, setJoinPasswordError] = useState<string | null>(null);

  // Reset header password states on room change
  useEffect(() => {
    setShowRejoinPassword(false);
    setRejoinPasswordInput('');
    setRejoinPasswordError(null);
    setShowJoinPassword(false);
    setJoinPasswordInput('');
    setJoinPasswordError(null);
  }, [roomId]);

  // Pending message IDs for dedup with WS broadcast
  const pendingIdsRef = useRef<Set<string>>(new Set());

  // ── Send Message (Optimistic) ─────────────────────────
  const handleSendMessage = useCallback(
    async (content: string, files?: File[], replyToId?: string) => {
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Add optimistic message immediately (text-only; files skip optimistic)
      if (!files || files.length === 0) {
        const optimistic: LocalMessage = {
          id: tempId,
          scopeType: 'room',
          scopeId: roomId,
          authorId: user?.id ?? '',
          content,
          createdAt: new Date().toISOString(),
          author: {
            id: user?.id ?? '',
            username: user?.username ?? '',
            profile: null,
          },
          _pending: true,
          _tempId: tempId,
          _retryContent: content,
        };
        pendingIdsRef.current.add(tempId);
        setMessages((prev) => [...prev, optimistic]);
      }

      try {
        if (files && files.length > 0) {
          const fields: Record<string, string> = {
            scopeType: 'room',
            scopeId: roomId,
          };
          if (content) fields.content = content;
          if (replyToId) fields.replyToId = replyToId;
          const result = await api.sendMessageWithFiles<{ message: MessageResponse }>('/api/messages', fields, files);
          if (!result.ok) throw new Error(result.error.message);
        } else {
          const result = await api.post<{ message: MessageResponse }>('/api/messages', {
            scopeType: 'room',
            scopeId: roomId,
            content,
            ...(replyToId ? { replyToId } : {}),
          });
          if (!result.ok) throw new Error(result.error.message);
          setMessages((prev) =>
            prev.map((m) =>
              m._tempId === tempId
                ? { ...result.data.message, _pending: false }
                : m
            )
          );
          pendingIdsRef.current.delete(tempId);
        }
      } catch (err) {
        if (!files || files.length === 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m._tempId === tempId
                ? { ...m, _pending: false, _error: true, _retryContent: content }
                : m
            )
          );
          pendingIdsRef.current.delete(tempId);
        } else {
          // F-CSD-067: file-upload failure path has no optimistic message in
          // the list (see early-return above), so there is no in-list surface
          // to render an error/retry on. Re-throw so MessageInput's catch
          // restores both `content` and `files` into the composer — that
          // becomes the retry surface for attached sends. Without this
          // re-throw the composer already cleared itself (line ~171), and the
          // user sees a silently swallowed upload failure.
          throw err;
        }
      }
    },
    [roomId, user?.id, user?.username]
  );

  // ── Retry Failed Message ──────────────────────────────
  const handleRetry = useCallback(
    async (tempId: string) => {
      const failedMsg = messages.find((m) => m._tempId === tempId);
      if (!failedMsg?._retryContent) return;

      setMessages((prev) => prev.filter((m) => m._tempId !== tempId));
      await handleSendMessage(failedMsg._retryContent);
    },
    [messages, handleSendMessage]
  );

  // ── Delete Message ─────────────────────────────────────
  const handleDelete = useCallback(async (messageId: string) => {
    const result = await api.delete<{ deleted: true; messageId: string }>(
      `/api/messages/${messageId}`
    );
    if (result.ok) {
      // Optimistic update (WS will also fire)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, content: null, deletedAt: new Date().toISOString(), attachments: [] }
            : msg
        )
      );
    }
  }, []);

  // ── Edit Message ───────────────────────────────────────
  const handleStartEdit = useCallback((_messageId: string, _content: string) => {
    setEditingMessageId(_messageId);
    setReplyTarget(null); // Cancel reply if editing
  }, []);

  const handleSaveEdit = useCallback(async (messageId: string, content: string) => {
    const result = await api.patch<{ message: MessageResponse }>(
      `/api/messages/${messageId}`,
      { content }
    );
    if (result.ok) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, content: result.data.message.content, editedAt: result.data.message.editedAt, editedBy: result.data.message.editedBy }
            : msg
        )
      );
    }
    setEditingMessageId(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  // ── Reply ──────────────────────────────────────────────
  const handleReply = useCallback((msg: MessageResponse) => {
    setReplyTarget({
      id: msg.id,
      authorUsername: msg.author.username,
      content: msg.content,
      deletedAt: msg.deletedAt,
    });
    setEditingMessageId(null); // Cancel edit if replying
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  // ── Missed Message Recovery (after WS reconnect) ─────
  const wasConnectedRef = useRef(isConnected);
  useEffect(() => {
    const wasDisconnected = !wasConnectedRef.current;
    wasConnectedRef.current = isConnected;

    if (isConnected && wasDisconnected && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && !lastMsg._pending && !lastMsg._error) {
        api
          .get<{ messages: MessageResponse[] }>(
            `/api/messages/since?scope=room:${roomId}&after=${encodeURIComponent(lastMsg.createdAt)}`
          )
          .then((result) => {
            if (result.ok && result.data.messages.length > 0 && roomIdRef.current === roomId) {
              setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const newMsgs = result.data.messages.filter((m) => !existingIds.has(m.id));
                return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
              });
            }
          });
      }
    }
  }, [isConnected, roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle Reaction ──────────────────────────────────
  const handleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      await api.post(`/api/messages/${messageId}/reactions`, { emoji });
    },
    []
  );

  // ── WS: message.reaction ───────────────────────────────
  useEffect(() => {
    return onMessage('message.reaction', (payload) => {
      const data = payload as MessageReactionPayload;
      if (data.scopeType === 'room' && data.scopeId === roomIdRef.current) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === data.messageId
              ? { ...msg, reactions: data.reactions.length > 0 ? data.reactions : undefined }
              : msg
          )
        );
      }
    });
  }, [onMessage]);

  // ── Active Users ──────────────────────────────────────
  // Filter users: only show online users who are joined members of this room
  const joinedMemberIds = useMemo(
    () => new Set(roomMembers.filter((m) => m.state === 'joined').map((m) => m.userId)),
    [roomMembers]
  );
  const activeUsers = useMemo(
    () => users.filter((u) => isUserOnline(u.id) && joinedMemberIds.has(u.id)),
    [users, isUserOnline, joinedMemberIds]
  );

  if (!room) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
        }}
      >
        loading...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-base)',
      }}
    >
      {/* ── Room Header ──────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          // Red border when user is in a call for this room (Phase 1B)
          ...(isUserInThisCall
            ? { boxShadow: 'inset 0 0 0 2px var(--error)' }
            : {}),
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-3) var(--space-4)',
          }}
        >
          {/* Left side: Room name + call controls + participants */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0, flex: 1, overflow: 'visible' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xl)',
                fontWeight: 700,
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              {room.name}
            </span>
            {/* Call timer visible to ALL users when there is an active call */}
            {activeCallForRoom && (
              <CallDurationTimer
                startedAt={activeCallForRoom.startedAt}
                prefix="CALL"
              />
            )}
            {membership === 'joined' && (
              <CallControls
                scope={{ type: 'room', id: roomId }}
                canCall={true}
                videoExpanded={videoExpanded}
                onToggleExpand={handleToggleExpand}
                hasCameras={hasCameras}
                chatOverlayOpen={chatOverlayOpen}
                onToggleChatOverlay={handleToggleChatOverlay}
              />
            )}
            {membership === 'joined' && (
              <ScreenshareControls
                roomId={roomId}
                roomName={room.name}
              />
            )}
            {(membership === 'joined' || membership === 'left') && (
              <>
                <IconButton
                  icon={Search}
                  label="Search messages"
                  color="var(--text-muted)"
                  onClick={() => setShowSearch(true)}
                />
                <IconButton
                  icon={Image}
                  label="Media gallery"
                  color="var(--text-muted)"
                  onClick={() => setShowGallery(true)}
                />
              </>
            )}

            {/* Call Participants — inline in header, scrollable */}
            {activeCallForRoom && activeCallForRoom.participants.length > 0 && (
              <CallParticipantsStrip
                participants={activeCallForRoom.participants}
                users={users}
                roomName={`call:${roomId}`}
                currentUserId={user?.id ?? ''}
              />
            )}

            {/* Active user avatars — inline in header */}
            {activeUsers.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexShrink: 1,
                  minWidth: 0,
                  overflow: 'auto',
                  scrollbarWidth: 'none',
                  marginLeft: 'var(--space-4)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                    marginRight: '4px',
                  }}
                >
                  active users:
                </span>
                {activeUsers.map((u) => (
                  <InlineAvatar key={u.id} user={u} />
                ))}
              </div>
            )}
          </div>

          {/* Right side: Font size + Leave Room */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ChatFontSizeButtons />
            {membership === 'joined' && (
              <button
                type="button"
                onClick={handleLeave}
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 0,
                  padding: 'var(--space-1) var(--space-3)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                [ LEAVE ROOM ]
              </button>
            )}
            {membership === 'left' && !showRejoinPassword && (
              <button
                type="button"
                onClick={async () => {
                  if (room?.hasPassword) {
                    setShowRejoinPassword(true);
                  } else {
                    await handleRejoin();
                  }
                }}
                style={{
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  borderRadius: 0,
                  padding: 'var(--space-1) var(--space-3)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                [ JOIN ROOM ]
              </button>
            )}
            {membership === 'left' && showRejoinPassword && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <input
                  type="password"
                  value={rejoinPasswordInput}
                  onChange={(e) => setRejoinPasswordInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setRejoinPasswordError(null);
                      const error = await handleRejoin(rejoinPasswordInput);
                      if (error) {
                        setRejoinPasswordError(error.message);
                      } else {
                        setShowRejoinPassword(false);
                        setRejoinPasswordInput('');
                      }
                    }
                    if (e.key === 'Escape') {
                      setShowRejoinPassword(false);
                      setRejoinPasswordInput('');
                      setRejoinPasswordError(null);
                    }
                  }}
                  placeholder="Password"
                  autoFocus
                  style={{
                    width: '140px',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: `1px solid ${rejoinPasswordError ? 'var(--error)' : 'var(--border-default)'}`,
                    borderRadius: 0,
                    padding: 'var(--space-1) var(--space-2)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    setRejoinPasswordError(null);
                    const error = await handleRejoin(rejoinPasswordInput);
                    if (error) {
                      setRejoinPasswordError(error.message);
                    } else {
                      setShowRejoinPassword(false);
                      setRejoinPasswordInput('');
                    }
                  }}
                  style={{
                    background: 'transparent',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent-muted)',
                    borderRadius: 0,
                    padding: 'var(--space-1) var(--space-2)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRejoinPassword(false);
                    setRejoinPasswordInput('');
                    setRejoinPasswordError(null);
                  }}
                  style={{
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: 'none',
                    borderRadius: 0,
                    padding: 'var(--space-1)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    cursor: 'pointer',
                  }}
                >
                  X
                </button>
              </div>
            )}
            {(membership === 'not_joined' || membership === null) && !showJoinPassword && (
              <button
                type="button"
                onClick={async () => {
                  if (room?.hasPassword) {
                    setShowJoinPassword(true);
                  } else {
                    await handleJoin();
                  }
                }}
                style={{
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  borderRadius: 0,
                  padding: 'var(--space-1) var(--space-3)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                [ JOIN ROOM ]
              </button>
            )}
            {(membership === 'not_joined' || membership === null) && showJoinPassword && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <input
                  type="password"
                  value={joinPasswordInput}
                  onChange={(e) => setJoinPasswordInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setJoinPasswordError(null);
                      const error = await handleJoin(joinPasswordInput);
                      if (error) {
                        setJoinPasswordError(error.message);
                      } else {
                        setShowJoinPassword(false);
                        setJoinPasswordInput('');
                      }
                    }
                    if (e.key === 'Escape') {
                      setShowJoinPassword(false);
                      setJoinPasswordInput('');
                      setJoinPasswordError(null);
                    }
                  }}
                  placeholder="Password"
                  autoFocus
                  style={{
                    width: '140px',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: `1px solid ${joinPasswordError ? 'var(--error)' : 'var(--border-default)'}`,
                    borderRadius: 0,
                    padding: 'var(--space-1) var(--space-2)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    setJoinPasswordError(null);
                    const error = await handleJoin(joinPasswordInput);
                    if (error) {
                      setJoinPasswordError(error.message);
                    } else {
                      setShowJoinPassword(false);
                      setJoinPasswordInput('');
                    }
                  }}
                  style={{
                    background: 'transparent',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent-muted)',
                    borderRadius: 0,
                    padding: 'var(--space-1) var(--space-2)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowJoinPassword(false);
                    setJoinPasswordInput('');
                    setJoinPasswordError(null);
                  }}
                  style={{
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: 'none',
                    borderRadius: 0,
                    padding: 'var(--space-1)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    cursor: 'pointer',
                  }}
                >
                  X
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── Content Area ─────────────────────────────── */}
      <MembershipGate membership={membership} hasPassword={room?.hasPassword ?? false} onJoin={handleJoin}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Screenshare Preview */}
          <ScreensharePreview roomId={roomId} />

          {/* Video Grid */}
          <VideoGrid roomId={roomId} expanded={videoExpanded} />

          {/* Message List — hidden (not unmounted) in expanded mode */}
          <div style={videoExpanded ? { display: 'none' } : { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <MessageList
              messages={messages}
              hasMore={hasMore}
              isLoading={isLoadingMessages}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadOlderMessages}
              currentUserId={user?.id ?? ''}
              currentUsername={user?.username}
              knownUsernames={users.map((u) => u.username)}
              isAdmin={user?.isAdmin}
              membership={membership}
              onReaction={membership === 'joined' ? handleReaction : undefined}
              onRetry={handleRetry}
              onDelete={membership === 'joined' ? handleDelete : undefined}
              onEdit={membership === 'joined' ? handleStartEdit : undefined}
              onReply={membership === 'joined' ? handleReply : undefined}
              readOnly={membership !== 'joined'}
              editingMessageId={editingMessageId}
              onCancelEdit={handleCancelEdit}
              onSaveEdit={handleSaveEdit}
              scrollToMessageId={scrollToMessageId}
            />
          </div>

          {/* Typing indicator — hidden in expanded mode */}
          <div style={videoExpanded ? { display: 'none' } : undefined}>
            <TypingIndicator typingUserIds={typingUserIds} users={users} />
          </div>

          {/* Message Input (only for joined members) — hidden in expanded mode */}
          {membership === 'joined' && (
            <div style={videoExpanded ? { display: 'none' } : undefined}>
              <MessageInput
                onSend={handleSendMessage}
                onKeystroke={handleKeystroke}
                onSendStart={handleSendStart}
                replyTarget={replyTarget}
                onCancelReply={handleCancelReply}
                knownUsernames={users.map((u) => u.username)}
              />
            </div>
          )}

          {/* Read-only banner for left state — hidden in expanded mode */}
          {membership === 'left' && (
            <div
              style={{
                flexShrink: 0,
                padding: 'var(--space-3) var(--space-4)',
                borderTop: '1px solid var(--border-default)',
                background: 'var(--bg-surface)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                textAlign: 'center',
                ...(videoExpanded ? { display: 'none' } : {}),
              }}
            >
              You left this room. Rejoin to send messages.
            </div>
          )}

          {/* Chat Overlay — shown in expanded mode when toggled */}
          {videoExpanded && (
            <ChatOverlay
              isOpen={chatOverlayOpen}
              onClose={() => setChatOverlayOpen(false)}
              messages={messages}
              hasMore={hasMore}
              isLoading={isLoadingMessages}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadOlderMessages}
              currentUserId={user?.id ?? ''}
              currentUsername={user?.username}
              knownUsernames={users.map((u) => u.username)}
              isAdmin={user?.isAdmin}
              membership={membership}
              onReaction={membership === 'joined' ? handleReaction : undefined}
              onRetry={handleRetry}
              onDelete={membership === 'joined' ? handleDelete : undefined}
              onEdit={membership === 'joined' ? handleStartEdit : undefined}
              onReply={membership === 'joined' ? handleReply : undefined}
              editingMessageId={editingMessageId}
              onCancelEdit={handleCancelEdit}
              onSaveEdit={handleSaveEdit}
              scrollToMessageId={scrollToMessageId}
              onSend={handleSendMessage}
              onKeystroke={handleKeystroke}
              onSendStart={handleSendStart}
              replyTarget={replyTarget}
              onCancelReply={handleCancelReply}
              typingUserIds={typingUserIds}
              users={users}
            />
          )}
        </div>
      </MembershipGate>

      {/* Search overlay */}
      {showSearch && (
        <MessageSearch
          scopeType="room"
          scopeId={roomId}
          onClose={() => setShowSearch(false)}
          onNavigateToMessage={(messageId) => {
            setScrollToMessageId(messageId);
            setShowSearch(false);
            setTimeout(() => setScrollToMessageId(null), 3000);
          }}
        />
      )}

      {/* Media Gallery */}
      {showGallery && (
        <MediaGallery
          scopeType="room"
          scopeId={roomId}
          onClose={() => setShowGallery(false)}
        />
      )}
    </div>
  );
}

// ── Chat Overlay (Expanded Video Mode) ─────────────────

interface ChatOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  messages: LocalMessage[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  currentUserId: string;
  currentUsername?: string;
  knownUsernames: string[];
  isAdmin?: boolean;
  membership: MembershipState | null;
  onReaction?: (messageId: string, emoji: string) => void;
  onRetry: (tempId: string) => void;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onReply?: (msg: import('@huddle/shared').MessageResponse) => void;
  editingMessageId: string | null;
  onCancelEdit: () => void;
  onSaveEdit: (messageId: string, content: string) => void;
  scrollToMessageId: string | null;
  onSend: (content: string, files?: File[], replyToId?: string) => Promise<void>;
  onKeystroke: () => void;
  onSendStart: () => void;
  replyTarget: ReplyTarget | null;
  onCancelReply: () => void;
  typingUserIds: string[];
  users: UserResponse[];
}

function ChatOverlay({
  isOpen,
  onClose,
  messages,
  hasMore,
  isLoading,
  isLoadingMore,
  onLoadMore,
  currentUserId,
  currentUsername,
  knownUsernames,
  isAdmin,
  membership,
  onReaction,
  onRetry,
  onDelete,
  onEdit,
  onReply,
  editingMessageId,
  onCancelEdit,
  onSaveEdit,
  scrollToMessageId,
  onSend,
  onKeystroke,
  onSendStart,
  replyTarget,
  onCancelReply,
  typingUserIds,
  users,
}: ChatOverlayProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(340px, 85vw)',
        background: 'rgba(26, 26, 46, 0.92)',
        borderLeft: '1px solid var(--border-default)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            color: 'var(--accent)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          [ CHAT ]
        </span>
        <IconButton
          icon={X}
          label="Close chat overlay"
          color="var(--text-muted)"
          size={16}
          onClick={onClose}
        />
      </div>

      {/* Message List */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <MessageList
          messages={messages}
          hasMore={hasMore}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          knownUsernames={knownUsernames}
          isAdmin={isAdmin}
          membership={membership}
          onReaction={onReaction}
          onRetry={onRetry}
          onDelete={onDelete}
          onEdit={onEdit}
          onReply={onReply}
          readOnly={membership !== 'joined'}
          editingMessageId={editingMessageId}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          scrollToMessageId={scrollToMessageId}
        />
      </div>

      {/* Typing indicator */}
      <TypingIndicator typingUserIds={typingUserIds} users={users} />

      {/* Message Input */}
      {membership === 'joined' && (
        <MessageInput
          onSend={onSend}
          onKeystroke={onKeystroke}
          onSendStart={onSendStart}
          replyTarget={replyTarget}
          onCancelReply={onCancelReply}
          knownUsernames={knownUsernames}
        />
      )}
    </div>
  );
}

// ── Call Participants Strip ─────────────────────────────

function CallParticipantsStrip({
  participants,
  users,
  roomName,
  currentUserId,
}: {
  participants: Array<{ userId: string; isMuted: boolean }>;
  users: UserResponse[];
  roomName: string;
  currentUserId: string;
}) {
  const { navigateToDm } = useNavigation();
  const contextMenu = useContextMenu();
  const [contextParticipant, setContextParticipant] = useState<{
    userId: string;
    isMuted: boolean;
  } | null>(null);

  const getUserName = (userId: string) => {
    const u = users.find((usr) => usr.id === userId);
    return u?.username ?? userId.slice(0, 8);
  };

  const handleParticipantClick = (
    e: React.MouseEvent,
    participant: { userId: string; isMuted: boolean }
  ) => {
    // Don't show context menu for self
    if (participant.userId === currentUserId) return;
    e.preventDefault();
    contextMenu.open(e);
    setContextParticipant(participant);
  };

  const handleMuteToggle = async () => {
    if (!contextParticipant) return;
    try {
      await api.post('/api/livekit/mute-participant', {
        roomName,
        userId: contextParticipant.userId,
        muted: !contextParticipant.isMuted,
      });
    } catch {
      // Silently fail
    }
  };

  const menuItems: ContextMenuItem[] = contextParticipant
    ? [
        {
          id: 'dm',
          label: 'Direct message',
          icon: MessageSquare,
          onAction: () => navigateToDm(contextParticipant.userId),
        },
        {
          id: 'mute-toggle',
          label: contextParticipant.isMuted ? 'Unmute user' : 'Mute user',
          icon: contextParticipant.isMuted ? User : UserX,
          onAction: handleMuteToggle,
        },
      ]
    : [];

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          overflow: 'auto',
          flexShrink: 1,
          minWidth: 0,
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--accent-muted) transparent',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            flexShrink: 0,
          }}
        >
          IN CALL:
        </span>
        {participants.map((p) => (
          <button
            key={p.userId}
            type="button"
            onClick={(e) => handleParticipantClick(e, p)}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              padding: '1px var(--space-1)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: p.isMuted ? 'var(--text-muted)' : 'var(--accent)',
              cursor: p.userId === currentUserId ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'color 150ms',
              textDecoration: p.isMuted ? 'line-through' : 'none',
            }}
            onMouseEnter={(e) => {
              if (p.userId !== currentUserId) {
                e.currentTarget.style.color = 'var(--text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = p.isMuted ? 'var(--text-muted)' : 'var(--accent)';
            }}
          >
            {getUserName(p.userId)}
          </button>
        ))}
      </div>

      {contextMenu.isOpen && menuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={contextMenu.close}
        />
      )}
    </>
  );
}

// ── Inline Avatar (for header strip) ───────────────────

function InlineAvatar({ user: u }: { user: UserResponse }) {
  const { isUserSpeaking, isUserInAnyCall } = useCall();
  const speaking = isUserSpeaking(u.id);
  const inCall = isUserInAnyCall(u.id);

  const avatarUrl =
    u.profile?.avatarKind === 'uploaded' && u.profile.portraitUrl
      ? u.profile.portraitUrl
      : u.profile?.builtInAvatarUrl ?? null;

  const displayName = u.profile?.title
    ? `${u.username} "${u.profile.title}"`
    : u.username;

  // Wrap in relative container so the CGL-014 in-call overlay can absolutely
  // position in the bottom-right corner of the avatar.
  return (
    <div style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={u.username}
          title={displayName}
          className={speaking ? 'avatar-speaking' : undefined}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: 0,
            display: 'block',
            objectFit: 'cover',
          }}
        />
      ) : (
        <div
          title={displayName}
          className={speaking ? 'avatar-speaking' : undefined}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: 0,
            background: 'var(--bg-input)',
            border: speaking ? '1px solid var(--accent)' : '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            color: speaking ? 'var(--accent)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {u.username.charAt(0).toUpperCase()}
        </div>
      )}
      {inCall && <CallIndicatorOverlay size={10} title={`${u.username} is in a call`} />}
    </div>
  );
}
