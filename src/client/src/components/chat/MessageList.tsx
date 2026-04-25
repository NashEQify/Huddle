import { useEffect, useRef, useCallback, useState, useMemo, useLayoutEffect, type ReactNode } from 'react';
import { Reply, Pencil, Trash2, SmilePlus } from 'lucide-react';
import type { MessageResponse } from '@huddle/shared';
import { MessageAttachments } from './MessageAttachments';
import { Lightbox } from './Lightbox';
import { EmojiPicker } from './EmojiPicker';
import { ReactionBadges } from './ReactionBadges';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { IconButton } from '../ui/IconButton';
import { linkifyText } from '../../lib/linkify';
import { parseMentions } from '../../lib/mentions';

/** Extended message with optional optimistic fields */
export interface LocalMessage extends MessageResponse {
  _pending?: boolean;
  _error?: boolean;
  _tempId?: string;
}

interface MessageListProps {
  messages: LocalMessage[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  currentUserId: string;
  currentUsername?: string;
  knownUsernames?: string[];
  isAdmin?: boolean;
  membership?: 'joined' | 'left' | 'not_joined' | null;
  /** DM partner's username — triggers the DM empty-state copy variant
   *  ("Send {username} a message."). Omit for room scope to use the room
   *  variant ("No messages yet. Say something."). Per spec 30-chat §30.4. */
  dmOtherUsername?: string;
  onReaction?: (messageId: string, emoji: string) => void;
  onRetry?: (tempId: string) => void;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onReply?: (msg: MessageResponse) => void;
  readOnly?: boolean;
  editingMessageId?: string | null;
  onCancelEdit?: () => void;
  onSaveEdit?: (messageId: string, content: string) => void;
  scrollToMessageId?: string | null;
}

// ── Helper: enrich text with linkify + mentions ─────────

function renderEnrichedText(
  text: string,
  knownUsernames?: string[],
  currentUsername?: string,
): ReactNode[] {
  // First apply mentions to get ReactNode[]
  const withMentions =
    knownUsernames && knownUsernames.length > 0
      ? parseMentions(text, knownUsernames, currentUsername)
      : [text];

  // Then for each string segment, apply linkify
  const result: ReactNode[] = [];
  for (const part of withMentions) {
    if (typeof part === 'string') {
      result.push(...linkifyText(part));
    } else {
      result.push(part);
    }
  }
  return result;
}

// ── Helper: format time ─────────────────────────────────

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function isToday(dateStr: string): boolean {
  return isSameDay(dateStr, new Date().toISOString());
}

// ── Helper: message type checks ─────────────────────────

function isSystemMessage(msg: MessageResponse): boolean {
  return msg.content?.startsWith('::system::') === true;
}

function isTombstone(msg: MessageResponse): boolean {
  return msg.deletedAt != null;
}

function shouldGroup(prev: MessageResponse, curr: MessageResponse): boolean {
  if (isSystemMessage(prev) || isSystemMessage(curr)) return false;
  if (isTombstone(prev) || isTombstone(curr)) return false;
  if (prev.authorId !== curr.authorId) return false;
  const diff = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
  return diff < 2 * 60 * 1000;
}

// ── Helper: parse system message ────────────────────────

function parseSystemMessage(content: string, username: string): string | null {
  if (!content.startsWith('::system::')) return null;
  const action = content.slice('::system::'.length);
  switch (action) {
    case 'joined':
      return `${username} joined the room`;
    case 'left':
      return `${username} left the room`;
    case 'rejoined':
      return `${username} rejoined the room`;
    default:
      return `${username} ${action}`;
  }
}

// ── Helper: 3-minute + 10s client grace window ──────────

const CLIENT_DELETE_WINDOW_MS = (3 * 60 + 10) * 1000;

function isWithinEditWindow(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < CLIENT_DELETE_WINDOW_MS;
}

// ── Avatar Component ────────────────────────────────────

function MessageAvatar({ author }: { author: MessageResponse['author'] }) {
  const avatarUrl =
    author.profile?.avatarKind === 'uploaded' && author.profile.portraitUrl
      ? author.profile.portraitUrl
      : author.profile?.builtInAvatarUrl ?? null;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={author.username}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: 0,
          display: 'block',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
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
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        flexShrink: 0,
      }}
    >
      {author.username.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Helper: collect all images across messages for lightbox ──

interface LightboxImage {
  url: string;
  filename: string;
}

function collectAllImages(messages: MessageResponse[]): LightboxImage[] {
  const images: LightboxImage[] = [];
  for (const msg of messages) {
    if (isTombstone(msg)) continue;
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.contentType.startsWith('image/')) {
          images.push({ url: att.url, filename: att.filename });
        }
      }
    }
  }
  return images;
}

// ── Reply Quoted Block ───────────────────────────────────

function ReplyQuote({
  replyTo,
  onClickQuote,
}: {
  replyTo: NonNullable<MessageResponse['replyTo']>;
  onClickQuote?: (messageId: string) => void;
}) {
  const isDeleted = replyTo.deletedAt != null || replyTo.content === null;

  return (
    <div
      onClick={() => onClickQuote?.(replyTo.id)}
      style={{
        borderLeft: '2px solid var(--border-default)',
        paddingLeft: 'var(--space-2)',
        marginBottom: 'var(--space-1)',
        cursor: onClickQuote ? 'pointer' : 'default',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-muted)',
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 500, fontSize: 'var(--text-xs)' }}>
        {replyTo.author.username}
      </div>
      <div style={isDeleted ? { fontStyle: 'italic' } : {}}>
        {isDeleted ? 'deleted message' : replyTo.content}
      </div>
    </div>
  );
}

// ── Collapsible Text ─────────────────────────────────────

function CollapsibleText({
  content,
  knownUsernames,
  currentUsername,
}: {
  content: string;
  knownUsernames?: string[];
  currentUsername?: string;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [measured, setMeasured] = useState(false);

  // Trim trailing whitespace — pre-wrap renders trailing \n as blank lines
  // which wastes space inside the max-height container
  const trimmedContent = content.replace(/\s+$/, '');

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const overflows = el.scrollHeight > el.clientHeight;
    setIsOverflowing(overflows);
    setMeasured(true);
    if (!overflows) {
      el.style.maxHeight = 'none';
    }
  }, [trimmedContent]);

  return (
    <div style={{ lineHeight: 0 }}>
      <div
        ref={textRef}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--chat-font-size)',
          color: 'var(--text-primary)',
          letterSpacing: '0.02em',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          overflow: 'hidden',
          maxHeight: isExpanded ? 'none' : '4.8em',
        }}
      >
        {renderEnrichedText(trimmedContent, knownUsernames, currentUsername)}
      </div>
      {measured && isOverflowing && !isExpanded && (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          style={{
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: 0,
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            letterSpacing: '0.02em',
            lineHeight: 1.4,
          }}
        >
          {'[...] \u25BC'}
        </button>
      )}
      {isExpanded && isOverflowing && (
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          style={{
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: 0,
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            letterSpacing: '0.02em',
            lineHeight: 1.4,
          }}
        >
          {'\u25B2'}
        </button>
      )}
    </div>
  );
}

// ── Inline Edit Textarea ─────────────────────────────────

function InlineEditTextarea({
  initialContent,
  onSave,
  onCancel,
}: {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    // Move cursor to end
    if (textareaRef.current) {
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed.length > 0) onSave(trimmed);
      }
    },
    [value, onSave, onCancel]
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  return (
    <div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        rows={1}
        style={{
          width: '100%',
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          border: '1px solid var(--accent)',
          borderRadius: 0,
          padding: 'var(--space-2) var(--space-3)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--chat-font-size)',
          letterSpacing: '0.02em',
          lineHeight: 1.6,
          resize: 'none',
          outline: 'none',
          minHeight: '36px',
          maxHeight: '200px',
          overflow: 'auto',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
        <button
          type="button"
          onClick={() => {
            const trimmed = value.trim();
            if (trimmed.length > 0) onSave(trimmed);
          }}
          style={{
            background: 'transparent',
            border: '1px solid var(--accent)',
            borderRadius: 0,
            padding: '2px var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--accent)',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          [ SAVE ]
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: '2px var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          [ CANCEL ]
        </button>
      </div>
    </div>
  );
}

// ── Message Content with Attachments + Reactions ─────────

function MessageContent({
  msg,
  onImageClick,
  onReaction,
  onReply,
  currentUserId,
  currentUsername,
  knownUsernames,
  isAdmin,
  membership,
  readOnly,
  isEditing,
  onSaveEdit,
  onCancelEdit,
  onContextMenu,
  onClickQuote,
}: {
  msg: MessageResponse;
  onImageClick: (url: string, filename: string) => void;
  onReaction?: (messageId: string, emoji: string) => void;
  onReply?: (msg: MessageResponse) => void;
  currentUserId: string;
  currentUsername?: string;
  knownUsernames?: string[];
  isAdmin?: boolean;
  membership?: string | null;
  readOnly?: boolean;
  isEditing?: boolean;
  onSaveEdit?: (content: string) => void;
  onCancelEdit?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onClickQuote?: (messageId: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const deleted = isTombstone(msg);
  const system = isSystemMessage(msg);
  const canInteract = !readOnly && !system && membership === 'joined';

  return (
    <div
      style={{
        position: 'relative',
        // Extend hover zone left to cover the icon area so
        // mouseLeave doesn't fire when moving to the icons
        marginLeft: '-36px',
        paddingLeft: '36px',
        // Force tight vertical stacking — no mysterious block gaps
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { if (!showPicker) setIsHovered(false); }}
      onContextMenu={canInteract && !deleted ? onContextMenu : undefined}
    >
      {/* Reply quoted block (NOT collapsible) */}
      {msg.replyTo && (
        <ReplyQuote replyTo={msg.replyTo} onClickQuote={onClickQuote} />
      )}

      {/* Tombstone display */}
      {deleted ? (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--chat-font-size)',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            letterSpacing: '0.02em',
            lineHeight: 1.6,
          }}
        >
          deleted message
        </div>
      ) : isEditing ? (
        <InlineEditTextarea
          initialContent={msg.content ?? ''}
          onSave={(content) => onSaveEdit?.(content)}
          onCancel={() => onCancelEdit?.()}
        />
      ) : msg.content ? (
        <CollapsibleText content={msg.content} knownUsernames={knownUsernames} currentUsername={currentUsername} />
      ) : null}

      {/* Attachments (hidden for tombstones) */}
      {!deleted && msg.attachments && msg.attachments.length > 0 && (
        <MessageAttachments
          attachments={msg.attachments}
          onImageClick={onImageClick}
        />
      )}

      {/* Reaction badges (preserved for tombstones) */}
      {msg.reactions && msg.reactions.length > 0 && (
        <ReactionBadges
          reactions={msg.reactions}
          currentUserId={currentUserId}
          onToggle={(emoji) => onReaction?.(msg.id, emoji)}
        />
      )}

      {/* Hover icons: emoji trigger + reply — left gutter, vertically centered */}
      {canInteract && (isHovered || showPicker) && !deleted && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '0px',
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'row',
            gap: '2px',
          }}
        >
          {/* Emoji trigger */}
          {onReaction && (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              aria-label="Add reaction"
              title="Add reaction"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 0,
                padding: '2px',
                cursor: 'pointer',
                lineHeight: 1,
                color: 'var(--text-muted)',
                transition: 'color 150ms',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '28px',
                minHeight: '28px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <SmilePlus size={14} strokeWidth={1.5} />
            </button>
          )}
          {/* Reply icon */}
          {onReply && (
            <IconButton
              icon={Reply}
              label="Reply to message"
              color="var(--text-muted)"
              size={14}
              onClick={() => onReply(msg)}
              style={{
                minWidth: '28px',
                minHeight: '28px',
                padding: '2px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
              }}
            />
          )}
          {showPicker && onReaction && (
            <EmojiPicker
              onSelect={(emoji) => onReaction(msg.id, emoji)}
              onClose={() => { setShowPicker(false); setIsHovered(false); }}
              anchorRef={triggerRef}
            />
          )}
        </div>
      )}

      {/* Reply icon on tombstones — left gutter, vertically centered */}
      {canInteract && deleted && isHovered && onReply && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '0px',
            transform: 'translateY(-50%)',
          }}
        >
          <IconButton
            icon={Reply}
            label="Reply to message"
            color="var(--text-muted)"
            size={14}
            onClick={() => onReply(msg)}
            style={{
              minWidth: '28px',
              minHeight: '28px',
              padding: '2px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Edit Indicator ───────────────────────────────────────

function EditIndicator({ msg }: { msg: MessageResponse }) {
  if (!msg.editedAt) return null;
  const isAdminEdit = msg.editedBy && msg.editedBy !== msg.authorId;
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        marginLeft: 'var(--space-1)',
      }}
    >
      {isAdminEdit ? '(edited by admin)' : '(edited)'}
    </span>
  );
}

// ── Inline Error for time-expired actions ────────────────

function TimeExpiredError() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        marginLeft: 'var(--space-2)',
        transition: 'opacity 300ms',
      }}
    >
      time window expired
    </span>
  );
}

// ── Main Component ──────────────────────────────────────

export function MessageList({
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
  dmOtherUsername,
  onReaction,
  onRetry,
  onDelete,
  onEdit,
  onReply,
  readOnly,
  editingMessageId,
  onCancelEdit,
  onSaveEdit,
  scrollToMessageId,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);
  const messageRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

  // Scroll position restoration after message prepend
  const prevScrollHeightRef = useRef(0);

  // Context menu state
  const contextMenu = useContextMenu();
  const [contextMenuMsgId, setContextMenuMsgId] = useState<string | null>(null);

  // Time-expired error per message
  const [expiredErrors, setExpiredErrors] = useState<Set<string>>(new Set());

  // Scroll-to-message highlight
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const allImages = useMemo(() => collectAllImages(messages), [messages]);

  const handleImageClick = useCallback(
    (url: string, _filename: string) => {
      const idx = allImages.findIndex((img) => img.url === url);
      if (idx >= 0) setLightboxIndex(idx);
    },
    [allImages]
  );

  // Scroll to message by ID
  const scrollToMessage = useCallback((messageId: string) => {
    const el = messageRefsMap.current.get(messageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight
      el.style.background = 'var(--bg-elevated)';
      setTimeout(() => {
        el.style.background = '';
      }, 1500);
    }
  }, []);

  // Capture scroll height when loading starts (for scroll restoration after prepend)
  useEffect(() => {
    if (isLoadingMore && listRef.current) {
      prevScrollHeightRef.current = listRef.current.scrollHeight;
    }
  }, [isLoadingMore]);

  // Restore scroll position when loading completes (messages were prepended)
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!isLoadingMore && prevScrollHeightRef.current > 0 && el) {
      const delta = el.scrollHeight - prevScrollHeightRef.current;
      if (delta > 0) {
        el.scrollTop += delta;
      }
      prevScrollHeightRef.current = 0;
    }
  }, [messages, isLoadingMore]);

  // Auto-scroll to bottom when new messages arrive (if user was at bottom)
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current && wasAtBottomRef.current && !isLoadingMore) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, isLoadingMore]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      bottomRef.current?.scrollIntoView();
    }
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to a specific message (e.g. from search)
  useEffect(() => {
    if (scrollToMessageId) {
      const el = messageRefsMap.current.get(scrollToMessageId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedId(scrollToMessageId);
        const timer = setTimeout(() => setHighlightedId(null), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [scrollToMessageId]);

  // Track if user is at bottom
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;

    const threshold = 50;
    wasAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

    if (el.scrollTop < 100 && hasMore && !isLoadingMore) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  // Build context menu items for a message
  const buildMenuItems = useCallback(
    (msg: MessageResponse): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      const sys = isSystemMessage(msg);
      const dead = isTombstone(msg);

      // REPLY — available for joined members on any message
      if (onReply && membership === 'joined') {
        items.push({
          id: 'reply',
          label: 'Reply',
          icon: Reply,
          onAction: () => onReply(msg),
        });
      }

      // EDIT — own + < 3:10, OR admin. Not system/tombstone.
      if (onEdit && !sys && !dead && membership === 'joined') {
        const isOwn = msg.authorId === currentUserId;
        const canEdit = isAdmin || (isOwn && isWithinEditWindow(msg.createdAt));
        if (canEdit) {
          items.push({
            id: 'edit',
            label: 'Edit message',
            icon: Pencil,
            onAction: () => onEdit(msg.id, msg.content ?? ''),
          });
        }
      }

      // DELETE — own + < 3:10, OR admin. Not system.
      if (onDelete && !sys && membership === 'joined') {
        const isOwn = msg.authorId === currentUserId;
        const canDelete = isAdmin || (isOwn && isWithinEditWindow(msg.createdAt));
        if (canDelete && !dead) {
          items.push({
            id: 'delete',
            label: 'Delete message',
            icon: Trash2,
            destructive: true,
            confirmQuestion: 'Delete this message?',
            onAction: () => onDelete(msg.id),
          });
        }
      }

      return items;
    },
    [currentUserId, isAdmin, membership, onReply, onEdit, onDelete]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, msgId: string) => {
      const msg = messages.find((m) => m.id === msgId);
      if (!msg) return;
      // No context menu for system messages
      if (isSystemMessage(msg)) return;
      const items = buildMenuItems(msg);
      if (items.length === 0) return;
      contextMenu.open(e);
      setContextMenuMsgId(msgId);
    },
    [messages, buildMenuItems, contextMenu]
  );

  if (isLoading) {
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
        loading...
      </div>
    );
  }

  if (messages.length === 0) {
    // CGL-010 + spec 30-chat §30.4: distinct copy for room vs DM.
    //   Room: "No messages yet. Say something."
    //   DM:   "Send {username} a message."
    const emptyCopy = dmOtherUsername
      ? `Send ${dmOtherUsername} a message.`
      : 'No messages yet. Say something.';
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
        {emptyCopy}
      </div>
    );
  }

  const contextMsg = contextMenuMsgId
    ? messages.find((m) => m.id === contextMenuMsgId)
    : null;
  const menuItems = contextMsg ? buildMenuItems(contextMsg) : [];

  return (
    <>
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        {/* Loading more indicator */}
        {isLoadingMore && (
          <div
            style={{
              textAlign: 'center',
              padding: 'var(--space-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
            }}
          >
            loading older messages...
          </div>
        )}

        {messages.map((msg, idx) => {
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const isSystemMsg = isSystemMessage(msg);
          const isGrouped = prevMsg !== null && shouldGroup(prevMsg, msg);
          const needsDateSep = prevMsg !== null && !isSameDay(prevMsg.createdAt, msg.createdAt);
          const isEditing = editingMessageId === msg.id;

          return (
            <div
              key={msg.id}
              data-message-id={msg.id}
              ref={(el) => {
                if (el) messageRefsMap.current.set(msg.id, el);
                else messageRefsMap.current.delete(msg.id);
              }}
              style={{
                overflow: 'visible',
                transition: 'background 500ms',
                background: highlightedId === msg.id ? 'var(--accent-glow)' : undefined,
              }}
            >
              {/* Date Separator */}
              {needsDateSep && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 'var(--space-4) 0 var(--space-3)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    letterSpacing: '0.02em',
                  }}
                >
                  {'------- '}
                  {formatDateFull(msg.createdAt)}
                  {' --------'}
                </div>
              )}

              {/* System Message */}
              {isSystemMsg ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 'var(--space-1) 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic',
                  }}
                >
                  {parseSystemMessage(msg.content ?? '', msg.author.username)}
                </div>
              ) : isGrouped ? (
                /* Grouped Message (continuation) */
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    paddingTop: 'var(--space-1)',
                    paddingLeft: 'calc(32px + var(--space-2))',
                    opacity: (msg as LocalMessage)._pending ? 0.5 : 1,
                    position: 'relative',
                    overflow: 'visible',
                  }}
                  className="message-row"
                >
                  {/* Hover timestamp */}
                  <span
                    className="message-hover-time"
                    style={{
                      position: 'absolute',
                      left: '0',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                      opacity: 0,
                      transition: 'opacity 150ms',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatTime(msg.createdAt)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <MessageContent
                      msg={msg}
                      onImageClick={handleImageClick}
                      onReaction={onReaction}
                      onReply={onReply}
                      currentUserId={currentUserId}
                      currentUsername={currentUsername}
                      knownUsernames={knownUsernames}
                      isAdmin={isAdmin}
                      membership={membership}
                      readOnly={readOnly}
                      isEditing={isEditing}
                      onSaveEdit={isEditing ? (content) => onSaveEdit?.(msg.id, content) : undefined}
                      onCancelEdit={isEditing ? onCancelEdit : undefined}
                      onContextMenu={(e) => handleContextMenu(e, msg.id)}
                      onClickQuote={scrollToMessage}
                    />
                    {(msg as LocalMessage)._error && (msg as LocalMessage)._tempId && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: '2px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--error)' }}>
                          Failed to send
                        </span>
                        <button
                          type="button"
                          onClick={() => onRetry?.((msg as LocalMessage)._tempId!)}
                          data-testid="retry-button"
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--error)',
                            borderRadius: 0,
                            padding: '1px 6px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--error)',
                            cursor: 'pointer',
                          }}
                        >
                          [ retry ]
                        </button>
                      </div>
                    )}
                    {expiredErrors.has(msg.id) && <TimeExpiredError />}
                  </div>
                </div>
              ) : (
                /* Full Message (first in group) */
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    paddingTop: prevMsg && !needsDateSep ? 'var(--space-3)' : 'var(--space-1)',
                    opacity: (msg as LocalMessage)._pending ? 0.5 : 1,
                    position: 'relative',
                    overflow: 'visible',
                  }}
                >
                  <MessageAvatar author={msg.author} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Username line */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 'var(--space-2)',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-sm)',
                          fontWeight: 500,
                          color: 'var(--accent)',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {msg.author.username}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {(msg as LocalMessage)._pending
                          ? 'sending...'
                          : isToday(msg.createdAt)
                            ? formatTime(msg.createdAt)
                            : `${formatDateFull(msg.createdAt)} ${formatTime(msg.createdAt)}`}
                      </span>
                      <EditIndicator msg={msg} />
                    </div>
                    {/* Message content + attachments */}
                    <MessageContent
                      msg={msg}
                      onImageClick={handleImageClick}
                      onReaction={onReaction}
                      onReply={onReply}
                      currentUserId={currentUserId}
                      currentUsername={currentUsername}
                      knownUsernames={knownUsernames}
                      isAdmin={isAdmin}
                      membership={membership}
                      readOnly={readOnly}
                      isEditing={isEditing}
                      onSaveEdit={isEditing ? (content) => onSaveEdit?.(msg.id, content) : undefined}
                      onCancelEdit={isEditing ? onCancelEdit : undefined}
                      onContextMenu={(e) => handleContextMenu(e, msg.id)}
                      onClickQuote={scrollToMessage}
                    />
                    {/* Error indicator with retry */}
                    {(msg as LocalMessage)._error && (msg as LocalMessage)._tempId && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: '2px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--error)' }}>
                          Failed to send
                        </span>
                        <button
                          type="button"
                          onClick={() => onRetry?.((msg as LocalMessage)._tempId!)}
                          data-testid="retry-button"
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--error)',
                            borderRadius: 0,
                            padding: '1px 6px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--error)',
                            cursor: 'pointer',
                          }}
                        >
                          [ retry ]
                        </button>
                      </div>
                    )}
                    {expiredErrors.has(msg.id) && <TimeExpiredError />}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Context Menu */}
      {contextMenu.isOpen && menuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={contextMenu.close}
        />
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          images={allImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
