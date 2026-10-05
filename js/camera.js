// camera.js – image import: native camera input, gallery multi-select,
// EXIF-correct decoding and safe downscaling.
//
// Phone photos are 12–50 MP and often stored rotated (EXIF). We:
//   1. decode with createImageBitmap(file, { imageOrientation: 'from-image' })
//      so the bitmap is upright;
//   2. fall back to an <img> element (browsers apply EXIF orientation by
//      default when drawing to canvas) if createImageBitmap with the option
//      is unsupported or fails (e.g. HEIC on some browsers);
//   3. downscale so the long edge is at most MAX_EDGE px (iOS Safari limits
//      canvas size to ~16.7 Mpx and total canvas memory).

const MAX_EDGE = 4000;

export function pickFromCamera() {
  return pickFiles({ capture: 'environment', multiple: false });
}

export function pickFromGallery() {
  return pickFiles({ capture: false, multiple: true });
}

function pickFiles({ capture, multiple }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.capture = capture;
    if (multiple) input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files || []);
      resolve(files);
      URL.revokeObjectURL(input.src || '');
    };
    // User pressing back/cancel fires no event; resolve with [] on next tick
    // is not reliable, so callers treat "no files" as cancel.
    input.click();
  });
}

// Decode a File into an upright ImageBitmap, respecting EXIF orientation.
export async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    // Fallback: draw via <img> (modern browsers honor EXIF orientation).
    const bmp = await decodeViaImg(file);
    return bmp;
  }
}

async function decodeViaImg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Downscale an ImageBitmap so its long edge is <= MAX_EDGE.
// Returns { bitmap, width, height }. Releases the input bitmap if scaled.
export async function normalizeImage(bitmap) {
  const { width, height } = bitmap;
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_EDGE) {
    return { bitmap, width, height };
  }
  const scale = MAX_EDGE / longEdge;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const scaled = await createImageBitmap(canvas);
  releaseCanvas(canvas);
  bitmap.close();
  return { bitmap: scaled, width: w, height: h };
}

export function releaseCanvas(canvas) {
  // Free canvas memory immediately (important on mobile).
  canvas.width = 0;
  canvas.height = 0;
}

export async function bitmapToBlob(bitmap, type = 'image/jpeg', quality = 0.9) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality);
  });
  releaseCanvas(canvas);
  return blob;
}

// Full import pipeline: File -> upright, downscaled JPEG blob + dimensions.
export async function importFile(file) {
  const bitmap = await decodeImage(file);
  try {
    const { bitmap: normalized, width, height } = await normalizeImage(bitmap);
    const blob = await bitmapToBlob(normalized, 'image/jpeg', 0.92);
    normalized.close();
    return { blob, width, height };
  } catch (err) {
    bitmap.close();
    throw err;
  }
}
