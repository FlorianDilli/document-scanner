// sidebar.js – page previews. Shared renderer for the desktop left
// sidebar (visible in the editor only) and the editor's mobile
// filmstrip. Thumbnails are cached per page and rebuilt only when
// the page's pipeline inputs change.
//
// The thumbs cross-fade into a new look just like the big preview
// does: the old thumbnail stays on screen while the new one is
// rendered and then dissolves over it. A changed document type
// therefore never flashes blank in the rails.

import * as state from '../state.js';
import { getThumbnail, pageAspect, pageFrameAspect } from '../pipeline.js';
import { t } from '../i18n.js';

// Persistent thumbnail cache: pageId -> { url, key }. key captures
// the current pipeline inputs (corners, rotation, filter, params), so
// unchanged pages reuse their object URL across rebuilds.
const thumbCache = new Map();

// Object URLs are shared: the cache hands them out and every thumb
// that shows one holds a reference. A URL is revoked only when the
// last holder lets go of it, so a thumbnail that is still on screen
// never breaks.
const urlRefs = new Map();

function retainUrl(url) {
  urlRefs.set(url, (urlRefs.get(url) || 0) + 1);
}

function releaseUrl(url) {
  if (!url) return;
  const count = (urlRefs.get(url) || 1) - 1;
  if (count > 0) {
    urlRefs.set(url, count);
    return;
  }
  urlRefs.delete(url);
  URL.revokeObjectURL(url);
}

// The rail shows its previews BIG: the desktop rail gives every page
// the full column width (~207 CSS px, ~290 tall for a portrait page),
// and phones/tablets display that at 2–3 device pixels per CSS pixel.
// Rendering the thumbnail at only ~240 px therefore upscales it ~3x,
// which turns the document into unreadable mush. 900 px keeps the
// page text legible on HiDPI screens and still costs almost nothing
// (the pipeline renders the preview on a downscaled copy anyway).
const THUMB_MAX_EDGE = 900;

// How long a new thumbnail takes to dissolve over the old one.
// Same duration as the big preview's cross-fade.
const THUMB_FADE_MS = 300;

function thumbKey(page) {
  return JSON.stringify([page.corners, page.rotation, page.filter, page.params]);
}

// Thumbnails that are being rendered right now, so the desktop rail
// and the mobile filmstrip share one CV run instead of two.
const inflight = new Map();

function ensureThumb(page, key) {
  const cached = thumbCache.get(page.id);
  if (cached && cached.key === key) return Promise.resolve(cached.url);
  const id = `${page.id}|${key}`;
  let promise = inflight.get(id);
  if (!promise) {
    promise = getThumbnail(page, THUMB_MAX_EDGE).then(
      (blob) => {
        inflight.delete(id);
        const url = URL.createObjectURL(blob);
        retainUrl(url);
        const prev = thumbCache.get(page.id);
        thumbCache.set(page.id, { url, key });
        if (prev && prev.url !== url) releaseUrl(prev.url);
        return url;
      },
      (err) => {
        inflight.delete(id);
        throw err;
      }
    );
    inflight.set(id, promise);
  }
  return promise;
}

// ---------- thumbnail nodes ----------

// One node per page and container (the desktop rail and the mobile
// filmstrip each get their own). The nodes are kept across rebuilds,
// so a rebuild never tears the visible images down – that is what
// used to make the rails flash white.
const nodeMaps = new WeakMap();

function createNode() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'strip-thumb';

  const num = document.createElement('span');
  num.className = 'strip-num';

  const base = document.createElement('img');
  base.alt = '';
  base.draggable = false;

  // The layer the new thumbnail fades in on top of the current one.
  const next = document.createElement('img');
  next.alt = '';
  next.draggable = false;
  next.className = 'thumb-fade';

  button.append(base, next, num);
  return { button, num, base, next, url: null, key: null, timer: null };
}

// Stops a running fade and clears the fading layer. The URL that was
// fading in is released unless it is the one the caller keeps.
function dropFade(node, keep = null) {
  if (node.timer) {
    clearTimeout(node.timer);
    node.timer = null;
  }
  const fadeUrl = node.next.getAttribute('src');
  node.next.style.transition = 'none';
  node.next.style.opacity = '0';
  node.next.removeAttribute('src');
  if (fadeUrl && fadeUrl !== keep) releaseUrl(fadeUrl);
}

// Puts `url` on screen. With `fade` the new image dissolves over the
// current one, otherwise it simply replaces it.
function showThumb(node, url, { fade = false } = {}) {
  if (node.url === url) return;
  const old = node.url;
  if (!fade || !old) {
    dropFade(node, url);
    node.base.src = url;
    node.url = url;
    retainUrl(url);
    if (old && old !== url) releaseUrl(old);
    return;
  }
  dropFade(node, url);
  const next = node.next;
  next.src = url;
  retainUrl(url);
  const finish = () => {
    // The new thumbnail is the current one from here on.
    node.base.src = url;
    node.url = url;
    if (old && old !== url) releaseUrl(old);
    // The fading layer is only taken away once the base really shows
    // the new thumbnail – otherwise the old one could flash back.
    const hide = () => {
      next.style.transition = 'none';
      next.style.opacity = '0';
      next.removeAttribute('src');
    };
    if (node.base.complete && node.base.naturalWidth) hide();
    else node.base.addEventListener('load', hide, { once: true });
  };
  const begin = () => {
    // Force a style flush so the browser sees the start value before
    // the transition is armed.
    void next.offsetWidth;
    next.style.transition = `opacity ${THUMB_FADE_MS}ms ease`;
    next.style.opacity = '1';
    node.timer = setTimeout(() => {
      node.timer = null;
      finish();
    }, THUMB_FADE_MS + 20);
  };
  // Only start the fade once the new image is really there – fading in
  // an empty layer would look like a flash.
  if (typeof next.decode === 'function') {
    next.decode().then(begin, () => {
      // The image could not be decoded: show it right away.
      next.style.transition = 'none';
      next.style.opacity = '0';
      next.removeAttribute('src');
      node.base.src = url;
      node.url = url;
      if (old && old !== url) releaseUrl(old);
    });
  } else {
    next.addEventListener('load', begin, { once: true });
  }
}

// Build the preview buttons into `container`. `onSelect(pageId)` is
// called for every page that is not the current one.
export function renderPageList(container, { currentId = null, onSelect = null } = {}) {
  const pages = state.getPages();
  let nodes = nodeMaps.get(container);
  if (!nodes) {
    nodes = new Map();
    nodeMaps.set(container, nodes);
  }

  // Drop thumbnails of removed pages; keep the rest.
  const ids = new Set(pages.map((p) => p.id));
  for (const [id, node] of nodes) {
    if (ids.has(id)) continue;
    dropFade(node);
    if (node.url) releaseUrl(node.url);
    node.button.remove();
    nodes.delete(id);
  }
  for (const [id, entry] of thumbCache) {
    if (!ids.has(id)) {
      releaseUrl(entry.url);
      thumbCache.delete(id);
    }
  }

  pages.forEach((page, index) => {
    let node = nodes.get(page.id);
    if (!node) {
      node = createNode();
      nodes.set(page.id, node);
    }
    const current = page.id === currentId;
    const thumb = node.button;
    thumb.classList.toggle('current', current);
    if (current) thumb.setAttribute('aria-current', 'true');
    else thumb.removeAttribute('aria-current');
    // Generic DIN A frame picked by the page's real orientation: the
    // thumb box itself rotates with the page while the rails pin
    // their size around it. Letterboxed inside with `contain`.
    const aspect = pageAspect(page);
    thumb.style.setProperty('--frame-aspect', String(Math.round(pageFrameAspect(page) * 1000) / 1000));
    thumb.classList.toggle('landscape', aspect > 1);
    const label = `${t('goToPage', { i: index + 1 })} – ${
      aspect > 1 ? t('orientationLandscape') : t('orientationPortrait')
    }`;
    thumb.title = label;
    thumb.setAttribute('aria-label', label);
    node.num.textContent = String(index + 1);

    thumb.onclick = current || !onSelect ? null : () => onSelect(page.id);
    // Keep the rail in page order without tearing the nodes down.
    const at = container.children[index];
    if (at !== thumb) container.insertBefore(thumb, at || null);

    // Reuse the cached object URL while the pipeline state is
    // unchanged; otherwise regenerate from the corrected document and
    // dissolve it over the current thumbnail.
    const key = thumbKey(page);
    if (node.key === key && node.url) return;
    node.key = key;
    ensureThumb(page, key)
      .then((url) => {
        // Discard a stale result if the page changed in the meantime.
        const live = state.getPage(page.id);
        if (!live || thumbKey(live) !== key) return;
        if (!nodes.has(page.id)) return;
        showThumb(node, url, { fade: true });
      })
      .catch((err) => {
        // Allow a later rebuild to try again.
        if (node.key === key) node.key = null;
        console.warn('thumbnail failed', err);
      });
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
