// pipeline.js – the non-destructive image pipeline.
//
//   original -> warp(corners) -> rotate -> filter(params) -> [ocr] -> pdf
//
// The original blob is never modified. The warped result is cached
// (fast filter switching) and the filtered result is cached (fast
// preview redraws). Both caches are invalidated automatically when
// their inputs change (see state.js).

import * as state from './state.js';
import * as cv from './cvClient.js';

// Decode a Blob into ImageData. Temporary canvas is released after.
async function blobToImageData(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close();
  canvas.width = 0;
  canvas.height = 0;
  return imageData;
}

// Downscale ImageData by a factor (nearest via canvas drawImage).
function downscaleImageData(imageData, scale) {
  const w = Math.max(1, Math.round(imageData.width * scale));
  const h = Math.max(1, Math.round(imageData.height * scale));
  const src = document.createElement('canvas');
  src.width = imageData.width;
  src.height = imageData.height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  dst.getContext('2d').drawImage(src, 0, 0, w, h);
  const result = dst.getContext('2d').getImageData(0, 0, w, h);
  src.width = 0; src.height = 0;
  dst.width = 0; dst.height = 0;
  return result;
}

// ---------- Detection ----------

// Run document detection on a page. Detection runs on a downscaled
// copy (long edge ~1000 px) and the found corners are scaled back
// up to working-image coordinates.
// Returns { corners, detected } – detected is false when nothing
// was found and the full image was returned as a guess.
export async function detectPageCorners(page) {
  const imageData = await blobToImageData(page.blob);
  const longEdge = Math.max(imageData.width, imageData.height);
  const scale = Math.min(1, 1000 / longEdge);
  const detectData = scale < 1 ? downscaleImageData(imageData, scale) : imageData;
  const { corners, detected } = await cv.detectDocument(detectData);
  return {
    corners: corners.map((p) => ({ x: p.x / scale, y: p.y / scale })),
    detected,
  };
}

// Get the warped image for a page as { blob, width, height } (cached).
export async function getWarped(page) {
  const cached = state.getWarpedCache(page);
  if (cached) return cached;
  const imageData = await blobToImageData(page.blob);
  const result = await cv.warpPerspective(imageData, page.corners);
  const blob = await cv.imageDataToBlob(result);
  state.setWarpedCache(page, blob, result.width, result.height);
  return state.getWarpedCache(page);
}

// Get the fully processed image (warp -> rotate -> filter) as
// { blob, width, height } (cached).
export async function getProcessed(page) {
  const cached = state.getFilteredCache(page);
  if (cached) return cached;
  const warped = await getWarped(page);
  let result = await blobToImageData(warped.blob);
  if (page.rotation) {
    result = await cv.rotate(result, page.rotation);
  }
  result = await cv.applyFilter(result, page.filter, page.params);
  const blob = await cv.imageDataToBlob(result);
  state.setFilteredCache(page, blob, result.width, result.height);
  return state.getFilteredCache(page);
}

// Render the processed image into a canvas (for previews / OCR /
// PDF export). Caller should release the canvas when done.
export async function renderProcessed(page, canvas) {
  const processed = await getProcessed(page);
  const bitmap = await createImageBitmap(processed.blob);
  canvas.width = processed.width;
  canvas.height = processed.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

// Fast preview: the same pipeline (warp -> rotate -> filter)
// but on a downscaled copy (long edge ~maxEdge px) so filter
// switching feels instant. The full-resolution result is
// computed by getProcessed() at export time.
export async function renderPreview(page, canvas, maxEdge = 800) {
  const origData = await blobToImageData(page.blob);
  const longEdge = Math.max(origData.width, origData.height);
  const scale = Math.min(1, maxEdge / longEdge);
  let data = scale < 1 ? downscaleImageData(origData, scale) : origData;
  const corners = page.corners.map((c) => ({ x: c.x * scale, y: c.y * scale }));
  let result = await cv.warpPerspective(data, corners);
  if (page.rotation) {
    result = await cv.rotate(result, page.rotation);
  }
  result = await cv.applyFilter(result, page.filter, page.params);
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(result.data, result.width, result.height), 0, 0);
  return canvas;
}

// Small JPEG thumbnail blob for the page list.
export async function getThumbnail(page, maxEdge = 600) {
  const canvas = document.createElement('canvas');
  await renderPreview(page, canvas, maxEdge);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('thumbnail failed'))),
      'image/jpeg',
      0.85
    );
  });
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

// Image used for OCR: the processed image, except for the
// 'original' (Photo) filter, where a cleaned document copy
// (background flattened, text darkened) gives much better OCR
// accuracy while the photo version is still what gets embedded
// in the PDF.
export async function getOcrImage(page) {
  if (page.filter !== 'original') return getProcessed(page);
  const warped = await getWarped(page);
  let result = await blobToImageData(warped.blob);
  if (page.rotation) {
    result = await cv.rotate(result, page.rotation);
  }
  result = await cv.applyFilter(result, 'document', { brightness: 0, contrast: 0, sharpen: 0 });
  const blob = await cv.imageDataToBlob(result);
  return { blob, width: result.width, height: result.height };
}
