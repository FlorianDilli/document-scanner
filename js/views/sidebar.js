// sidebar.js – page previews. Shared renderer for the desktop left
// sidebar (visible on every view) and the editor's mobile filmstrip.
// Thumbnails are cached per page and rebuilt only when the page's
// pipeline inputs change.

import * as state from '../state.js';
import { getThumbnail, pageAspect, pageFrameAspect } from '../pipeline.js';
import { t } from '../i18n.js';

// Persistent thumbnail cache: pageId -> { url, key }. key captures
// the current pipeline inputs (corners, rotation, filter, params), so
// unchanged pages reuse their object URL across rebuilds.
const thumbCache = new Map();

function thumbKey(page) {
  return JSON.stringify([page.corners, page.rotation, page.filter, page.params]);
}

// Build the preview buttons into `container`. `onSelect(pageId)` is
// called for every page that is not the current one.
export function renderPageList(container, { currentId = null, onSelect = null } = {}) {
  const pages = state.getPages();
  container.textContent = '';

  // Drop thumbnails of removed pages; keep the rest.
  const ids = new Set(pages.map((p) => p.id));
  for (const [id, entry] of thumbCache) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(entry.url);
      thumbCache.delete(id);
    }
  }

  pages.forEach((page, index) => {
    const current = page.id === currentId;
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'strip-thumb';
    // Generic DIN A frames: one portrait (1:√2) and one landscape
    // (√2:1) slot, picked by the page's real orientation. The page is
    // letterboxed inside with `contain`.
    const aspect = pageAspect(page);
    thumb.style.aspectRatio = String(Math.round(pageFrameAspect(page) * 1000) / 1000);
    if (aspect > 1) thumb.classList.add('landscape');
    if (current) {
      thumb.classList.add('current');
      thumb.setAttribute('aria-current', 'true');
    }
    const label = `${t('goToPage', { i: index + 1 })} – ${
      aspect > 1 ? t('orientationLandscape') : t('orientationPortrait')
    }`;
    thumb.title = label;
    thumb.setAttribute('aria-label', label);

    const num = document.createElement('span');
    num.className = 'strip-num';
    num.textContent = String(index + 1);
    thumb.appendChild(num);

    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    thumb.appendChild(img);

    if (!current && onSelect) thumb.addEventListener('click', () => onSelect(page.id));
    container.appendChild(thumb);

    // Reuse the cached object URL while the pipeline state is
    // unchanged; otherwise regenerate from the corrected document.
    const key = thumbKey(page);
    const cached = thumbCache.get(page.id);
    if (cached && cached.key === key) {
      img.src = cached.url;
      return;
    }
    if (cached) {
      URL.revokeObjectURL(cached.url);
      thumbCache.delete(page.id);
    }
    getThumbnail(page, 240)
      .then((blob) => {
        // Discard a stale result if the page changed in the meantime.
        if (state.getPage(page.id) !== page || thumbKey(page) !== key) return;
        const url = URL.createObjectURL(blob);
        thumbCache.set(page.id, { url, key });
        img.src = url;
      })
      .catch((err) => console.warn('thumbnail failed', err));
  });

  // Keep the highlighted page in view without scrolling the document.
  const active = container.querySelector('.strip-thumb.current');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---------- desktop sidebar ----------

let sidebarEl = null;
let sidebarSelect = null;
let sidebarCurrent = null;
let lastSignature = '';

export function initSidebar(el, onSelect) {
  sidebarEl = el;
  sidebarSelect = onSelect;
  state.subscribe(refreshSidebar);
  refreshSidebar();
}

// Highlight the page open in the editor (null on other views).
export function setSidebarCurrent(id) {
  sidebarCurrent = id;
  refreshSidebar();
}

export function refreshSidebar() {
  if (!sidebarEl) return;
  // Slider drags update the page on every input event; skip the
  // rebuild unless the list or a thumbnail input actually changed.
  const signature = JSON.stringify([
    sidebarCurrent,
    state.getPages().map((p) => [p.id, thumbKey(p), pageAspect(p) > 1]),
  ]);
  if (signature === lastSignature) return;
  lastSignature = signature;
  renderPageList(sidebarEl, { currentId: sidebarCurrent, onSelect: sidebarSelect });
}
