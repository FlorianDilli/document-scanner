# Vendored third-party libraries

All third-party code is vendored into this repository so the app works fully
offline, without any CDN at runtime. Versions are pinned exactly.

| Path | Library | Version | Source | License |
| --- | --- | --- | --- | --- |
| `opencv.js` | OpenCV.js (official build, wasm embedded) | 4.13.0 | https://docs.opencv.org/4.13.0/opencv.js | BSD 3-Clause (OpenCV) |
| `tesseract/tesseract.esm.min.js` | Tesseract.js (main ESM build) | 7.0.0 | https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js | Apache 2.0 |
| `tesseract/worker.min.js` | Tesseract.js worker script | 7.0.0 | https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js | Apache 2.0 |
| `tesseract/core/tesseract-core*.wasm.js` + `.wasm` | Tesseract.js-core (wasm core, all SIMD/LSTM variants) | 7.0.0 | https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/ | Apache 2.0 |
| `tesseract/tessdata/deu.traineddata`, `eng.traineddata` | Tesseract traineddata (`tessdata_fast` variants) | fast, 4.0.0 | https://github.com/tesseract-ocr/tessdata_fast | Apache 2.0 |
| `pdf-lib/pdf-lib.min.js` | pdf-lib (UMD build) | 1.17.1 | https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js | MIT (Microsoft) |
| `pdf-lib/fontkit.umd.min.js` | @pdf-lib/fontkit (UMD build, self-contained) | 1.1.1 | https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js | MIT |
| `fonts/NotoSans-Regular.ttf` | Noto Sans Regular (Unicode TTF for the PDF text layer) | 2024 | https://github.com/notofonts/notofonts.github.io/blob/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf | SIL Open Font License 1.1 |

## Notes

- **OpenCV.js** is the official single-file build with the wasm embedded in the
  JS file (~11 MB). It is loaded inside a dedicated Web Worker via
  `importScripts`. No `SharedArrayBuffer` / threads are used (GitHub Pages
  cannot set COOP/COEP headers).
- **Tesseract.js-core**: all six wasm variants (plain / simd / relaxedsimd,
  each with and without `-lstm`) are vendored because the library picks the
  variant based on the device's wasm feature detection at runtime. The default
  OEM mode (`LSTM_ONLY`) loads the `-lstm` variants.
- **tessdata_fast** is used instead of `tessdata_best` to keep the language
  files small (~1.5 MB deu, ~4 MB eng) while still giving good accuracy.
- **pdf-lib / fontkit**: the UMD builds are loaded as classic scripts
  (`window.pdfLib`, `window.fontkit`). The ESM build of fontkit depends on
  `pako`, so the self-contained UMD build is vendored instead.
- **Noto Sans Regular** covers German umlauts (ä ö ü Ä Ö Ü) and ß, which is
  required for the invisible text layer in the exported PDF.
- To update a library: download the exact file from the source URL above,
  replace the vendored file, and update the version in this table.
