import { useState, useCallback, useRef, useEffect } from 'react';
import type { MessageResponse } from '@huddle/shared';
import { api } from '../../lib/api';

// Extended search result with room name context
interface SearchResult extends MessageResponse {
  roomName: string | null;
}

interface MessageSearchProps {
  scopeType?: 'room' | 'direct';
  scopeId?: string;
  onClose: () => void;
  onNavigateToMessage?: (messageId: string, scopeType: string, scopeId: string) => void;
}

// ── Helper: format relative time ─────────────────────────

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  const d = new Date(dateStr);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ── Helper: highlight matches in content ─────────────────

function highlightContent(
  content: string,
  query: string,
  maxLength: number = 120
): Array<{ text: string; highlight: boolean }> {
  if (!query || !content) return [{ text: content.slice(0, maxLength), highlight: false }];

  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIdx = lowerContent.indexOf(lowerQuery);

  if (matchIdx === -1) {
    return [{ text: content.slice(0, maxLength), highlight: false }];
  }

  // Show content around the match
  const contextBefore = 30;
  const start = Math.max(0, matchIdx - contextBefore);
  const end = Math.min(content.length, start + maxLength);
  const slice = content.slice(start, end);
  const relMatchIdx = matchIdx - start;

  const parts: Array<{ text: string; highlight: boolean }> = [];

  if (start > 0) {
    parts.push({ text: '...', highlight: false });
  }

  if (relMatchIdx > 0) {
    parts.push({ text: slice.slice(0, relMatchIdx), highlight: false });
  }

  parts.push({
    text: slice.slice(relMatchIdx, relMatchIdx + query.length),
    highlight: true,
  });

  const afterMatch = relMatchIdx + query.length;
  if (afterMatch < slice.length) {
    parts.push({ text: slice.slice(afterMatch), highlight: false });
  }

  if (end < content.length) {
    parts.push({ text: '...', highlight: false });
  }

  return parts;
}

export function MessageSearch({
  scopeType,
  scopeId,
  onClose,
  onNavigateToMessage,
}: MessageSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const executeSearch = useCallback(
    async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setResults([]);
        setTotal(0);
        setHasSearched(false);
        return;
      }

      setIsSearching(true);
      setHasSearched(true);

      const params = new URLSearchParams({ q: searchQuery, limit: '50' });
      if (scopeType && scopeId) {
        params.set('scopeType', scopeType);
        params.set('scopeId', scopeId);
      }

      const result = await api.get<{ messages: SearchResult[]; total: number }>(
        `/api/messages/search?${params.toString()}`
      );

      if (result.ok) {
        setResults(result.data.messages);
        setTotal(result.data.total);
      } else {
        setResults([]);
        setTotal(0);
      }

      setIsSearching(false);
    },
    [scopeType, scopeId]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        executeSearch(value.trim());
      }, 300);
    },
    [executeSearch]
  );

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleResultClick = useCallback(
    (msg: SearchResult) => {
      onNavigateToMessage?.(msg.id, msg.scopeType, msg.scopeId);
      onClose();
    },
    [onNavigateToMessage, onClose]
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(10, 10, 20, 0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          margin: 'var(--space-8) auto 0',
          width: '100%',
          maxWidth: '640px',
          maxHeight: 'calc(100vh - 100px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 0,
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              flexShrink: 0,
            }}
          >
            [
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--accent)',
              flexShrink: 0,
            }}
          >
            SEARCH
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder="type to search messages..."
            style={{
              flex: 1,
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 0,
              padding: 'var(--space-2) var(--space-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-base)',
              letterSpacing: '0.02em',
              outline: 'none',
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
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              flexShrink: 0,
            }}
          >
            ]
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-default)',
              borderRadius: 0,
              padding: 'var(--space-1) var(--space-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'color 150ms, border-color 150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--error)';
              e.currentTarget.style.borderColor = 'var(--error)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-default)';
            }}
          >
            ESC
          </button>
        </div>

        {/* Results area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-3) var(--space-4)',
            minHeight: '200px',
            maxHeight: '60vh',
          }}
        >
          {/* Status line */}
          {isSearching && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                padding: 'var(--space-2) 0',
              }}
            >
              searching...
            </div>
          )}

          {!isSearching && hasSearched && results.length === 0 && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                padding: 'var(--space-4) 0',
                textAlign: 'center',
              }}
            >
              no results found
            </div>
          )}

          {!isSearching && hasSearched && results.length > 0 && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                padding: 'var(--space-1) 0 var(--space-2)',
              }}
            >
              {total} matching message{total === 1 ? '' : 's'}
              {total > results.length ? ` (showing ${results.length})` : ''}
            </div>
          )}

          {!hasSearched && !isSearching && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                padding: 'var(--space-4) 0',
                textAlign: 'center',
              }}
            >
              {scopeType ? 'search in this conversation' : 'search across all rooms'}
            </div>
          )}

          {/* Result items */}
          {results.map((msg) => (
            <button
              key={msg.id}
              type="button"
              onClick={() => handleResultClick(msg)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border-default)',
                padding: 'var(--space-3) var(--space-2)',
                cursor: 'pointer',
                transition: 'background 150ms',
                borderRadius: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-surface)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {/* Author + Context + Time */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-1)',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: 'var(--accent)',
                  }}
                >
                  {msg.author.username}
                </span>
                {msg.roomName && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    in #{msg.roomName}
                  </span>
                )}
                {msg.scopeType === 'direct' && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    [DM]
                  </span>
                )}
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-muted)',
                    marginLeft: 'auto',
                    flexShrink: 0,
                  }}
                >
                  {formatRelativeTime(msg.createdAt)}
                </span>
              </div>

              {/* Content snippet with highlights */}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-primary)',
                  lineHeight: 1.5,
                }}
              >
                {highlightContent(msg.content ?? '', query).map((part, i) => (
                  <span
                    key={i}
                    style={{
                      color: part.highlight ? 'var(--accent)' : 'var(--text-primary)',
                      fontWeight: part.highlight ? 700 : 400,
                      background: part.highlight ? 'var(--accent-glow)' : 'transparent',
                    }}
                  >
                    {part.text}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: 'var(--space-2) var(--space-4)',
            borderTop: '1px solid var(--border-default)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            display: 'flex',
            gap: 'var(--space-4)',
          }}
        >
          <span>ESC close</span>
          <span>CLICK navigate to message</span>
        </div>
      </div>
    </div>
  );
}
