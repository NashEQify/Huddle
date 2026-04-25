import { useEffect, useCallback } from 'react';

export interface LightboxImage {
  url: string;
  filename: string;
}

interface LightboxProps {
  images: LightboxImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function Lightbox({ images, currentIndex, onClose, onNavigate }: LightboxProps) {
  const current = images[currentIndex];
  const hasMultiple = images.length > 1;

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  const goNext = useCallback(() => {
    if (currentIndex < images.length - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, images.length, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goPrev, goNext]);

  if (!current) return null;

  return (
    <div
      data-testid="lightbox-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.85)',
      }}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close lightbox"
        style={{
          position: 'absolute',
          top: 'var(--space-4)',
          right: 'var(--space-4)',
          background: 'transparent',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
          borderRadius: 0,
          padding: 'var(--space-1) var(--space-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
          zIndex: 10000,
        }}
      >
        [ x ]
      </button>

      {/* Previous button */}
      {hasMultiple && currentIndex > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          aria-label="Previous image"
          style={{
            position: 'absolute',
            left: 'var(--space-4)',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: 'var(--space-2) var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-lg)',
            cursor: 'pointer',
            zIndex: 10000,
          }}
        >
          {'<'}
        </button>
      )}

      {/* Next button */}
      {hasMultiple && currentIndex < images.length - 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          aria-label="Next image"
          style={{
            position: 'absolute',
            right: 'var(--space-4)',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            padding: 'var(--space-2) var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-lg)',
            cursor: 'pointer',
            zIndex: 10000,
          }}
        >
          {'>'}
        </button>
      )}

      {/* Image */}
      <img
        src={current.url}
        alt={current.filename}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 0,
        }}
      />

      {/* Counter */}
      {hasMultiple && (
        <div
          style={{
            position: 'absolute',
            bottom: 'var(--space-4)',
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>
  );
}
