// pdf.js – A4 PDF export with an invisible, selectable text layer.
//
// Layout per page:
//   * A4 = 595.28 x 841.89 pt; portrait or landscape chosen
//     from the processed image's aspect ratio.
//   * The image is scaled to FIT the whole page (contain),
//     centered, with no margin.
//   * The image is embedded as JPEG (small files).
//   * Recognized words are drawn at their bounding-box position
//     with opacity 0, so the PDF is searchable/selectable but
//     the text is not visible. The y-axis is flipped (PDF origin
//     is bottom-left, OCR origin is top-left). The font size is
//     chosen so the word width matches the bbox width, which
//     makes selection highlights line up with the visible text.

import { renderProcessed, getOcrImage } from './pipeline.js';
import { recognizeImage } from './ocr.js';
import { savePageOcr } from './storage.js';

const { PDFDocument } = window.PDFLib;
const fontkit = window.fontkit;

const A4_W = 595.28;
const A4_H = 841.89;
const FONT_PATH = './vendor/fonts/NotoSans-Regular.ttf';

// Keep printable characters only; strip control chars and lone
// surrogates so one odd glyph cannot abort the export.
function sanitizeText(text) {
  return text
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDFFF]/g, '');
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))),
      'image/jpeg',
      quality
    );
  });
}

// Build the PDF.
// pages: page objects from state.js
// options: { quality, ocr, filename }
// onProgress(current, total, phase)
// shouldCancel(): returns true to abort (returns null)
// onOcrProgress(status, progress): per-page OCR progress
export async function buildPdf(pages, options, onProgress, shouldCancel, onOcrProgress) {
  const { quality = 0.85, ocr = true, filename = 'scan.pdf' } = options;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Embed the vendored Unicode font (covers German umlauts and ß;
  // the standard PDF fonts cannot encode them).
  const fontResponse = await fetch(FONT_PATH);
  if (!fontResponse.ok) throw new Error('font load failed');
  const fontBytes = await fontResponse.arrayBuffer();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  pdfDoc.setTitle(filename.replace(/\.pdf$/i, ''));
  pdfDoc.setCreator('Document Scanner');
  pdfDoc.setProducer('Document Scanner');
  pdfDoc.setCreationDate(new Date());

  // One canvas reused for all pages; released at the end to
  // avoid memory spikes on large documents.
  const canvas = document.createElement('canvas');
  const ocrCanvas = document.createElement('canvas');

  try {
    const total = pages.length;
    for (let i = 0; i < total; i++) {
      if (shouldCancel && shouldCancel()) return null;
      const page = pages[i];
      onProgress && onProgress(i, total, 'pdf');

      // 1. Render the final processed image.
      await renderProcessed(page, canvas);
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      // 2. Embed as JPEG.
      const jpegBlob = await canvasToJpegBlob(canvas, quality);
      const jpegBytes = await jpegBlob.arrayBuffer();
      const img = await pdfDoc.embedJpg(jpegBytes);

      // 3. A4 page, orientation from the image aspect ratio.
      const landscape = imgWidth > imgHeight;
      const pageW = landscape ? A4_H : A4_W;
      const pageH = landscape ? A4_W : A4_H;
      const pdfPage = pdfDoc.addPage([pageW, pageH]);

      // 4. Fit the image to the full page (contain), centered.
      const scale = Math.min(pageW / imgWidth, pageH / imgHeight);
      const imgW = imgWidth * scale;
      const imgH = imgHeight * scale;
      const imgX = (pageW - imgW) / 2;
      const imgY = (pageH - imgH) / 2;
      pdfPage.drawImage(img, { x: imgX, y: imgY, width: imgW, height: imgH });

      // 5. Invisible text layer from OCR (run on the final
      //    processed image; for the Photo filter an enhanced
      //    copy is used for better accuracy). Results are
      //    cached per page (page.ocr) and invalidated
      //    automatically when the processed image changes
      //    (see state.js updatePage).
      if (ocr) {
        try {
          let words;
          // The cache only counts when it holds actual words, so a
          // result saved by an earlier (buggy) build cannot suppress
          // a fresh OCR run after this fix.
          if (
            page.ocr &&
            page.ocr.lang === 'deu+eng' &&
            Array.isArray(page.ocr.words) &&
            page.ocr.words.length > 0
          ) {
            words = page.ocr.words;
          } else {
            const ocrImg = await getOcrImage(page);
            const bmp = await createImageBitmap(ocrImg.blob);
            ocrCanvas.width = ocrImg.width;
            ocrCanvas.height = ocrImg.height;
            ocrCanvas.getContext('2d').drawImage(bmp, 0, 0);
            bmp.close();
            const result = await recognizeImage(ocrCanvas, (status, progress) => {
              if (onOcrProgress) onOcrProgress(status, progress);
            });
            words = result.words;
            page.ocr = { words, lang: 'deu+eng' };
            // Persist the OCR cache so re-exports (and
            // reloads) do not re-run OCR. Empty results are
            // not cached: they cannot be told apart from
            // results produced by a broken OCR run. Failures
            // here are non-fatal.
            if (words.length > 0) {
              savePageOcr(page.id, page.ocr).catch((err) =>
                console.warn('ocr cache persist failed', err)
              );
            }
          }
          const pxToPt = imgW / imgWidth;
          for (const word of words) {
            const { x0, y0, x1, y1 } = word.bbox;
            if (!word.text || x1 <= x0 || y1 <= y0) continue;
            if (x0 < 0 || y0 < 0 || x1 > imgWidth || y1 > imgHeight) continue;
            const text = sanitizeText(word.text);
            if (!text) continue;
            const naturalWidth = font.widthOfTextAtSize(text, 1);
            if (naturalWidth <= 0) continue;
            // Font size so the word width matches the bbox width.
            let fontSize = ((x1 - x0) * pxToPt) / naturalWidth;
            fontSize = Math.max(2, Math.min(60, fontSize));
            // Flip the y-axis: PDF origin is bottom-left.
            const x = imgX + x0 * pxToPt;
            const y = imgY + (imgHeight - y1) * pxToPt;
            try {
              // opacity 0 = invisible but still selectable and
              // searchable in Chrome/Firefox/Preview/iOS Files.
              // Trailing space keeps copy/paste word spacing.
              pdfPage.drawText(text + ' ', {
                x, y, size: fontSize, font, opacity: 0,
              });
            } catch (err) {
              // One odd glyph must not abort the export.
            }
          }
        } catch (err) {
          // OCR failed for this page: export without a text layer.
          // The UI reports this to the user.
          page.ocrError = true;
        }
      }
    }

    const bytes = await pdfDoc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  } finally {
    // Release canvas memory.
    canvas.width = 0;
    canvas.height = 0;
    ocrCanvas.width = 0;
    ocrCanvas.height = 0;
  }
}
