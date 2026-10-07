// sw.js – service worker: precache the app shell and all
// vendored files, then cache-first for vendor/ and
// stale-while-revalidate for app code.
//
// Robustness rules:
//   * Each precache file is fetched individually inside
//     try/catch, so one failure (e.g. a huge file on a
//     slow connection) never aborts the whole install –
//     whatever was cached stays cached, and anything
//     missed is picked up by the runtime cache-first
//     handler on first use. The app always works online.
//   * The cache name is versioned; old caches are
//     deleted on activate.

const CACHE = 'scanner-v14';

// App shell + small vendor files (precached at install).
const PRECACHE = [
  './',
  './index.html',
  './css/app.css',
  './js/main.js',
  './js/state.js',
  './js/storage.js',
  './js/pageOps.js',
  './js/icons.js',
  './js/i18n.js',
  './js/ui.js',
  './js/camera.js',
  './js/pipeline.js',
  './js/cvClient.js',
  './js/cv-worker.js',
  './js/cornerEditor.js',
  './js/ocr.js',
  './js/pdf.js',
  './js/views/home.js',
  './js/views/pageEditor.js',
  './js/views/export.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/logo.svg',
  './vendor/pdf-lib/pdf-lib.min.js',
  './vendor/pdf-lib/fontkit.umd.min.js',
  './vendor/fonts/NotoSans-Regular.ttf',
  // Large vendor files (OpenCV ~11 MB, Tesseract core
  // ~43 MB, tessdata ~5.6 MB) are precached too, but
  // each file is optional (see install handler).
  './vendor/opencv.js',
  './vendor/tesseract/tesseract.esm.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/core/tesseract-core.wasm.js',
  './vendor/tesseract/core/tesseract-core.wasm',
  './vendor/tesseract/core/tesseract-core-simd.wasm.js',
  './vendor/tesseract/core/tesseract-core-simd.wasm',
  './vendor/tesseract/core/tesseract-core-relaxedsimd.wasm.js',
  './vendor/tesseract/core/tesseract-core-relaxedsimd.wasm',
  './vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/core/tesseract-core-lstm.wasm',
  './vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/core/tesseract-core-simd-lstm.wasm',
  './vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  './vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm',
  './vendor/tesseract/tessdata/deu.traineddata',
  './vendor/tesseract/tessdata/eng.traineddata',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of PRECACHE) {
        try {
          await cache.add(url);
        } catch (err) {
          // Optional: the runtime handler below caches
          // the file on first use instead.
          console.warn('[sw] precache failed:', url, err);
        }
      }
    })
    // Deliberately NO auto-skipWaiting here: a new version takes
    // over only when the user accepts the update banner, so an
    // update can never reload the app while they are mid-flow
    // (e.g. during an import).
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.map((name) =>
            name === CACHE ? Promise.resolve() : caches.delete(name)
          )
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Vendor files are immutable (versioned by the cache
  // name): cache-first, populate on miss.
  if (url.pathname.indexOf('/vendor/') !== -1) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // App shell: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
