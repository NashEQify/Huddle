import { useState, useCallback, useRef, useEffect } from 'react';
import type { MessageResponse } from '@huddle/shared';
import { resizeImage } from '../../lib/imageResize';

const MAX_MESSAGE_LENGTH = 10000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

/** Image types that go through the resize pipeline (not GIF — animation) */
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'application/zip',
  'audio/mpeg', 'audio/ogg', 'video/mp4', 'video/webm',
]);

export interface ReplyTarget {
  id: string;
  authorUsername: string;
  content: string | null;
  deletedAt?: string;
}

interface MessageInputProps {
  onSend: (content: string, files?: File[], replyToId?: string) => Promise<void>;
  disabled?: boolean;
  onKeystroke?: () => void;
  onSendStart?: () => void;
  replyTarget?: ReplyTarget | null;
  onCancelReply?: () => void;
  knownUsernames?: string[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageType(type: string): boolean {
  return type.startsWith('image/');
}

export function MessageInput({ onSend, disabled, onKeystroke, onSendStart, replyTarget, onCancelReply, knownUsernames }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Map<string, string>>(new Map());
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(0);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  // Compute filtered mention suggestions
  const mentionSuggestions = mentionQuery !== null && knownUsernames
    ? knownUsernames.filter((name) =>
        name.toLowerCase().startsWith(mentionQuery.toLowerCase())
      ).slice(0, 8)
    : [];

  // Insert a mention into the content
  const insertMention = useCallback((username: string) => {
    const before = content.slice(0, mentionStartIndex);
    const after = content.slice(textareaRef.current?.selectionStart ?? content.length);
    const newContent = `${before}@${username} ${after}`;
    setContent(newContent);
    setMentionQuery(null);
    setMentionSelectedIndex(0);

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const pos = before.length + username.length + 2;
        el.focus();
        el.setSelectionRange(pos, pos);
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 150) + 'px';
      }
    });
  }, [content, mentionStartIndex]);

  // Validate and add files (with auto-resize for images >1 MB)
  const addFiles = useCallback(async (newFiles: FileList | File[]) => {
    setFileError(null);
    const incoming = Array.from(newFiles);
    const toAdd: File[] = [];

    for (const file of incoming) {
      // Check max count
      if (files.length + toAdd.length >= MAX_FILES) {
        setFileError(`Maximum ${MAX_FILES} files per message`);
        break;
      }
      // Check type
      if (!ALLOWED_TYPES.has(file.type)) {
        setFileError(`File type not allowed: ${file.name}`);
        continue;
      }
      // Resizable images: resize first, then check size
      if (RESIZABLE_TYPES.has(file.type) && file.size > 1024 * 1024) {
        setIsResizing(true);
        try {
          const resized = await resizeImage(file);
          // `resizeImage` can still return a file above the server's
          // 10 MB limit when even the min-quality JPEG pass exceeds it
          // (extremely large images where downscaling alone isn't
          // enough). Without this guard, the upload reached the server
          // and got rejected with a generic 400 — poor UX. See
          // imageResize.ts:149-165 "min-quality accept" branch.
          if (resized.size > MAX_FILE_SIZE) {
            setFileError(
              `Image still exceeds 10 MB after compression: ${file.name}. Try a smaller original.`
            );
            setIsResizing(false);
            continue;
          }
          toAdd.push(resized);
        } catch {
          setFileError(`Could not process image: ${file.name}`);
        }
        setIsResizing(false);
        continue;
      }
      // Non-resizable files: enforce 10 MB limit
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`File exceeds 10 MB limit: ${file.name}`);
        continue;
      }
      toAdd.push(file);
    }

    if (toAdd.length > 0) {
      setFiles((prev) => [...prev, ...toAdd]);
      for (const file of toAdd) {
        if (isImageType(file.type)) {
          const url = URL.createObjectURL(file);
          setFilePreviews((prev) => {
            const next = new Map(prev);
            next.set(file.name + file.size, url);
            return next;
          });
        }
      }
    }
  }, [files]);

  // Remove a file
  const removeFile = useCallback((index: number) => {
    setFiles((prev) => {
      const removed = prev[index];
      if (removed) {
        const key = removed.name + removed.size;
        setFilePreviews((prev) => {
          const next = new Map(prev);
          const url = next.get(key);
          if (url) {
            URL.revokeObjectURL(url);
            next.delete(key);
          }
          return next;
        });
      }
      return prev.filter((_, i) => i !== index);
    });
    setFileError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim();
    if ((!trimmed && files.length === 0) || isSending || isOverLimit) return;

    onSendStart?.();
    setIsSending(true);
    setContent('');
    const currentReplyId = replyTarget?.id;
    onCancelReply?.(); // Clear reply mode immediately

    const filesToSend = files.length > 0 ? [...files] : undefined;

    // Clear files and previews
    if (filesToSend) {
      setFiles([]);
      // Revoke preview URLs
      for (const url of filePreviews.values()) {
        URL.revokeObjectURL(url);
      }
      setFilePreviews(new Map());
    }
    setFileError(null);

    try {
      await onSend(trimmed, filesToSend, currentReplyId);
    } catch {
      // Restore content on error
      setContent(trimmed);
      if (filesToSend) {
        setFiles(filesToSend);
      }
    }

    setIsSending(false);
    // Wait for React to re-render (removing disabled attr) before focusing
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [content, files, filePreviews, isSending, onSend, onSendStart, replyTarget, onCancelReply]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle mention autocomplete navigation
      if (mentionQuery !== null && mentionSuggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionSelectedIndex((prev) =>
            prev < mentionSuggestions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : mentionSuggestions.length - 1
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertMention(mentionSuggestions[mentionSelectedIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionQuery(null);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape' && replyTarget) {
        e.preventDefault();
        onCancelReply?.();
      }
    },
    [handleSubmit, replyTarget, onCancelReply, mentionQuery, mentionSuggestions, mentionSelectedIndex, insertMention]
  );

  // Focus input when reply is activated
  useEffect(() => {
    if (replyTarget) {
      textareaRef.current?.focus();
    }
  }, [replyTarget]);

  // Auto-resize textarea + trigger keystroke + mention detection
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
    if (value.length > 0) {
      onKeystroke?.();
    }

    // Detect @mention trigger
    const cursorPos = el.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);

    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex >= 0) {
      const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
        const query = textBeforeCursor.slice(lastAtIndex + 1);
        if (!query.includes('\n')) {
          // Allow spaces in query if a known username matches the prefix
          const hasMatch = !query.includes(' ') || (knownUsernames ?? []).some(
            (name) => name.toLowerCase().startsWith(query.toLowerCase())
          );
          if (hasMatch) {
            setMentionQuery(query);
            setMentionStartIndex(lastAtIndex);
            setMentionSelectedIndex(0);
            return;
          }
        }
      }
    }
    setMentionQuery(null);
  }, [onKeystroke]);

  // Clipboard paste handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      addFiles(imageFiles);
    }
  }, [addFiles]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const hasContent = content.trim().length > 0 || files.length > 0;
  const isOverLimit = content.length > MAX_MESSAGE_LENGTH;

  return (
    <div
      style={{
        flexShrink: 0,
        padding: 'var(--space-3) var(--space-4)',
        borderTop: '1px solid var(--border-default)',
        background: isDragOver ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        transition: 'background 150ms',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Reply preview bar */}
      {replyTarget && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            marginBottom: 'var(--space-2)',
            background: 'var(--bg-elevated)',
            borderLeft: '2px solid var(--accent-dim)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-2)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', marginBottom: '2px' }}>
              Replying to {replyTarget.authorUsername}
            </div>
            <div
              style={{
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {replyTarget.deletedAt
                ? 'deleted message'
                : (replyTarget.content ?? '').slice(0, 80)}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              padding: '0 2px',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            [x]
          </button>
        </div>
      )}

      {/* Drop zone indicator */}
      {isDragOver && (
        <div
          style={{
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-2)',
            border: '1px dashed var(--accent)',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            color: 'var(--accent)',
          }}
        >
          Drop files here
        </div>
      )}

      {/* File error */}
      {fileError && (
        <div
          style={{
            padding: 'var(--space-1) var(--space-2)',
            marginBottom: 'var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--error)',
          }}
        >
          {fileError}
        </div>
      )}

      {/* File preview chips */}
      {files.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-2)',
          }}
        >
          {files.map((file, idx) => {
            const key = file.name + file.size;
            const previewUrl = filePreviews.get(key);
            return (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  padding: 'var(--space-1) var(--space-2)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-input)',
                  maxWidth: '200px',
                }}
              >
                {/* Image thumbnail or file icon */}
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={file.name}
                    style={{
                      width: '36px',
                      height: '36px',
                      objectFit: 'cover',
                      borderRadius: 0,
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-secondary)',
                      flexShrink: 0,
                    }}
                  >
                    []
                  </span>
                )}
                {/* Name + size */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {file.name}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {isResizing ? 'Resizing...' : formatFileSize(file.size)}
                  </div>
                </div>
                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  aria-label={`Remove ${file.name}`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    cursor: 'pointer',
                    padding: '0 2px',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--error)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-muted)';
                  }}
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Mention autocomplete dropdown */}
      {mentionQuery !== null && mentionSuggestions.length > 0 && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            marginBottom: 'var(--space-1)',
            maxHeight: '200px',
            overflowY: 'auto',
          }}
        >
          {mentionSuggestions.map((username, idx) => (
            <button
              key={username}
              type="button"
              onClick={() => insertMention(username)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: idx === mentionSelectedIndex ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                borderRadius: 0,
                padding: 'var(--space-2) var(--space-3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: idx === mentionSelectedIndex ? 'var(--accent)' : 'var(--text-primary)',
                cursor: 'pointer',
                transition: 'background 100ms',
              }}
              onMouseEnter={(e) => {
                setMentionSelectedIndex(idx);
                e.currentTarget.style.background = 'var(--bg-surface)';
              }}
              onMouseLeave={(e) => {
                if (idx !== mentionSelectedIndex) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{ color: 'var(--accent)' }}>@</span>
              {username}
            </button>
          ))}
        </div>
      )}

      {/* Character limit warning */}
      {isOverLimit && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            marginBottom: 'var(--space-2)',
            border: '1px solid var(--error)',
            background: 'var(--bg-elevated)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            color: 'var(--error)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>MESSAGE TOO LONG</span>
          <span>{content.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}</span>
        </div>
      )}

      {/* Input row */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'flex-end',
        }}
      >
        {/* Paperclip / attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSending}
          aria-label="Attach files"
          style={{
            background: 'transparent',
            color: files.length > 0 ? 'var(--accent)' : 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: 'var(--space-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'color 150ms, border-color 150ms',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--accent)';
            e.currentTarget.style.borderColor = 'var(--accent-dim)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = files.length > 0 ? 'var(--accent)' : 'var(--text-secondary)';
            e.currentTarget.style.borderColor = 'var(--border-default)';
          }}
        >
          +F
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={Array.from(ALLOWED_TYPES).join(',')}
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(e.target.files);
            }
            // Reset so the same file can be selected again
            e.target.value = '';
          }}
        />

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled || isSending}
          placeholder={files.length > 0 ? 'Add a message (optional)...' : 'Type a message...'}
          rows={1}
          data-message-input
          aria-label="Type a message"
          style={{
            flex: 1,
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: 'var(--space-2) var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--chat-font-size)',
            letterSpacing: '0.02em',
            lineHeight: 1.6,
            resize: 'none',
            outline: 'none',
            minHeight: '36px',
            maxHeight: '150px',
            overflow: 'auto',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.boxShadow = 'var(--glow-ring)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-default)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasContent || isSending || disabled || isOverLimit}
          style={{
            background: 'transparent',
            color: hasContent ? 'var(--accent)' : 'var(--text-muted)',
            border: `1px solid ${hasContent ? 'var(--accent)' : 'var(--border-default)'}`,
            borderRadius: 0,
            padding: 'var(--space-2) var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            cursor: hasContent ? 'pointer' : 'default',
            transition: 'background 150ms, color 150ms',
            flexShrink: 0,
            opacity: hasContent ? 1 : 0.5,
          }}
          onMouseEnter={(e) => {
            if (hasContent) {
              e.currentTarget.style.background = 'var(--accent)';
              e.currentTarget.style.color = 'var(--bg-base)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = hasContent
              ? 'var(--accent)'
              : 'var(--text-muted)';
          }}
        >
          SEND
        </button>
      </div>

    </div>
  );
}
