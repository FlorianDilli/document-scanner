# Dokumenten-Scanner (Document Scanner PWA)

A free, private, fully client-side document scanner. It runs as static files
on **GitHub Pages** — no backend, no accounts, no analytics, no network calls
after the first load. Photos are processed entirely in the browser:

- Add pages via the **camera** or the **gallery** (multi-select)
- **Automatic document detection** (largest page-like quadrilateral) with
  draggable corner fine-tuning (incl. magnifier loupe)
- **Perspective correction** (warp to a flat, upright rectangle)
- **Filters**: Photo (untouched) and Document (grayscale, flattened
  background, sharp text; drive the contrast slider up for a hard
  black-and-white look) + sharpen, brightness, contrast
- **OCR** (German + English) → invisible but **selectable/searchable text**
  layer in the PDF
- **Multi-page A4 PDF** export (Web Share API on mobile, download fallback)
- **Offline** after the first visit, installable to the home screen (PWA)
- UI language: **German by default**, English available (header button)

## Run locally

Opening `index.html` directly via `file://` will not work: browsers block ES
module scripts (CORS) and, with the app's CSP, also stylesheets on `file://`
pages. Serve the folder over HTTP instead:

    python3 -m http.server 8000

then open http://localhost:8000/. Any static server works (`npx serve`, …);
Python's built-in one already sends the correct MIME types
(`text/javascript`, `application/wasm`).

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. Repository **Settings → Pages → Build and deployment → Source**:
   select **Deploy from a branch**, branch `main` (or `master`), folder `/ (root)`.
3. The app is then available at `https://<user>.github.io/<repo>/`.

All paths are relative (`./vendor/...`), so the app works under any subpath
(`/repo/`). No server configuration is needed.

## How it works

```
index.html            app shell (CSP meta tag, views)
css/app.css           styles (dark/light via prefers-color-scheme)
js/main.js            bootstrap, navigation, PWA install/update
js/state.js           page list model + pub/sub (only global state)
js/storage.js         IndexedDB persistence (blobs + metadata)
js/i18n.js            all UI strings (de/en)
js/ui.js              toast / busy / confirm helpers
js/icons.js           inline SVG icon set (no external assets)
js/pageOps.js         page actions shared by views (delete + undo)
js/camera.js          live camera capture, EXIF decode, downscaling
js/pipeline.js        original → warp → rotate → filter (with caches)
js/cv-worker.js       OpenCV worker: detect, warp, filter, rotate
js/cvClient.js        promise wrapper around the worker (transferables)
js/cornerEditor.js    draggable corners + loupe (Pointer Events)
js/ocr.js             Tesseract.js wrapper (one reused worker)
js/pdf.js             A4 PDF with invisible text layer (pdf-lib + fontkit)
js/views/home.js      page grid, import, drag-&-drop reorder, delete w/ undo
js/views/pageEditor.js  single page editor: Frame (crop) + Look (filters/rotate)
js/views/export.js    export view
vendor/               all third-party code (see vendor/README.md)
icons/                PWA icons (192 / 512 / maskable)
sw.js                 service worker (precache + cache-first for vendor/)
manifest.webmanifest  PWA manifest (relative start_url/scope)
```

**Pipeline (non-destructive):** `original → warp(corners) → rotate →
filter(params) → [OCR] → PDF`. The original photo is never modified; warped
and filtered results are cached in memory for fast filter switching and are
invalidated automatically when their inputs change.

**Detection inset:** a detected outline is shrunk ~1% per side toward its
center before it reaches the corner editor, so the selection forwarded on
"apply" is slightly smaller than the raw detection and no background
artifacts (a sliver of the table, shadows) remain at the edges of the
cropped document. Corners can still be dragged outward.

**Missed detection:** detection runs exactly once per page (on import) and
is deterministic on the photo — a retry cannot produce a different result.
When no page edges are found — or the page fills the whole photo — the
frame falls back to the full photo (dashed outline, "check frame" badge on the page card for hard failures) and the
"Detect again" button is greyed out as "No edges detected": there are no
exact page edges to re-find. Committing a manually changed frame clears
the flag.

**Threading:** all OpenCV work runs in a dedicated Web Worker (pixel buffers
are transferred, not copied). Tesseract.js runs in its own worker (one
instance, reused, terminated after 2 minutes idle). The UI thread stays
responsive; progress/spinners are shown for detect, warp, OCR and export.

**Memory:** phone photos are downscaled so the long edge is at most 4000 px
(iOS Safari canvas limits). Detection runs on a ~1000 px copy; previews on a
~800 px copy; the full resolution (capped at 3508 px, A4 @ 300 DPI) is only
rendered at export time. Every OpenCV `Mat` is `.delete()`d in `finally`
blocks.

## Updating vendored libraries

See `vendor/README.md` for the pinned versions, source URLs and licenses.
To update: download the exact file from the source URL, replace the vendored
file, and update the version table. Never load anything from a CDN at
runtime — the CSP (`default-src 'self'`) blocks it.

## Known limitations and deliberate deviations

- **Offline precaching:** the service worker precaches the app shell and all
  of `vendor/` (~63 MB) file-by-file at install, each inside `try/catch`, so
  a single failure (e.g. a huge file on a slow connection) never aborts the
  install. Anything missed is cached on first use (cache-first runtime
  handler). The app always works online; full offline support kicks in after
  the large files have been cached (first scan / first OCR). This follows the
  brief's allowance to lazy-load OpenCV/Tesseract on first need.
- **Invisible text layer:** implemented with `opacity: 0` in `drawText`
  (verified: text is selectable/searchable in Chrome's PDF viewer, Firefox
  pdf.js, macOS Preview and iOS Files; the PDF contains a ToUnicode CMap and
  an ExtGState with `/ca 0`).
- **No cross-origin isolation:** GitHub Pages cannot set COOP/COEP headers,
  so `SharedArrayBuffer` and multi-threaded wasm are not used anywhere
  (single-threaded OpenCV.js and Tesseract builds).
- **Live camera preview with real-time outline, OSD auto-rotation and batch
  export of selected pages** (step 7 of the build order) are not included in
  v1; native camera capture and manual rotation are used instead.
- **HEIC:** iOS Safari converts HEIC to JPEG when using the file input;
  decode failures show a clear error message.

## Debug mode

Append `?debug=1` to the URL to log timings of the detect / warp / filter /
OCR / PDF steps to the console.

## Licenses

All vendored libraries are open-source (BSD-3, Apache-2.0, MIT, SIL-OFL);
see `vendor/README.md` for the full list with versions, source URLs and
licenses.
