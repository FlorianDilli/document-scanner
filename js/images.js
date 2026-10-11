// images.js – save the processed pages as JPEG images (camera roll).
//
// One image per page, rendered from the same pipeline the PDF export
// uses (warp -> rotate -> filter), encoded as JPEG at the chosen
// quality. The images are returned as { name, blob } so the caller
// can deliver them (Web Share API on phones, download elsewhere).

import { renderProcessed } from './pipeline.js';

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))),
      'image/jpeg',
      quality
    );
  });
}

// Build one JPEG per page.
// pages: page objects from state.js
// options: { quality, filename (base name, extension stripped) }
// onProgress(current, total, phase)
// shouldCancel(): returns true to abort (returns null)
export async function buildImages(pages, options, onProgress, shouldCancel) {
  const { quality = 0.95, filename = 'scan' } = options;

  // Base name without any PDF extension; page index appended as a
  // suffix so the camera roll keeps the scan order.
  const base = (filename || 'scan').replace(/\.pdf$/i, '').trim() || 'scan';
  const pad = String(pages.length).length;

  const canvas = document.createElement('canvas');
  const files = [];
  try {
    const total = pages.length;
    for (let i = 0; i < total; i++) {
      if (shouldCancel && shouldCancel()) return null;
      const page = pages[i];
      onProgress && onProgress(i, total, 'image');

      await renderProcessed(page, canvas);
      const blob = await canvasToJpegBlob(canvas, quality);
      const name = `${base}-${String(i + 1).padStart(pad, '0')}.jpg`;
      files.push({ name, blob });
    }
    return files;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
