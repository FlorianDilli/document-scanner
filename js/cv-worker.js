// cv-worker.js – dedicated Web Worker for all OpenCV work.
// Loaded via `new Worker('./js/cv-worker.js')`; OpenCV.js is pulled in
// with importScripts (relative to THIS file: ../vendor/opencv.js).
//
// Message protocol (ArrayBuffers are transferred, not copied):
//   {type:'init'}                              -> {type:'ready'}
//   {type:'detect',  id, data, width, height}  -> {type:'detect-done',  id, corners}
//   {type:'warp',    id, data, width, height, corners}
//                                            -> {type:'warp-done',    id, data, width, height}
//   {type:'filter',  id, data, width, height, filter, params}
//                                            -> {type:'filter-done',  id, data, width, height}
//   {type:'rotate',  id, data, width, height, angle}
//                                            -> {type:'rotate-done',  id, data, width, height}
//
// Memory safety: every cv.Mat / MatVector / Size is tracked and .delete()d
// in a finally block. Leaks crash mobile browsers after a few pages.

importScripts('../vendor/opencv.js');

// ---------- OpenCV initialization ----------
// Depending on the build, `cv` is a plain object with an
// onRuntimeInitialized hook, or a Promise/factory. Handle both and
// resolve only when cv.Mat is actually usable.
function isCvReady() {
  try {
    // mat_clone is attached to the prototype by the official build's
    // onRuntimeInitialized handler, so it is a reliable readiness signal.
    return typeof cv.Mat === 'function' && typeof cv.Mat.prototype.mat_clone === 'function';
  } catch (e) {
    return false;
  }
}

function loadOpenCV() {
  return new Promise((resolve, reject) => {
    if (typeof cv === 'undefined') {
      reject(new Error('cv global missing'));
      return;
    }
    if (isCvReady()) {
      resolve();
      return;
    }
    // Promise/factory style build. NOTE: resolve with a plain
    // value, never with `cv` itself – `cv` is a thenable, and
    // resolving a native Promise with it makes the Promise
    // machinery call cv.then() again to assimilate it, which
    // deadlocks the emscripten runtime.
    if (typeof cv.then === 'function') {
      cv.then(() => resolve(), reject);
      return;
    }
    // Callback style: assign onRuntimeInitialized, plus a
    // poll in case the callback already fired or never fires.
    const prev = cv.onRuntimeInitialized;
    let settled = false;
    let timer;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (ok) resolve();
      else reject(new Error('OpenCV init timeout'));
    };
    cv.onRuntimeInitialized = () => {
      if (prev) prev();
      finish(isCvReady());
    };
    timer = setInterval(() => {
      if (isCvReady()) finish(true);
    }, 50);
    setTimeout(() => finish(false), 30000);
  });
}

// ---------- Mat tracking (leak prevention) ----------
function track() {
  const mats = [];
  return {
    add(m) { mats.push(m); return m; },
    cleanup() {
      while (mats.length) {
        const m = mats.pop();
        try { m.delete(); } catch (e) { /* already deleted */ }
      }
    },
  };
}

// ---------- Helpers ----------

// Detected outlines are shrunk toward their centroid by this
// fraction before they are handed to the editor. Contours
// typically follow the page edge within a few pixels and often
// catch a sliver of the surrounding background (blur,
// morphological close), so the selection forwarded on apply is
// made slightly smaller than the raw detection to keep edge
// artifacts (a bit of the table, shadows) out of the crop.
// 0.02 shrinks each corner 2% toward the center, i.e. ~1%
// inset per edge.
const DETECT_INSET = 0.02;

// Shrink a quadrilateral toward its centroid by `factor`
// (0..1). A homothety preserves convexity and corner order,
// so the result stays a valid crop selection.
function shrinkQuad(corners, factor) {
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const k = 1 - factor;
  return corners.map((c) => ({
    x: cx + (c.x - cx) * k,
    y: cy + (c.y - cy) * k,
  }));
}

// Order 4 points as TL, TR, BR, BL:
// TL = smallest x+y, BR = largest x+y, TR = smallest y-x, BL = largest y-x.
function orderCorners(pts) {
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  for (const p of pts) {
    const s = p.x + p.y;
    const d = p.y - p.x;
    if (s < minSum) { minSum = s; tl = p; }
    if (s > maxSum) { maxSum = s; br = p; }
    if (d < minDiff) { minDiff = d; tr = p; }
    if (d > maxDiff) { maxDiff = d; bl = p; }
  }
  return [tl, tr, br, bl];
}

// Search contours for the best page-like quadrilateral.
// Returns ordered corners or null. `epsilons` are the
// approxPolyDP epsilon factors tried per contour (as a
// fraction of the contour perimeter).
function findQuad(contours, width, height, epsilons) {
  const imgArea = width * height;
  const candidates = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    candidates.push({ c, area: cv.contourArea(c) });
  }
  candidates.sort((a, b) => b.area - a.area);
  for (const { c, area } of candidates.slice(0, 10)) {
    if (area < 0.2 * imgArea) break; // sorted desc: nothing bigger will come
    if (area > 0.98 * imgArea) continue; // the full-image frame itself
    const peri = cv.arcLength(c, true);
    let quad = null;
    for (const eps of epsilons) {
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, eps * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts = [];
        for (let j = 0; j < 4; j++) {
          const ptr = approx.intPtr(j);
          pts.push({ x: ptr[0], y: ptr[1] });
        }
        quad = orderCorners(pts);
      }
      approx.delete();
      if (quad) break;
    }
    c.delete();
    if (quad) {
      // Free the remaining candidates.
      for (const { c: cc } of candidates) {
        try { cc.delete(); } catch (e) { /* already deleted */ }
      }
      return quad;
    }
  }
  // cleanup remaining candidates
  for (const { c } of candidates) {
    try { c.delete(); } catch (e) { /* already deleted */ }
  }
  return null;
}

// Search for the best page-like quadrilateral.
// Multiple strategies because no single approach works on
// all photos:
//   1. Canny edges (two threshold pairs) + morphological
//      close to join broken edges – works on clean edges.
//   2. Otsu threshold, bright foreground (THRESH_BINARY) –
//      the common case: a bright page on a darker desk.
//   3. Otsu threshold, dark foreground (THRESH_BINARY_INV) –
//      a dark page on a bright background.
// For each strategy, contours are sorted by area and the
// top ~10 are checked for a convex 4-point polygon whose
// area is 20-98% of the image. Several approxPolyDP
// epsilons are tried per contour.
function contourSearch(grayBlurred, width, height) {
  const t = track();
  try {
    const epsilons = [0.01, 0.02, 0.03, 0.05];
    const closeKernel = t.add(
      cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
    );

    // Strategy 1: Canny edges.
    for (const [lo, hi] of [[50, 150], [30, 100], [80, 200]]) {
      const edges = t.add(new cv.Mat());
      cv.Canny(grayBlurred, edges, lo, hi);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, closeKernel);
      const contours = t.add(new cv.MatVector());
      const hierarchy = t.add(new cv.Mat());
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const quad = findQuad(contours, width, height, epsilons);
      if (quad) return quad;
    }

    // Strategies 2 & 3: Otsu threshold, both polarities.
    for (const mode of [cv.THRESH_BINARY, cv.THRESH_BINARY_INV]) {
      const thresh = t.add(new cv.Mat());
      cv.threshold(grayBlurred, thresh, 0, 255, mode + cv.THRESH_OTSU);
      cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, closeKernel);
      const contours = t.add(new cv.MatVector());
      const hierarchy = t.add(new cv.Mat());
      cv.findContours(thresh, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const quad = findQuad(contours, width, height, epsilons);
      if (quad) return quad;
    }

    return null;
  } finally {
    t.cleanup();
  }
}

// ---------- Message handlers ----------

function handleDetect(msg) {
  const t = track();
  try {
    const { width, height } = msg;
    const src = t.add(new cv.Mat(height, width, cv.CV_8UC4));
    // The Mat constructor's 4th arg is a fill Scalar, not raw
    // data – copy the pixels into the wasm heap explicitly.
    src.data.set(msg.data);
    const gray = t.add(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const blurred = t.add(new cv.Mat());
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    let corners = contourSearch(blurred, width, height);
    let detected = true;
    if (!corners) {
      // Fallback: rectangle inset ~5% from the borders. The UI shows a
      // hint that the document was not detected automatically.
      detected = false;
      const mx = Math.round(width * 0.05);
      const my = Math.round(height * 0.05);
      corners = [
        { x: mx, y: my },
        { x: width - mx, y: my },
        { x: width - mx, y: height - my },
        { x: mx, y: height - my },
      ];
    } else {
      // Safety inset so no background artifacts remain
      // at the edges of the cropped document.
      corners = shrinkQuad(corners, DETECT_INSET);
    }
    return { type: 'detect-done', id: msg.id, corners, detected };
  } finally {
    t.cleanup();
  }
}

// Output size from the quadrilateral, long-edge cap.
function computeOutputSize(corners) {
  const [tl, tr, br, bl] = corners;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  // Cap the long edge to 3508 px (A4 at 300 DPI).
  const longEdge = Math.max(w, h);
  if (longEdge > 3508) {
    const s = 3508 / longEdge;
    w *= s; h *= s;
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

function handleWarp(msg) {
  const t = track();
  try {
    const { width, height, corners } = msg;
    const src = t.add(new cv.Mat(height, width, cv.CV_8UC4));
    // The Mat constructor's 4th arg is a fill Scalar, not raw
    // data – copy the pixels into the wasm heap explicitly.
    src.data.set(msg.data);
    const out = computeOutputSize(corners);
    const srcTri = t.add(cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y,
    ]));
    const dstTri = t.add(cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, out.width, 0, out.width, out.height, 0, out.height,
    ]));
    const M = t.add(cv.getPerspectiveTransform(srcTri, dstTri));
    const dst = t.add(new cv.Mat(out.height, out.width, cv.CV_8UC4));
    cv.warpPerspective(src, dst, M, new cv.Size(out.width, out.height), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
    // Copy out of the wasm heap: the wasm memory itself cannot be transferred.
    const data = new Uint8ClampedArray(dst.data);
    return { type: 'warp-done', id: msg.id, data, width: out.width, height: out.height };
  } finally {
    t.cleanup();
  }
}

function handleFilter(msg) {
  const t = track();
  try {
    const { width, height, filter, params } = msg;
    const src = t.add(new cv.Mat(height, width, cv.CV_8UC4));
    // The Mat constructor's 4th arg is a fill Scalar, not raw
    // data – copy the pixels into the wasm heap explicitly.
    src.data.set(msg.data);
    let work;
    // Two modes: 'original' (untouched photo) and 'document' – the one
    // cleanup mode (grayscale, flattened background, sharp text). The
    // former grayscale/bw looks are reached via the contrast slider:
    // raising contrast on the flattened image drives it near-binary.
    // 'gray', 'bw' and 'enhance' are legacy filter ids from before the
    // unification; persisted pages carrying them render as document
    // (storage.js additionally maps them on load, so the edit view's
    // chip selection matches).
    switch (filter) {
      case 'document':
      case 'gray':
      case 'bw':
      case 'enhance': {
        // Clean-up look, tuned on real phone photos:
        //
        // 1. Background estimate with a MEDIAN blur (kernel ~4% of the
        //    long edge): the median ignores dark ink (strokes, redaction
        //    bars) and follows the illumination.
        // 2. Guarded divide: gray*255/bg flattens shadows and paper tint
        //    (paper -> pure white). The guard keeps pixels untouched where
        //    the estimate is dark (bg < 120: inside fat ink or deep shadow)
        //    – there the division would brighten ink into gray "holes".
        //    The divide is written as an explicit JS loop: values are
        //    clamped to 0..255 by hand (Uint8Array writes wrap modulo 256
        //    instead of saturating like cv.divide does).
        // 3. Fixed document levels (black 30 -> 0, white 238 -> 255):
        //    content-independent so the look is identical page to page;
        //    exposure variance is already removed by step 2, and a
        //    histogram-based stretch (vendored calcHist) would be fragile.
        // 4. Light unsharp mask (sigma 1.2, amount 0.5) for crisp strokes.
        const gray = t.add(new cv.Mat());
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        const longEdge = Math.max(width, height);
        let k = Math.round(longEdge * 0.04);
        if (k % 2 === 0) k += 1;
        k = Math.max(31, k);
        const bg = t.add(new cv.Mat());
        cv.medianBlur(gray, bg, k);
        const divided = t.add(new cv.Mat(height, width, cv.CV_8U));
        {
          const g = gray.data, b = bg.data, o = divided.data;
          for (let p = 0; p < o.length; p++) {
            const bb = b[p];
            o[p] = bb < 120 ? g[p] : Math.min(255, (g[p] * 255 / bb) | 0);
          }
        }
        const lut = t.add(new cv.Mat(1, 256, cv.CV_8U));
        const LEV_LO = 30, LEV_HI = 238;
        for (let v = 0; v < 256; v++) {
          const walked = v < LEV_LO ? 0 : Math.round(((v - LEV_LO) / (LEV_HI - LEV_LO)) * 255);
          lut.data[v] = Math.min(255, walked);
        }
        const leveled = t.add(new cv.Mat());
        cv.LUT(divided, lut, leveled);
        const blurred = t.add(new cv.Mat());
        cv.GaussianBlur(leveled, blurred, new cv.Size(0, 0), 1.2);
        const sharp = t.add(new cv.Mat());
        cv.addWeighted(leveled, 1.5, blurred, -0.5, 0, sharp);
        work = t.add(new cv.Mat());
        cv.cvtColor(sharp, work, cv.COLOR_GRAY2RGBA);
        break;
      }
      case 'original':
      default: {
        work = t.add(src.clone());
        break;
      }
    }
    // Brightness / contrast. Contrast must pivot around mid-gray
    // (out = (v - 127.5) * alpha + 127.5), not around 0: a pure gain
    // pushes near-white pages toward saturation exactly like a
    // brightness lift, making both sliders behave identically on
    // document scans. The pivot folds into beta: convertTo applies
    // src * alpha + beta.
    const alpha = 1 + (params.contrast || 0) / 100;
    const beta = (params.brightness || 0) * 1.27; // +/-100 -> +/-127
    if (alpha !== 1 || beta !== 0) {
      const adjusted = t.add(new cv.Mat());
      work.convertTo(adjusted, -1, alpha, 127.5 * (1 - alpha) + beta);
      work = adjusted;
    }
    // Sharpen: unsharp mask, strength from slider.
    const sharpen = (params.sharpen || 0) / 100;
    if (sharpen > 0) {
      const blurred = t.add(new cv.Mat());
      cv.GaussianBlur(work, blurred, new cv.Size(0, 0), 1.5);
      const sharp = t.add(new cv.Mat());
      cv.addWeighted(work, 1 + 1.5 * sharpen, blurred, -1.5 * sharpen, 0, sharp);
      work = sharp;
    }
    const data = new Uint8ClampedArray(work.data);
    return { type: 'filter-done', id: msg.id, data, width, height };
  } finally {
    t.cleanup();
  }
}

function handleRotate(msg) {
  const t = track();
  try {
    const { width, height, angle } = msg;
    const src = t.add(new cv.Mat(height, width, cv.CV_8UC4));
    // The Mat constructor's 4th arg is a fill Scalar, not raw
    // data – copy the pixels into the wasm heap explicitly.
    src.data.set(msg.data);
    const dst = t.add(new cv.Mat());
    const code = angle === 90 ? cv.ROTATE_90_CLOCKWISE
      : angle === 180 ? cv.ROTATE_180
        : cv.ROTATE_90_COUNTERCLOCKWISE;
    cv.rotate(src, dst, code);
    const data = new Uint8ClampedArray(dst.data);
    return { type: 'rotate-done', id: msg.id, data, width: dst.cols, height: dst.rows };
  } finally {
    t.cleanup();
  }
}

const handlers = {
  detect: handleDetect,
  warp: handleWarp,
  filter: handleFilter,
  rotate: handleRotate,
};

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    loadOpenCV()
      .then(() => self.postMessage({ type: 'ready' }))
      .catch((err) => self.postMessage({ type: 'error', error: String(err && err.message || err) }));
    return;
  }
  try {
    const handler = handlers[msg.type];
    if (!handler) throw new Error('unknown message type: ' + msg.type);
    const result = handler(msg);
    // Transfer the output buffer to avoid a copy (only when the
    // result actually carries pixel data).
    if (result.data) {
      self.postMessage(result, [result.data.buffer]);
    } else {
      self.postMessage(result);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message || err) });
  }
};
