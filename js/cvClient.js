// cvClient.js – promise-based wrapper around the OpenCV Web Worker.
// All OpenCV work happens off the UI thread; pixel buffers are
// transferred (not copied) in both directions.

let worker = null;
let readyPromise = null;
let nextId = 0;
const pending = new Map();

function createWorker() {
  return new Promise((resolve, reject) => {
    const w = new Worker('./js/cv-worker.js');
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        resolve(w);
        return;
      }
      if (msg.type === 'error' && !msg.id) {
        // init-time error
        reject(new Error(msg.error));
        return;
      }
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        if (msg.type === 'error') entry.reject(new Error(msg.error));
        else entry.resolve(msg);
      }
    };
    w.onerror = (e) => reject(new Error(e.message || 'worker error'));
    w.postMessage({ type: 'init' });
  });
}

export function cvReady() {
  if (!readyPromise) {
    readyPromise = createWorker().then((w) => {
      worker = w;
      return w;
    });
    // Allow retry after a failure.
    readyPromise.catch(() => { readyPromise = null; });
  }
  return readyPromise;
}

function send(msg, transfer) {
  const debug = typeof window !== 'undefined' && window.__debug;
  const t0 = debug ? performance.now() : 0;
  return cvReady().then(
    () =>
      new Promise((resolve, reject) => {
        const id = 'cv-' + nextId++;
        pending.set(id, { resolve, reject });
        msg.id = id;
        if (transfer && transfer.length) {
          worker.postMessage(msg, transfer);
        } else {
          worker.postMessage(msg);
        }
        if (debug) {
          const entry = pending.get(id);
          const origResolve = entry.resolve;
          entry.resolve = (result) => {
            console.log(`[debug] cv ${msg.type}: ${(performance.now() - t0).toFixed(0)} ms`);
            origResolve(result);
          };
        }
      })
  );
}

// Detect the document in an ImageData. Returns
// { corners: [{x,y} TL, TR, BR, BL], detected: boolean }
// in the same pixel coordinates. `detected` is false when
// the fallback inset rectangle was used.
export function detectDocument(imageData) {
  const data = new Uint8ClampedArray(imageData.data);
  return send(
    { type: 'detect', data, width: imageData.width, height: imageData.height },
    [data.buffer]
  ).then((r) => ({ corners: r.corners, detected: r.detected }));
}

// Warp the quadrilateral into an upright rectangle.
// Returns { data, width, height } (new ImageData-compatible).
export function warpPerspective(imageData, corners) {
  const data = new Uint8ClampedArray(imageData.data);
  return send(
    {
      type: 'warp',
      data,
      width: imageData.width,
      height: imageData.height,
      corners,
    },
    [data.buffer]
  ).then((r) => ({ data: r.data, width: r.width, height: r.height }));
}

// Apply a filter + params to an ImageData.
export function applyFilter(imageData, filter, params) {
  const data = new Uint8ClampedArray(imageData.data);
  return send(
    {
      type: 'filter',
      data,
      width: imageData.width,
      height: imageData.height,
      filter,
      params,
    },
    [data.buffer]
  ).then((r) => ({ data: r.data, width: r.width, height: r.height }));
}

// Rotate by 90/180/270 degrees.
export function rotate(imageData, angle) {
  const data = new Uint8ClampedArray(imageData.data);
  return send(
    { type: 'rotate', data, width: imageData.width, height: imageData.height, angle },
    [data.buffer]
  ).then((r) => ({ data: r.data, width: r.width, height: r.height }));
}

// Convert an ImageData result into a Blob (JPEG) via a canvas.
export async function imageDataToBlob(result, quality = 0.92) {
  const canvas = document.createElement('canvas');
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext('2d');
  const img = new ImageData(result.data, result.width, result.height);
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
  });
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}
