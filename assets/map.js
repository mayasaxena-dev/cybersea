// The world: map.html?g=<game>. Everyone sees it. From the Map tab (edited in the spreadsheet, or
// by the GM here):
//   Region | Location | Level   | Image | Text | GM notes | Shown
//   Vega   |          |         | 🖼    | …    |          |          a region's own map: always shows, under its heading
//   Vega   | Haven    |         | 🖼    | …    | …        | on       a place: crew see it once Shown is on
//          | Haven    | Level 1 | 🖼    | …    |          |          a floor or level of the place, in order
// A place with no levels is one picture. Image is a picture placed in the cell, =IMAGE(…), or the
// name of a row of the Images tab. GM notes reach only the GM; the script leaves hidden places out
// of what the crew get.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { md } from './markup.js';
import { pictureHTML, showPictures, shrink } from './pictures.js';
import { esc, escTxt, ICON, armed, modal, closeModal, toast, deletedToast, pageShell, refreshNav, debounce, noGame } from './core.js';
import { hold } from './hold.js';
import { shareButtonHTML, wireShare } from './share.js';
import { joinRef } from './session-model.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) noGame(app, 'map');
const client = new GameClient(game);
pageShell(app, client, 'map');
const store = client.tab('Map');
const main = document.createElement('main');
app.append(main);
let query = '';
let showAll = true; // the GM's view: every place, or only those on the map
const shownLevel = {}; // place index -> which of its levels is showing

const key = s => String(s || '').trim().toLowerCase();
const isGm = () => client.role === 'gm';
// Rows the GM deleted here, held a few seconds before the sheet hears (hold.js): row JSON -> hold.
const gone = new Map();

// The Map tab as regions, each with its maps and places; a place has its levels.
function world(rows) {
  const regions = [];
  const region = name => {
    let r = regions.find(x => key(x.name) === key(name));
    if (!r) regions.push(r = { name: String(name || '').trim(), maps: [], places: [] });
    return r;
  };
  const places = new Map();
  const levels = [];
  rows.forEach((row, at) => {
    if (gone.has(JSON.stringify(row))) return; // a deleted place's levels go with it
    const [reg, loc, level, image, text, notes, shown] = row;
    const item = { at, name: String(level || loc || reg || '').trim(), image, text: String(text || ''), notes: String(notes || '') };
    if (!String(loc || '').trim()) { region(reg).maps.push(item); return; }
    if (String(level || '').trim()) { levels.push([key(loc), { ...item, loc: String(loc).trim() }]); return; }
    if (places.has(key(loc))) return;
    const p = { ...item, region: String(reg || '').trim(), i: places.size, on: shown === 'on', levels: [] };
    places.set(key(loc), p);
    region(reg).places.push(p);
  });
  for (const [k, lv] of levels) places.get(k)?.levels.push({ ...lv, place: places.get(k) });
  for (const p of places.values()) p.search = [p.name, p.text, p.notes, ...p.levels.flatMap(l => [l.name, l.text])].join(' ').toLowerCase();
  return regions;
}

const imgHTML = (item, cls) => pictureHTML('Map', item.image, item.name, cls);
showPictures(main, client);

/* ---------- the page ---------- */

const notesHTML = it => (isGm() && it.notes.trim() ? `<details class="orig"><summary>GM notes</summary>${md(it.notes)}</details>` : '');

function placeHTML(p) {
  const at = Math.min(shownLevel[p.i] || 0, Math.max(p.levels.length - 1, 0));
  const lv = p.levels[at];
  const toggle = isGm()
    ? `<button class="pbtn mapon${p.on ? ' on' : ''}" data-place="${p.i}" aria-pressed="${p.on}" title="${p.on ? 'Take it off the crew’s map' : 'Put it on the crew’s map'}">${p.on ? 'On the map' : 'Hidden'}</button>`
    : '';
  const edit = (at, label) => (isGm() ? `<button class="ic" data-edit="${at}" title="${label}" aria-label="${label}">${ICON.pen}</button>` : '');
  const share = isGm() ? shareButtonHTML({ type: 'place', ref: p.name, title: p.name }) + (p.image ? shareButtonHTML({ type: 'picture', ref: joinRef('Map', p.name), title: `${p.name} (picture)` }, 'Share picture') : '') : '';
  const shareLv = lv && isGm() ? shareButtonHTML({ type: 'level', ref: joinRef(p.name, lv.name), title: `${p.name}: ${lv.name}` }, `Share ${lv.name}`) : '';
  return `<section class="card loc${p.on ? '' : ' off'}" id="loc-${p.i}"><div class="shead"><h2>${escTxt(p.name)}</h2>${toggle}${edit(p.at, `Edit ${esc(p.name)}`)}</div>
    ${share ? `<div class="prow">${share}</div>` : ''}
    ${p.text.trim() ? `<div class="rich">${md(p.text)}</div>` : ''}
    ${imgHTML(p, 'rimg')}
    ${p.levels.length ? `<div class="levels">
      <div class="shead"><div class="cats" role="group" aria-label="Levels">${p.levels.map((l, k) => `<button data-loc="${p.i}" data-lv="${k}" aria-pressed="${k === at}" class="${k === at ? 'on' : ''}">${escTxt(l.name)}</button>`).join('')}</div>${edit(lv.at, `Edit ${esc(lv.name)}`)}${shareLv}</div>
      ${lv.text.trim() ? `<div class="rich">${md(lv.text)}</div>` : ''}${imgHTML(lv, 'rimg')}${notesHTML(lv)}</div>` : ''}
    ${notesHTML(p)}
    ${isGm() ? `<button class="add sm" data-new="level" data-for="${p.i}">+ Level</button>` : ''}</section>`;
}

let W = world(store.rows); // a cached copy shows at once; the sheet may say it's unchanged
const allPlaces = () => W.flatMap(r => r.places);

const search = debounce(() => { const w = document.getElementById('world'); if (w) w.innerHTML = worldHTML(); });
function render() {
  search.cancel();
  if (!store.loaded && !store.missing) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (store.missing) {
    main.innerHTML = isGm()
      ? '<div class="empty">No Map tab yet. Add a place or a region’s map to start one.</div><div class="mtools"><button class="pbtn" data-new="place">+ Place</button><button class="pbtn" data-new="map">+ Region map</button></div>'
      : '<div class="empty">Nothing on the map yet.</div>';
    return;
  }
  const gm = isGm();
  const onCount = allPlaces().filter(p => p.on).length;
  main.innerHTML = `
    <div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search places" value="${esc(query)}" aria-label="Search places" autocomplete="off">
      ${gm ? `<div class="cats"><button data-show="all" aria-pressed="${showAll}" class="${showAll ? 'on' : ''}">Every place</button><button data-show="on" aria-pressed="${!showAll}" class="${showAll ? '' : 'on'}">On the map (${onCount})</button></div>
        <button class="pbtn" data-new="place">+ Place</button><button class="pbtn" data-new="map">+ Region map</button>` : ''}
    </div>
    ${gm ? '<div class="robar"><span>You choose which places the crew see; every place starts hidden.</span></div>' : ''}
    <div id="world">${worldHTML()}</div>`;
}

// The regions and places that match the search: all a search redraws.
function worldHTML() {
  const q = query.trim().toLowerCase();
  const gm = isGm();
  const visible = p => (!q || p.search.includes(q)) && ((gm && showAll) || p.on);
  const none = gm ? (q ? 'No matches.' : showAll ? 'No places in the Map tab yet.' : 'No places on the map yet: show every place and turn some on.')
    : (q ? 'No matches.' : 'Nothing on the map yet.');
  const regions = W.map(r => ({ ...r, maps: r.maps.filter(m => !q || `${m.name} ${m.text}`.toLowerCase().includes(q)), places: r.places.filter(visible) }))
    .filter(r => r.maps.length || r.places.length);
  return `
      ${regions.map(r => `<div class="mgroup"><h3>${escTxt(r.name || 'Places')}${gm ? r.maps.map(m => `<button class="ic" data-edit="${m.at}" title="Edit the ${esc(m.name)} map" aria-label="Edit the ${esc(m.name)} map">${ICON.pen}</button>`).join('') : ''}${gm && r.maps.length && r.name ? shareButtonHTML({ type: 'region', ref: r.name, title: `${r.name} map` }, 'Share map') : ''}</h3>
        ${r.maps.map(m => [imgHTML(m, 'mapimg'), m.text.trim() ? `<div class="rich">${md(m.text)}</div>` : '', notesHTML(m)].join('')).filter(Boolean).map(h => `<section class="worldmap">${h}</section>`).join('')}
        ${r.places.length ? `<div class="cols">${r.places.map(placeHTML).join('')}</div>` : ''}</div>`).join('')}
      ${!regions.some(r => r.places.length) ? `<div class="empty">${none}</div>` : ''}`;
}

const rerenderCard = p => { const el = document.getElementById(`loc-${p.i}`); if (el) el.outerHTML = placeHTML(p); };

async function setOn(p, on) {
  p.on = on; // shows at once; the read that follows has the sheet's word
  render();
  try {
    const r = await client.request({ op: 'show', location: p.name, on });
    if (!r.ok) throw new Error(r.error);
  } finally {
    await client.read(['Map']).catch(() => {});
  }
}

wireShare(main, client);
main.addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]');
  if (ed && isGm()) { openEditor(itemAt(+ed.dataset.edit)); return; }
  const nw = e.target.closest('[data-new]');
  if (nw && isGm()) { openEditor(null, nw.dataset.new, allPlaces().find(x => String(x.i) === nw.dataset.for)); return; }
  const t = e.target.closest('[data-place]');
  if (t && isGm()) {
    const p = allPlaces().find(x => String(x.i) === t.dataset.place);
    if (p) setOn(p, !p.on).catch(err => toast(err.message, 'lo'));
    return;
  }
  const s = e.target.closest('[data-show]');
  if (s) { showAll = s.dataset.show === 'all'; render(); return; }
  const b = e.target.closest('[data-lv]');
  if (!b) return;
  shownLevel[b.dataset.loc] = +b.dataset.lv;
  const p = allPlaces().find(x => String(x.i) === b.dataset.loc);
  if (p) rerenderCard(p);
});
main.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  query = e.target.value;
  search();
});
/* ---------- the GM's editor ----------
 * Adds, changes or removes a Map row (op "place"). A picture is kept, cleared, picked from the
 * Images tab, or uploaded there under a name (so it's stored once and can be picked again).
 */
const itemAt = at => W.flatMap(r => [...r.maps, ...r.places, ...r.places.flatMap(p => p.levels)]).find(x => x.at === at);
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

// kind: 'map' (a region's own map), 'place' or 'level'; it is the item to change, or null for a new one.
function openEditor(it, kind, place) {
  if (it) kind = it.place ? 'level' : it.levels ? 'place' : 'map';
  const title = it ? `Edit ${it.name}` : kind === 'level' ? `New level of ${place.name}` : kind === 'place' ? 'New place' : 'New region map';
  const regions = [...new Set(W.map(r => r.name).filter(Boolean))];
  const reg = it ? (kind === 'level' ? '' : regionOf(it)) : '';
  const name = it ? it.name : '';
  const pic = it?.image || '';
  const o = modal(`
    <div class="prow"><h2>${escTxt(title)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    ${kind !== 'level' ? `<label class="field"><span class="lbl">Region</span><input class="in" data-f="region" value="${esc(reg)}" list="map-regions" ${kind === 'map' ? 'required' : ''}></label>
      <datalist id="map-regions">${regions.map(r => `<option value="${esc(r)}">`).join('')}</datalist>` : ''}
    ${kind !== 'map' ? `<label class="field"><span class="lbl">${kind === 'level' ? 'Level' : 'Place'}</span><input class="in" data-f="name" value="${esc(name)}" required></label>` : ''}
    <label class="field"><span class="lbl">Text</span><textarea class="in rtext" data-f="text">${escTxt(it?.text || '')}</textarea></label>
    <label class="field"><span class="lbl">GM notes</span><textarea class="in rtext" data-f="notes">${escTxt(it?.notes || '')}</textarea></label>
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
  const row = it ? { row: store.server.ns?.[it.at] || 0, was: store.server.rows[it.at] } : { row: 0 };
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
    const cells = kind === 'level' ? ['', (it ? it.loc : place.name), nm, v('text'), v('notes')]
      : [v('region'), kind === 'place' ? nm : '', '', v('text'), v('notes')];
    if (kind === 'level' && it) cells[0] = String(store.server.rows[it.at][0] || '');
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
  redraw();
  deletedToast(it.name, () => { gone.get(k)?.cancel(); if (gone.delete(k)) redraw(); });
}

store.on(() => { W = world(store.rows); render(); });
client.on(e => {
  if (e.list) refreshNav(client, 'map');
  if (e.list || e.key || e.auth) render();
});
render();
client.watch('Map');
client.read(['Map']).catch(() => render());
client.startPolling();
