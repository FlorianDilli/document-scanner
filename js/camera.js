// camera.js – image import: in-app live camera capture (mobile),
// capture-attribute file input (desktop / fallback), gallery
// multi-select, EXIF-correct decoding and safe downscaling.
//
// Phone photos are 12–50 MP and often stored rotated (EXIF). We:
//   1. decode with createImageBitmap(file, { imageOrientation: 'from-image' })
//      so the bitmap is upright;
//   2. fall back to an <img> element (browsers apply EXIF orientation by
//      default when drawing to canvas) if createImageBitmap with the option
//      is unsupported or fails (e.g. HEIC on some browsers);
//   3. downscale so the long edge is at most MAX_EDGE px (iOS Safari limits
//      canvas size to ~16.7 Mpx and total canvas memory).

import { t } from './i18n.js';
import { mountIcons } from './icons.js';

const MAX_EDGE = 4000;

// The pending file picker, if any: { input, resolve }.
// The input stays in the DOM (off-screen) and strongly referenced
// until the picker settles. A detached input can be garbage-collected
// while the native camera/gallery is open (high memory pressure),
// in which case the change event never fires and the photo is
// silently lost – the classic "photo taken but not imported" bug.
let pendingPick = null;

// The pending in-app camera session, if any: { finish }.
let pendingCapture = null;

export function pickFromCamera() {
  const fallback = () => pickFiles({ capture: 'environment', multiple: false });
  // A capture-attribute file input NEVER opens the camera directly on
  // mobile: systems always present a choice menu first (iOS action
  // sheet with Photo Library / Take Photo / Choose File, choosing
  // intent on Android). getUserMedia streams straight into the page,
  // so on touch-first devices it is the preferred path. Desktop
  // browsers, unsupported browsers and denied permissions keep the
  // capture file input (falls back to plain file choosing).
  if (
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    isTouchFirstDevice()
  ) {
    return openLiveCapture().catch(fallback);
  }
  return fallback();
}

export function pickFromGallery() {
  // Plain image input, no capture: on modern Android Chrome this
  // opens the system photo picker directly (no camera/menu choice),
  // on iOS the system action sheet is unavoidable and offers the
  // photo library as its first option.
  return pickFiles({ capture: false, multiple: true });
}

// Phones/tablets have a coarse primary pointer (touch first);
// touch-laptops keep their fine (mouse) primary pointer and are
// treated as desktops.
function isTouchFirstDevice() {
  return window.matchMedia
    ? window.matchMedia('(pointer: coarse)').matches
    : navigator.maxTouchPoints > 0;
}

// Settle a previous picker/session that never resolved (user
// cancelled on a browser that fires no 'cancel' event) so a new
// import always starts from a clean state.
function settlePending() {
  if (pendingCapture) {
    const prevCapture = pendingCapture;
    pendingCapture = null;
    prevCapture.finish([]);
  }
  if (pendingPick) {
    const prev = pendingPick;
    pendingPick = null;
    prev.input.remove();
    prev.resolve([]);
  }
}

function pickFiles({ capture, multiple }) {
  return new Promise((resolve) => {
    settlePending();

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.capture = capture;
    if (multiple) input.multiple = true;

    const finish = (files) => {
      // Ignore a late event from an already-settled picker.
      if (!pendingPick || pendingPick.input !== input) return;
      pendingPick = null;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => {
      finish(Array.from(input.files || []));
    });
    // User dismissing the picker (where 'cancel' is supported).
    input.addEventListener('cancel', () => finish([]));

    // Keep the input in the document while the picker is open.
    // Off-screen, not display:none – iOS Safari refuses to open
    // the picker for programmatically clicked hidden inputs.
    input.style.position = 'fixed';
    input.style.top = '-10000px';
    document.body.appendChild(input);
    pendingPick = { input, resolve };

    input.click();
  });
}

// In-app camera: full-screen live preview with a shutter button,
// resolved as File[] (same contract as pickFiles). Cancelling
// resolves []; getUserMedia failures reject so the caller can fall
// back to the capture file input.
function openLiveCapture() {
  return new Promise((resolve, reject) => {
    settlePending();

    const overlay = document.getElementById('camera-view');
    const video = document.getElementById('camera-video');
    const btnCancel = document.getElementById('btn-camera-cancel');
    const btnShutter = document.getElementById('btn-camera-shutter');
    if (!overlay || !video || !btnCancel || !btnShutter) {
      reject(new Error('camera overlay missing'));
      return;
    }
    mountIcons(overlay); // idempotent (replaceChildren)

    let session = null;
    let stream = null;
    let settled = false;

    const cleanup = () => {
      if (session && pendingCapture === session) pendingCapture = null;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        stream = null;
      }
      video.srcObject = null;
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKeydown);
      btnCancel.removeEventListener('click', onCancel);
      btnShutter.removeEventListener('click', onShutter);
    };

    const finish = (files) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };

    session = { finish };
    pendingCapture = session;

    btnCancel.setAttribute('aria-label', t('cancel'));
    btnCancel.title = t('cancel');
    btnShutter.setAttribute('aria-label', t('takePhoto'));

    const onCancel = () => finish([]);
    const onShutter = async () => {
      try {
        btnShutter.disabled = true;
        finish([await captureVideoFrame(video)]);
      } catch (err) {
        settled = true;
        cleanup();
        reject(err);
      }
    };
    const onKeydown = (e) => {
      if (e.key === 'Escape') finish([]);
    };

    btnCancel.addEventListener('click', onCancel);
    btnShutter.addEventListener('click', onShutter);
    document.addEventListener('keydown', onKeydown);

    // Called within the originating click, so browsers treat the
    // camera permission prompt as user-initiated (a hard requirement
    // on iOS Safari).
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4096 },
          height: { ideal: 2160 },
        },
      })
      .then((s) => {
        if (settled) {
          for (const track of s.getTracks()) track.stop();
          return;
        }
        stream = s;
        btnShutter.disabled = true;
        video.addEventListener('loadeddata', () => {
          btnShutter.disabled = false;
          btnShutter.focus({ preventScroll: true });
        }, { once: true });
        video.srcObject = s;
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        video.play().catch(() => {});
      })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}

// Current video frame -> canvas -> JPEG File (no EXIF, upright).
async function captureVideoFrame(video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error('camera frame not ready');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  const blob = await new Promise((res, rej) => {
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.92);
  });
  releaseCanvas(canvas);
  return new File([blob], 'camera.jpg', { type: 'image/jpeg' });
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
