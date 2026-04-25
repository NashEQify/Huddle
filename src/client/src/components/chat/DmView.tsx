import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  MessageResponse,
  MessageNewPayload,
  MessageReactionPayload,
  MessageDeletedPayload,
  MessageEditedPayload,
  UserResponse,
} from '@huddle/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../stores/auth';
import { useWs } from '../../stores/ws';
import { usePresence } from '../../stores/presence';
import { MessageList } from './MessageList';
import { MessageInput, type ReplyTarget } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { useTyping } from '../../hooks/useTyping';
import { CallControls } from '../call/CallControls';
import { VideoGrid } from '../call/VideoGrid';
import { ScreenshareControls } from '../call/ScreenshareControls';
import { ScreensharePreview } from '../call/ScreensharePreview';
import { MessageSearch } from './MessageSearch';
import { useCall, scopeToKey } from '../../stores/call';
import { ChatFontSizeButtons } from './ChatFontSizeButtons';
import { IconButton } from '../ui/IconButton';
import { Search, Image } from 'lucide-react';
import { MediaGallery } from './MediaGallery';

/** Extended message with optimistic fields */
interface LocalMessage extends MessageResponse {
  _pending?: boolean;
  _error?: boolean;
  _tempId?: string;
  _retryContent?: string;
  _retryFiles?: File[];
}

interface DmViewProps {
  otherUserId: string;
}

export function DmView({ otherUserId }: DmViewProps) {
  const { user } = useAuth();
  const { onMessage, isConnected } = useWs();
  const { isUserOnline } = usePresence();
  const { state: callState, getActiveCall } = useCall();

  const [otherUser, setOtherUser] = useState<UserResponse | null>(null);
  const [directId, setDirectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);

  // v2: reply and edit state
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  // Track current otherUserId in a ref for staleness checks
  const otherUserIdRef = useRef(otherUserId);
  otherUserIdRef.current = otherUserId;

  // Track directId in a ref so WS callback always has latest value
  const directIdRef = useRef<string | null>(null);
  directIdRef.current = directId;

  // Ref for editingMessageId to avoid stale closures in WS handlers
  const editingMessageIdRef = useRef(editingMessageId);
  editingMessageIdRef.current = editingMessageId;

  // Typing indicators — only active after DM entity exists (directId is set)
  const { typingUserIds, handleKeystroke, handleSendStart } = useTyping('direct', directId);

  // Build a minimal users array for TypingIndicator to resolve names
  const typingUsers = otherUser ? [otherUser] : [];

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

  // Reset v2 state on DM change
  useEffect(() => {
    setReplyTarget(null);
    setEditingMessageId(null);
  }, [otherUserId]);

  // ── Fetch Other User Info ─────────────────────────────
  const fetchOtherUser = useCallback(async () => {
    const result = await api.get<{ users: UserResponse[] }>('/api/users');
    if (result.ok) {
      const found = result.data.users.find((u) => u.id === otherUserId);
      if (found) setOtherUser(found);
    }
  }, [otherUserId]);

  // ── Lookup Existing DirectConversation ─────────────────
  const lookupDirect = useCallback(async () => {
    const result = await api.get<{ directId: string | null }>(
      `/api/direct/${otherUserId}`
    );
    if (result.ok) {
      setDirectId(result.data.directId);
      return result.data.directId;
    }
    return null;
  }, [otherUserId]);

  // ── Fetch Messages ─────────────────────────────────────
  const fetchMessages = useCallback(
    async (dmId: string) => {
      setIsLoading(true);
      const result = await api.get<{
        messages: MessageResponse[];
        hasMore: boolean;
      }>(`/api/messages?scopeType=direct&scopeId=${dmId}`);
      if (result.ok && otherUserIdRef.current === otherUserId) {
        setMessages(result.data.messages);
        setHasMore(result.data.hasMore);
      }
      setIsLoading(false);
    },
    [otherUserId]
  );

  // ── Load Older Messages ────────────────────────────────
  const isLoadingMoreRef = useRef(false);

  const loadOlderMessages = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMore || messages.length === 0 || !directId) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const oldestTs = messages[0]?.createdAt;
      const result = await api.get<{
        messages: MessageResponse[];
        hasMore: boolean;
      }>(
        `/api/messages?scopeType=direct&scopeId=${directId}&before=${oldestTs}`
      );

      if (result.ok && otherUserIdRef.current === otherUserId) {
        setMessages((prev) => [...result.data.messages, ...prev]);
        setHasMore(result.data.hasMore);
      }
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [directId, messages, hasMore, otherUserId]);

  // ── Initial Load ───────────────────────────────────────
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setIsLoading(true);
    setDirectId(null);
    setOtherUser(null);

    (async () => {
      await fetchOtherUser();
      const existingId = await lookupDirect();
      if (existingId) {
        await fetchMessages(existingId);
      } else {
        // No DM exists yet — show empty state, ready to send first message
        setIsLoading(false);
      }
    })();
  }, [otherUserId, fetchOtherUser, lookupDirect, fetchMessages]);

  // ── WS: message.new ────────────────────────────────────
  useEffect(() => {
    return onMessage('message.new', (payload) => {
      const msg = payload as MessageNewPayload;
      if (msg.scopeType !== 'direct') return;

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

      // Accept messages for our DM (by directId or by the other user being author/recipient)
      const currentDirectId = directIdRef.current;
      if (currentDirectId && msg.scopeId === currentDirectId) {
        setMessages((prev) => {
          // Dedup by ID (WS may arrive after REST response)
          if (prev.some((m) => m.id === msg.id)) return prev;
          // If this is our own message and we have pending messages, skip — REST response handles it
          if (msg.authorId === user?.id && prev.some((m) => m._pending && m.authorId === msg.authorId)) {
            return prev;
          }
          return [...prev, messageResponse];
        });
      } else if (!currentDirectId) {
        // When directId is unknown, only accept messages we sent ourselves
        // (via REST response which already sets directId). Don't trust WS
        // for setting directId because we can't verify participants from the payload.
        if (msg.authorId === user?.id) {
          // Our own message — REST response should have already set directId
          // Just add to messages if directId was set by REST in the meantime
          if (directIdRef.current) {
            // directId was set since we checked — the message belongs here
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, messageResponse];
            });
          }
        }
        return;
      }
    });
  }, [onMessage, otherUserId, user?.id]);

  // ── WS: message.deleted ──────────────────────────────────
  useEffect(() => {
    return onMessage('message.deleted', (payload) => {
      const data = payload as MessageDeletedPayload;
      if (data.scopeType === 'direct' && directIdRef.current && data.scopeId === directIdRef.current) {
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

  // ── WS: message.edited ───────────────────────────────────
  useEffect(() => {
    return onMessage('message.edited', (payload) => {
      const data = payload as MessageEditedPayload;
      if (data.scopeType === 'direct' && directIdRef.current && data.scopeId === directIdRef.current) {
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

  // ── Send Message (Optimistic) ──────────────────────────
  const handleSendMessage = useCallback(
    async (content: string, files?: File[], replyToId?: string) => {
      const scopeId = directId ?? `new:${otherUserId}`;
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Add optimistic message immediately (text-only; files skip optimistic)
      if (!files || files.length === 0) {
        const optimistic: LocalMessage = {
          id: tempId,
          scopeType: 'direct',
          scopeId,
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
        setMessages((prev) => [...prev, optimistic]);
      }

      try {
        if (files && files.length > 0) {
          const fields: Record<string, string> = {
            scopeType: 'direct',
            scopeId,
          };
          if (content) fields.content = content;
          if (replyToId) fields.replyToId = replyToId;
          const result = await api.sendMessageWithFiles<{
            message: MessageResponse;
            directId?: string;
          }>('/api/messages', fields, files);

          if (!result.ok) throw new Error(result.error.message);
          if (result.data.directId && !directId) {
            setDirectId(result.data.directId);
          }
        } else {
          const result = await api.post<{
            message: MessageResponse;
            directId?: string;
          }>('/api/messages', {
            scopeType: 'direct',
            scopeId,
            content,
            ...(replyToId ? { replyToId } : {}),
          });

          if (!result.ok) throw new Error(result.error.message);
          if (result.data.directId && !directId) {
            setDirectId(result.data.directId);
          }
          // Replace optimistic with server version
          setMessages((prev) =>
            prev.map((m) =>
              m._tempId === tempId
                ? { ...result.data.message, _pending: false }
                : m
            )
          );
        }
      } catch (err) {
        // Mark optimistic message as error with retry
        if (!files || files.length === 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m._tempId === tempId
                ? { ...m, _pending: false, _error: true, _retryContent: content }
                : m
            )
          );
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
    [directId, otherUserId, user?.id, user?.username]
  );

  // ── Retry Failed Message ──────────────────────────────
  const handleRetry = useCallback(
    async (tempId: string) => {
      const failedMsg = messages.find((m) => m._tempId === tempId);
      if (!failedMsg?._retryContent) return;

      // Remove the failed message, re-send
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

    if (isConnected && wasDisconnected && messages.length > 0 && directId) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && !lastMsg._pending && !lastMsg._error) {
        api
          .get<{ messages: MessageResponse[] }>(
            `/api/messages/since?scope=direct:${directId}&after=${encodeURIComponent(lastMsg.createdAt)}`
          )
          .then((result) => {
            if (result.ok && result.data.messages.length > 0 && directIdRef.current === directId) {
              setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const newMsgs = result.data.messages.filter((m) => !existingIds.has(m.id));
                return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
              });
            }
          });
      }
    }
  }, [isConnected, directId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (data.scopeType === 'direct' && directIdRef.current && data.scopeId === directIdRef.current) {
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


  // ── Render ─────────────────────────────────────────────

  const online = isUserOnline(otherUserId);
  const displayName = otherUser?.username ?? 'loading...';

  // Check if current user is in this DM call
  const dmScopeKey = directId ? `direct:${directId}` : null;
  const isInThisDmCall =
    callState.activeScope !== null &&
    directId !== null &&
    scopeToKey(callState.activeScope) === `direct:${directId}`;

  // Get active call for this DM
  const activeCall = dmScopeKey ? getActiveCall(dmScopeKey) : undefined;

  // Waiting state: user is in this call and the other participant hasn't joined
  const isWaiting =
    isInThisDmCall &&
    activeCall &&
    activeCall.participants.length <= 1;

  // Self-DM prevention
  if (otherUserId === user?.id) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
        }}
      >
        You can&apos;t send a DM to yourself.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        width: '100%',
        background: 'var(--bg-base)',
      }}
    >
      {/* ── DM Header ─────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Left side: Avatar + Name + Call controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {otherUser?.profile?.portraitUrl ||
            otherUser?.profile?.builtInAvatarUrl ? (
              <img
                src={
                  otherUser.profile.avatarKind === 'uploaded' &&
                  otherUser.profile.portraitUrl
                    ? otherUser.profile.portraitUrl
                    : otherUser.profile.builtInAvatarUrl ?? undefined
                }
                alt={displayName}
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
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 0,
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Online indicator */}
            {online && (
              <span
                style={{
                  position: 'absolute',
                  bottom: '-1px',
                  left: '-1px',
                  width: '8px',
                  height: '8px',
                  background: 'var(--success)',
                  display: 'block',
                }}
              />
            )}
          </div>

          {/* Name + status */}
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-lg)',
                fontWeight: 700,
                color: 'var(--accent)',
              }}
            >
              {displayName}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: online ? 'var(--success)' : 'var(--text-muted)',
              }}
            >
              {online ? 'online' : 'offline'}
            </div>
          </div>

          {/* Call Controls -- visible when DM entity exists */}
          {directId && (
            <CallControls
              scope={{ type: 'direct', id: directId }}
              canCall={true}
              dmOtherUserId={otherUserId}
            />
          )}
          {/* Screenshare Controls -- always visible (auto-joins call per spec 50.2) */}
          {directId && (
            <ScreenshareControls
              directId={directId}
            />
          )}
          {directId && (
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
          <ChatFontSizeButtons />
        </div>
      </div>

      {/* Video Strip -- DM strip mode (outside overflow container for proper sizing) */}
      {directId && <VideoGrid roomId={directId} mode="strip" />}

      {/* Screenshare Preview -- visible when someone is sharing in this DM */}
      {directId && <ScreensharePreview directId={directId} />}

      {/* ── Messages ──────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <MessageList
          messages={messages}
          hasMore={hasMore}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadOlderMessages}
          currentUserId={user?.id ?? ''}
          currentUsername={user?.username}
          knownUsernames={[user?.username ?? '', otherUser?.username ?? ''].filter(Boolean)}
          isAdmin={user?.isAdmin}
          membership="joined"
          dmOtherUsername={otherUser?.username}
          onReaction={handleReaction}
          onRetry={handleRetry}
          onDelete={handleDelete}
          onEdit={handleStartEdit}
          onReply={handleReply}
          editingMessageId={editingMessageId}
          onCancelEdit={handleCancelEdit}
          onSaveEdit={handleSaveEdit}
          scrollToMessageId={scrollToMessageId}
        />

        <TypingIndicator typingUserIds={typingUserIds} users={typingUsers} />

        {/* Waiting state — in call, other participant hasn't joined */}
        {isWaiting && (
          <div
            style={{
              flexShrink: 0,
              padding: 'var(--space-2) var(--space-4)',
              borderTop: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--accent-dim)',
              textAlign: 'center',
            }}
            data-testid="dm-call-waiting"
          >
            waiting for {displayName}...
          </div>
        )}

        <MessageInput
          onSend={handleSendMessage}
          onKeystroke={handleKeystroke}
          onSendStart={handleSendStart}
          replyTarget={replyTarget}
          onCancelReply={handleCancelReply}
          knownUsernames={[user?.username ?? '', otherUser?.username ?? ''].filter(Boolean)}
        />
      </div>

      {/* Search overlay */}
      {showSearch && directId && (
        <MessageSearch
          scopeType="direct"
          scopeId={directId}
          onClose={() => setShowSearch(false)}
          onNavigateToMessage={(messageId) => {
            setScrollToMessageId(messageId);
            setShowSearch(false);
            setTimeout(() => setScrollToMessageId(null), 3000);
          }}
        />
      )}

      {/* Media Gallery */}
      {showGallery && directId && (
        <MediaGallery
          scopeType="direct"
          scopeId={directId}
          onClose={() => setShowGallery(false)}
        />
      )}
    </div>
  );
}
