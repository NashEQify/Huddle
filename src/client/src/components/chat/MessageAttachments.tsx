import type { AttachmentResponse } from '@huddle/shared';

interface MessageAttachmentsProps {
  attachments: AttachmentResponse[];
  onImageClick?: (url: string, filename: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith('image/');
}

export function MessageAttachments({ attachments, onImageClick }: MessageAttachmentsProps) {
  const images = attachments.filter((a) => isImageType(a.contentType));
  const files = attachments.filter((a) => !isImageType(a.contentType));

  return (
    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {/* Inline image previews */}
      {images.map((img) => (
        <div key={img.id}>
          <img
            src={img.url}
            alt={img.filename}
            loading="lazy"
            onClick={() => onImageClick?.(img.url, img.filename)}
            style={{
              maxWidth: '400px',
              maxHeight: '300px',
              objectFit: 'contain',
              borderRadius: 0,
              cursor: 'pointer',
              display: 'block',
              border: '1px solid var(--border-default)',
            }}
          />
        </div>
      ))}

      {/* Non-image file download rows */}
      {files.map((file) => (
        <a
          key={file.id}
          href={file.url}
          download={file.filename}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            border: '1px solid var(--border-default)',
            borderRadius: 0,
            background: 'var(--bg-surface)',
            textDecoration: 'none',
            maxWidth: '400px',
            transition: 'border-color 150ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-dim)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-default)';
          }}
        >
          {/* File icon */}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-lg)',
              color: 'var(--text-secondary)',
              flexShrink: 0,
            }}
          >
            []
          </span>
          {/* Filename + size */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {file.filename}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
              }}
            >
              {formatFileSize(file.sizeBytes)}
            </div>
          </div>
          {/* Download arrow */}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--accent)',
              flexShrink: 0,
            }}
          >
            DL
          </span>
        </a>
      ))}
    </div>
  );
}
