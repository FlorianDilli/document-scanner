// views/crop.js – crop view: corner editor with draggable
// handles, auto-detect, reset, A4 snap, and apply.

import * as state from '../state.js';
import * as storage from '../storage.js';
import { CornerEditor, isConvexQuad } from '../cornerEditor.js';
import { detectPageCorners, getSnapA4, setSnapA4 } from '../pipeline.js';

let ctx = null;
let editor = null;
let currentPage = null;
let bitmap = null;

function fullImageCorners() {
  return [
    { x: 0, y: 0 },
    { x: currentPage.width, y: 0 },
    { x: currentPage.width, y: currentPage.height },
    { x: 0, y: currentPage.height },
  ];
}

// The Apply button is disabled while the quadrilateral is
// concave or self-intersecting.
function validateQuad() {
  const corners = editor.getCorners();
  const valid = isConvexQuad(corners);
  document.getElementById('btn-crop-done').disabled = !valid;
  return valid;
}

async function runDetection() {
  if (!currentPage) return;
  ctx.showBusy(ctx.t('busyDetect'));
  try {
    const { corners, detected } = await detectPageCorners(currentPage);
    editor.setCorners(corners);
    validateQuad();
    if (!detected) ctx.toast(ctx.t('detectFallback'));
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t('errGeneric'));
  } finally {
    ctx.hideBusy();
  }
}

export function init(context) {
  ctx = context;

  editor = new CornerEditor(document.getElementById('crop-canvas'), {
    onChange: () => validateQuad(),
  });

  document.getElementById('btn-crop-back').addEventListener('click', () => {
    ctx.navigate('home');
  });

  document.getElementById('btn-crop-done').addEventListener('click', async () => {
    if (!currentPage) return;
    const corners = editor.getCorners();
    if (!isConvexQuad(corners)) {
      ctx.toast(ctx.t('errGeneric'));
      return;
    }
    state.updatePage(currentPage.id, { corners });
    try {
      await storage.savePage(currentPage);
    } catch (err) {
      console.warn('persist failed', err);
    }
    ctx.navigate('edit', { pageId: currentPage.id });
  });

  document.getElementById('btn-redetect').addEventListener('click', runDetection);

  document.getElementById('btn-reset-crop').addEventListener('click', () => {
    if (!currentPage) return;
    editor.setCorners(fullImageCorners());
    validateQuad();
  });

  const snapBtn = document.getElementById('btn-a4-snap');
  snapBtn.addEventListener('click', () => {
    const v = !getSnapA4();
    setSnapA4(v);
    snapBtn.setAttribute('aria-pressed', String(v));
  });
}

export async function show({ pageId }) {
  const page = state.getPage(pageId);
  if (!page) {
    ctx.navigate('home');
    return;
  }
  currentPage = page;

  // A4 snap toggle state.
  document.getElementById('btn-a4-snap')
    .setAttribute('aria-pressed', String(getSnapA4()));

  // Load the original photo into the editor.
  try {
    if (bitmap) bitmap.close();
    bitmap = await createImageBitmap(page.blob);
    await editor.setImage(bitmap);
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t('errDecode'));
    ctx.navigate('home');
    return;
  }

  editor.setCorners(page.corners);
  validateQuad();

  // If the page has not been detected yet (e.g. the user
  // opened it while the background queue was still running),
  // run detection now.
  if (!page.detected) {
    await runDetection();
  }
}

export function hide() {
  // Keep the editor canvas; it is reused for the next page.
}
