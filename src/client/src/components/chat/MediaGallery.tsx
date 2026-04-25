/**
 * MediaGallery — Browse all shared images and files in a room/DM.
 * Spec: 30-chat.md §30.21
 */

import { useState, useEffect, useCallback } from 'react';
import type { MediaItem } from '@huddle/shared';
import { api } from '../../lib/api';
import { Lightbox, type LightboxImage } from './Lightbox';

interface MediaGalleryProps {
  scopeType: 'room' | 'direct';
  scopeId: string;
  onClose: () => void;
}

type TabType = 'images' | 'files';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function MediaGallery({ scopeType, scopeId, onClose }: MediaGalleryProps) {
  const [activeTab, setActiveTab] = useState<TabType>('images');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const fetchMedia = useCallback(async (tab: TabType, cursor?: string) => {
    const params = new URLSearchParams({
      scopeType,
      scopeId,
      type: tab,
      limit: '50',
    });
    if (cursor) params.set('cursor', cursor);

    const result = await api.get<{ items: MediaItem[]; nextCursor: string | null }>(
      `/api/messages/media?${params.toString()}`
    );

    if (result.ok) {
      if (cursor) {
        setItems((prev) => [...prev, ...result.data.items]);
      } else {
        setItems(result.data.items);
      }
      setNextCursor(result.data.nextCursor);
    }
  }, [scopeType, scopeId]);

  // Load on mount and tab change
  useEffect(() => {
    setIsLoading(true);
    setItems([]);
    setNextCursor(null);
    fetchMedia(activeTab).finally(() => setIsLoading(false));
  }, [activeTab, fetchMedia]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    await fetchMedia(activeTab, nextCursor);
    setIsLoadingMore(false);
  }, [nextCursor, isLoadingMore, activeTab, fetchMedia]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && lightboxIndex === null) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, lightboxIndex]);

  // Lightbox images (only from current items)
  const lightboxImages: LightboxImage[] = items
    .filter((i) => i.contentType.startsWith('image/'))
    .map((i) => ({ url: i.url, filename: i.filename }));

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 59,
        }}
        onClick={onClose}
      />

      {/* Gallery panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(500px, 95vw)',
          height: 'min(600px, 80vh)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          zIndex: 60,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
            [ MEDIA ]
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              padding: '0 2px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            [x]
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          {(['images', 'files'] as TabType[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'transparent',
                border: `1px solid ${activeTab === tab ? 'var(--accent)' : 'var(--border-default)'}`,
                borderRadius: 0,
                padding: 'var(--space-1) var(--space-3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 'var(--space-3)',
          }}
        >
          {isLoading ? (
            <div
              style={{
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                textAlign: 'center',
                padding: 'var(--space-4)',
              }}
            >
              loading...
            </div>
          ) : items.length === 0 ? (
            <div
              style={{
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                textAlign: 'center',
                padding: 'var(--space-4)',
              }}
            >
              {activeTab === 'images' ? 'No images shared yet.' : 'No files shared yet.'}
            </div>
          ) : activeTab === 'images' ? (
            /* Images Grid */
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, 120px)',
                gap: 'var(--space-2)',
              }}
            >
              {items.map((item, idx) => (
                <div key={item.id}>
                  <div
                    style={{
                      width: '120px',
                      height: '120px',
                      border: '1px solid var(--border-default)',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      background: 'var(--bg-input)',
                    }}
                    onClick={() => setLightboxIndex(idx)}
                  >
                    <img
                      src={item.url}
                      alt={item.filename}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      marginTop: '2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '120px',
                    }}
                  >
                    {item.authorUsername} · {formatDate(item.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Files List */
            <div>
              {items.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  download={item.filename}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2)',
                    borderBottom: '1px solid var(--border-default)',
                    textDecoration: 'none',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-sm)',
                    cursor: 'pointer',
                    transition: 'background 100ms',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>[]</span>
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.filename}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontSize: 'var(--text-xs)' }}>
                    {formatFileSize(item.sizeBytes)}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontSize: 'var(--text-xs)' }}>
                    {item.authorUsername}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, fontSize: 'var(--text-xs)' }}>
                    {formatDate(item.createdAt)}
                  </span>
                </a>
              ))}
            </div>
          )}

          {/* Load More */}
          {nextCursor && !isLoading && (
            <div style={{ textAlign: 'center', padding: 'var(--space-3)' }}>
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-default)',
                  borderRadius: 0,
                  padding: 'var(--space-1) var(--space-3)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  cursor: isLoadingMore ? 'default' : 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {isLoadingMore ? 'loading...' : '[ LOAD MORE ]'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && lightboxImages.length > 0 && (
        <Lightbox
          images={lightboxImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
