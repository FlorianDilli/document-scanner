// icons.js – tiny inline SVG icon set matching the "paper & ink"
// theme: 24x24 boxes, 2 px round strokes in currentColor, filled
// dots for grips. Icons are injected as real elements, so no
// external assets are needed and the CSP (default-src 'self')
// stays intact. fill/stroke live on the <svg> root and inherit.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Path markup per icon name.
const ICONS = {
  // ← back to the overview
  back:
    '<line x1="20" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  // closed trash can
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  // crop frame
  crop:
    '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  // vertical sliders
  sliders:
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  // Turn the page counter-clockwise: a sheet with a hooked arrow
  // over its top-right corner. This one glyph is a solid shape
  // (reference artwork), so it is filled instead of stroked and is
  // scaled down from its original 1920 grid.
  rotate:
    '<g transform="translate(2.3 1.09) scale(0.011364)">' +
    '<path fill="currentColor" stroke="none" fill-rule="evenodd" clip-rule="evenodd" ' +
    'd="M1251.45 447.883 1120 316.432h160c176.73 0 320 143.269 320 320h106.67' +
    'c0-235.641-191.03-426.666-426.67-426.666h-159.97l134.34-134.341L1178.94 0 915.833 263.111' +
    'l260.197 260.196 75.42-75.424Zm28.55 405.45C1280 735.513 1184.49 640 1066.67 640H213.333' +
    'C95.513 640 0 735.513 0 853.333v853.337C0 1824.49 95.513 1920 213.333 1920h853.337' +
    'c117.82 0 213.33-95.51 213.33-213.33V853.333Zm-213.33-106.666H213.333' +
    'c-58.91 0-106.666 47.756-106.666 106.666v853.337c0 58.91 47.756 106.66 106.666 106.66' +
    'h853.337c58.91 0 106.66-47.75 106.66-106.66V853.333c0-58.91-47.75-106.666-106.66-106.666Z"/>' +
    '</g>',
  // auto-detect (spark)
  wand:
    '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  // full image (reset crop)
  expand:
    '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  chevronL:
    '<polyline points="15 18 9 12 15 6"/>',
  chevronR:
    '<polyline points="9 18 15 12 9 6"/>',
  // camera body with lens
  camera:
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  // picture frame with mountain and sun (gallery)
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  // confirm (done)
  check:
    '<polyline points="20 6 9 17 4 12"/>',
  // magnifier with minus / plus (preview zoom)
  zoomOut:
    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>',
  zoomIn:
    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
  // document sheet with folded corner (PDF)
  pdf:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
  // close (leave live camera)
  close:
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  // → into an import tile / forward action
  arrow:
    '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  // download into a tray (export action)
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
};

// Grip: a horizontal row of three filled dots (an ellipsis), the
// quiet reorder affordance.
function gripMarkup() {
  let out = '';
  for (const cx of [5, 12, 19]) {
    out += `<circle cx="${cx}" cy="12" r="2" fill="currentColor" stroke="none"/>`;
  }
  return out;
}

// Build one icon element, e.g. ic('trash', 16).
export function ic(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  // These presentation attributes inherit into all children, so
  // paths stay unfilled, stroked strokes in the theme color.
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('icon', 'icon-' + name);
  svg.innerHTML = name === 'grip' ? gripMarkup() : ICONS[name] || '';
  return svg;
}

// Replace every <span data-icon="name"> inside root with the icon.
export function mountIcons(root = document) {
  root.querySelectorAll('span[data-icon]').forEach((slot) => {
    const name = slot.getAttribute('data-icon');
    if (!name || (!ICONS[name] && name !== 'grip')) return;
    slot.replaceChildren(ic(name, Number(slot.dataset.iconSize) || 18));
  });
}
