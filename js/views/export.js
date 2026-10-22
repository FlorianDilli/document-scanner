// views/export.js – export view: options (format, quality,
// OCR, filename), progress per page, cancel, and delivery
// via the Web Share API (mobile) or a download link.
//
// Two formats:
//   pdf    – A4 document with an invisible OCR text layer
//   images – one JPEG per page, meant for the camera roll

import * as state from '../state.js';
import { buildPdf } from '../pdf.js';
import { buildImages } from '../images.js';
import { cancelOcr } from '../ocr.js';

let ctx = null;
let cancelled = false;
let currentPageIndex = 0;
let format = 'pdf';

// How many files go into a single share sheet: phones cap the
// number of shared files, and each sheet costs the user one tap.
const SHARE_CHUNK = 10;

function defaultFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `scan-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.pdf`;
}

// The base name (without extension) last suggested in the field.
// Lets a refresh tell the suggestion apart from a name the user typed.
let suggestedBase = '';

// Re-suggests today's name when the field still holds the previous
// suggestion (or is empty). A custom name is never overwritten.
function refreshDefaultFilename() {
  const input = document.getElementById('opt-filename');
  const current = input.value.trim().replace(/\.pdf$/i, '');
  if (!current || current === suggestedBase) {
    input.value = defaultFilename();
  }
  suggestedBase = defaultFilename().replace(/\.pdf$/i, '');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function setProgress(current, total, text) {
  document.getElementById('export-progress-fill').style.width =
    `${Math.round((current / total) * 100)}%`;
  document.getElementById('export-progress-text').textContent = text;
}

// Reflect the selected format in the options (OCR only makes sense
// for the PDF text layer) and in the action button label.
function applyFormatUI() {
  const isPdf = format === 'pdf';
  document.querySelectorAll('#opt-format .format-btn').forEach((btn) => {
    btn.setAttribute('aria-checked', btn.dataset.format === format ? 'true' : 'false');
  });
  document.getElementById('row-ocr').classList.toggle('hidden', !isPdf);
  document.getElementById('format-hint').classList.toggle('hidden', isPdf);
  const startBtn = document.getElementById('btn-export-start');
  const key = isPdf ? 'startExport' : 'startExportImages';
  startBtn.setAttribute('data-i18n', key);
  startBtn.textContent = ctx.t(key);
}

function setFormat(next) {
  if (next !== 'pdf' && next !== 'images') return;
  format = next;
  applyFormatUI();
}

// Share a batch of images (the share sheet is where phones offer
// "Save image" / Photos); fall back to plain downloads.
// Returns 'shared', 'downloaded' or 'aborted' (user dismissed).
async function deliverImages(files) {
  if (navigator.canShare) {
    const shareable = files.map((f) =>
      new File([f.blob], f.name, { type: 'image/jpeg' })
    );
    if (navigator.canShare({ files: shareable })) {
      try {
        await navigator.share({ files: shareable, title: shareable[0].name });
        return 'shared';
      } catch (err) {
        if (err.name === 'AbortError') return 'aborted';
        console.warn('share failed', err);
        ctx.toast(ctx.t('shareFailed'));
      }
    }
  }
  for (const file of files) downloadBlob(file.blob, file.name);
  return 'downloaded';
}

async function startExport() {
  const pages = state.getPages();
  if (!pages.length) {
    ctx.toast(ctx.t('emptyState'));
    return;
  }

  const filenameInput = document.getElementById('opt-filename');
  let filename = filenameInput.value.trim() || defaultFilename();
  if (format === 'pdf') {
    if (!/\.pdf$/i.test(filename)) filename += '.pdf';
  } else {
    filename = filename.replace(/\.pdf$/i, '');
  }
  filenameInput.value = filename;

  const options = {
    quality: Number(document.getElementById('opt-quality').value),
    filename,
  };
  if (format === 'pdf') options.ocr = document.getElementById('opt-ocr').checked;

  cancelled = false;
  // Failure flags describe the current export only: a page that failed
  // earlier (or was cut off by a cancel) gets a fresh attempt.
  for (const page of pages) page.ocrError = false;
  const progressBox = document.getElementById('export-progress');
  const startBtn = document.getElementById('btn-export-start');
  progressBox.classList.remove('hidden');
  startBtn.disabled = true;

  const onProgress = (current, total, phase) => {
    currentPageIndex = current;
    const text = phase === 'ocr'
      ? ctx.t('ocrProgress', { current: current + 1, total })
      : phase === 'image'
        ? ctx.t('imageProgress', { current: current + 1, total })
        : ctx.t('pdfProgress', { current: current + 1, total });
    setProgress(current, total, text);
  };
  const shouldCancel = () => cancelled;
  const onOcrProgress = (status, progress) => {
    setProgress(
      currentPageIndex,
      pages.length,
      `${ctx.t('busyOcr')} ${status} (${Math.round(progress * 100)}%)`
    );
  };

  try {
    if (format === 'pdf') {
      setProgress(0, pages.length, ctx.t('busyPdf'));
      const blob = await buildPdf(pages, options, onProgress, shouldCancel, onOcrProgress);
      if (!blob) {
        ctx.toast(ctx.t('exportCancelled'));
        return;
      }

      // Deliver: prefer the Web Share API on mobile so the
      // user can save to Files or send the PDF; fall back to
      // a plain download.
      const file = new File([blob], filename, { type: 'application/pdf' });
      let shared = false;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          shared = true;
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('share failed', err);
            ctx.toast(ctx.t('shareFailed'));
          }
        }
      }
      if (!shared) downloadBlob(blob, filename);

      // Report pages whose OCR failed (exported without text layer).
      const failed = pages.filter((p) => p.ocrError).length;
      if (failed > 0) ctx.toast(ctx.t('ocrFailedNote'), 5000);
      return;
    }

    // Images (camera roll): render every page, then hand the JPEGs
    // to the share sheet in batches.
    setProgress(0, pages.length, ctx.t('busyImages'));
    const files = await buildImages(pages, options, onProgress, shouldCancel);
    if (!files) {
      ctx.toast(ctx.t('exportCancelled'));
      return;
    }

    let downloaded = false;
    for (let i = 0; i < files.length; i += SHARE_CHUNK) {
      const result = await deliverImages(files.slice(i, i + SHARE_CHUNK));
      if (result === 'aborted') return;
      if (result === 'downloaded') downloaded = true;
    }
    ctx.toast(ctx.t(downloaded ? 'imagesDownloaded' : 'imagesSaved'), 5000);
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t(format === 'pdf' ? 'errPdf' : 'errImages'));
  } finally {
    progressBox.classList.add('hidden');
    startBtn.disabled = false;
  }
}

export function init(context) {
  ctx = context;

  document.getElementById('opt-filename').value = defaultFilename();
  suggestedBase = defaultFilename().replace(/\.pdf$/i, '');
  // On narrow screens the back button shows its arrow only – the
  // label lives on the button as its accessible name.
  document
    .getElementById('btn-export-back')
    .setAttribute('aria-label', ctx.t('back'));
  document.getElementById('btn-export-back').addEventListener('click', () => {
    ctx.navigate('home');
  });
  document.getElementById('btn-export-start').addEventListener('click', startExport);
  document.getElementById('btn-export-cancel').addEventListener('click', async () => {
    cancelled = true;
    await cancelOcr();
  });
  document.querySelectorAll('#opt-format .format-btn').forEach((btn) => {
    btn.addEventListener('click', () => setFormat(btn.dataset.format));
  });
  setFormat('pdf');
}

export async function show() {
  // Options keep their state; re-apply the labels so a language
  // switch shows the strings of the selected format.
  applyFormatUI();
  // The app may stay open for days: the suggested date must be today's.
  refreshDefaultFilename();
}
