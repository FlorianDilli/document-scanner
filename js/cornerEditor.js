// cornerEditor.js – canvas overlay with four draggable corner
// handles and a magnifier loupe.
//
// Coordinate systems:
//   * image coords: pixels of the ORIGINAL working image (the page
//     model's corner space). The corners live here, so they stay on
//     the same physical points of the photo when it is turned.
//   * display coords: CSS pixels on the canvas (the canvas is sized
//     to its CSS box * devicePixelRatio; the context is scaled by dpr
//     so all drawing happens in CSS px)
//   * the image is drawn "contain"-fitted, so a fit transform
//     (scale + offset) maps between the two spaces.
//   * the photo can be turned. `rotation` is the target (0 | 90 |
//     180 | 270, clockwise, same as the page rotation); `angle` is
//     the angle currently on screen. The two differ while a turn
//     animates, so the photo can spin smoothly from one quarter
//     turn to the next.

const HANDLE_RADIUS = 22; // 44 px hit area (touch target)
const KNOB_RADIUS = 12;   // drawn corner dot (CSS px)
const KNOB_GAP = 5;       // empty space between the outline and the dot
const LOUPE_RADIUS = 70;  // loupe circle radius (CSS px)
const LOUPE_ZOOM = 3;     // loupe magnification
const LOUPE_OFFSET = 95;  // loupe offset from the finger (CSS px)
const MOVE_MS = 200;      // corner move animation
export const TURN_MS = 380; // rotation animation
const ANIM_QUALITY = 0.7; // canvas resolution while an animation runs

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

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Ease-out cubic: fast at the start, gentle landing.
function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Ease-in-out cubic: the turn eases in and out, so the photo neither
// lunges at the start nor crawls at the end.
function easeInOut(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class CornerEditor {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.image = null;       // ImageBitmap (original orientation)
    this.origWidth = 0;      // original bitmap size
    this.origHeight = 0;
    this.rotation = 0;       // target rotation: 0 | 90 | 180 | 270, clockwise
    this.angle = 0;          // angle on screen (degrees, clockwise)
    this.corners = null;     // [{x,y} TL, TR, BR, BL] in original image coords
    this.guess = false;      // dashed outline while the frame is an unverified auto-detection
    this.dragIndex = -1;
    this.pointerPos = null;  // display coords of the active pointer
    this.dpr = window.devicePixelRatio || 1;
    this.turnFrame = null;   // rAF of the running rotation animation
    this.turnTo = null;      // target angle of the running rotation animation
    this.turnScale = null;   // scale while the turn runs (null = fit the angle)
    this.moveFrame = null;   // rAF of the running corner move animation
    this.moveTo = null;      // target corners of the running corner move animation
    this.sprite = null;      // display-sized copy of the photo
    this.spriteKey = '';     // size the sprite was built for
    this.quality = 1;        // canvas resolution factor (lower while animating)
    this.drawDpr = 1;        // device pixel ratio the canvas is drawn with

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
  }

  destroy() {
    this.cancelTurn();
    this.cancelMove();
    this.resizeObserver.disconnect();
    if (this.image) this.image.close();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.applyCanvasSize();
    this.buildSprite();
    this.draw();
  }

  // The canvas backing store. While an animation runs it is scaled
  // down: a quarter of the pixels means a quarter of the fill and
  // blit work per frame, which is what makes a turn smooth on
  // phones. The full resolution comes back when it ends.
  applyCanvasSize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.dpr * this.quality;
    this.drawDpr = dpr;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    this.applyCanvasSize();
    // The new backing store starts out empty – repaint at once so
    // the stage never flashes blank.
    this.draw();
  }

  // A display-sized copy of the photo. Drawing the original bitmap
  // every frame means the browser resamples the full photo (megapiles)
  // per frame – far too slow on phones, and it is what made the
  // rotation stutter. The copy is downscaled once, then blitted.
  buildSprite() {
    if (!this.image) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // The photo reaches its largest scale in one of its two
    // orientations – the sprite is built for that one, so a turned
    // photo never has to be upscaled (and stays sharp while it
    // spins).
    const s0 = Math.max(
      Math.min(rect.width / this.origWidth, rect.height / this.origHeight),
      Math.min(rect.width / this.origHeight, rect.height / this.origWidth)
    );
    const w = Math.max(1, Math.round(this.origWidth * s0 * this.dpr));
    const h = Math.max(1, Math.round(this.origHeight * s0 * this.dpr));
    const key = `${w}x${h}`;
    if (key === this.spriteKey && this.sprite) return;
    if (!this.sprite) this.sprite = document.createElement('canvas');
    this.sprite.width = w;
    this.sprite.height = h;
    const sctx = this.sprite.getContext('2d');
    sctx.imageSmoothingQuality = 'medium';
    sctx.drawImage(this.image, 0, 0, w, h);
    this.spriteKey = key;
  }

  async setImage(bitmap, rotation = 0) {
    this.cancelTurn();
    this.cancelMove();
    if (this.image) this.image.close();
    this.image = bitmap;
    this.origWidth = bitmap.width;
    this.origHeight = bitmap.height;
    this.rotation = ((Math.round(rotation) % 360) + 360) % 360;
    // A new photo appears at its stored orientation – no animation.
    this.angle = this.rotation;
    this.spriteKey = '';
    this.buildSprite();
    this.resize();
  }

  // Turns the photo to a new quarter turn. The corners stay on the
  // same physical points of the photo, so the frame turns with it.
  setRotation(rotation) {
    const target = ((Math.round(rotation) % 360) + 360) % 360;
    if (!this.image) {
      this.rotation = target;
      this.angle = target;
      return;
    }
    // A turn is always a single quarter turn – the shorter way round.
    const delta = ((target - this.rotation + 540) % 360) - 180;
    this.rotation = target;
    if (delta === 0) {
      // Already there (or already on the way): let the running
      // animation finish instead of snapping.
      if (!this.turnFrame) {
        this.angle = target;
        this.draw();
      }
      return;
    }
    this.animateAngle(this.angle, this.angle + delta);
  }

  // Spins the photo from `from` to `to` degrees (clockwise).
  animateAngle(from, to, duration = TURN_MS) {
    if (prefersReducedMotion()) {
      this.cancelTurn();
      this.angle = to;
      this.turnScale = null;
      this.draw();
      return;
    }
    this.cancelTurn();
    this.turnTo = to;
    // The photo keeps its size while it turns: the scale glides from
    // the fit of the start orientation to the fit of the end one.
    // The plain "fit of the current angle" would shrink the photo
    // towards the middle of the turn (a turned rectangle needs more
    // room) and blow it up again – the photo would breathe.
    const scaleFrom = this.containScale(from);
    const scaleTo = this.containScale(to);
    this.setQuality(ANIM_QUALITY);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOut(t);
      this.angle = from + (to - from) * e;
      this.turnScale = scaleFrom + (scaleTo - scaleFrom) * e;
      this.draw();
      if (t < 1) {
        this.turnFrame = requestAnimationFrame(step);
      } else {
        this.turnFrame = null;
        this.turnTo = null;
        this.angle = to;
        this.turnScale = null;
        this.restoreQuality();
        this.draw();
      }
    };
    this.turnFrame = requestAnimationFrame(step);
  }

  // `corners` are in ORIGINAL image coords.
  setCorners(corners) {
    this.cancelMove();
    this.corners = corners.map((c) => ({ x: c.x, y: c.y }));
    this.draw();
  }

  // Glides the frame to new corners (ORIGINAL image coords) instead of
  // jumping there. Used by "Detect again" and by "whole picture":
  // the rectangle moves smoothly into its new position.
  animateTo(corners, duration = MOVE_MS) {
    if (!this.corners || prefersReducedMotion()) {
      this.setCorners(corners);
      return;
    }
    const from = this.corners.map((c) => ({ x: c.x, y: c.y }));
    const to = corners.map((c) => ({ x: c.x, y: c.y }));
    this.cancelMove();
    this.moveTo = to;
    this.setQuality(ANIM_QUALITY);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeOut(t);
      this.corners = to.map((c, i) => ({
        x: from[i].x + (c.x - from[i].x) * e,
        y: from[i].y + (c.y - from[i].y) * e,
      }));
      this.draw();
      if (t < 1) {
        this.moveFrame = requestAnimationFrame(step);
      } else {
        this.moveFrame = null;
        this.moveTo = null;
        this.restoreQuality();
        this.draw();
      }
    };
    this.moveFrame = requestAnimationFrame(step);
  }

  // Stops the running rotation animation.
  cancelTurn() {
    if (this.turnFrame) {
      cancelAnimationFrame(this.turnFrame);
      this.turnFrame = null;
    }
    this.turnTo = null;
    this.turnScale = null;
    this.restoreQuality();
  }

  // Stops the running corner move animation.
  cancelMove() {
    if (this.moveFrame) {
      cancelAnimationFrame(this.moveFrame);
      this.moveFrame = null;
    }
    this.moveTo = null;
    this.restoreQuality();
  }

  // Full canvas resolution again once no animation is running.
  restoreQuality() {
    if (!this.turnFrame && !this.moveFrame) this.setQuality(1);
  }

  // Snaps both animations to their end: the frame is committed from
  // here on, so it must never be left half-way.
  finishAnimation() {
    if (this.turnTo !== null) {
      const to = this.turnTo;
      this.cancelTurn();
      this.angle = to;
    }
    if (this.moveTo) {
      const to = this.moveTo;
      this.cancelMove();
      this.corners = to.map((c) => ({ x: c.x, y: c.y }));
    }
    this.draw();
  }

  // Marks the current frame as an unverified guess (failed
  // auto-detection): the outline switches to dashed until the first
  // corner drag settles it. The page model commits either way.
  setGuess(guess) {
    const next = Boolean(guess);
    if (next === this.guess) return;
    this.guess = next;
    this.draw();
  }

  // Returns the corners in ORIGINAL image coords (the page model space).
  getCorners() {
    if (!this.corners) return null;
    return this.corners.map((c) => ({ x: c.x, y: c.y }));
  }

  // The original image turned clockwise by `angle`: its corner points
  // and the box they span.
  rotatedBox(angle = this.angle) {
    const a = (angle * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const w = this.origWidth;
    const h = this.origHeight;
    const pts = [[0, 0], [w, 0], [w, h], [0, h]];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    return { cos, sin, minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  // The scale that shows the photo turned by `angle` completely
  // inside the stage ("contain").
  containScale(angle) {
    const rect = this.canvas.getBoundingClientRect();
    const box = this.rotatedBox(angle);
    if (!box.width || !box.height) return 1;
    return Math.min(rect.width / box.width, rect.height / box.height);
  }

  // Fit transform: the turned image drawn "contain" inside the canvas.
  computeFit() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const box = this.rotatedBox();
    // While the photo turns, the scale comes from the animation (it
    // glides from the fit of the start orientation to the fit of the
    // end one) so the photo keeps its size instead of breathing.
    const scale = this.turnScale !== null
      ? this.turnScale
      : Math.min(cssW / box.width, cssH / box.height);
    return {
      scale,
      box,
      offsetX: (cssW - box.width * scale) / 2,
      offsetY: (cssH - box.height * scale) / 2,
      cssW,
      cssH,
    };
  }

  toImageCoords(dx, dy) {
    const f = this.computeFit();
    const { cos, sin, minX, minY } = f.box;
    const rx = (dx - f.offsetX) / f.scale + minX;
    const ry = (dy - f.offsetY) / f.scale + minY;
    // Undo the turn.
    return { x: rx * cos + ry * sin, y: -rx * sin + ry * cos };
  }

  // Display coords of an original-image point, for a fit that was
  // already computed for the current frame.
  displayPoint(f, ix, iy) {
    const { cos, sin, minX, minY } = f.box;
    const rx = ix * cos - iy * sin;
    const ry = ix * sin + iy * cos;
    return { x: (rx - minX) * f.scale + f.offsetX, y: (ry - minY) * f.scale + f.offsetY };
  }

  toDisplayCoords(ix, iy) {
    return this.displayPoint(this.computeFit(), ix, iy);
  }

  // Display coords of a pointer event (relative to the canvas).
  eventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  handleAt(pos) {
    if (!this.corners) return -1;
    const f = this.computeFit();
    let best = -1;
    let bestDist = HANDLE_RADIUS;
    this.corners.forEach((c, i) => {
      const d = this.displayPoint(f, c.x, c.y);
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
    // A touch takes over from a running animation.
    this.cancelTurn();
    this.cancelMove();
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
    img.x = Math.max(0, Math.min(this.origWidth, img.x));
    img.y = Math.max(0, Math.min(this.origHeight, img.y));
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
    const dpr = this.drawDpr;
    const rect = this.canvas.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!this.image || !this.corners) return;

    // One fit per frame: reading the layout and doing the trigonometry
    // once keeps the animation cheap.
    const f = this.computeFit();
    const point = (c) => this.displayPoint(f, c.x, c.y);

    // Image, turned by the current angle.
    ctx.save();
    // The photo is resampled on every frame of a turn: medium
    // smoothing keeps the edges from crawling.
    ctx.imageSmoothingQuality = 'medium';
    ctx.translate(f.offsetX, f.offsetY);
    ctx.scale(f.scale, f.scale);
    ctx.translate(-f.box.minX, -f.box.minY);
    ctx.rotate((this.angle * Math.PI) / 180);
    if (this.sprite) {
      ctx.drawImage(this.sprite, 0, 0, this.origWidth, this.origHeight);
    } else {
      ctx.drawImage(this.image, 0, 0);
    }
    ctx.restore();

    // Dim everything outside the quadrilateral (even-odd fill).
    const [tl, tr, br, bl] = this.corners.map(point);
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

    // Quad outline (dashed while it is an unverified guess).
    // Every edge is trimmed at both ends so the line stops short of
    // the corner dots: the outline reads as four separate strokes
    // that are visibly disconnected from the knobs.
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (this.guess) ctx.setLineDash([7, 6]);
    const pts = [tl, tr, br, bl];
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const trim = KNOB_RADIUS + KNOB_GAP;
      if (len <= trim * 2) continue;
      const ux = dx / len;
      const uy = dy / len;
      ctx.beginPath();
      ctx.moveTo(a.x + ux * trim, a.y + uy * trim);
      ctx.lineTo(b.x - ux * trim, b.y - uy * trim);
      ctx.stroke();
    }
    ctx.restore();

    // Corner handles (small dots; the touch target stays HANDLE_RADIUS).
    this.corners.forEach((c, i) => {
      const d = point(c);
      ctx.save();
      ctx.beginPath();
      ctx.arc(d.x, d.y, KNOB_RADIUS, 0, Math.PI * 2);
      // Active corner inverts to ink so it reads as "selected".
      ctx.fillStyle = i === this.dragIndex ? 'rgba(20, 20, 20, 0.92)' : 'rgba(255, 255, 255, 0.95)';
      ctx.fill();
      // The dragged dot is ink, so it keeps a white rim to stay visible.
      if (i === this.dragIndex) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
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
    const d = this.toDisplayCoords(corner.x, corner.y);
    // Loupe center: offset from the finger, away from the
    // corner, so it never sits under the finger.
    let cx = this.pointerPos.x + (d.x < this.pointerPos.x ? LOUPE_OFFSET : -LOUPE_OFFSET);
    let cy = this.pointerPos.y + (d.y < this.pointerPos.y ? LOUPE_OFFSET : -LOUPE_OFFSET);
    // Keep the loupe fully inside the canvas.
    cx = Math.max(LOUPE_RADIUS, Math.min(rect.width - LOUPE_RADIUS, cx));
    cy = Math.max(LOUPE_RADIUS, Math.min(rect.height - LOUPE_RADIUS, cy));

    ctx.save();
    // Circle clip.
    ctx.beginPath();
    ctx.arc(cx, cy, LOUPE_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    // Backdrop for areas beyond the image edges.
    ctx.fillStyle = '#161616';
    ctx.fillRect(cx - LOUPE_RADIUS, cy - LOUPE_RADIUS, 2 * LOUPE_RADIUS, 2 * LOUPE_RADIUS);
    // Draw the image turned and magnified around the corner, so the
    // corner always maps exactly to the crosshair at the loupe center
    // – even right at the image edges (no source-rect clamping, so no
    // dead zones).
    const { cos, sin } = f.box;
    const rx = corner.x * cos - corner.y * sin;
    const ry = corner.x * sin + corner.y * cos;
    ctx.translate(cx, cy);
    ctx.scale(f.scale * LOUPE_ZOOM, f.scale * LOUPE_ZOOM);
    ctx.translate(-rx, -ry);
    ctx.rotate((this.angle * Math.PI) / 180);
    ctx.drawImage(this.image, 0, 0);
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
    ctx.strokeStyle = '#141414';
    ctx.stroke();
    ctx.restore();
  }
}
