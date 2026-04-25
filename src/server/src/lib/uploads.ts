/**
 * File upload utilities — validation, storage, serving.
 *
 * Storage structure: {UPLOADS_DIR}/{year}/{month}/{attachmentId}_{sanitized_filename}
 * Magic byte validation for content type verification.
 */

import { mkdir, writeFile, stat } from 'fs/promises';
import path from 'path';

// ── Constants ────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES_PER_MESSAGE = 5;
const MAX_FILENAME_LENGTH = 200;

const ALLOWED_CONTENT_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  // Documents
  'application/pdf',
  'text/plain',
  // Archives
  'application/zip',
  // Audio
  'audio/mpeg',
  'audio/ogg',
  // Video
  'video/mp4',
  'video/webm',
]);

// ── Magic Bytes ─────────────────────────────────────────

interface MagicSignature {
  offset: number;
  bytes: number[];
  contentType: string;
}

interface MultiPartSignature {
  parts: Array<{ offset: number; bytes: number[] }>;
  contentType: string;
}

const MAGIC_SIGNATURES: MagicSignature[] = [
  // JPEG: FF D8 FF
  { offset: 0, bytes: [0xff, 0xd8, 0xff], contentType: 'image/jpeg' },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], contentType: 'image/png' },
  // GIF: GIF87a or GIF89a
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], contentType: 'image/gif' },
  // PDF: %PDF
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], contentType: 'application/pdf' },
  // ZIP (and derivatives): PK
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04], contentType: 'application/zip' },
  // MP3: ID3 tag or MPEG sync
  { offset: 0, bytes: [0x49, 0x44, 0x33], contentType: 'audio/mpeg' }, // ID3
  { offset: 0, bytes: [0xff, 0xfb], contentType: 'audio/mpeg' }, // MPEG sync
  // OGG: OggS
  { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53], contentType: 'audio/ogg' },
  // MP4: ftyp box
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], contentType: 'video/mp4' },
  // WebM: EBML header (same as Matroska)
  { offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3], contentType: 'video/webm' },
];

// Multi-part signatures: ALL parts must match (e.g. WebP = RIFF + WEBP marker).
const MULTIPART_SIGNATURES: MultiPartSignature[] = [
  // WebP: "RIFF" at offset 0 AND "WEBP" at offset 8.
  // Bytes 4-7 are the file-length field (variable).
  {
    parts: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
    ],
    contentType: 'image/webp',
  },
];

/**
 * Detect content type from magic bytes. Returns null if unknown.
 * Multi-part signatures are checked first so a partial match on a shared
 * prefix (e.g. RIFF container) does not shadow the full-signature check.
 */
function detectContentType(buffer: Buffer): string | null {
  // Multi-part: all parts must match.
  for (const sig of MULTIPART_SIGNATURES) {
    let allMatch = true;
    for (const part of sig.parts) {
      if (buffer.length < part.offset + part.bytes.length) {
        allMatch = false;
        break;
      }
      for (let i = 0; i < part.bytes.length; i++) {
        if (buffer[part.offset + i] !== part.bytes[i]) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) break;
    }
    if (allMatch) return sig.contentType;
  }

  // Single-part signatures.
  for (const sig of MAGIC_SIGNATURES) {
    if (buffer.length < sig.offset + sig.bytes.length) continue;

    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[sig.offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return sig.contentType;
  }
  return null;
}

// ── Validation ──────────────────────────────────────────

export interface UploadValidationError {
  code: 'FILE_TOO_LARGE' | 'INVALID_TYPE' | 'TOO_MANY_FILES' | 'MAGIC_MISMATCH';
  message: string;
  filename?: string;
}

/**
 * Validate a file before storage.
 */
export function validateFile(
  buffer: Buffer,
  declaredContentType: string,
  filename: string
): UploadValidationError | null {
  // Size check
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `File exceeds 10 MB limit`,
      filename,
    };
  }

  // Content type whitelist
  if (!ALLOWED_CONTENT_TYPES.has(declaredContentType)) {
    return {
      code: 'INVALID_TYPE',
      message: `File type not allowed: ${declaredContentType}`,
      filename,
    };
  }

  // Magic byte validation — text/plain exempt (no reliable magic bytes)
  if (declaredContentType !== 'text/plain') {
    const detected = detectContentType(buffer);
    if (!detected) {
      return {
        code: 'MAGIC_MISMATCH',
        message: `Cannot verify file type for ${filename}`,
        filename,
      };
    }

    // Check the detected type is in the allowed set
    if (!ALLOWED_CONTENT_TYPES.has(detected)) {
      return {
        code: 'MAGIC_MISMATCH',
        message: `File content does not match declared type`,
        filename,
      };
    }

    // Validate that detected content-type matches declared content-type.
    // Strict: each declared MIME must match its own magic signature exactly.
    // No cross-format tolerance (webm EBML and ogg OggS are entirely different
    // containers; accepting them as "compatible" was a validation bypass).
    if (detected !== declaredContentType) {
      return {
        code: 'MAGIC_MISMATCH' as const,
        message: `File content type (${detected}) does not match declared type (${declaredContentType})`,
        filename,
      };
    }
  }

  return null;
}

/**
 * Validate file count.
 */
export function validateFileCount(count: number): UploadValidationError | null {
  if (count > MAX_FILES_PER_MESSAGE) {
    return {
      code: 'TOO_MANY_FILES',
      message: `Maximum ${MAX_FILES_PER_MESSAGE} files per message`,
    };
  }
  return null;
}

// ── Filename Sanitization ───────────────────────────────

/**
 * Sanitize a filename: remove path separators, control characters, truncate.
 */
export function sanitizeFilename(filename: string): string {
  // Remove path separators and control characters
  let clean = filename
    .replace(/[/\\]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\.\./g, '_')
    .trim();

  // Fallback for empty names
  if (!clean) clean = 'file';

  // Truncate to max length, preserving extension
  if (clean.length > MAX_FILENAME_LENGTH) {
    const ext = path.extname(clean);
    const base = clean.slice(0, MAX_FILENAME_LENGTH - ext.length);
    clean = base + ext;
  }

  return clean;
}

// ── Storage ─────────────────────────────────────────────

/**
 * Get the uploads base directory from environment.
 */
function getUploadsDir(): string {
  return process.env['UPLOAD_DIR'] || process.env['UPLOADS_DIR'] || path.join(process.cwd(), 'uploads');
}

/**
 * Store a file on disk and return the relative storage path.
 */
export async function storeFile(
  attachmentId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');

  const sanitized = sanitizeFilename(filename);
  const storageFilename = `${attachmentId}_${sanitized}`;
  const relativePath = path.join(year, month, storageFilename);
  const absolutePath = path.join(getUploadsDir(), relativePath);

  // Ensure directory exists
  await mkdir(path.dirname(absolutePath), { recursive: true });

  // Write file
  await writeFile(absolutePath, buffer);

  return relativePath;
}

/**
 * Get the absolute path for a stored file.
 * Validates that the resolved path stays within the uploads directory.
 */
export function getAbsolutePath(storagePath: string): string {
  const base = getUploadsDir();
  const resolved = path.resolve(base, storagePath);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

/**
 * Check if a file exists on disk.
 */
export async function fileExists(storagePath: string): Promise<boolean> {
  try {
    await stat(getAbsolutePath(storagePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the URL for an attachment.
 */
export function attachmentUrl(attachmentId: string, filename: string): string {
  return `/api/uploads/${attachmentId}/${encodeURIComponent(filename)}`;
}

export { MAX_FILE_SIZE, MAX_FILES_PER_MESSAGE, ALLOWED_CONTENT_TYPES };
