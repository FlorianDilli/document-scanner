// views/export.js – export view: options (quality,
// OCR, filename), progress per page, cancel, and delivery
// via the Web Share API (mobile) or a download link.

import * as state from '../state.js';
import { buildPdf } from '../pdf.js';
import { cancelOcr } from '../ocr.js';

let ctx = null;
let cancelled = false;
let currentPageIndex = 0;

function defaultFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `scan-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.pdf`;
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

async function startExport() {
  const pages = state.getPages();
  if (!pages.length) {
    ctx.toast(ctx.t('emptyState'));
    return;
  }

  const filenameInput = document.getElementById('opt-filename');
  let filename = filenameInput.value.trim() || defaultFilename();
  if (!/\.pdf$/i.test(filename)) filename += '.pdf';
  filenameInput.value = filename;

  const options = {
    quality: Number(document.getElementById('opt-quality').value),
    ocr: document.getElementById('opt-ocr').checked,
    filename,
  };

  cancelled = false;
  const progressBox = document.getElementById('export-progress');
  const startBtn = document.getElementById('btn-export-start');
  progressBox.classList.remove('hidden');
  startBtn.disabled = true;
  setProgress(0, pages.length, ctx.t('busyPdf'));

  try {
    const blob = await buildPdf(
      pages,
      options,
      (current, total, phase) => {
        currentPageIndex = current;
        const text = phase === 'ocr'
          ? ctx.t('ocrProgress', { current: current + 1, total })
          : ctx.t('pdfProgress', { current: current + 1, total });
        setProgress(current, total, text);
      },
      () => cancelled,
      (status, progress) => {
        // Live OCR status within the current page.
        setProgress(
          currentPageIndex,
          pages.length,
          `${ctx.t('busyOcr')} ${status} (${Math.round(progress * 100)}%)`
        );
      }
    );

    if (!blob) {
      ctx.toast(ctx.t('cancel'));
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
  } catch (err) {
    console.error(err);
    ctx.toast(ctx.t('errPdf'));
  } finally {
    progressBox.classList.add('hidden');
    startBtn.disabled = false;
  }
}

export function init(context) {
  ctx = context;

  document.getElementById('opt-filename').value = defaultFilename();
  document.getElementById('btn-export-back').addEventListener('click', () => {
    ctx.navigate('home');
  });
  document.getElementById('btn-export-start').addEventListener('click', startExport);
  document.getElementById('btn-export-cancel').addEventListener('click', async () => {
    cancelled = true;
    await cancelOcr();
  });
}

export async function show() {
  // Nothing to prepare; options keep their state.
}
