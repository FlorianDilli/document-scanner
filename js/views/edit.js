// views/edit.js – edit view: filter chips, brightness /
// contrast / sharpen sliders, rotate buttons, live preview.

import * as state from '../state.js';
import * as storage from '../storage.js';
import { renderPreview } from '../pipeline.js';
import { t } from '../i18n.js';

const FILTERS = [
  { id: 'original', key: 'filterPhoto' },
  { id: 'document', key: 'filterDocument' },
];

let ctx = null;
let currentPage = null;
let canvas = null;

// Preview resolution: render at the size the canvas is actually
// displayed at (device pixels) so filter effects read clearly.
// Display bounds come from CSS (#edit-preview: max-width 100%,
// max-height 55vh). Capped so the CV worker stays responsive.
const PREVIEW_MIN_EDGE = 800;
const PREVIEW_MAX_EDGE = 2400;

function previewMaxEdge() {
  const wrap = document.getElementById('edit-preview-wrap');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const availW = Math.max(1, wrap.clientWidth);
  const availH = Math.max(1, parseFloat(getComputedStyle(canvas).maxHeight) || 0);
  const edge = Math.ceil(Math.max(availW, availH) * dpr);
  return Math.max(PREVIEW_MIN_EDGE, Math.min(edge, PREVIEW_MAX_EDGE));
}

// Preview rendering is serialized: rapid slider moves
// queue up instead of piling up concurrent CV jobs.
let rendering = false;
let renderQueued = false;

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
      await renderPreview(currentPage, canvas, previewMaxEdge());
    } while (renderQueued);
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t('errGeneric'));
  } finally {
    rendering = false;
    spinner.classList.add('hidden');
  }
}

// Debounced persistence so a reload does not lose edits.
let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    if (!currentPage) return;
    try {
      await storage.savePage(currentPage);
    } catch (err) {
      console.warn('persist failed', err);
    }
  }, 400);
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
    // updatePage invalidates caches + OCR; params change
    // only affects the filter stage.
    state.updatePage(currentPage.id, { params: { ...currentPage.params } });
    requestPreview();
    persistSoon();
  });
}

export function init(context) {
  ctx = context;
  canvas = document.getElementById('edit-preview');

  document.getElementById('btn-edit-back').addEventListener('click', () => {
    ctx.navigate('crop', { pageId: currentPage.id });
  });
  document.getElementById('btn-edit-done').addEventListener('click', () => {
    ctx.navigate('home');
  });
  document.getElementById('btn-rotate-left').addEventListener('click', () => {
    if (!currentPage) return;
    state.updatePage(currentPage.id, {
      rotation: (currentPage.rotation + 270) % 360,
    });
    requestPreview();
    persistSoon();
  });
  document.getElementById('btn-rotate-right').addEventListener('click', () => {
    if (!currentPage) return;
    state.updatePage(currentPage.id, {
      rotation: (currentPage.rotation + 90) % 360,
    });
    requestPreview();
    persistSoon();
  });

  wireSlider('slider-brightness', 'val-brightness', 'brightness');
  wireSlider('slider-contrast', 'val-contrast', 'contrast');
  wireSlider('slider-sharpen', 'val-sharpen', 'sharpen');

  // Re-render when the display box or zoom changes
  // (window resize, orientation change, browser zoom).
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => requestPreview(), 150);
  });
}

export async function show({ pageId }) {
  const page = state.getPage(pageId);
  if (!page) {
    ctx.navigate('home');
    return;
  }
  currentPage = page;
  buildFilterChips();
  syncSliders();
  await requestPreview();
}

export function hide() {
  currentPage = null;
}
