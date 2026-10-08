// views/pageEditor.js – single full-screen page editor with two
// equally important modes:
//
//   Frame ("Rahmen"): corner editor over the original photo –
//   auto-detect, reset, drag corners (with loupe). Corners are
//   committed when leaving the mode or via "Done".
//   Look ("Optik"): filter chips, brightness / contrast / sharpen
//   sliders and rotation over the live processed preview.
//
// Opening rules:
//   * the editor ALWAYS opens in Frame mode first – the same screen
//     as after an import (the user confirms/adjusts the frame, then
//     switches to Look via the tabs);
//   * the filmstrip of small page previews (bottom rail on mobile,
//     left rail on desktop) jumps straight to any page while
//     keeping the mode.
//
// All edits stay non-destructive (original -> warp -> rotate ->
// filter, caches in state.js).

import * as state from '../state.js';
import * as storage from '../storage.js';
import { CornerEditor, isConvexQuad } from '../cornerEditor.js';
import { detectPageCorners, renderPreview } from '../pipeline.js';
import { mountIcons } from '../icons.js';
import { t } from '../i18n.js';
import { renderPageList, setSidebarCurrent } from './sidebar.js';

const FILTERS = [
  { id: 'original', key: 'filterPhoto' },
  { id: 'document', key: 'filterDocument' },
];

// Preview resolution: render at the size the canvas is actually
// displayed at (device pixels) so filter effects read clearly.
const PREVIEW_MIN_EDGE = 800;
const PREVIEW_MAX_EDGE = 2400;

let ctx = null;
let editor = null;
let currentPage = null;
let currentMode = 'frame';

// Frame editor state: bitmap of the ORIGINAL photo loaded into the
// corner editor, and the page it belongs to.
let bitmap = null;
let bitmapPageId = null;

// Set by the first corner drag after a failed auto-detection: the
// user took manual control, so the hint banner and the dashed
// "guess" outline stand down (until the page is left / re-entered).
let frameHintDismissed = false;

// Preview rendering is serialized: rapid slider moves
// queue up instead of piling up concurrent CV jobs.
let rendering = false;
let renderQueued = false;

// Debounced persistence so a reload does not lose edits.
let persistTimer = null;

// ---------- look mode: preview ----------

function previewMaxEdge() {
  const wrap = document.getElementById('edit-preview-wrap');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const availW = Math.max(1, wrap.clientWidth);
  const availH = Math.max(1, wrap.clientHeight);
  // Zoomed-in previews are rendered sharper (the CSS zoom only scales).
  const edge = Math.ceil(Math.max(availW, availH) * dpr * zoom);
  return Math.max(PREVIEW_MIN_EDGE, Math.min(edge, PREVIEW_MAX_EDGE));
}

// ---------- look mode: zoom ----------
// Phones: pinch to zoom, one finger pans when zoomed. Desktop: the
// zoom buttons in the lower-right corner of the preview. The canvas
// is scaled with a CSS transform; after the gesture settles the
// preview is re-rendered at the higher resolution.

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
let zoom = 1;
let panX = 0;
let panY = 0;
let zoomRenderTimer = null;
// Active pointers on the preview (pointerId -> {x, y}) and the
// gesture baseline (pinch or pan) they started from.
const touchPointers = new Map();
let gesture = null;

function previewWrap() {
  return document.getElementById('edit-preview-wrap');
}

function clampPan() {
  const w = previewWrap();
  const maxX = (w.clientWidth * (zoom - 1)) / 2;
  const maxY = (w.clientHeight * (zoom - 1)) / 2;
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
}

function applyZoom() {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  if (zoom === ZOOM_MIN) {
    panX = 0;
    panY = 0;
  }
  clampPan();
  document.getElementById('edit-preview').style.transform =
    zoom === ZOOM_MIN ? '' : `translate(${panX}px, ${panY}px) scale(${zoom})`;
  document.getElementById('btn-zoom-in').disabled = zoom >= ZOOM_MAX;
  document.getElementById('btn-zoom-out').disabled = zoom <= ZOOM_MIN;
}

function scheduleZoomRender() {
  clearTimeout(zoomRenderTimer);
  zoomRenderTimer = setTimeout(() => requestPreview(), 200);
}

function setZoom(next) {
  const before = zoom;
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
  applyZoom();
  if (zoom !== before) scheduleZoomRender();
}

function resetZoom() {
  zoom = ZOOM_MIN;
  panX = 0;
  panY = 0;
  clearTimeout(zoomRenderTimer);
  applyZoom();
}

function pointerInWrap(e) {
  const r = previewWrap().getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function startGesture() {
  const pts = [...touchPointers.values()];
  if (pts.length >= 2) {
    const [a, b] = pts;
    gesture = {
      type: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom,
      panX,
      panY,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  } else if (pts.length === 1) {
    gesture = { type: 'pan', start: pts[0], panX, panY };
  } else {
    gesture = null;
  }
}

function initZoom() {
  const wrap = previewWrap();
  wrap.addEventListener('pointerdown', (e) => {
    touchPointers.set(e.pointerId, pointerInWrap(e));
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    startGesture();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!touchPointers.has(e.pointerId) || !gesture) return;
    touchPointers.set(e.pointerId, pointerInWrap(e));
    if (gesture.type === 'pinch' && touchPointers.size >= 2) {
      const [a, b] = [...touchPointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoom = gesture.zoom * (dist / gesture.dist);
      panX = gesture.panX + ((a.x + b.x) / 2 - gesture.mid.x);
      panY = gesture.panY + ((a.y + b.y) / 2 - gesture.mid.y);
      applyZoom();
    } else if (gesture.type === 'pan' && zoom > ZOOM_MIN) {
      const pos = touchPointers.get(e.pointerId);
      panX = gesture.panX + (pos.x - gesture.start.x);
      panY = gesture.panY + (pos.y - gesture.start.y);
      applyZoom();
    }
  });
  const end = (e) => {
    if (!touchPointers.has(e.pointerId)) return;
    touchPointers.delete(e.pointerId);
    startGesture();
    scheduleZoomRender();
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);

  document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(zoom * ZOOM_STEP));
  document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(zoom / ZOOM_STEP));
  document.getElementById('btn-zoom-in').setAttribute('aria-label', ctx.t('zoomIn'));
  document.getElementById('btn-zoom-out').setAttribute('aria-label', ctx.t('zoomOut'));
  document.getElementById('btn-zoom-in').title = ctx.t('zoomIn');
  document.getElementById('btn-zoom-out').title = ctx.t('zoomOut');
  applyZoom();
}

async function requestPreview() {
  if (rendering) {
    renderQueued = true;
    return;
  }
  rendering = true;
  const spinner = document.getElementById('edit-spinner');
  spinner.classList.remove('hidden');
  try {
    do {
      renderQueued = false;
      if (!currentPage) return;
      await renderPreview(currentPage, document.getElementById('edit-preview'), previewMaxEdge());
    } while (renderQueued);
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t('errGeneric'));
  } finally {
    rendering = false;
    spinner.classList.add('hidden');
  }
}

function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistNow(), 400);
}

function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  if (!currentPage) return Promise.resolve();
  return storage.savePage(currentPage).catch((err) =>
    console.warn('persist failed', err)
  );
}

function buildFilterChips() {
  const row = document.getElementById('filter-chips');
  row.textContent = '';
  for (const f of FILTERS) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = t(f.key);
    chip.dataset.filter = f.id;
    chip.setAttribute('aria-pressed', String(currentPage.filter === f.id));
    chip.addEventListener('click', () => {
      state.updatePage(currentPage.id, { filter: f.id });
      row.querySelectorAll('.chip').forEach((c) => {
        c.setAttribute('aria-pressed', String(c.dataset.filter === f.id));
      });
      requestPreview();
      persistSoon();
    });
    row.appendChild(chip);
  }
}

function syncSliders() {
  const p = currentPage.params;
  document.getElementById('slider-brightness').value = p.brightness;
  document.getElementById('slider-contrast').value = p.contrast;
  document.getElementById('slider-sharpen').value = p.sharpen;
  document.getElementById('val-brightness').textContent = String(p.brightness);
  document.getElementById('val-contrast').textContent = String(p.contrast);
  document.getElementById('val-sharpen').textContent = String(p.sharpen);
}

function wireSlider(id, valId, key) {
  const slider = document.getElementById(id);
  const val = document.getElementById(valId);
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    val.textContent = String(v);
    currentPage.params[key] = v;
    state.updatePage(currentPage.id, { params: { ...currentPage.params } });
    requestPreview();
    persistSoon();
  });
}

// ---------- frame mode ----------

function fullImageCorners() {
  return [
    { x: 0, y: 0 },
    { x: currentPage.width, y: 0 },
    { x: currentPage.width, y: currentPage.height },
    { x: 0, y: currentPage.height },
  ];
}

async function ensureFrameEditor() {
  if (bitmapPageId === currentPage.id && editor.image) {
    editor.setRotation(currentPage.rotation);
    return;
  }
  if (bitmap) bitmap.close();
  bitmap = await createImageBitmap(currentPage.blob);
  await editor.setImage(bitmap, currentPage.rotation);
  editor.setCorners(currentPage.corners);
  bitmapPageId = currentPage.id;
}

// Re-run auto-detection ("Detect again"). Detection is deterministic
// on the original photo – the button can only ever reproduce the
// import result, which is why it is hidden for pages whose detection
// failed (see syncFrameHint). It remains useful as "restore the
// auto-detected frame" after manual fiddling.
async function runDetection() {
  if (!currentPage) return;
  ctx.showBusy(ctx.t('busyDetect'));
  try {
    const { corners, detected, fullFrame } = await detectPageCorners(currentPage);
    editor.setCorners(corners);
    // Persist the honest flags; corners stay editor-local until the
    // frame is committed.
    if (
      detected !== currentPage.detected ||
      fullFrame !== currentPage.fullFrame
    ) {
      state.updatePage(currentPage.id, { detected, fullFrame });
      persistNow();
    }
    frameHintDismissed = false;
    syncFrameHint();
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t('errGeneric'));
  } finally {
    ctx.hideBusy();
  }
}

// Needs-check state: either the auto-detection failed outright
// (page.detected === false) or it returned the whole photo as the
// document (page.fullFrame === true) – both carry no exact page
// edges. The editor communicates it with a persistent hint INSTEAD
// of a transient toast, a dashed "guess" outline, and the "Detect
// again" button greyed out as "No edges detected": its result could
// not differ from what is already on screen (detection is
// deterministic on the original photo).
function syncFrameHint() {
  const failed = Boolean(currentPage)
    && (currentPage.detected === false || currentPage.fullFrame === true);
  const btn = document.getElementById('btn-redetect');
  btn.disabled = failed;
  const label = btn.querySelector('span[data-i18n]');
  if (label) {
    label.setAttribute('data-i18n', failed ? 'redetectDisabled' : 'redetect');
    label.textContent = ctx.t(failed ? 'redetectDisabled' : 'redetect');
  }
  btn.title = ctx.t(failed ? 'redetectDisabled' : 'redetect');
  if (editor.image) editor.setGuess(failed && !frameHintDismissed);
}

// Commit the frame being edited (only when leaving Frame mode or
// finishing). Returns false – and blocks the transition – if the
// current quadrilateral is unusable.
function commitFrame() {
  if (!currentPage || currentMode !== 'frame' || !editor.image) return true;
  const corners = editor.getCorners();
  if (!isConvexQuad(corners)) {
    ctx.toast(ctx.t('invalidFrame'));
    return false;
  }
  if (JSON.stringify(corners) !== JSON.stringify(currentPage.corners)) {
    // Committing a changed frame is the manual confirmation a failed
    // auto-detection cannot provide: clear the "check frame" state.
    state.updatePage(currentPage.id, { corners, detected: true, fullFrame: false });
    persistNow();
    // The page's pipeline inputs changed, so its filmstrip preview
    // is outdated – rebuild it (the cache generates a fresh one).
    refreshFilmstrip();
  }
  return true;
}

// ---------- mode + navigation ----------

function syncModeButtons() {
  const frame = document.getElementById('mode-frame');
  const look = document.getElementById('mode-look');
  frame.setAttribute('aria-selected', String(currentMode === 'frame'));
  look.setAttribute('aria-selected', String(currentMode === 'look'));
  document.getElementById('frame-pane').classList.toggle('hidden', currentMode !== 'frame');
  document.getElementById('look-pane').classList.toggle('hidden', currentMode !== 'look');
  // Frame mode fits the viewport (the stage flexes into it); look
  // mode flows normally so nothing is cut off at the bottom.
  document
    .getElementById('view-editor')
    .classList.toggle('in-frame', currentMode === 'frame');
}

// Mobile filmstrip + desktop sidebar highlight. With fewer than two
// pages the mobile strip hides itself.
function refreshFilmstrip() {
  const strip = document.getElementById('page-filmstrip');
  strip.classList.toggle('hidden', !currentPage || state.getPages().length < 2);
  setSidebarCurrent(currentPage ? currentPage.id : null);
  renderPageList(strip, { currentId: currentPage ? currentPage.id : null, onSelect: gotoPage });
}

// Jump to a page from the filmstrip or sidebar. The working mode is
// kept so several shots can be fixed in a row.
export async function gotoPage(pageId) {
  if (!currentPage || pageId === currentPage.id) return;
  if (!commitFrame()) return;
  await persistNow();
  const target = state.getPage(pageId);
  if (!target) {
    refreshFilmstrip();
    return;
  }
  currentPage = target;
  if (bitmap) bitmap.close();
  bitmap = null;
  bitmapPageId = null;
  frameHintDismissed = false;
  resetZoom();
  refreshFilmstrip();
  syncModeButtons();
  await enterPane();
}

async function enterPane() {
  try {
    if (currentMode === 'frame') {
      await ensureFrameEditor();
      // Detection runs exactly once per page, at import; on entering
      // the frame pane it is only DISPLAYED. Re-running it cannot
      // produce a different result (deterministic on the original
      // photo). A failed detection is communicated by the hint.
      syncFrameHint();
    } else {
      buildFilterChips();
      syncSliders();
      await requestPreview();
    }
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t('errDecode'));
    ctx.navigate('home');
  }
}

// Enter or switch modes. Blocked with a toast if the frame is
// currently invalid.
async function setMode(next) {
  if (!currentPage || next === currentMode) return;
  if (next === 'look' && !commitFrame()) return;
  currentMode = next;
  syncModeButtons();
  await enterPane();
}

// Static tooltips (also re-applied on language switch, because the
// router re-enters show() with the same params).
function applyStaticTexts() {
  for (const [id, key] of [
    ['btn-editor-back', 'back'],
    ['btn-reset-crop', 'resetCrop'],
    ['mode-frame', 'modeFrame'],
    ['mode-look', 'modeLook'],
  ]) {
    const el = document.getElementById(id);
    el.title = ctx.t(key);
    el.setAttribute('aria-label', ctx.t(key));
  }
  document
    .getElementById('page-filmstrip')
    .setAttribute('aria-label', ctx.t('filmstripLabel'));
}

function goBack() {
  if (!currentPage) return;
  // Frame drags are only in the editor until committed; the page
  // model keeps the last committed frame. Everything else was
  // applied + saved on the fly.
  persistNow();
  ctx.navigate('home');
}

async function done() {
  if (!currentPage) return;
  if (!commitFrame()) return;
  await persistNow();
  ctx.navigate('home');
}

export function init(context) {
  ctx = context;
  mountIcons(document.getElementById('view-editor'));

  editor = new CornerEditor(document.getElementById('crop-canvas'), {
    onChange: () => {
      // The first corner drag after a failed auto-detection is the
      // manual confirmation the detection could not deliver: dashed
      // outline and hint banner end for this visit.
      if (frameHintDismissed) return;
      frameHintDismissed = true;
      editor.setGuess(false);
      syncFrameHint();
    },
  });

  document.getElementById('btn-editor-back').addEventListener('click', goBack);
  document.getElementById('btn-editor-done').addEventListener('click', done);
  document.getElementById('mode-frame').addEventListener('click', () => setMode('frame'));
  document.getElementById('mode-look').addEventListener('click', () => setMode('look'));
  document.getElementById('btn-redetect').addEventListener('click', runDetection);
  document.getElementById('btn-reset-crop').addEventListener('click', () => {
    if (!currentPage) return;
    editor.setCorners(fullImageCorners());
  });

  document.getElementById('btn-rotate-left').addEventListener('click', () => {
    if (!currentPage) return;
    state.updatePage(currentPage.id, {
      rotation: (currentPage.rotation + 270) % 360,
    });
    editor.setRotation(currentPage.rotation);
    requestPreview();
    persistSoon();
    // The thumb's proportions are orientation-bound: rebuilding the
    // strip (cheap, thumbnails are keyed) turns the rotated preview
    // upright immediately.
    refreshFilmstrip();
  });
  document.getElementById('btn-rotate-right').addEventListener('click', () => {
    if (!currentPage) return;
    state.updatePage(currentPage.id, {
      rotation: (currentPage.rotation + 90) % 360,
    });
    editor.setRotation(currentPage.rotation);
    requestPreview();
    persistSoon();
    refreshFilmstrip();
  });

  initZoom();

  wireSlider('slider-brightness', 'val-brightness', 'brightness');
  wireSlider('slider-contrast', 'val-contrast', 'contrast');
  wireSlider('slider-sharpen', 'val-sharpen', 'sharpen');

  // Re-render the preview when the display box or zoom changes.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!currentPage || currentMode !== 'look') return;
    applyZoom();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => requestPreview(), 150);
  });
}

export async function show({ pageId, mode: requestedMode } = {}) {
  const page = state.getPage(pageId);
  if (!page) {
    ctx.navigate('home');
    return;
  }
  currentPage = page;
  // Always the same entry screen as after an import: Frame first
  // (an explicit mode param still wins, e.g. the import flow).
  currentMode = requestedMode === 'look' ? 'look' : 'frame';
  frameHintDismissed = false;
  resetZoom();
  applyStaticTexts();
  refreshFilmstrip();
  syncModeButtons();
  await enterPane();
}
