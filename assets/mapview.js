// The map, as the Map page (map.js) and the Session page's Map app (session.js) show it. From the
// Map tab (edited in the spreadsheet, or by the GM on the Map page):
//   Region | Location | Level   | Image | Text | GM notes | Shown | On          | Where       | Depth
//   Vega   |          |         | 🖼    | …    |          |       |             |             |        a region's own map: always shows, under its heading
//   Vega   | Haven    |         | 🖼    | …    | …        | on    |             | 74 71 34    | 1      a place: crew see it once Shown is on, on the map at Where
//          | Haven    | Level 1 | 🖼    | …    |          |       |             | 44 22 77 6  |        a floor or level of the place, in order; Where is its band on the side view
//   Vega   | Phreakerz|         |       | …    |          | on    | Haven / Level 1 | 59 45 13 7 |      a spot on a level's picture, opening its own card
// A place with no levels is one picture. Image is a picture placed in the cell, =IMAGE(…), or the
// name of a row of the Images tab. GM notes reach only the GM; the script leaves hidden places out
// of what the crew get. Shown "static" shows a hidden place's picture to the crew as static. A row
// called Ship (or the Ship tab's name) is the ship: a marker the GM moves about. Where, On and
// Depth are written up in where.js; a place with no Where is a card under its map, as before.
import { href } from './games.js';
import { md } from './markup.js';
import { parseSheet } from './codec.js';
import { pictureHTML, showPictures, shrink } from './pictures.js';
import { esc, escTxt, ICON, armed, modal, closeModal, toast, deletedToast, debounce } from './core.js';
import { hold } from './hold.js';
import { shareButtonHTML, wireShare } from './share.js';
import { joinRef } from './session-model.js';
import { Stage } from './mapstage.js';
import { mapKey as key, parseWhere, formatWhere, parseOn, parseDepth } from './where.js';


// The Map tab's rows as the crew get them from the script (Code.gs mapRows_): only the places
// shown, a static place as its picture and where it is, and no GM notes. The Session page's map
// shows this even to the GM, so it's safe to screenshare.
export function crewRows(rows = []) {
  const low = v => String(v ?? '').trim().toLowerCase();
  const shown = {};
  const some = {};
  for (const r of rows) {
    const loc = low(r[1]);
    const v = low(r[6]) === 'static' ? 'static' : /^(on|yes|y|x|true|●|1)$/.test(low(r[6])) ? 'on' : '';
    if (loc && !low(r[2]) && !(loc in shown)) shown[loc] = v;
    if (loc && low(r[2]) && v === 'on') some[loc] = true;
  }
  const on = r => /^(on|yes|y|x|true|●|1)$/.test(low(r[6]));
  return rows.filter(r => {
    const loc = low(r[1]);
    if (!loc) return true;
    if (shown[loc] === 'on') return !(low(r[2]) && some[loc] && !on(r));
    return shown[loc] === 'static' && !low(r[2]) && !!low(r[8]);
  }).map(r => {
    const c = [...r];
    while (c.length < 10) c.push('');
    c[5] = '';
    const loc = low(c[1]);
    if (loc && shown[loc] === 'static') return [c[0], '', '', c[3], '', '', 'static', c[7], c[8], c[9]];
    if (loc && shown[loc] === 'on' && !low(c[2])) c[6] = 'on';
    return c;
  });
}

// main and drawer: where the map and a place's open card go. crew: show only what the crew see,
// with none of the GM's tools. embedded: inside a window, so it never scrolls the page.
export function mountMap({ client, game, main, drawer, crew = false, embedded = false }) {
  const store = client.tab('Map');
  const ship = client.tab('Ship');
  let query = '';
  let showAll = true; // the GM's view: every place, or only those on the map
  let arrange = false; // the GM is moving things about on the map
  let card = null; // the open card: a place's key, or "static:<row>"
  let inside = null; // {place: key, level: index, stack} while looking inside a place
  const shownLevel = {}; // place index -> which of its levels is showing, on a card

  const isGm = () => !crew && client.role === 'gm';
  // Rows the GM deleted here, held a few seconds before the sheet hears (hold.js): row JSON -> hold.
  const gone = new Map();
  // Moves the GM made here that the sheet hasn't answered yet: row index -> Where.
  const moving = new Map();

  /* ---------- the Map tab, as regions, places, levels and spots ---------- */
  function shipInfo() {
    if (!ship.loaded || ship.missing) return null;
    return { name: parseSheet(ship.rows).info.name || '', image: ship.imageOf('info', 'Name') || '' };
  }

  function world(rows) {
    if (crew) rows = crewRows(rows);
    const regions = [];
    const region = name => {
      let r = regions.find(x => key(x.name) === key(name));
      if (!r) regions.push(r = { name: String(name || '').trim(), maps: [], places: [], statics: [] });
      return r;
    };
    const places = new Map();
    const levels = [];
    const spots = [];
    const sh = shipInfo();
    rows.forEach((row, at) => {
      if (gone.has(JSON.stringify(row))) return; // a deleted place's levels go with it
      const [reg, loc, level, image, text, notes, shown, on, where, depth] = row;
      const w = moving.has(at) ? moving.get(at) : where;
      const item = { at, name: String(level || loc || reg || '').trim(), image, text: String(text || ''), notes: String(notes || ''),
        where: parseWhere(w), whereText: String(w || '').trim(), depth: parseDepth(depth), onText: String(on || '').trim() };
      if (shown === 'static' && !String(loc || '').trim()) { region(reg).statics.push({ ...item, name: '' }); return; } // what the crew get of one
      if (!String(loc || '').trim()) { region(reg).maps.push(item); return; }
      if (String(level || '').trim()) { levels.push([key(loc), { ...item, loc: String(loc).trim(), spots: [] }]); return; }
      if (places.has(key(loc))) return;
      const p = { ...item, region: String(reg || '').trim(), i: places.size, key: key(loc), shown: shown || '', on: shown === 'on', levels: [], spots: [] };
      p.ship = p.key === 'ship' || (!!sh?.name && p.key === key(sh.name));
      if (p.ship && !String(image || '').trim() && sh?.image) { p.image = sh.image; p.picTab = 'Ship'; }
      places.set(p.key, p);
      const ref = parseOn(on);
      if (ref) spots.push([ref, p]); else region(reg).places.push(p);
    });
    for (const [k, lv] of levels) places.get(k)?.levels.push({ ...lv, place: places.get(k) });
    for (const [ref, p] of spots) {
      const host = places.get(ref.place);
      const lv = host && ref.level ? host.levels.find(l => key(l.name) === ref.level) : null;
      if (host && (!ref.level || lv)) { (lv || host).spots.push(p); p.host = host; p.hostLevel = lv; } else region(p.region).places.push(p);
    }
    for (const p of places.values()) p.search = [p.name, p.text, p.notes, ...p.levels.flatMap(l => [l.name, l.text])].join(' ').toLowerCase();
    return { regions, places };
  }

  const imgHTML = (item, cls, opts) => pictureHTML(item.picTab || 'Map', item.image, item.name, cls, opts);
  showPictures(main, client);
  showPictures(drawer, client);

  /* ---------- cards ---------- */

  const notesHTML = it => (isGm() && it.notes.trim() ? `<details class="orig"><summary>GM notes</summary>${md(it.notes)}</details>` : '');
  const SHOWN = [['', 'Hidden', 'The crew don’t see it'], ['static', 'Static', 'The crew see static where it is, nothing more'], ['on', 'Shown', 'On the crew’s map']];
  const shownHTML = p => `<div class="seg mapshow" role="group" aria-label="What the crew see">${SHOWN.map(([v, l, t]) => `<button data-place="${p.i}" data-to="${v}" aria-pressed="${p.shown === v}" class="${p.shown === v ? 'on' : ''}" title="${t}">${l}</button>`).join('')}</div>`;
  const canEnter = p => p.levels.some(l => l.image) || p.spots.length > 0;

  // open: the card a click on the map opens, rather than one in the list under it
  function placeHTML(p, open = false) {
    const at = Math.min(shownLevel[p.i] || 0, Math.max(p.levels.length - 1, 0));
    const lv = p.levels[at];
    const edit = (row, label) => (isGm() ? `<button class="ic" data-edit="${row}" title="${label}" aria-label="${label}">${ICON.pen}</button>` : '');
    const close = open ? '<button class="mini" data-close-card aria-label="Close">×</button>' : '';
    const where = p.hostLevel ? `${p.host.name} · ${p.hostLevel.name}` : p.host ? p.host.name : '';
    return `<section class="card loc${p.on ? '' : ' off'}${p.ship ? ' shipcard' : ''}${open ? ' open' : ''}" id="${open ? 'card' : 'loc'}-${p.i}"${open ? ` role="dialog" aria-label="${esc(p.name)}"` : ''}>
      <div class="shead"><h2>${escTxt(p.name)}</h2>${isGm() ? shownHTML(p) : ''}${edit(p.at, `Edit ${esc(p.name)}`)}${close}</div>
      ${isGm() ? `<div class="prow">${shareButtonHTML({ type: 'place', ref: p.name, title: p.name })}${p.image ? shareButtonHTML({ type: 'picture', ref: joinRef('Map', p.name), title: `${p.name} (picture)` }, 'Share picture') : ''}${lv ? shareButtonHTML({ type: 'level', ref: joinRef(p.name, lv.name), title: `${p.name}: ${lv.name}` }, `Share ${lv.name}`) : ''}</div>` : ''}
      ${where ? `<div class="mwhere">${escTxt(where)}</div>` : ''}
      ${p.text.trim() ? `<div class="rich">${md(p.text)}</div>` : ''}
      ${imgHTML(p, 'rimg')}
      ${p.levels.length && !(open && canEnter(p)) ? `<div class="levels">
        <div class="shead"><div class="cats" role="group" aria-label="Levels">${p.levels.map((l, k) => `<button data-loc="${p.i}" data-lv="${k}" aria-pressed="${k === at}" class="${k === at ? 'on' : ''}">${escTxt(l.name)}</button>`).join('')}</div>${edit(lv.at, `Edit ${esc(lv.name)}`)}</div>
        ${lv.text.trim() ? `<div class="rich">${md(lv.text)}</div>` : ''}${imgHTML(lv, 'rimg')}${notesHTML(lv)}</div>` : ''}
      ${notesHTML(p)}
      ${open && canEnter(p) ? `<div class="prow"><button class="pbtn primary" data-enter="${p.i}">Go inside ${escTxt(p.name)}</button></div>` : ''}
      ${open && p.ship ? `<div class="prow"><a class="pbtn" href="${esc(href('ship.html', game))}">Open the ship</a></div>` : ''}
      ${isGm() && !open ? `<button class="add sm" data-new="level" data-for="${p.i}">+ Level</button>` : ''}</section>`;
  }

  const staticHTML = s => `<section class="card loc open" id="card-static" role="dialog" aria-label="Unknown signal">
    <div class="shead"><h2>Unknown signal</h2><button class="mini" data-close-card aria-label="Close">×</button></div>
    <p class="mwhere">Something is out there. It isn’t on your map yet.</p></section>`;

  function renderCard() {
    const p = card && !card.startsWith('static:') ? W.places.get(card) : null;
    if (card && !p && !card.startsWith('static:')) card = null;
    drawer.innerHTML = p ? placeHTML(p, true) : card ? staticHTML() : '';
  }
  function openCard(k) {
    card = k;
    renderCard();
    drawStages();
    drawer.querySelector('[data-close-card]')?.focus({ preventScroll: true });
  }
  function closeCard() {
    if (!card) return;
    card = null;
    renderCard();
    drawStages();
  }

  /* ---------- the stages: the region maps, and the inside of a place ---------- */
  const stages = new Map(); // picture token -> Stage, kept between renders so the camera and pictures stay
  let W = world(store.rows); // a cached copy shows at once; the sheet may say it's unchanged
  const allPlaces = () => [...W.places.values()];

  function stageFor(k, bg, label) {
    let s = stages.get(k);
    if (!s) {
      s = new Stage({
        bg, label,
        onOpen: id => (id.startsWith('lv:') ? goLevel(+id.slice(3)) : openCard(id)),
        onMove: (id, w, was) => move(id, w, was),
        onDraw: w => drawn(w),
        onHover: it => { s.el.title = it?.name || ''; },
      });
      stages.set(k, s);
    }
    return s;
  }

  const q = () => query.trim().toLowerCase();
  const visible = p => (isGm() && showAll) || p.on;
  // What a place shows as on a stage.
  function itemOf(p) {
    const cls = [];
    if (p.ship) cls.push('ship');
    if (isGm() && p.shown !== 'on') cls.push(p.shown === 'static' ? 'gmstatic' : 'hid');
    if (q() && !p.search.includes(q())) cls.push('dim');
    if (card === p.key) cls.push('cur');
    return { id: p.key, name: p.name, where: p.where, depth: p.depth, cls, label: p.ship ? p.name : '',
      pic: p.image && !p.where.area ? imgHTML(p, 'mpic', { still: true }) : p.image ? imgHTML(p, 'mpic fill', { still: true }) : '' };
  }

  function regionItems(r) {
    const items = r.places.filter(p => p.where && visible(p)).map(itemOf);
    for (const s of r.statics) if (s.where && s.image) items.push({ id: `static:${s.at}`, name: 'Unknown signal', where: s.where, depth: s.depth, cls: ['static'], pic: imgHTML(s, 'mpic', { still: true }) });
    return items.sort((a, b) => (a.cls.includes('ship') - b.cls.includes('ship')) || a.depth - b.depth);
  }

  function insideItems(p, lv) {
    const items = [];
    if (lv) p.levels.filter(l => l.image).forEach((l, k) => { if (l.where) items.push({ id: `lv:${k}`, name: l.name, where: l.where, cls: ['lvl', ...(l === lv ? ['now'] : [])], pic: '', fixed: true }); });
    for (const s of (lv || p).spots) if (s.where && visible(s)) items.push(itemOf(s));
    return items;
  }

  // Puts each stage where render left a place for it, with what's on it now.
  function drawStages() {
    const tool = isGm() && arrange ? 'arrange' : 'look';
    for (const slot of main.querySelectorAll('[data-stage]')) {
      const s = stages.get(slot.dataset.stage);
      if (!s) continue;
      if (slot !== s.el) slot.replaceWith(s.el);
    }
    for (const r of W.regions) {
      const m = r.maps.find(x => x.image);
      if (m && stages.has(m.image)) stages.get(m.image).set(regionItems(r), tool);
    }
    const p = inside && W.places.get(inside.place);
    if (p) {
      const lv = p.levels.filter(l => l.image)[inside.level];
      const pic = lv ? lv.image : p.image;
      if (stages.has(pic)) stages.get(pic).set(insideItems(p, lv), tool);
    }
  }

  /* ---------- the page ---------- */

  const search = debounce(() => { const w = main.querySelector('.mworldlist'); if (w) { w.innerHTML = worldHTML(); drawStages(); } });
  function render() {
    search.cancel();
    if (!store.loaded && !store.missing) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
    if (store.missing) {
      main.innerHTML = isGm()
        ? '<div class="empty">No Map tab yet. Add a place or a region’s map to start one.</div><div class="mtools"><button class="pbtn" data-new="place">+ Place</button><button class="pbtn" data-new="map">+ Region map</button></div>'
        : '<div class="empty">Nothing on the map yet.</div>';
      return;
    }
    if (inside && !W.places.get(inside.place)) inside = null;
    renderCard();
    if (inside) {
      main.innerHTML = insideHTML();
      main.querySelectorAll('.mplane').forEach((b, k) => b.style.setProperty('--i', k)); // (no inline styles: the page's CSP)
      drawStages();
      return;
    }
    const gm = isGm();
    const onCount = allPlaces().filter(p => p.on).length;
    const staged = W.regions.some(r => r.maps.some(m => m.image));
    main.innerHTML = `
      <div class="mtools">
        <input type="search" class="in search" id="q" placeholder="Search places" value="${esc(query)}" aria-label="Search places" autocomplete="off">
        ${gm ? `<div class="cats"><button data-show="all" aria-pressed="${showAll}" class="${showAll ? 'on' : ''}">Every place</button><button data-show="on" aria-pressed="${!showAll}" class="${showAll ? '' : 'on'}">On the map (${onCount})</button></div>
          ${staged ? `<button class="pbtn" data-arrange aria-pressed="${arrange}">Arrange</button>` : ''}
          <button class="pbtn" data-new="place">+ Place</button><button class="pbtn" data-new="map">+ Region map</button>` : ''}
      </div>
      ${gm ? `<div class="robar"><span>${arrange ? 'Drag a place to move it, or its corner to resize it. Drag on an empty spot to mark a new place there.' : 'You choose which places the crew see; every place starts hidden.'}</span></div>` : ''}
      <div class="mworldlist" id="${embedded ? 'mworld-app' : 'world'}">${worldHTML()}</div>`;
    drawStages();
  }

  const chipHTML = (p, act = 'open') => `<button class="chip${p.on ? '' : ' off'}" data-${act}="${esc(p.key)}">${escTxt(p.name)}</button>`;

  // The regions and places that match the search: all a search redraws.
  function worldHTML() {
    const qq = q();
    const gm = isGm();
    const match = p => !qq || p.search.includes(qq);
    const none = gm ? (qq ? 'No matches.' : showAll ? 'No places in the Map tab yet.' : 'No places on the map yet: show every place and turn some on.')
      : (qq ? 'No matches.' : 'Nothing on the map yet.');
    const regions = W.regions.map(r => {
      const stageMap = r.maps.find(m => m.image);
      const onMap = stageMap ? r.places.filter(p => p.where && visible(p)) : [];
      return { ...r, stageMap, onMap, maps: r.maps.filter(m => !qq || `${m.name} ${m.text}`.toLowerCase().includes(qq) || m === stageMap),
        cards: r.places.filter(p => !onMap.includes(p) && visible(p) && match(p)) };
    }).filter(r => r.maps.length || r.cards.length || r.onMap.length || r.statics.length);
    let any = false;
    const html = regions.map(r => {
      const maps = r.maps.map(m => {
        if (m === r.stageMap) {
          stageFor(m.image, imgHTML(m, 'mbg', { still: true }), `${m.name} map`);
          const chips = r.onMap.filter(match);
          if (chips.length) any = true;
          return `<section class="worldmap"><div data-stage="${esc(m.image)}"></div>
            ${chips.length ? `<div class="chips mchips" aria-label="Places on the map">${chips.map(p => chipHTML(p)).join('')}</div>` : ''}
            ${m.text.trim() ? `<div class="rich">${md(m.text)}</div>` : ''}${notesHTML(m)}</section>`;
        }
        const h = [imgHTML(m, 'mapimg'), m.text.trim() ? `<div class="rich">${md(m.text)}</div>` : '', notesHTML(m)].join('');
        return h ? `<section class="worldmap">${h}</section>` : '';
      }).join('');
      if (r.cards.length) any = true;
      return `<div class="mgroup"><h3>${escTxt(r.name || 'Places')}${gm ? r.maps.map(m => `<button class="ic" data-edit="${m.at}" title="Edit the ${esc(m.name)} map" aria-label="Edit the ${esc(m.name)} map">${ICON.pen}</button>`).join('') : ''}${gm && r.maps.length && r.name ? shareButtonHTML({ type: 'region', ref: r.name, title: `${r.name} map` }, 'Share map') : ''}</h3>
          ${maps}
          ${r.cards.length ? `<div class="cols">${r.cards.map(p => placeHTML(p)).join('')}</div>` : ''}</div>`;
    }).join('');
    return html + (any ? '' : `<div class="empty">${none}</div>`);
  }

  // Inside a place: its levels' pictures (or its own), with its spots, the levels to pick from and
  // the level's card under them.
  function insideHTML() {
    const p = W.places.get(inside.place);
    const lvs = p.levels.filter(l => l.image);
    inside.level = Math.min(inside.level, Math.max(lvs.length - 1, 0));
    const lv = lvs[inside.level];
    const pic = lv ? lv.image : p.image;
    const gm = isGm();
    if (pic) stageFor(pic, imgHTML(lv || p, 'mbg', { still: true }), lv ? `${p.name}, ${lv.name}` : p.name);
    const it = lv || p;
    const spots = it.spots.filter(visible);
    const stack = inside.stack && lvs.length > 1;
    return `
      <div class="mtools">
        <button class="pbtn" data-out>← ${escTxt(p.region || 'The map')}</button>
        <h2 class="minside">${escTxt(p.name)}</h2>
        ${lvs.length ? `<div class="cats" role="group" aria-label="Levels">${lvs.map((l, k) => `<button data-go="${k}" aria-pressed="${k === inside.level && !stack}" class="${k === inside.level && !stack ? 'on' : ''}">${escTxt(l.name)}</button>`).join('')}</div>` : ''}
        ${lvs.length > 1 ? `<button class="pbtn" data-stack aria-pressed="${stack}">Stack</button>` : ''}
        ${gm && pic && !stack ? `<button class="pbtn" data-arrange aria-pressed="${arrange}">Arrange</button>` : ''}
      </div>
      ${gm && arrange && !stack ? '<div class="robar"><span>Drag a spot to move it. Drag on an empty spot to mark a new one there.</span></div>' : ''}
      ${stack ? `<div class="mstack fade" aria-label="Levels, stacked">${lvs.map((l, k) => `<button class="mplane" data-go="${k}" aria-label="Go to ${esc(l.name)}">${imgHTML(l, 'mplanepic', { still: true })}<span>${escTxt(l.name)}</span></button>`).join('')}</div>`
      : pic ? `<div data-stage="${esc(pic)}"></div>` : ''}
      ${spots.length ? `<div class="chips mchips" aria-label="Places here">${spots.map(s => chipHTML(s)).join('')}</div>` : ''}
      <section class="card loc">
        <div class="shead"><h2>${escTxt(it.name)}</h2>${gm ? `<button class="ic" data-edit="${it.at}" title="Edit ${esc(it.name)}" aria-label="Edit ${esc(it.name)}">${ICON.pen}</button>` : ''}</div>
        ${it.text.trim() ? `<div class="rich">${md(it.text)}</div>` : ''}${notesHTML(it)}
        ${gm ? `<button class="add sm" data-new="level" data-for="${p.i}">+ Level</button>` : ''}
      </section>`;
  }

  /* ---------- going in and out ---------- */
  async function enter(p) {
    closeCard();
    const r = W.regions.find(x => x.places.includes(p));
    const m = r?.maps.find(x => x.image);
    const s = m && stages.get(m.image);
    if (s && p.where) await s.flyTo(p.where.x, p.where.y);
    inside = { place: p.key, level: 0, stack: false };
    arrange = false;
    render();
    play(main.querySelector('.mstage'), 'fade');
    if (!embedded) window.scrollTo({ top: 0 });
  }
  function leave() {
    const p = W.places.get(inside.place);
    inside = null;
    arrange = false;
    render();
    const r = W.regions.find(x => x.places.includes(p));
    const m = r?.maps.find(x => x.image);
    const s = m && stages.get(m.image);
    if (s && p?.where) {
      if (!embedded) s.el.scrollIntoView({ block: 'center' });
      s.flyFrom(p.where.x, p.where.y);
    }
  }
  // Plays a one-off animation class on el.
  function play(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }
  function goLevel(k) {
    if (!inside) return;
    const dir = k > inside.level ? 'up' : k < inside.level ? 'down' : '';
    inside.level = k;
    inside.stack = false;
    render();
    if (dir) play(main.querySelector('.mstage'), `go${dir}`);
  }

  /* ---------- the GM's hand ---------- */
  const placeAt = id => W.places.get(id);
  async function setShown(p, to) {
    p.shown = to; // shows at once; the read that follows has the sheet's word
    p.on = to === 'on';
    render();
    try {
      const r = await client.request({ op: 'show', location: p.name, on: to === 'static' ? 'static' : to === 'on' });
      if (!r.ok) throw new Error(r.error);
    } finally {
      await client.read(['Map']).catch(() => {});
    }
  }

  const rowOf = at => ({ row: store.server.ns?.[at] || 0, was: store.server.rows[at] });
  async function sendWhere(at, where) {
    const { row, was } = rowOf(at);
    if (!row) throw new Error('Reload the page, then try again.');
    const r = await client.request({ op: 'where', row, was, where });
    if (!r.ok) throw new Error(r.error);
  }
  // The GM dropped something somewhere: it stays there now, and the sheet hears.
  function move(id, w, was) {
    const p = placeAt(id);
    if (!p) return;
    const at = p.at;
    const from = was ? formatWhere(was) : p.whereText;
    const to = formatWhere(w);
    moving.set(at, to);
    W = world(store.rows);
    drawStages();
    sendWhere(at, to).then(() => {
      toast(`Moved ${p.name}.`, '', { label: 'Undo', run: () => {
        const now = [...W.places.values()].find(x => x.key === p.key);
        if (!now) return;
        moving.set(now.at, from);
        W = world(store.rows);
        drawStages();
        sendWhere(now.at, from).catch(err => toast(err.message, 'lo')).finally(() => settle(now.at));
      } });
    }, err => toast(err.message, 'lo')).finally(() => settle(at));
  }
  // Once the sheet has answered a move, its own Where stands.
  async function settle(at) {
    await client.read(['Map']).catch(() => {});
    moving.delete(at);
    W = world(store.rows);
    drawStages();
  }
  // The GM marked out a new area: it becomes a new place (or spot, inside a place) there.
  function drawn(w) {
    const where = formatWhere(w);
    const p = inside && W.places.get(inside.place);
    if (p) {
      const lv = p.levels.filter(l => l.image)[inside.level];
      openEditor(null, 'place', null, { region: p.region, on: lv ? `${p.name} / ${lv.name}` : p.name, where });
    } else {
      const r = W.regions.find(x => x.maps.some(m => m.image));
      openEditor(null, 'place', null, { region: r?.name || '', where });
    }
  }

  function onClick(e) {
    if (e.target.closest('[data-close-card]')) { closeCard(); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed && isGm()) { openEditor(itemAt(+ed.dataset.edit)); return; }
    const nw = e.target.closest('[data-new]');
    if (nw && isGm()) { openEditor(null, nw.dataset.new, allPlaces().find(x => String(x.i) === nw.dataset.for)); return; }
    const t = e.target.closest('[data-place]');
    if (t && isGm()) {
      const p = allPlaces().find(x => String(x.i) === t.dataset.place);
      if (p && p.shown !== t.dataset.to) setShown(p, t.dataset.to).catch(err => toast(err.message, 'lo'));
      return;
    }
    const op = e.target.closest('[data-open]');
    if (op) { openCard(op.dataset.open); return; }
    const en = e.target.closest('[data-enter]');
    if (en) { const p = allPlaces().find(x => String(x.i) === en.dataset.enter); if (p) enter(p); return; }
    if (e.target.closest('[data-out]')) { leave(); return; }
    const go = e.target.closest('[data-go]');
    if (go) { goLevel(+go.dataset.go); return; }
    if (e.target.closest('[data-stack]')) { inside.stack = !inside.stack; arrange = false; render(); return; }
    if (e.target.closest('[data-arrange]')) { arrange = !arrange; closeCard(); render(); return; }
    const s = e.target.closest('[data-show]');
    if (s) { showAll = s.dataset.show === 'all'; render(); return; }
    const b = e.target.closest('[data-lv]');
    if (!b) return;
    shownLevel[b.dataset.loc] = +b.dataset.lv;
    const p = allPlaces().find(x => String(x.i) === b.dataset.loc);
    const el = p && main.querySelector(`#loc-${p.i}`);
    if (el) el.outerHTML = placeHTML(p);
  }
  wireShare(main, client);
  wireShare(drawer, client);
  main.addEventListener('click', onClick);
  drawer.addEventListener('click', onClick);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && card && main.isConnected && !document.getElementById('overlay')) closeCard(); });
  main.addEventListener('input', e => {
    if (e.target.id !== 'q') return;
    query = e.target.value;
    search();
  });

  /* ---------- the GM's editor ----------
   * Adds, changes or removes a Map row (op "place"). A picture is kept, cleared, picked from the
   * Images tab, or uploaded there under a name (so it's stored once and can be picked again).
   */
  const itemAt = at => [...W.regions.flatMap(r => r.maps), ...allPlaces(), ...allPlaces().flatMap(p => p.levels)].find(x => x.at === at);
  const regionOf = it => String(store.server.rows[it.at]?.[0] || '').trim();
  let imageList = null; // [[name, token]] from the Images tab, once asked for

  async function loadImages() {
    try {
      imageList = (await client.request({ op: 'images' })).images;
    } catch (e) {
      imageList = [];
      throw e;
    }
    return imageList;
  }

  // kind: 'map' (a region's own map), 'place' or 'level'; it is the item to change, or null for a
  // new one; fresh fills in a new one's region, On and Where.
  function openEditor(it, kind, place, fresh = {}) {
    if (it) kind = it.place ? 'level' : it.levels ? 'place' : 'map';
    const title = it ? `Edit ${it.name}` : kind === 'level' ? `New level of ${place.name}` : kind === 'place' ? 'New place' : 'New region map';
    const regions = [...new Set(W.regions.map(r => r.name).filter(Boolean))];
    const reg = it ? (kind === 'level' ? '' : regionOf(it)) : fresh.region || '';
    const name = it ? it.name : '';
    const pic = it?.picTab ? '' : it?.image || '';
    const cell = i => (it ? String(store.server.rows[it.at]?.[i] ?? '') : '');
    const hosts = allPlaces().filter(p => p !== it).flatMap(p => [p.name, ...p.levels.map(l => `${p.name} / ${l.name}`)]);
    const o = modal(`
      <div class="prow"><h2>${escTxt(title)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
      ${kind !== 'level' ? `<label class="field"><span class="lbl">Region</span><input class="in" data-f="region" value="${esc(reg)}" list="map-regions" ${kind === 'map' ? 'required' : ''}></label>
        <datalist id="map-regions">${regions.map(r => `<option value="${esc(r)}">`).join('')}</datalist>` : ''}
      ${kind !== 'map' ? `<label class="field"><span class="lbl">${kind === 'level' ? 'Level' : 'Place'}</span><input class="in" data-f="name" value="${esc(name)}" required></label>` : ''}
      <label class="field"><span class="lbl">Text</span><textarea class="in rtext" data-f="text">${escTxt(it?.text || '')}</textarea></label>
      <label class="field"><span class="lbl">GM notes</span><textarea class="in rtext" data-f="notes">${escTxt(it?.notes || '')}</textarea></label>
      ${kind !== 'map' ? `<div class="prow mfields">
        ${kind === 'place' ? `<label class="field"><span class="lbl">On</span><input class="in" data-f="on" value="${esc(it ? cell(7) : fresh.on || '')}" list="map-hosts" placeholder="Its region’s map"></label>
          <datalist id="map-hosts">${hosts.map(h => `<option value="${esc(h)}">`).join('')}</datalist>` : ''}
        <label class="field"><span class="lbl">Where</span><input class="in" data-f="where" value="${esc(it ? cell(8) : fresh.where || '')}" placeholder="${kind === 'level' ? 'Its band on the side view' : 'Not on the map'}" spellcheck="false"></label>
        ${kind === 'place' ? `<label class="field"><span class="lbl">Depth</span><input class="in" data-f="depth" type="number" min="0" max="5" step="1" value="${esc(it ? cell(9) : '')}" placeholder="0"></label>` : ''}
      </div>` : ''}
      <label class="field"><span class="lbl">Picture</span><select class="in" data-f="pic">
        ${pic ? '<option value="keep" selected>Keep this picture</option>' : ''}
        <option value="none"${pic ? '' : ' selected'}>No picture</option>
        <option value="upload">Upload a new picture…</option>
        <optgroup label="From the Images tab" data-list><option disabled>Loading…</option></optgroup>
      </select></label>
      <div class="field" data-upload hidden>
        <input class="in" type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-f="file">
        <label class="field"><span class="lbl">Name in the Images tab</span><input class="in" data-f="picname" value="${esc(name)}"></label>
      </div>
      <div data-preview>${pic ? pictureHTML('Map', pic, name, 'rimg') : ''}</div>
      <div class="prow">${it ? '<button class="pbtn" data-del>Delete</button>' : ''}<span class="status" data-msg></span><span class="grow"></span>
        <button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-save>Save</button></div>`, { label: title, wide: true });
    showPictures(o, client);
    const f = n => o.querySelector(`[data-f="${n}"]`);
    const say = m => { o.querySelector('[data-msg]').textContent = m; };
    const sel = f('pic');
    const preview = o.querySelector('[data-preview]');
    let upload = null; // {type, data, url} once a file is picked
    const showChoice = () => {
      o.querySelector('[data-upload]').hidden = sel.value !== 'upload';
      const token = sel.value === 'keep' ? pic : sel.value.startsWith('img:') ? (imageList.find(x => x[0] === sel.value.slice(4)) || [])[1] : '';
      if (sel.value === 'upload') preview.innerHTML = upload ? `<span class="rimg"><img src="${esc(upload.url)}" alt=""></span>` : '';
      else preview.innerHTML = token ? pictureHTML('Map', token, name, 'rimg') : '';
    };
    sel.addEventListener('change', showChoice);
    (imageList ? Promise.resolve(imageList) : loadImages()).then(list => {
      o.querySelector('[data-list]').innerHTML = list.length ? list.map(([n]) => `<option value="img:${esc(n)}">${escTxt(n)}</option>`).join('') : '<option disabled>None yet</option>';
    }, err => { o.querySelector('[data-list]').innerHTML = '<option disabled>Couldn’t load</option>'; say(err.message); });
    f('file').addEventListener('change', async () => {
      const file = f('file').files[0];
      if (upload) URL.revokeObjectURL(upload.url);
      upload = null;
      if (!file) { showChoice(); return; }
      say('Reading the picture…');
      try {
        upload = await shrink(file);
        say('');
      } catch (err) { say(err.message); }
      showChoice();
    });
    f('name')?.addEventListener('input', () => { if (!f('picname').dataset.typed) f('picname').value = f('name').value; });
    f('picname').addEventListener('input', () => { f('picname').dataset.typed = '1'; });

    const send = async body => {
      o.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        await client.request({ op: 'place', ...body }, { timeout: 90000 });
        if (upload) URL.revokeObjectURL(upload.url);
        closeModal();
        if (body.image?.data) imageList = null; // the upload is in the Images tab now
      } catch (err) {
        o.querySelectorAll('button').forEach(b => { b.disabled = false; });
        say(err.message);
        return;
      } finally {
        await client.read(['Map']).catch(() => {});
      }
      toast('Saved to the Map tab.');
    };
    const row = it ? rowOf(it.at) : { row: 0 };
    o.querySelector('[data-del]')?.addEventListener('click', e => {
      if (!armed(e.target)) { say(kind === 'place' && it.levels.length ? 'Click again to delete it and its levels.' : 'Click again to delete it.'); return; }
      closeModal();
      remove(it);
    });
    o.querySelector('[data-save]').addEventListener('click', () => {
      const v = n => (f(n)?.value || '').trim();
      const nm = v('name');
      if (kind !== 'map' && !nm) { say(`Give the ${kind} a name.`); return; }
      if (kind === 'map' && !v('region')) { say('Name the region.'); return; }
      if (it && !row.row) { say('Reload the page, then try again.'); return; }
      if (v('where') && !parseWhere(v('where'))) { say('Where is “all”, three or four numbers, or three or more x,y corners.'); return; }
      const cells = kind === 'level' ? ['', (it ? it.loc : place.name), nm, v('text'), v('notes')]
        : [v('region'), kind === 'place' ? nm : '', '', v('text'), v('notes')];
      if (kind === 'level' && it) cells[0] = String(store.server.rows[it.at][0] || '');
      if (kind === 'place') cells.push(v('on'), v('where'), v('depth'));
      if (kind === 'level') cells.push('', v('where'), '');
      const body = { ...row, cells };
      if (sel.value === 'none') { if (pic) body.image = ''; }
      else if (sel.value === 'upload') {
        if (!upload) { say('Pick a picture to upload.'); return; }
        body.image = { name: v('picname') || nm || v('region'), type: upload.type, data: upload.data };
      } else if (sel.value.startsWith('img:')) body.image = { name: sel.value.slice(4) };
      say(body.image?.data ? 'Uploading…' : 'Saving…');
      send(body);
    });
  }

  // Deleting a map, place or level: it goes from the page now, and from the Map tab once the
  // toast's Undo is past.
  function remove(it) {
    const was = store.server.rows[it.at];
    const k = JSON.stringify(was);
    const redraw = () => { W = world(store.rows); render(); };
    gone.set(k, hold(async () => {
      gone.delete(k);
      const at = store.server.rows.findIndex(r => JSON.stringify(r) === k);
      try {
        if (at >= 0) await client.request({ op: 'place', row: store.server.ns?.[at] || 0, was }, { timeout: 90000 });
      } catch (err) {
        toast(err.message, 'lo');
      } finally {
        await client.read(['Map']).catch(() => {});
        redraw();
      }
    }));
    if (card === it.key) card = null;
    redraw();
    deletedToast(it.name, () => { gone.get(k)?.cancel(); if (gone.delete(k)) redraw(); });
  }

  const refresh = () => { W = world(store.rows); render(); };
  store.on(refresh);
  ship.on(() => { W = world(store.rows); render(); });
  client.on(e => { if (e.list || e.key || e.auth) render(); });
  render();

  // Shows a place to everyone looking: its card on the map, or inside it at a level.
  function focus(name, level = '') {
    const p = W.places.get(key(name));
    if (!p) return;
    if (level) {
      const k = p.levels.filter(l => l.image).findIndex(l => key(l.name) === key(level));
      inside = { place: p.key, level: Math.max(k, 0), stack: false };
      card = null;
    } else {
      inside = null;
      card = p.key;
    }
    render();
  }
  return { render, focus };
}

