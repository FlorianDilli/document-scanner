// state.js – single source of truth: the page list model + a tiny pub/sub store.
// No global mutable state lives anywhere else.
//
// Page model (one object per scanned page):
//   id        uuid
//   blob      original photo (EXIF-corrected Blob) – the only thing persisted
//   width, height   dimensions of the working image (long edge <= 4000 px)
//   corners   [{x,y} TL, TR, BR, BL] in ORIGINAL working-image pixel coords
//   rotation  0 | 90 | 180 | 270 (applied after warp)
//   filter    'original' | 'document'
//   params    { brightness, contrast, sharpen }  (-100..100, 0..100)
//   ocr       cached { words: [...], lang } or null (invalidated on change)
//   detected  true after a successful auto-detection; false when the
//             frame is the full-image fallback ("check frame" badge on
//             the card, hint in the editor – cleared when a changed
//             frame is committed); undefined on legacy pages
//
// Runtime-only caches (never persisted, prefixed with _):
//   _warped    { blob, width, height, key }   key = JSON of corners
//   _filtered  { blob, width, height, key }   key = filter+params+rotation+warpKey

const listeners = new Set();
let pages = [];

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(pages);
}

export function getPages() {
  return pages;
}

export function getPage(id) {
  return pages.find((p) => p.id === id);
}

export function addPage(page) {
  pages.push(page);
  notify();
  return page;
}

export function updatePage(id, patch) {
  const page = getPage(id);
  if (!page) return;
  Object.assign(page, patch);
  // Any change to the image pipeline invalidates the OCR cache.
  if ('corners' in patch || 'rotation' in patch || 'filter' in patch || 'params' in patch) {
    page.ocr = null;
    page._filtered = null;
  }
  if ('corners' in patch) page._warped = null;
  notify();
}

export function removePage(id) {
  const idx = pages.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const [removed] = pages.splice(idx, 1);
  notify();
  return removed;
}

export function movePage(id, toIndex) {
  const idx = pages.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const [page] = pages.splice(idx, 1);
  toIndex = Math.max(0, Math.min(pages.length, toIndex));
  pages.splice(toIndex, 0, page);
  notify();
}

// Re-insert a previously removed page (undo delete).
export function insertPage(page, index) {
  pages.splice(Math.max(0, Math.min(pages.length, index)), 0, page);
  notify();
}

export function replaceAll(newPages) {
  pages = newPages;
  notify();
}

export function newId() {
  // uuid v4 without dependencies
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ---------- In-memory pipeline caches ----------
// The pipeline is always: original -> warp(corners) -> rotate -> filter(params).
// We cache the warped result (fast filter switching) and the filtered result
// (fast preview redraws). Both are dropped when their inputs change.

export function getWarpedCache(page) {
  const key = JSON.stringify([page.corners]);
  if (page._warped && page._warped.key === key) return page._warped;
  return null;
}

export function setWarpedCache(page, blob, width, height) {
  const key = JSON.stringify([page.corners]);
  page._warped = { blob, width, height, key };
}

export function getFilteredCache(page) {
  const warp = page._warped;
  const key = JSON.stringify([warp ? warp.key : null, page.rotation, page.filter, page.params]);
  if (page._filtered && page._filtered.key === key) return page._filtered;
  return null;
}

export function setFilteredCache(page, blob, width, height) {
  const warp = page._warped;
  const key = JSON.stringify([warp ? warp.key : null, page.rotation, page.filter, page.params]);
  page._filtered = { blob, width, height, key };
}
