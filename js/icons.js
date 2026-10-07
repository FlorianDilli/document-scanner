// icons.js – tiny inline SVG icon set matching the "paper & ink"
// theme (stroke-based, currentColor). Icons are injected as real
// elements, so no external assets are needed and the CSP
// (default-src 'self') stays intact.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Path data per icon (24x24 viewBox, stroke unless noted).
const ICONS = {
  back:
    '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  crop:
    '<path d="M7 2v14a2 2 0 0 0 2 2h13"/><path d="M2 7h14a2 2 0 0 1 2 2v13"/>',
  sliders:
    '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  rotateL:
    '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  rotateR:
    '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>',
  wand:
    '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  expand:
    '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  chevronL:
    '<path d="M15 18l-6-6 6-6"/>',
  chevronR:
    '<path d="M9 6l6 6-6 6"/>',
};

// Grip: six dots, filled instead of stroked.
function gripMarkup() {
  let out = '';
  for (const [cx, cy] of [
    [9, 5], [15, 5], [9, 12], [15, 12], [9, 19], [15, 19],
  ]) {
    out += `<circle cx="${cx}" cy="${cy}" r="1.6" fill="currentColor" stroke="none"/>`;
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
  svg.classList.add('icon', 'icon-' + name);
  svg.innerHTML = name === 'grip' ? gripMarkup() : ICONS[name] || '';
  return svg;
}

// Replace every <span data-icon="name"> inside root with the icon.
export function mountIcons(root = document) {
  root.querySelectorAll('span[data-icon]').forEach((slot) => {
    const name = slot.getAttribute('data-icon');
    if (!name || !ICONS[name] && name !== 'grip') return;
    slot.replaceChildren(ic(name, Number(slot.dataset.iconSize) || 18));
  });
}
