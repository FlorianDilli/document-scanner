// ocr.js – Tesseract.js wrapper.
//
// * The Tesseract module is loaded lazily (dynamic import) so the
//   initial app load stays light; it is only fetched when OCR is
//   first needed (export time or background OCR).
// * One worker is created and reused for all pages.
// * The worker is terminated after an idle period to free memory.
// * Languages: German + English (deu+eng), self-hosted traineddata.

import { t } from './i18n.js';

const LANG = 'deu+eng';
const IDLE_TIMEOUT_MS = 120_000;

let TesseractModule = null;
let workerPromise = null;
let idleTimer = null;
let activeLogger = null;

async function loadTesseract() {
  if (!TesseractModule) {
    // Relative to the page URL (resolved against window.location
    // by tesseract.js itself), so it works under /<repo>/.
    TesseractModule = await import('../vendor/tesseract/tesseract.esm.min.js');
    // The ESM build puts the whole API on a single default export
    // (no named exports), so unwrap it before use.
    if (!TesseractModule.createWorker && TesseractModule.default) {
      TesseractModule = TesseractModule.default;
    }
  }
  return TesseractModule;
}

function scheduleIdleTerminate() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (workerPromise) {
      workerPromise
        .then((w) => w.terminate())
        .catch(() => {})
        .finally(() => { workerPromise = null; });
    }
  }, IDLE_TIMEOUT_MS);
}

async function getWorker(onProgress) {
  activeLogger = onProgress || null;
  if (!workerPromise) {
    const T = await loadTesseract();
    // v7 signature: createWorker(langs, oem, options).
    // Language setup (loadLanguage/initialize) happens inside
    // createWorker when langs are passed; the paths and the
    // logger go into the options object. workerBlobURL: false
    // keeps the worker on its real same-origin URL so the
    // relative vendored paths resolve inside the worker.
    // gzip: false because the vendored tessdata files are
    // stored uncompressed (*.traineddata, not *.traineddata.gz).
    workerPromise = T.createWorker(LANG, 1, {
      gzip: false,
      workerBlobURL: false,
      workerPath: './vendor/tesseract/worker.min.js',
      corePath: './vendor/tesseract/core',
      langPath: './vendor/tesseract/tessdata',
      logger: (m) => {
        if (activeLogger && typeof m.progress === 'number') {
          activeLogger(m.status, m.progress);
        }
      },
    });
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// Cancel any running OCR by tearing down the worker.
export async function cancelOcr() {
  clearTimeout(idleTimer);
  if (workerPromise) {
    const p = workerPromise;
    workerPromise = null;
    try {
      const w = await p;
      await w.terminate();
    } catch (err) { /* already gone */ }
  }
}

// Collect words with bboxes from the blocks output. Tesseract.js
// >= 4 removed the flat data.words array; word boxes only exist in
// the nested structure blocks -> paragraphs -> lines -> words.
// Traversal is defensive: a level falls back to its closest
// available child level, so partial structures still yield words.
function collectWords(blocks) {
  const words = [];
  const pushWord = (w) => {
    if (w && w.text && w.text.trim().length > 0 && w.bbox) {
      words.push({
        text: w.text,
        bbox: {
          x0: w.bbox.x0,
          y0: w.bbox.y0,
          x1: w.bbox.x1,
          y1: w.bbox.y1,
        },
      });
    }
  };
  const pushLine = (l) => (Array.isArray(l.words) ? l.words.forEach(pushWord) : 0);
  const pushPara = (p) =>
    Array.isArray(p.lines) ? p.lines.forEach(pushLine) : pushLine(p);
  const pushBlock = (b) =>
    Array.isArray(b.paragraphs)
      ? b.paragraphs.forEach(pushPara)
      : Array.isArray(b.lines)
        ? b.lines.forEach(pushLine)
        : pushPara(b);
  (blocks || []).forEach(pushBlock);
  return words;
}

// Recognize text in an image (canvas / ImageBitmap / Blob).
// Returns { words: [{ text, bbox: {x0,y0,x1,y1} }], lang }.
// Throws on failure – callers decide how to proceed.
export async function recognizeImage(imageSource, onProgress) {
  const worker = await getWorker(onProgress);
  try {
    // Word boxes are nested inside "blocks"; since v6 all other
    // outputs are disabled by default, so request it explicitly.
    const { data } = await worker.recognize(
      imageSource,
      {},
      { text: true, blocks: true }
    );
    return { words: collectWords(data.blocks), lang: LANG };
  } finally {
    scheduleIdleTerminate();
  }
}

// Convenience: progress label for the UI.
export function progressLabel(status, progress) {
  return `${t('busyOcr')} ${status} (${Math.round(progress * 100)}%)`;
}
