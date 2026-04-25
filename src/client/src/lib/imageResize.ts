/**
 * Client-side image resize utility.
 * Spec: 35-uploads.md §35.11
 *
 * Resizes JPEG/PNG/WebP images >1 MB to ≤1 MB using Canvas API.
 * GIFs are returned unchanged (animation preservation).
 * Images ≤1 MB are returned unchanged.
 */

const MAX_SIZE_BYTES = 1024 * 1024; // 1 MB
const MAX_DIMENSION = 2048;
const IOS_CANVAS_PIXEL_LIMIT = 16_777_216; // ~16 MP (iOS Safari limit)
const INITIAL_QUALITY = 0.92;
const QUALITY_STEP = 0.05;
const MIN_QUALITY = 0.5;

/**
 * Calculate target dimensions, respecting max dimension and iOS canvas limits.
 */
function calculateDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  let w = width;
  let h = height;

  // Step 1: reduce to max dimension
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  // Step 2: iOS canvas pixel limit
  while (w * h > IOS_CANVAS_PIXEL_LIMIT) {
    const scale = Math.sqrt(IOS_CANVAS_PIXEL_LIMIT / (w * h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  return { width: w, height: h };
}

/**
 * Load an image from a File into an HTMLImageElement.
 */
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
      reject(new Error('Could not process image'));
    };
    img.src = url;
  });
}

/**
 * Export a canvas to a Blob with a given MIME type and quality.
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      mimeType,
      quality
    );
  });
}

/**
 * Resize an image file to ≤1 MB.
 *
 * Returns the original file unchanged if:
 * - File is ≤1 MB
 * - File is a GIF
 * - File is not an image
 *
 * Throws on unrecoverable error (corrupt image).
 */
export async function resizeImage(file: File): Promise<File> {
  // Skip non-images and GIFs
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }

  // Skip small images
  if (file.size <= MAX_SIZE_BYTES) {
    return file;
  }

  // Load image
  const img = await loadImage(file);
  const { width, height } = calculateDimensions(img.naturalWidth, img.naturalHeight);

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Canvas OOM or unsupported — return original
    console.warn('[resize] Canvas context creation failed, uploading original');
    return file;
  }

  ctx.drawImage(img, 0, 0, width, height);

  // Determine output format and try quality loop
  let outputType = file.type;
  let quality = INITIAL_QUALITY;

  // PNG: try PNG first, fallback to JPEG if still >1 MB
  if (file.type === 'image/png') {
    const pngBlob = await canvasToBlob(canvas, 'image/png');
    if (pngBlob && pngBlob.size <= MAX_SIZE_BYTES) {
      return new File([pngBlob], file.name, { type: 'image/png' });
    }
    // PNG too large — fall back to JPEG
    outputType = 'image/jpeg';
    quality = 0.85;
  }

  // Quality reduction loop (JPEG / WebP)
  while (quality >= MIN_QUALITY) {
    const blob = await canvasToBlob(canvas, outputType, quality);
    if (!blob) {
      // toBlob returned null — try JPEG as fallback
      if (outputType !== 'image/jpeg') {
        outputType = 'image/jpeg';
        quality = INITIAL_QUALITY;
        continue;
      }
      // Even JPEG failed — return original
      console.warn('[resize] toBlob failed, uploading original');
      return file;
    }

    if (blob.size <= MAX_SIZE_BYTES) {
      // Adjust filename extension if format changed
      const name = outputType !== file.type
        ? file.name.replace(/\.[^.]+$/, '.jpg')
        : file.name;
      return new File([blob], name, { type: outputType });
    }

    quality -= QUALITY_STEP;
  }

  // Even at minimum quality, still >1 MB — accept it
  const finalBlob = await canvasToBlob(canvas, outputType, MIN_QUALITY);
  if (finalBlob) {
    const name = outputType !== file.type
      ? file.name.replace(/\.[^.]+$/, '.jpg')
      : file.name;
    return new File([finalBlob], name, { type: outputType });
  }

  // Last resort — return original
  return file;
}
