/**
 * ImageCropModal — Crop UI for image uploads.
 * Spec: 35-uploads.md §35.12
 *
 * Uses react-easy-crop for drag/pinch-to-zoom interaction.
 * Three actions: Apply (crop), Skip (use full image), Cancel (discard).
 */

import { useState, useCallback, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';

interface ImageCropModalProps {
  file: File;
  onApply: (croppedFile: File) => void;
  onSkip: () => void;
  onCancel: () => void;
  /** Fixed aspect ratio (e.g. 1 for square). Hides aspect ratio selector. */
  fixedAspect?: number;
}

type AspectMode = 'free' | '1:1' | '16:9';

const ASPECT_VALUES: Record<AspectMode, number | undefined> = {
  'free': undefined,
  '1:1': 1,
  '16:9': 16 / 9,
};

/**
 * Crop the image using canvas based on the pixel area from react-easy-crop.
 */
async function cropImage(file: File, cropArea: Area): Promise<File> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = cropArea.width;
  canvas.height = cropArea.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context creation failed');
  }

  ctx.drawImage(
    img,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    cropArea.width,
    cropArea.height
  );

  return new Promise((resolve, reject) => {
    const outputType = file.type === 'image/png' ? 'image/png' : file.type;
    const quality = file.type === 'image/png' ? undefined : 0.92;
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Crop export failed'));
          return;
        }
        resolve(new File([blob], file.name, { type: blob.type }));
      },
      outputType,
      quality
    );
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

export function ImageCropModal({ file, onApply, onSkip, onCancel, fixedAspect }: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectMode, setAspectMode] = useState<AspectMode>('free');
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create object URL for the image
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleApply = useCallback(async () => {
    if (!croppedAreaPixels || isProcessing) return;
    setIsProcessing(true);
    setError(null);
    try {
      const cropped = await cropImage(file, croppedAreaPixels);
      onApply(cropped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Crop failed');
      setIsProcessing(false);
    }
  }, [croppedAreaPixels, file, onApply, isProcessing]);

  // Keyboard: Escape = cancel, Enter = apply
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && !isProcessing) {
        handleApply();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, handleApply, isProcessing]);

  if (!imageUrl) return null;

  const aspect = fixedAspect ?? ASPECT_VALUES[aspectMode];
  const showAspectSelector = fixedAspect === undefined;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: 'min(95vw, 800px)',
          maxHeight: '90vh',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            flexShrink: 0,
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
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
            [ CROP ]
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
            }}
          >
            {file.name}
          </span>
        </div>

        {/* Crop area + vertical zoom slider */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            minHeight: '300px',
            maxHeight: '60vh',
          }}
        >
          {/* Crop */}
          <div
            style={{
              position: 'relative',
              flex: 1,
              background: 'var(--bg-base)',
            }}
          >
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              minZoom={1}
              maxZoom={10}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              style={{
                containerStyle: {
                  background: 'var(--bg-base)',
                },
              }}
            />
          </div>

          {/* Vertical zoom slider — right side */}
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--bg-base)',
              borderLeft: '1px solid var(--border-default)',
              width: '48px',
              zIndex: 10,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--text-muted)',
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Zoom
            </span>
            <input
              type="range"
              min={1}
              max={10}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{
                width: '100%',
                writingMode: 'vertical-lr',
                direction: 'rtl',
                accentColor: 'var(--accent)',
                cursor: 'pointer',
                flex: 1,
                minHeight: '120px',
              }}
            />
          </div>
        </div>

        {/* Aspect ratio selector (hidden when fixedAspect is set) */}
        {showAspectSelector && (
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderTop: '1px solid var(--border-default)',
              borderBottom: '1px solid var(--border-default)',
            }}
          >
            {(['free', '1:1', '16:9'] as AspectMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAspectMode(mode)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${aspectMode === mode ? 'var(--accent)' : 'var(--border-default)'}`,
                  borderRadius: 0,
                  padding: 'var(--space-1) var(--space-2)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: aspectMode === mode ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {mode === 'free' ? 'Free' : mode}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              flexShrink: 0,
              padding: 'var(--space-1) var(--space-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--error)',
            }}
          >
            {error}
          </div>
        )}

        {/* Footer buttons */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              padding: 'var(--space-1) var(--space-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={isProcessing}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-default)',
              borderRadius: 0,
              padding: 'var(--space-1) var(--space-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            SKIP
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isProcessing}
            style={{
              background: 'transparent',
              border: '1px solid var(--accent)',
              borderRadius: 0,
              padding: 'var(--space-1) var(--space-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: isProcessing ? 'var(--text-muted)' : 'var(--accent)',
              cursor: isProcessing ? 'default' : 'pointer',
            }}
          >
            {isProcessing ? 'CROPPING...' : 'APPLY'}
          </button>
        </div>
      </div>
    </div>
  );
}
