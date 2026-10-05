// cornerEditor.js – canvas overlay with four draggable corner
// handles and a magnifier loupe.
//
// Coordinate systems:
//   * image coords: pixels of the ORIGINAL working image
//     (the page model's corner space)
//   * display coords: CSS pixels on the canvas (the canvas is
//     sized to its CSS box * devicePixelRatio; the context is
//     scaled by dpr so all drawing happens in CSS px)
//   * the image is drawn "contain"-fitted, so a fit transform
//     (scale + offset) maps between the two spaces.

const HANDLE_RADIUS = 22; // 44 px hit area (touch target)
const LOUPE_RADIUS = 70;  // loupe circle radius (CSS px)
const LOUPE_ZOOM = 3;     // loupe magnification
const LOUPE_OFFSET = 95;  // loupe offset from the finger (CSS px)

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// A quad is usable if it is convex (all consecutive-edge cross
// products share a sign) and has a non-zero area.
export function isConvexQuad(corners) {
  if (!corners || corners.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return sign !== 0;
}

export class CornerEditor {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.image = null;       // ImageBitmap
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.corners = null;     // [{x,y} TL, TR, BR, BL] in image coords
    this.dragIndex = -1;
    this.pointerPos = null;  // display coords of the active pointer
    this.dpr = window.devicePixelRatio || 1;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
  }

  destroy() {
    this.resizeObserver.disconnect();
    if (this.image) this.image.close();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.draw();
  }

  async setImage(bitmap) {
    if (this.image) this.image.close();
    this.image = bitmap;
    this.imageWidth = bitmap.width;
    this.imageHeight = bitmap.height;
    this.resize();
  }

  setCorners(corners) {
    this.corners = corners.map((c) => ({ ...c }));
    this.draw();
  }

  getCorners() {
    return this.corners ? this.corners.map((c) => ({ ...c })) : null;
  }

  // Fit transform: image drawn "contain" inside the canvas.
  computeFit() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const scale = Math.min(cssW / this.imageWidth, cssH / this.imageHeight);
    return {
      scale,
      offsetX: (cssW - this.imageWidth * scale) / 2,
      offsetY: (cssH - this.imageHeight * scale) / 2,
      cssW,
      cssH,
    };
  }

  toImageCoords(dx, dy) {
    const f = this.computeFit();
    return { x: (dx - f.offsetX) / f.scale, y: (dy - f.offsetY) / f.scale };
  }

  toDisplayCoords(ix, iy) {
    const f = this.computeFit();
    return { x: ix * f.scale + f.offsetX, y: iy * f.scale + f.offsetY };
  }

  // Display coords of a pointer event (relative to the canvas).
  eventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  handleAt(pos) {
    if (!this.corners) return -1;
    let best = -1;
    let bestDist = HANDLE_RADIUS;
    this.corners.forEach((c, i) => {
      const d = this.toDisplayCoords(c.x, c.y);
      const dist = Math.hypot(d.x - pos.x, d.y - pos.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  onPointerDown(e) {
    if (!this.corners) return;
    const pos = this.eventPos(e);
    const idx = this.handleAt(pos);
    if (idx === -1) return;
    e.preventDefault();
    this.dragIndex = idx;
    this.pointerPos = pos;
    this.canvas.setPointerCapture(e.pointerId);
    this.draw();
  }

  onPointerMove(e) {
    if (this.dragIndex === -1) return;
    e.preventDefault();
    const pos = this.eventPos(e);
    this.pointerPos = pos;
    const img = this.toImageCoords(pos.x, pos.y);
    // Clamp to the image bounds.
    img.x = Math.max(0, Math.min(this.imageWidth, img.x));
    img.y = Math.max(0, Math.min(this.imageHeight, img.y));
    this.corners[this.dragIndex] = img;
    this.draw();
    this.onChange(this.getCorners());
  }

  onPointerUp(e) {
    if (this.dragIndex === -1) return;
    this.dragIndex = -1;
    this.pointerPos = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const rect = this.canvas.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!this.image || !this.corners) return;

    const f = this.computeFit();

    // Image.
    ctx.save();
    ctx.translate(f.offsetX, f.offsetY);
    ctx.scale(f.scale, f.scale);
    ctx.drawImage(this.image, 0, 0);
    ctx.restore();

    // Dim everything outside the quadrilateral (even-odd fill).
    const [tl, tr, br, bl] = this.corners.map((c) => this.toDisplayCoords(c.x, c.y));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rect.width, rect.height);
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill('evenodd');
    ctx.restore();

    // Quad outline.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Corner handles (large touch targets).
    this.corners.forEach((c, i) => {
      const d = this.toDisplayCoords(c.x, c.y);
      ctx.save();
      ctx.beginPath();
      ctx.arc(d.x, d.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = i === this.dragIndex ? 'rgba(26, 115, 232, 0.9)' : 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1a73e8';
      ctx.stroke();
      ctx.restore();
    });

    // Loupe while dragging: a magnified circle offset away from
    // the finger so the corner stays visible.
    if (this.dragIndex !== -1 && this.pointerPos) {
      this.drawLoupe(this.corners[this.dragIndex]);
    }
  }

  drawLoupe(corner) {
    const ctx = this.ctx;
    const f = this.computeFit();
    const rect = this.canvas.getBoundingClientRect();
    // Loupe center: offset from the finger, away from the
    // corner, so it never sits under the finger.
    let cx = this.pointerPos.x + (corner.x * f.scale + f.offsetX < this.pointerPos.x ? LOUPE_OFFSET : -LOUPE_OFFSET);
    let cy = this.pointerPos.y + (corner.y * f.scale + f.offsetY < this.pointerPos.y ? LOUPE_OFFSET : -LOUPE_OFFSET);
    // Keep the loupe fully inside the canvas.
    cx = Math.max(LOUPE_RADIUS, Math.min(rect.width - LOUPE_RADIUS, cx));
    cy = Math.max(LOUPE_RADIUS, Math.min(rect.height - LOUPE_RADIUS, cy));

    // Region of the image visible in the loupe (image coords).
    const regionDisplay = (2 * LOUPE_RADIUS) / LOUPE_ZOOM; // display px
    const regionImage = regionDisplay / f.scale;             // image px
    const half = regionImage / 2;
    // Clamp the source rect to the image bounds.
    const sx = Math.max(0, Math.min(this.imageWidth - regionImage, corner.x - half));
    const sy = Math.max(0, Math.min(this.imageHeight - regionImage, corner.y - half));

    ctx.save();
    // Circle clip.
    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    // Magnified image region.
    ctx.drawImage(
      this.image,
      sx, sy, regionImage, regionImage,
      cx - LOUPE_RADIUS, cy - LOUPE_RADIUS, 2 * LOUPE_RADIUS, 2 * LOUPE_RADIUS
    );
    ctx.restore();

    // Crosshair at the exact corner position.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy + 12);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1a73e8';
    ctx.stroke();
    ctx.restore();
  }
}
