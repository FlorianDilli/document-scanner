// views/home.js – home view: page list with thumbnails,
// import (camera / gallery), reorder, delete with undo.

import * as state from '../state.js';
import * as storage from '../storage.js';
import { importFile } from '../camera.js';
import { detectPageCorners, getThumbnail } from '../pipeline.js';
import { newId } from '../state.js';

const FILTER_DEFAULT = 'document'; // recommended default

let ctx = null;
// Persistent thumbnail cache: pageId -> object URL.
// Thumbnails are only generated once per page and
// reused across re-renders (state changes must not
// regenerate all thumbnails).
let thumbnailUrls = new Map();

function pageCountText(n) {
  return n === 1 ? ctx.t('pageCountOne') : ctx.t('pageCount', { count: n });
}

// Revoke object URLs of pages that no longer exist.
function pruneThumbnailCache(pages) {
  const ids = new Set(pages.map((p) => p.id));
  for (const [id, url] of thumbnailUrls) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(url);
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

  // Drop thumbnails of removed pages; keep the rest.
  pruneThumbnailCache(pages);

  grid.textContent = '';
  empty.classList.toggle('hidden', pages.length > 0);
  footer.classList.toggle('hidden', pages.length === 0);
  counter.textContent = pageCountText(pages.length);

  pages.forEach((page, index) => {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.draggable = true;
    card.dataset.id = page.id;

    const num = document.createElement('span');
    num.className = 'page-num';
    num.textContent = String(index + 1);
    card.appendChild(num);

    const img = document.createElement('img');
    img.alt = '';
    card.appendChild(img);

    // Thumbnail: reuse the cached object URL, or
    // generate it once (async) for new pages.
    const cached = thumbnailUrls.get(page.id);
    if (cached) {
      img.src = cached;
    } else {
      getThumbnail(page)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          thumbnailUrls.set(page.id, url);
          img.src = url;
        })
        .catch((err) => console.warn('thumbnail failed', err));
    }

    // Tap to edit.
    card.addEventListener('click', () => {
      ctx.navigate('crop', { pageId: page.id });
    });

    // Tools: move up/down (touch-reliable), delete.
    const tools = document.createElement('div');
    tools.className = 'page-tools';
    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.title = ctx.t('moveUp');
    upBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.movePage(page.id, index - 1);
      persistOrder();
    });
    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.title = ctx.t('moveDown');
    downBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.movePage(page.id, index + 1);
      persistOrder();
    });
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑';
    delBtn.title = ctx.t('deletePage');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePageWithUndo(page.id);
    });
    tools.appendChild(upBtn);
    tools.appendChild(downBtn);
    tools.appendChild(delBtn);
    card.appendChild(tools);

    // Drag & drop reorder (desktop; buttons cover touch).
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', page.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === page.id) return;
      const from = state.getPages().findIndex((p) => p.id === draggedId);
      if (from === -1) return;
      state.movePage(draggedId, index);
      persistOrder();
    });

    grid.appendChild(card);
  });
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

  // Detect the document on the first page, then open the
  // crop view. Remaining pages are detected in a queue.
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
  ctx.navigate('crop', { pageId: newPages[0].id });

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

// ---------- delete with undo ----------

async function deletePageWithUndo(id) {
  const pages = state.getPages();
  const index = pages.findIndex((p) => p.id === id);
  if (index === -1) return;
  const page = state.removePage(id);
  try {
    await storage.deletePage(id);
  } catch (err) {
    console.warn('delete from storage failed', err);
  }
  const undone = await ctx.toastAction(ctx.t('pageDeleted'), ctx.t('undo'));
  if (undone) {
    state.insertPage(page, index);
    try {
      await storage.savePage(page);
    } catch (err) {
      console.warn('undo persist failed', err);
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
