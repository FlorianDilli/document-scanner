// views/home.js – home view: page list with thumbnails,
// import (camera / gallery), drag-&-drop reorder, delete with undo.

import * as state from '../state.js';
import * as storage from '../storage.js';
import { importFile } from '../camera.js';
import { detectPageCorners, getThumbnail } from '../pipeline.js';
import { newId } from '../state.js';
import { ic } from '../icons.js';
import { deletePageWithUndo } from '../pageOps.js';
import { getLastMode } from './pageEditor.js';

const FILTER_DEFAULT = 'document'; // recommended default

let ctx = null;
// Persistent thumbnail cache: pageId -> { url, key }.
// key captures the current pipeline inputs (corners, rotation,
// filter, params); unchanged pages reuse their object
// URL across re-renders, while a re-cropped or edited page gets
// a fresh thumbnail of the corrected document.
let thumbnailUrls = new Map();

// Fingerprint of everything that influences the processed image.
function pipelineKey(page) {
  return JSON.stringify([
    page.corners,
    page.rotation,
    page.filter,
    page.params,
  ]);
}

function pageCountText(n) {
  return n === 1 ? ctx.t('pageCountOne') : ctx.t('pageCount', { count: n });
}

// Revoke object URLs of pages that no longer exist.
function pruneThumbnailCache(pages) {
  const ids = new Set(pages.map((p) => p.id));
  for (const [id, entry] of thumbnailUrls) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(entry.url);
      thumbnailUrls.delete(id);
    }
  }
}

function fullImageCorners(width, height) {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

// ---------- drag & drop reorder (pointer events, touch-first) ----------

// Handles live on the cards; a pointer drag inserts the card
// before/after its neighbours, and on release the DOM order is
// written back into the page model once.

const DRAG_THRESHOLD = 6; // px before a touch becomes a drag
const DRAG_SCROLL_AREA = 70; // px band at the viewport edge that auto-scrolls
const DRAG_SCROLL_STEP = 14; // px per pointermove inside the band

let drag = null; // { grid, card, id, fromIndex, startY, startScroll, moved }

// After a keyboard reorder, re-focus that page's grip handle.
let focusPageId = null;

// A drag must not double as an "open editor" tap.
let suppressCardClick = false;

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Insert card before/after ref; displaced siblings animate out of the way.
function insertCard(dragSession, ref, before) {
  const { grid, card } = dragSession;
  if (before ? ref.previousElementSibling === card : ref.nextElementSibling === card) {
    return; // already in position
  }
  const moving = prefersReducedMotion()
    ? []
    : Array.from(grid.children).filter((c) => c !== card && c !== ref);
  const rects = new Map(moving.map((c) => [c, c.getBoundingClientRect()]));
  grid.insertBefore(card, before ? ref : ref.nextSibling);
  for (const c of moving) {
    const prev = rects.get(c);
    const now = c.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (!dx && !dy) continue;
    c.style.transition = 'none';
    c.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      c.style.transition = 'transform 0.12s ease';
      c.style.transform = '';
      c.addEventListener(
        'transitionend',
        () => {
          c.style.transition = '';
        },
        { once: true }
      );
    });
  }
}

// End a drag session. dropped=true writes the DOM order into state.
function endDrag(dropped) {
  if (!drag) return;
  const { grid, card, id, fromIndex, moved } = drag;
  card.classList.remove('drag-lift');
  card.style.transform = '';
  if (dropped && moved) {
    suppressCardClick = true;
    setTimeout(() => {
      suppressCardClick = false;
    }, 400);
    const to = Array.prototype.indexOf.call(grid.children, card);
    if (to !== fromIndex) {
      state.movePage(id, to);
      persistOrder();
    }
  }
  drag = null;
}

function wireDragHandlers(grid, card, handle, pageId) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const main = document.getElementById('app-main');
    drag = {
      grid,
      card,
      id: pageId,
      fromIndex: Array.prototype.indexOf.call(grid.children, card),
      startY: e.clientY,
      startScroll: main ? main.scrollTop : 0,
      moved: false,
    };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (err) {
      /* capture is optional */
    }
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!drag || drag.card !== card) return;
    if (!drag.moved && Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const main = document.getElementById('app-main');
    // Scroll-aware delta: the drag offset follows the finger even
    // while the page auto-scrolls.
    const dy =
      e.clientY - drag.startY + (main ? main.scrollTop - drag.startScroll : 0);
    card.classList.add('drag-lift');
    card.style.transform = `translateY(${dy}px)`;

    // Auto-scroll near the viewport edges.
    const vh = window.innerHeight;
    if (main) {
      if (e.clientY < DRAG_SCROLL_AREA) {
        main.scrollTop = Math.max(0, main.scrollTop - DRAG_SCROLL_STEP);
      } else if (e.clientY > vh - DRAG_SCROLL_AREA) {
        main.scrollTop += DRAG_SCROLL_STEP;
      }
    }

    // Drop slot: the card under the pointer (the dragged card is
    // pointer-events: none while lifted), placed before/after it
    // depending on which half was hit.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const over = el && el.closest ? el.closest('.page-card') : null;
    if (over && over !== card) {
      const r = over.getBoundingClientRect();
      insertCard(drag, over, e.clientY < r.top + r.height / 2);
    }
    e.preventDefault();
  });

  const release = (e) => {
    if (!drag || drag.card !== card) return;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* already released */
    }
    endDrag(true);
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);

  // A tap or the post-drag click must never open the editor.
  handle.addEventListener('click', (e) => e.stopPropagation());

  // Keyboard reorder: focus the handle, arrow keys move the page.
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const pages = state.getPages();
    const idx = pages.findIndex((p) => p.id === pageId);
    const to = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
    if (to < 0 || to >= pages.length) return;
    state.movePage(pageId, to);
    persistOrder();
    focusPageId = pageId;
  });
}

// An animation-free, state-driven render while a drag is active
// would orphan the dragged card – settle the drag first.
function settleDragBeforeRender() {
  if (drag) endDrag(false);
}

// ---------- rendering ----------

function render(pages) {
  // Skip re-rendering while another view is active
  // (state changes from the edit view must not
  // rebuild the hidden grid on every slider move).
  const view = document.getElementById('view-home');
  if (view.classList.contains('hidden')) return;

  const grid = document.getElementById('page-grid');
  const empty = document.getElementById('empty-state');
  const footer = document.getElementById('home-footer');
  const counter = document.getElementById('page-counter');

  settleDragBeforeRender();

  // Drop thumbnails of removed pages; keep the rest.
  pruneThumbnailCache(pages);

  grid.textContent = '';
  empty.classList.toggle('hidden', pages.length > 0);
  footer.classList.toggle('hidden', pages.length === 0);
  counter.textContent = pageCountText(pages.length);

  pages.forEach((page, index) => {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.dataset.id = page.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', ctx.t('openPage', { i: index + 1 }));

    const num = document.createElement('span');
    num.className = 'page-num';
    num.textContent = String(index + 1);
    card.appendChild(num);

    // Frame hint when auto-detection failed for this page.
    if (page.detected === false) {
      card.appendChild(makeFrameBadge());
    }

    const img = document.createElement('img');
    img.alt = '';
    card.appendChild(img);

    // Thumbnail: reuse the cached object URL while the page's
    // pipeline state is unchanged; otherwise regenerate (async)
    // from the corrected document.
    const key = pipelineKey(page);
    const cached = thumbnailUrls.get(page.id);
    if (cached && cached.key === key) {
      img.src = cached.url;
    } else {
      if (cached) {
        URL.revokeObjectURL(cached.url);
        thumbnailUrls.delete(page.id);
      }
      getThumbnail(page)
        .then((blob) => {
          // Discard a stale result if the page changed in the meantime.
          if (pipelineKey(page) !== key) return;
          if (thumbnailUrls.get(page.id)) {
            URL.revokeObjectURL(thumbnailUrls.get(page.id).url);
          }
          const url = URL.createObjectURL(blob);
          thumbnailUrls.set(page.id, { url, key });
          img.src = url;
        })
        .catch((err) => console.warn('thumbnail failed', err));
    }

    // Tap (or Enter) opens the page editor in the last used mode.
    card.addEventListener('click', (e) => {
      if (suppressCardClick) return;
      if (e.target instanceof Element && e.target.closest('button')) return;
      openEditor(page.id);
    });
    card.addEventListener('keydown', (e) => {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEditor(page.id);
      }
    });

    // Tools: reorder (drag handle) and delete.
    const tools = document.createElement('div');
    tools.className = 'page-tools';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'grab-handle';
    const handleLabel = ctx.t('gripMove', { i: index + 1 });
    handle.title = handleLabel;
    handle.setAttribute('aria-label', handleLabel);
    handle.appendChild(ic('grip', 16));
    wireDragHandlers(grid, card, handle, page.id);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-danger';
    delBtn.title = ctx.t('deletePage');
    delBtn.setAttribute('aria-label', ctx.t('deletePage'));
    delBtn.appendChild(ic('trash', 16));
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePageWithUndo(ctx, page.id);
    });

    tools.appendChild(handle);
    tools.appendChild(delBtn);
    card.appendChild(tools);

    grid.appendChild(card);
  });

  if (focusPageId) {
    const handle = grid.querySelector(
      `.page-card[data-id="${focusPageId}"] .grab-handle`
    );
    if (handle) handle.focus();
    focusPageId = null;
  }
}

function makeFrameBadge() {
  const badge = document.createElement('span');
  badge.className = 'page-badge';
  badge.title = ctx.t('cropPending');
  badge.appendChild(ic('crop', 12));
  const text = document.createElement('span');
  text.textContent = ctx.t('cropPending');
  badge.appendChild(text);
  return badge;
}

function openEditor(pageId) {
  ctx.navigate('editor', { pageId, mode: getLastMode(pageId) });
}

// Persist the current order (all pages, in order).
async function persistOrder() {
  for (const page of state.getPages()) {
    try {
      await storage.savePage(page);
    } catch (err) {
      console.warn('persist failed', err);
    }
  }
}

// ---------- import ----------

async function importFiles(files) {
  if (!files || !files.length) return;
  ctx.showBusy(ctx.t('busyDetect'));
  const newPages = [];
  for (const file of files) {
    try {
      const { blob, width, height } = await importFile(file);
      const page = {
        id: newId(),
        blob,
        width,
        height,
        corners: fullImageCorners(width, height),
        rotation: 0,
        filter: FILTER_DEFAULT,
        params: { brightness: 0, contrast: 0, sharpen: 0 },
        ocr: null,
        detected: false,
      };
      state.addPage(page);
      await storage.savePage(page);
      newPages.push(page);
    } catch (err) {
      console.error(err);
      ctx.toast(ctx.t('errDecode'));
    }
  }
  if (!newPages.length) {
    ctx.hideBusy();
    return;
  }

  // Detect the document on the first page, then open the page
  // editor in Frame mode (the detection is fresh there). Remaining
  // pages are detected in a queue.
  try {
    const first = newPages[0];
    const { corners, detected } = await detectPageCorners(first);
    state.updatePage(first.id, { corners, detected: true });
    await storage.savePage(first);
    if (!detected) ctx.toast(ctx.t('detectFallback'));
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t('errGeneric'));
  }
  ctx.hideBusy();
  ctx.navigate('editor', { pageId: newPages[0].id, mode: 'frame' });

  // Background queue for the remaining pages.
  for (let i = 1; i < newPages.length; i++) {
    const page = newPages[i];
    try {
      const { corners, detected } = await detectPageCorners(page);
      state.updatePage(page.id, { corners, detected: true });
      await storage.savePage(page);
    } catch (err) {
      console.warn('background detect failed', err);
    }
  }
}

// ---------- init ----------

export function init(context) {
  ctx = context;

  document.getElementById('btn-camera').addEventListener('click', () => {
    ctx.pickFromCamera().then(importFiles).catch((err) => {
      console.error(err);
      ctx.toast(ctx.t('errCamera'));
    });
  });
  document.getElementById('btn-gallery').addEventListener('click', () => {
    ctx.pickFromGallery().then(importFiles).catch((err) => {
      console.error(err);
      ctx.toast(ctx.t('errGeneric'));
    });
  });
  document.getElementById('btn-export').addEventListener('click', () => {
    ctx.navigate('export');
  });
  document.getElementById('btn-delete-all').addEventListener('click', async () => {
    if (!(await ctx.confirmAction(ctx.t('confirmDeleteAll')))) return;
    state.replaceAll([]);
    try {
      await storage.clearAllPages();
    } catch (err) {
      console.warn('clear failed', err);
    }
  });

  state.subscribe(render);
  render(state.getPages());
}

// Called by the router when this view becomes visible.
export function show() {
  render(state.getPages());
}
