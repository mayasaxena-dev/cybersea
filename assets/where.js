// Where a Map row sits on a picture: its On, Where and Depth cells (see map.js).
//   On:    blank (its region's map), "Place", or "Place / Level" (also "Place · Level")
//   Where: "x y w"      a picture's center across and down, and its width, in percent of the map
//          "x y w h"    an area: its center, width and height (for things painted into the map)
//          "x,y x,y …"  an area of any shape, by its corners (three or more)
//          "all"        a picture the same size as the map
//   Depth: 0 (blank) to 5, how far it floats above the map
// No DOM here, so the tests can load it.

export const mapKey = s => String(s ?? '').trim().toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ');

const num = s => (/^-?\d+(\.\d+)?$/.test(s) ? +s : NaN);

export function parseWhere(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (/^all$/i.test(t)) return { full: true, x: 50, y: 50, w: 100, h: 100 };
  const parts = t.split(/\s+/);
  if (t.includes(',')) {
    const poly = parts.map(p => p.split(',').map(num));
    if (poly.length < 3 || poly.some(p => p.length !== 2 || p.some(Number.isNaN))) return null;
    return { poly, ...boxOf(poly) };
  }
  const n = parts.map(num);
  if ((n.length !== 3 && n.length !== 4) || n.some(Number.isNaN)) return null;
  const [x, y, w, h] = n;
  return n.length === 4 ? { x, y, w, h, area: true } : { x, y, w };
}

// The box around a shape's corners: center, width and height.
function boxOf(poly) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

const f1 = n => String(Math.round(n * 10) / 10);
export function formatWhere(w) {
  if (!w) return '';
  if (w.full) return 'all';
  if (w.poly) return w.poly.map(p => p.map(f1).join(',')).join(' ');
  return [w.x, w.y, w.w, ...(w.area ? [w.h] : [])].map(f1).join(' ');
}

// The same shape, moved by dx, dy (percent).
export function moveWhere(w, dx, dy) {
  if (w.poly) { const poly = w.poly.map(([x, y]) => [x + dx, y + dy]); return { poly, ...boxOf(poly) }; }
  return { ...w, x: w.x + dx, y: w.y + dy };
}

// Whether the point (percent) is in an area. A picture's own pixels are the stage's to judge.
export function inWhere(w, X, Y) {
  if (w.poly) {
    let c = false;
    for (let i = 0, j = w.poly.length - 1; i < w.poly.length; j = i++) {
      const [xi, yi] = w.poly[i], [xj, yj] = w.poly[j];
      if ((yi > Y) !== (yj > Y) && X < (xj - xi) * (Y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const h = w.h ?? w.w;
  return Math.abs(X - w.x) <= w.w / 2 && Math.abs(Y - w.y) <= h / 2;
}

export function parseOn(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(.*?)\s*(?:\/|·|>)\s*(.+)$/);
  return m && m[1].trim() ? { place: mapKey(m[1]), level: mapKey(m[2]) } : { place: mapKey(t), level: '' };
}

export const parseDepth = s => {
  const n = parseFloat(String(s ?? '').trim());
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0;
};
