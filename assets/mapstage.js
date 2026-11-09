// A picture to explore (map.js): pan and zoom it, with the Map tab's rows placed on it (where.js).
// Each item is {id, name, where, pic (a picture's HTML, or '' for an area), depth, cls}. A
// picture is clicked only where it's painted (when the browser may read its pixels: the script's
// pictures, not other sites'); an area anywhere inside it. The GM's "arrange" tool drags things
// about, resizes pictures by their corner and draws new areas. The page hears of it all by
// onOpen(id), onMove(id, where) and onDraw(where).
import { inWhere, moveWhere } from './where.js';
import { esc } from './core.js';

const MAX_ZOOM = 5;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const alphas = new Map(); // picture src -> {w, h, d} of its pixels, or 'box' when it can't be read

function pixels(img) {
  const src = img.currentSrc || img.src;
  if (!src || !img.complete || !img.naturalWidth) return null;
  if (!alphas.has(src)) {
    try {
      const w = Math.min(img.naturalWidth, 600), h = Math.max(1, Math.round(img.naturalHeight * w / img.naturalWidth));
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      alphas.set(src, { w, h, d: ctx.getImageData(0, 0, w, h).data });
    } catch { alphas.set(src, 'box'); }
  }
  return alphas.get(src);
}
// Whether u, v (0–1 across the picture) is painted, or near enough to it for a finger.
function painted(img, u, v) {
  const a = pixels(img);
  if (!a || a === 'box') return true;
  const x = Math.floor(u * a.w), y = Math.floor(v * a.h), r = Math.max(2, Math.round(a.w / 120));
  for (let dy = -r; dy <= r; dy += r) for (let dx = -r; dx <= r; dx += r) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < a.w && yy < a.h && a.d[(yy * a.w + xx) * 4 + 3] > 40) return true;
  }
  return false;
}

export class Stage {
  constructor({ bg, label, onOpen, onMove, onDraw, onHover }) {
    Object.assign(this, { onOpen, onMove, onDraw, onHover, tool: 'look', items: [], els: new Map(), cam: { s: 1, x: 0, y: 0 } });
    this.el = document.createElement('div');
    this.el.className = 'mstage';
    this.el.innerHTML = `<div class="mvp" role="group" aria-label="${esc(label)}"><div class="mworld">${bg}<div class="mlayers"></div>
      <svg class="mareas" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg></div>
      <div class="mzoom"><button class="ic" data-z="in" aria-label="Zoom in" title="Zoom in">+</button><button class="ic" data-z="out" aria-label="Zoom out" title="Zoom out">−</button><button class="ic" data-z="fit" aria-label="Show it all" title="Show it all">⤢</button></div></div>`;
    this.vp = this.el.firstElementChild;
    this.world = this.vp.firstElementChild;
    this.layers = this.world.querySelector('.mlayers');
    this.svg = this.world.querySelector('svg');
    this.bind();
    // The background sets the stage's shape once it's in: as wide as fits, no taller than most of the screen.
    this.world.addEventListener('load', e => { if (e.target.closest('.mbg')) this.fit(e.target); }, true);
    const bgImg = this.world.querySelector('.mbg img');
    if (bgImg?.complete && bgImg.naturalWidth) this.fit(bgImg);
  }

  fit(img) {
    const ratio = img.naturalWidth / img.naturalHeight;
    this.vp.style.width = `min(100%, ${Math.round(80 * ratio)}vh)`;
    this.el.classList.add('ready');
    this.clamp();
    this.apply();
  }

  /* ---------- what's on it ---------- */
  set(items, tool = this.tool) {
    this.items = items;
    this.tool = tool;
    this.vp.classList.toggle('arrange', tool === 'arrange');
    const keep = new Set();
    let svg = '';
    for (const it of items) {
      if (!it.pic) { svg += this.areaSVG(it); continue; }
      keep.add(it.id);
      if (this.drag?.id === it.id) continue; // the GM's hand is on it
      let el = this.els.get(it.id);
      const html = `<div class="mdrift"><div class="mbob">${it.pic}${it.label ? `<span class="mlabel">${esc(it.label)}</span>` : ''}</div></div>`;
      if (!el) {
        el = document.createElement('div');
        this.els.set(it.id, el);
        el.dataset.id = it.id;
        el.innerHTML = html;
        el.html = html;
      } else if (el.html !== html) { el.innerHTML = html; el.html = html; }
      this.place(el, it);
      this.layers.append(el); // in order: later ones on top
    }
    for (const [id, el] of this.els) if (!keep.has(id)) { el.remove(); this.els.delete(id); }
    this.svg.innerHTML = svg + (this.draft ? this.draftSVG() : '');
  }

  place(el, it) {
    const w = it.where;
    const sel = this.sel === it.id && this.tool === 'arrange';
    el.className = ['mlay', ...(it.cls || []), w.full ? 'full' : '', sel ? 'sel' : '', this.hover === it.id ? 'hover' : '', it.depth ? 'floats' : '', this.drag?.id === it.id ? 'dragging' : ''].filter(Boolean).join(' ');
    el.style.cssText = w.full ? '' : `left:${w.x}%;top:${w.y}%;width:${w.w}%${w.area ? `;height:${w.h}%` : ''}`;
    el.style.setProperty('--d', it.depth || 0);
    el.style.setProperty('--k', (String(it.id).length * 7 + Number(String(it.id).replace(/\D/g, '') || 0)) % 5);
    let h = el.querySelector(':scope > .mhandle');
    if (sel && !w.full && !h) { h = document.createElement('i'); h.className = 'mhandle'; el.append(h); } else if (!sel && h) h.remove();
  }

  areaSVG(it) {
    const w = it.where;
    const c = ['ma', ...(it.cls || []), this.hover === it.id ? 'hover' : '', this.sel === it.id && this.tool === 'arrange' ? 'sel' : ''].filter(Boolean).join(' ');
    const t = `<title>${esc(it.name)}</title>`;
    if (w.poly) return `<polygon class="${c}" data-id="${esc(it.id)}" points="${w.poly.map(p => p.join(',')).join(' ')}">${t}</polygon>`;
    const h = w.h ?? w.w;
    return `<rect class="${c}" data-id="${esc(it.id)}" x="${w.x - w.w / 2}" y="${w.y - h / 2}" width="${w.w}" height="${h}" rx=".8">${t}</rect>`;
  }
  draftSVG() {
    const [a, b, c, d] = this.draft;
    return `<rect class="mdraft" x="${Math.min(a, c)}" y="${Math.min(b, d)}" width="${Math.abs(c - a)}" height="${Math.abs(d - b)}"/>`;
  }
  redraw() { this.set(this.items); }

  /* ---------- the camera ---------- */
  clamp() {
    const w = this.vp.clientWidth, h = this.vp.clientHeight, c = this.cam;
    c.s = Math.min(MAX_ZOOM, Math.max(1, c.s));
    c.x = Math.min(0, Math.max(w - w * c.s, c.x));
    c.y = Math.min(0, Math.max(h - h * c.s, c.y));
  }
  apply() {
    const c = this.cam;
    this.world.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.s})`;
    this.vp.classList.toggle('zoomed', c.s > 1.01);
    // Where the camera looks, -1 to 1 across: floating things drift against it.
    const w = this.vp.clientWidth || 1, h = this.vp.clientHeight || 1;
    const cx = c.s > 1 ? (-c.x + w / 2) / (w * c.s) * 2 - 1 : 0, cy = c.s > 1 ? (-c.y + h / 2) / (h * c.s) * 2 - 1 : 0;
    this.world.style.setProperty('--cx', cx.toFixed(3));
    this.world.style.setProperty('--cy', cy.toFixed(3));
  }
  zoomAt(f, cx, cy) {
    const r = this.vp.getBoundingClientRect(), c = this.cam;
    const px = cx - r.left, py = cy - r.top, s = Math.min(MAX_ZOOM, Math.max(1, c.s * f));
    c.x = px - (px - c.x) * s / c.s;
    c.y = py - (py - c.y) * s / c.s;
    c.s = s;
    this.clamp();
    this.apply();
  }
  // The camera to (x, y) percent at zoom s, gliding there over ms.
  async glide(cam, ms) {
    if (still() || !ms) { this.cam = cam; this.clamp(); this.apply(); return; }
    this.world.style.transition = `transform ${ms}ms cubic-bezier(.55,0,.25,1)`;
    this.cam = cam;
    this.clamp();
    this.apply();
    await new Promise(r => setTimeout(r, ms));
    this.world.style.transition = '';
  }
  camAt(x, y, s) {
    const w = this.vp.clientWidth, h = this.vp.clientHeight;
    return { s, x: w / 2 - x / 100 * w * s, y: h / 2 - y / 100 * h * s };
  }
  flyTo(x, y, s = 3.2, ms = 650) { return this.glide(this.camAt(x, y, s), ms); }
  // Starts zoomed in on (x, y) and pulls back to the whole picture.
  async flyFrom(x, y, s = 3.2, ms = 650) {
    this.cam = this.camAt(x, y, s);
    this.clamp();
    this.apply();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await this.glide({ s: 1, x: 0, y: 0 }, ms);
  }
  reset() { this.cam = { s: 1, x: 0, y: 0 }; this.apply(); }

  /* ---------- the pointer ---------- */
  pct(cx, cy) {
    const r = this.world.getBoundingClientRect();
    return [(cx - r.left) / r.width * 100, (cy - r.top) / r.height * 100];
  }
  hit(cx, cy) {
    const [X, Y] = this.pct(cx, cy);
    for (const it of this.items.filter(x => !x.pic).reverse()) if (inWhere(it.where, X, Y)) return it;
    for (const it of this.items.filter(x => x.pic).reverse()) {
      const img = this.els.get(it.id)?.querySelector('img');
      if (!img) continue;
      const b = img.getBoundingClientRect();
      const u = (cx - b.left) / b.width, v = (cy - b.top) / b.height;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && painted(img, u, v)) return it;
    }
    return null;
  }

  bind() {
    const vp = this.vp, ptrs = new Map();
    let pinch = null;
    vp.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return; // the page scrolls; a trackpad pinch (ctrl+wheel) zooms
      e.preventDefault();
      this.zoomAt(Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
    }, { passive: false });
    vp.addEventListener('pointerdown', e => {
      if (e.target.closest('.mzoom') || e.button > 0) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.drag = null;
        return;
      }
      vp.setPointerCapture?.(e.pointerId);
      const [X, Y] = this.pct(e.clientX, e.clientY);
      const hit = this.hit(e.clientX, e.clientY);
      const d = { sx: e.clientX, sy: e.clientY, X, Y, hit, moved: false, mode: 'pan', cam: { ...this.cam } };
      if (this.tool === 'arrange') {
        const handle = e.target.closest('.mhandle');
        const it = handle ? this.items.find(x => x.id === this.sel) : hit;
        if (it && !it.where.full && !it.fixed) Object.assign(d, { mode: handle ? 'size' : 'move', id: it.id, it, w0: it.where });
        else if (!it) { d.mode = 'draw'; this.draft = [X, Y, X, Y]; }
        if (it) { this.sel = it.id; this.redraw(); }
      }
      this.drag = d;
    });
    vp.addEventListener('pointermove', e => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const r = vp.getBoundingClientRect();
      this.world.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
      this.world.style.setProperty('--my', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomAt(dd / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = dd;
        return;
      }
      const d = this.drag;
      if (!d) {
        if (e.pointerType !== 'mouse') return;
        const h = this.hit(e.clientX, e.clientY);
        vp.style.cursor = h ? 'pointer' : this.tool === 'arrange' ? 'crosshair' : this.cam.s > 1 ? 'grab' : '';
        if ((h?.id ?? null) !== (this.hover ?? null)) { this.hover = h?.id ?? null; this.redraw(); this.onHover?.(h); }
        return;
      }
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
      if (!d.moved) return;
      const [X, Y] = this.pct(e.clientX, e.clientY);
      if (d.mode === 'pan') {
        this.cam.x = d.cam.x + e.clientX - d.sx;
        this.cam.y = d.cam.y + e.clientY - d.sy;
        this.clamp();
        this.apply();
      } else if (d.mode === 'move' || d.mode === 'size') {
        d.it.where = d.mode === 'move' ? moveWhere(d.w0, X - d.X, Y - d.Y) : { ...d.w0, w: Math.max(2, d.w0.w + 2 * (X - d.X)) };
        const el = this.els.get(d.id);
        if (el) this.place(el, d.it); else this.svg.innerHTML = this.items.filter(x => !x.pic).map(x => this.areaSVG(x)).join('');
      } else if (d.mode === 'draw') {
        this.draft[2] = X;
        this.draft[3] = Y;
        this.redraw();
      }
    });
    const up = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.mode === 'draw') {
        const [a, b, c, dd] = this.draft;
        this.draft = null;
        this.redraw();
        if (d.moved && Math.abs(c - a) > 1 && Math.abs(dd - b) > 1) {
          this.onDraw?.({ x: (a + c) / 2, y: (b + dd) / 2, w: Math.abs(c - a), h: Math.abs(dd - b), area: true });
        }
        return;
      }
      if ((d.mode === 'move' || d.mode === 'size') && d.moved) { this.onMove?.(d.id, d.it.where, d.w0); return; }
      if (!d.moved && e.type === 'pointerup' && d.hit) this.onOpen?.(d.hit.id);
    };
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
    vp.addEventListener('pointerleave', e => {
      if (e.pointerType !== 'mouse' || this.drag) return;
      this.world.style.setProperty('--mx', 0);
      this.world.style.setProperty('--my', 0);
      if (this.hover != null) { this.hover = null; this.redraw(); this.onHover?.(null); }
    });
    vp.querySelector('.mzoom').addEventListener('click', e => {
      const z = e.target.closest('[data-z]');
      if (!z) return;
      const r = vp.getBoundingClientRect();
      if (z.dataset.z === 'fit') this.glide({ s: 1, x: 0, y: 0 }, 300);
      else this.zoomAt(z.dataset.z === 'in' ? 1.5 : 1 / 1.5, r.left + r.width / 2, r.top + r.height / 2);
    });
    window.addEventListener('resize', () => { this.clamp(); this.apply(); });
  }
}
