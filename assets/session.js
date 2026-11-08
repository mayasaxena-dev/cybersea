// The Session page: session.html?g=<game>. A desktop everyone shares during play, kept in the
// Session tab (session-model.js): folders of what the GM shared, the windows the GM has open
// (every Session tab shows the same ones, where the GM put them), the session's rolls, and the
// prompt to run Session Begins, Session Ends or Chapter's End when the GM starts or ends one.
// It shows only what's been shared, and never links to the GM page, so the GM can screenshare it.
// The GM opens, moves, resizes and closes windows here; anyone signed in can add notes to a
// folder, and edit or delete their own.
import { bootstrap, ls, gkey } from './games.js';
import { mountMap } from './mapview.js';
import { GameClient } from './api.js';
import { md } from './markup.js';
import { gameRules, TABS as RULE_TABS } from './rules.js';
import { parseSheet, serializeSheet, logId, rowKey, parseTrack } from './codec.js';
import { makeActions } from './actions.js';
import { pictureHTML, showPictures } from './pictures.js';
import { crewCardHTML, shipCardHTML, staticPips } from './cards.js';
import { recordHTML } from './refview.js';
import { parseRoll, rollHTML, ROLLS_TAB } from './rolls.js';
import { esc, escTxt, modal, closeModal, toast, pageShell, refreshNav, whenIdle, noGame, typingIn } from './core.js';
import {
  SESSION_TAB, NPCS_TAB, parseSession, itemsIn, subfolders, sessionOf, owedPrompt, refParts, cleanPath, parentOf, baseName,
  windowRow, noteRow, shareRow, nextBox, topZ, parseNpcs, clampBox, MAP_WIN, focusRow,
} from './session-model.js';
import { writeRows } from './share.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) noGame(app, 'session');
const client = new GameClient(game);
pageShell(app, client, 'session');
const main = document.createElement('main');
main.className = 'desk';
app.append(main);
showPictures(main, client);

const store = client.tab(SESSION_TAB);
const isGm = () => client.role === 'gm';
const low = s => String(s ?? '').trim().toLowerCase();
let S = parseSession(store.rows);
let R = gameRules(client);
let cwd = S.current?.title || ''; // the folder the explorer shows
let shown = cwd;                   // the running session the explorer last opened on
let sel = '';                      // the file the explorer previews
let drag = null;                   // a window being moved or resized by the GM
let seen = null;                   // the windows open at the last render (null before the first)

/* ---------- this viewer's own apps ----------
 * The desktop's icons open the Files and Map apps in windows of this viewer's own: nobody else's
 * desktop follows them. The GM's Map icon opens the Map for everyone instead (MAP_WIN). Where they
 * sit is kept in this browser.
 */
const APPS_KEY = gkey(game || { id: '' }, 'session-apps');
const APP_BOX = { files: { x: 10, y: 3, w: 34, h: 90 }, map: { x: 14, y: 5, w: 70, h: 85 } };
let apps = (() => { try { return ls.get(APPS_KEY, null) || { files: { ...APP_BOX.files, z: 1 } }; } catch { return { files: { ...APP_BOX.files, z: 1 } }; } })();
const saveApps = () => { try { ls.set(APPS_KEY, apps); } catch { /* private window: they're not kept */ } };
const appTop = () => Math.max(0, ...Object.values(apps).map(a => a.z || 0)) + 1;
function openApp(id) { apps[id] = { ...(apps[id] || APP_BOX[id]), z: appTop() }; saveApps(); render(); }
function closeApp(id) { delete apps[id]; saveApps(); render(); }

/* ---------- what a share shows ---------- */
const mapRows = () => client.tab('Map').rows;
const loreRow = (cat, title) => client.tab('Lore').rows.find(r => rowKey(r[0], r[1]) === rowKey(cat, title));
const placeOf = name => mapRows().find(r => low(r[1]) === low(name) && !String(r[2]).trim());
const levelOf = (place, level) => mapRows().find(r => low(r[1]) === low(place) && low(r[2]) === low(level));
const levelsOf = name => mapRows().filter(r => low(r[1]) === low(name) && String(r[2]).trim());
const gone = '<div class="empty gone"><img class="ico" src="assets/icons/warning.svg" alt="">This isn’t shared any more.</div>';
const mapItem = (row, title = row[2] || row[1] || row[0]) => `${String(row[4]).trim() ? `<div class="rich">${md(row[4])}</div>` : ''}${pictureHTML('Map', row[3], title, 'rimg')}`;

function titleOf(it) {
  if (it.type === 'map') return 'Map';
  if (it.type === 'note') return `Note from ${it.author || 'someone'}`;
  if (it.type === 'ship') return 'The ship';
  if (it.type === 'lore' || it.type === 'picture' || it.type === 'level') return refParts(it.ref).pop();
  return it.ref || it.type;
}
// The desktop's icons (assets/icons): pixel art, in the site's teal.
const ICONS = { map: 'web', place: 'web', level: 'web', region: 'web', lore: 'file', rule: 'file', npc: 'computer', clock: 'hourglass', crew: 'computer', ship: 'disk', picture: 'photo', scene: 'star1', note: 'message' };
const icon = name => `<img class="ico" src="assets/icons/${name}.svg" alt="">`;
const iconOf = it => icon(ICONS[it.type] || 'file');

function bodyHTML(it) {
  const [a, b, c] = refParts(it.ref);
  switch (it.type) {
    case 'scene': return `<div class="scene"><h3>${escTxt(it.ref)}</h3>${it.body ? `<div class="rich">${md(it.body)}</div>` : ''}</div>`;
    case 'note': return `<div class="rich">${md(it.body || '')}</div>`;
    case 'clock': return `<div class="clock"><span class="pips">${staticPips(parseTrack(it.body))}</span></div>`;
    case 'place': {
      const p = placeOf(it.ref);
      return p ? mapItem(p, it.ref) + levelsOf(it.ref).map(l => `<h4>${escTxt(l[2])}</h4>${mapItem(l)}`).join('') : gone;
    }
    case 'level': { const l = levelOf(a, b); return l ? mapItem(l) : gone; }
    case 'region': {
      const maps = mapRows().filter(r => low(r[0]) === low(it.ref) && !String(r[1]).trim());
      return maps.length ? maps.map(m => mapItem(m)).join('') : gone;
    }
    case 'lore': {
      const r = loreRow(a, b);
      if (!r) return gone;
      const img = client.tab('Lore').imageOf(r[0], r[1]);
      return `<div class="note">${escTxt(a)}</div>${String(r[2]).trim() ? `<div class="rich">${md(r[2])}</div>` : ''}${img ? pictureHTML('Lore', img, b, 'rimg') : ''}`;
    }
    case 'picture': {
      if (low(a) === 'lore') { const r = loreRow(b, c); const img = r && client.tab('Lore').imageOf(r[0], r[1]); return img ? pictureHTML('Lore', img, c, 'rimg big') : gone; }
      const row = c ? levelOf(b, c) : placeOf(b) || mapRows().find(r => low(r[0]) === low(b) && !String(r[1]).trim());
      return row && row[3] ? pictureHTML('Map', row[3], c || b, 'rimg big') : gone;
    }
    case 'rule': {
      const r = R.recs.find(x => low(x.name) === low(it.ref));
      return r ? recordHTML(r, true) : gone;
    }
    case 'npc': {
      const n = parseNpcs(client.tab(NPCS_TAB).rows).find(x => low(x.name) === low(it.ref));
      if (!n) return gone;
      return `${n.tags ? `<div class="tagtext">${escTxt(n.tags)}</div>` : ''}${n.harm ? `<div class="cc-row"><span class="lbl">Harm</span><span class="pips harm">${staticPips(parseTrack(n.harm))}</span></div>` : ''}${n.notes ? `<div class="rich">${md(n.notes)}</div>` : ''}`;
    }
    case 'crew': return client.list.some(t => t.kind === 'character' && low(t.name) === low(it.ref)) ? `<div class="crew">${crewCardHTML(client, it.ref)}</div>` : gone;
    case 'ship': return `<div class="crew">${shipCardHTML(client)}</div>`;
  }
  return gone;
}

/* ---------- the Map app ----------
 * The crew's map (mapview.js), in a window: the same interactive map as the Map page, showing
 * only what the crew see, even to the GM. It's made once and moved into its window at each
 * render, so the camera stays put. Opening a place's share shows that place on it, for everyone.
 */
const mapApp = document.createElement('div');
mapApp.className = 'mapapp';
const mapMain = document.createElement('div');
mapMain.className = 'mapmain';
const mapDrawer = document.createElement('div');
mapDrawer.className = 'mapcard';
mapApp.append(mapMain, mapDrawer);
let mapView = null;
let focused = '';
function placeMap() {
  const slot = main.querySelector('[data-mapslot]');
  if (!slot) return;
  if (!mapView) mapView = mountMap({ client, game, main: mapMain, drawer: mapDrawer, crew: true, embedded: true });
  slot.replaceWith(mapApp);
  const f = S.focus ? `${S.focus.place}\n${S.focus.level}` : '';
  if (f !== focused) { focused = f; if (S.focus) mapView.focus(S.focus.place, S.focus.level); }
}
const MAP_ITEM = { type: 'map', ref: 'Map' };
// The GM opens a place or level's share on the map: the Map app comes up showing it.
function showOnMap(it) {
  const [a, b] = refParts(it.ref);
  setWindows(rows => {
    const w = S.windows.find(x => x.id === MAP_WIN);
    return [...withoutWindow(rows, MAP_WIN).filter(r => low(r[0]) !== 'focus'), windowRow(MAP_WIN, w || { x: 6, y: 4, w: 70, h: 80 }, topZ(S)), it.type === 'level' ? focusRow(a, b) : focusRow(it.ref)];
  });
  render();
}

/* ---------- the desktop ---------- */
const itemOf = id => (id === MAP_WIN ? MAP_ITEM : S.items.find(i => i.id === id));
function windowHTML(w) {
  const it = itemOf(w.id);
  const gm = isGm();
  return `<section class="win" data-win="${esc(w.id)}" aria-label="${esc(titleOf(it))}">
    <div class="wbar"${gm ? ' data-drag="move"' : ''}><span class="wic" aria-hidden="true">${iconOf(it)}</span><span class="wtitle">${escTxt(titleOf(it))}</span>
      ${gm ? `<button class="wbtn" data-wclose="${esc(w.id)}" title="Close this window for everyone" aria-label="Close">×</button>` : ''}</div>
    <div class="wbody${w.id === MAP_WIN ? ' mapbody' : ''}">${w.id === MAP_WIN ? '<div data-mapslot></div>' : bodyHTML(it)}</div>
    ${gm ? '<span class="wgrip" data-drag="size" aria-hidden="true"></span>' : ''}
  </section>`;
}

/* ---------- the explorer ---------- */
const mine = it => it.kind === 'note' && !!client.me && low(it.author) === low(client.me);
function explorerHTML() {
  const here = itemsIn(S, cwd);
  const subs = subfolders(S, cwd);
  const ses = sessionOf(S, cwd);
  const top = cwd ? `<button class="file up" data-cd="${esc(parentOf(cwd))}"><span class="fic">↑</span><span>Up</span></button>` : '';
  const files = top + subs.map(f => `<button class="file folder${sessionOf(S, f) ? ' sess' : ''}${S.current && f === S.current.title ? ' live' : ''}" data-cd="${esc(f)}"><span class="fic">${icon(sessionOf(S, f) ? 'floppy' : 'folder')}</span><span>${escTxt(baseName(f))}</span></button>`).join('') +
    here.map(it => `<button class="file${sel === it.id ? ' on' : ''}${S.windows.some(w => w.id === it.id) ? ' open' : ''}" data-sel="${esc(it.id)}"><span class="fic">${iconOf(it)}</span><span>${escTxt(titleOf(it))}</span></button>`).join('');
  const it = here.find(i => i.id === sel);
  const canNote = !!cwd && (isGm() || client.canEdit(SESSION_TAB));
  const tools = `${isGm() ? '<button class="pbtn" data-act="mkdir">New folder</button>' : ''}${isGm() && cwd ? '<button class="pbtn" data-act="scene">Scene card</button>' : ''}${canNote ? '<button class="pbtn" data-act="note">New note</button>' : ''}`;
  const preview = it ? `<div class="preview"><div class="phead"><b>${escTxt(titleOf(it))}</b><span class="grow"></span>
      ${isGm() ? `<button class="pbtn" data-open="${esc(it.id)}">${it.type === 'place' || it.type === 'level' ? 'Show on the map' : S.windows.some(w => w.id === it.id) ? 'Bring to front' : 'Open for everyone'}</button>` : ''}
      ${mine(it) ? `<button class="pbtn" data-edit="${esc(it.id)}">Edit</button>` : ''}
      ${isGm() || mine(it) ? `<button class="pbtn del" data-del="${esc(it.id)}">${icon('trash')}Delete</button>` : ''}</div>
      <div class="pbody">${bodyHTML(it)}</div></div>` : '';
  return `<div class="addr" aria-label="Folder">${escTxt(cwd ? `C:\\${cwd.replace(/\//g, '\\')}` : 'C:\\')}${ses ? ` <span class="cnt">${ses.end ? 'ended' : 'running'}</span>` : ''}</div>
    <div class="files">${files || '<div class="empty">Nothing here yet.</div>'}</div>
    ${tools ? `<div class="prow tools">${tools}</div>` : ''}
    ${preview}`;
}

// One of this viewer's app windows (see apps): anyone can move, resize or close their own.
function appHTML(id) {
  const [title, ic, body, cls] = id === 'files' ? ['Files', 'computer', explorerHTML(), 'wbody ebody'] : ['Map', 'web', '<div data-mapslot></div>', 'wbody mapbody'];
  return `<section class="win app${id === 'files' ? ' explorer' : ''}" data-app-win="${id}" aria-label="${title}">
    <div class="wbar" data-drag="move"><span class="wic" aria-hidden="true">${icon(ic)}</span><span class="wtitle">${title}</span>
      <button class="wbtn" data-aclose="${id}" title="Close" aria-label="Close">×</button></div>
    <div class="${cls}">${body}</div>
    <span class="wgrip" data-drag="size" aria-hidden="true"></span>
  </section>`;
}
// The app windows to show: the Map's own only while the GM hasn't opened it for everyone.
const appsShown = () => Object.keys(apps).filter(id => APP_BOX[id] && !(id === 'map' && S.windows.some(w => w.id === MAP_WIN)));
const iconsHTML = () => `<nav class="dicons" aria-label="Apps">
    <button class="dicon" data-app="files" title="Your file browser"><img class="ico" src="assets/icons/computer.svg" alt=""><span>Files</span></button>
    <button class="dicon" data-app="map" title="${isGm() ? 'Open the map for everyone' : 'The map'}"><img class="ico" src="assets/icons/web.svg" alt=""><span>Map</span></button>
  </nav>`;

/* ---------- rolls ---------- */
// The session's rolls: live from the Rolls tab while it runs, or what it kept when it ended.
function rollsHTML() {
  const ses = sessionOf(S, cwd) || S.current || S.sessions.at(-1);
  if (!ses) return '<div class="empty">No session yet.</div>';
  const kept = S.rolls[low(ses.title)];
  if (ses.end && kept != null) {
    const lines = kept.split('\n').filter(Boolean);
    return `<div class="note">${escTxt(ses.title)}</div>${lines.length ? `<ul class="klist">${lines.map(l => `<li>${escTxt(l)}</li>`).join('')}</ul>` : '<div class="empty">No rolls.</div>'}`;
  }
  const from = Date.parse(ses.start) || 0;
  const to = Date.parse(ses.end) || Infinity;
  const rs = client.tab(ROLLS_TAB).rows.map(parseRoll).filter(r => { const t = Date.parse(r.when); return t >= from && t <= to; }).reverse();
  return `<div class="note">${escTxt(ses.title)}</div>${rs.length ? `<ul class="rlist">${rs.map(r => rollHTML(r)).join('')}</ul>` : '<div class="empty">No rolls yet.</div>'}`;
}

/* ---------- the prompt: Session Begins, Session Ends, Chapter's End ---------- */
const ACTION_LABEL = { 'session-begin': 'Session Begins', 'session-end': 'Session Ends', 'chapter-end': 'Chapter’s End' };
const labelOf = action => R.recs.find(r => low(r.meta.action) === action && r.meta.label)?.meta.label || R.recs.find(r => low(r.meta.action) === action)?.name || ACTION_LABEL[action];
function promptHTML() {
  const p = owedPrompt(S, client.me);
  if (!p) return '';
  return `<div class="prompt" role="status"><span>${escTxt(p.title || 'The GM')}: time for <b>${escTxt(labelOf(p.action))}</b>.</span><span class="grow"></span>
    <button class="pbtn primary" data-run="${esc(p.action)}" data-stamp="${esc(p.stamp)}">${escTxt(labelOf(p.action))}</button></div>`;
}

// Runs the action on the signed-in character's sheet: its dialog asks what needs a choice, then
// one press does it all. An Undo puts the sheet back as it was.
function runPrompt(action, stamp) {
  const me = client.me;
  if (!me) return;
  const sheet = client.tab(me);
  let st = parseSheet(sheet.rows);
  const before = serializeSheet(st);
  const actions = makeActions({
    st: () => st,
    rules: () => R,
    editing: () => false,
    render: () => {},
    used: () => {},
    keep: {},
    changed: () => {
      const after = serializeSheet(st);
      sheet.change(before, after);
      const doneRow = ['done', `${action}:${me}`, stamp, ''];
      store.change(store.rows, [...store.rows.filter(r => rowKey(r[0], r[1]) !== rowKey(doneRow[0], doneRow[1])), doneRow]);
      render();
      toast(`${labelOf(action)}: done on ${me}’s sheet`, '', {
        label: 'Undo',
        run: () => {
          sheet.change(sheet.rows, before);
          store.change(store.rows, store.rows.filter(r => rowKey(r[0], r[1]) !== rowKey(doneRow[0], doneRow[1])));
          st = parseSheet(before);
          render();
        },
      }, 15000);
    },
  });
  actions.open(action);
}

/* ---------- the page ---------- */
function render() {
  S = parseSession(store.rows);
  // A session that starts (or is running when the page opens) opens in the explorer.
  if (S.current && S.current.title !== shown) { cwd = S.current.title; sel = ''; if (!apps.files) apps.files = { ...APP_BOX.files, z: appTop() }; }
  shown = S.current?.title || '';
  if (cwd && !S.folders.includes(cwd)) cwd = '';
  document.title = `${S.current ? '● ' : ''}Session · ${client.game.name || 'Cybersea'}`;
  const live = S.current ? `<b>${escTxt(S.current.title)}</b> · running` : 'No session running';
  if (!store.loaded && !store.missing) { main.innerHTML = '<div class="empty"><span class="gload" data-text="Loading" aria-label="Loading">Loading</span></div>'; return; }
  main.innerHTML = `
    <div class="sbanner" role="banner"><span class="sdot${S.current ? ' on' : ''}" aria-hidden="true"></span><span class="gtext" data-text="SESSION · shared screen">SESSION · shared screen</span><span class="grow"></span><span>${live}</span></div>
    ${promptHTML()}
    <div class="dwrap">
      <section class="desktop" id="desktop" aria-label="Desktop">${iconsHTML()}${S.windows.map(windowHTML).join('')}${appsShown().map(appHTML).join('')}${S.windows.length || appsShown().length ? '' : `<div class="dempty">${icon('star4')}<span>Nothing open on the desktop.</span></div>`}</section>
      <aside class="dside drolls"><div class="win"><div class="wbar"><span class="wic" aria-hidden="true">${icon('hourglass')}</span><span class="wtitle">Rolls</span></div><div class="wbody">${rollsHTML()}</div></div></aside>
    </div>`;
  // Where each window sits (the page's CSP allows no inline style attributes, so it's set here).
  // A window that wasn't open last time glitches in.
  for (const w of S.windows) {
    const el = main.querySelector(`[data-win="${CSS.escape(w.id)}"]`);
    if (!el) continue;
    Object.assign(el.style, { left: `${w.x}%`, top: `${w.y}%`, width: `${w.w}%`, height: `${w.h}%`, zIndex: String(1 + w.z) }); // over the icons
    if (seen && !seen.has(w.id)) el.classList.add('fresh');
  }
  // This viewer's apps sit above what the GM shares.
  for (const id of appsShown()) {
    const a = apps[id];
    const el = main.querySelector(`[data-app-win="${id}"]`);
    Object.assign(el.style, { left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%`, zIndex: String(1000 + (a.z || 0)) });
    if (seen && !seen.has(`app:${id}`)) el.classList.add('fresh');
  }
  seen = new Set([...S.windows.map(w => w.id), ...appsShown().map(id => `app:${id}`)]);
  placeMap();
  requestAnimationFrame(glitchAll);
}

/* ---------- glitching pictures ---------- */
// A picture on the desktop now and then tears into strips that jump sideways and shift hue, then
// snaps back: thin strips of the same picture laid over it, each on its own random timing.
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);
function glitch(img) {
  const box = img.parentElement;
  if (reduced() || !img.complete || !img.naturalWidth || !box || box.querySelector('.strips')) return;
  const w = img.clientWidth;
  const ht = img.clientHeight;
  if (!w || !ht) return;
  const strips = document.createElement('span');
  strips.className = 'strips';
  strips.setAttribute('aria-hidden', 'true');
  Object.assign(strips.style, { width: `${w}px`, height: `${ht}px`, left: `${img.offsetLeft}px`, top: `${img.offsetTop}px` });
  const dur = Math.round(rnd(6000, 11000));
  for (let top = 0; top < ht;) {
    const h = Math.min(ht - top, Math.round(rnd(2, 14)));
    const st = document.createElement('span');
    Object.assign(st.style, {
      height: `${h}px`, backgroundImage: `url("${img.currentSrc || img.src}")`, backgroundSize: `${w}px ${ht}px`,
      backgroundPosition: `0 -${top}px`, animationName: `g-strip-${1 + Math.floor(Math.random() * 3)}`,
      animationDuration: `${dur}ms`, animationDelay: `${Math.round(rnd(0, 3000))}ms`,
    });
    st.style.setProperty('--gx1', `${Math.round(rnd(-24, 24))}px`);
    st.style.setProperty('--gx2', `${Math.round(rnd(-16, 16))}px`);
    st.style.setProperty('--gh1', `${Math.round(rnd(-40, 40))}deg`);
    st.style.setProperty('--gh2', `${Math.round(rnd(-40, 40))}deg`);
    strips.append(st);
    top += h;
  }
  box.classList.add('glitchy');
  box.append(strips);
}
// Only what the GM shares glitches: not icons, the map, or the viewer's Files.
const glitchy = img => img.matches('.desktop [data-win] .wbody img:not(.ico)') && !img.closest('.mapapp');
const glitchAll = () => main.querySelectorAll('.desktop [data-win] .wbody img').forEach(img => { if (glitchy(img)) glitch(img); });
main.addEventListener('load', e => { if (e.target.matches?.('img') && glitchy(e.target)) glitch(e.target); }, true);

const busy = () => !!drag || typingIn(main) || !!document.getElementById('overlay');
const later = whenIdle(main, busy);
store.on(() => later(render));
for (const t of [NPCS_TAB, 'Map', 'Lore', 'Ship', ROLLS_TAB]) client.tab(t).on(() => later(render));
for (const t of RULE_TABS) client.tab(t).on(() => { R = gameRules(client); later(render); });
const characters = () => client.list.filter(t => t.kind === 'character').map(t => t.name);
client.on(e => {
  if (!e.list) return;
  refreshNav(client, 'session');
  const fresh = characters().filter(n => !client.watched.has(n));
  fresh.forEach(n => { client.watch(n); client.tab(n).on(() => later(render)); });
  if (fresh.length) client.read().catch(() => {});
  later(render);
});

/* ---------- interactions ---------- */
const setWindows = next => store.change(store.rows, next(store.rows));
const withoutWindow = (rows, id) => rows.filter(r => !(low(r[0]) === 'window' && r[1] === id));
function openWindow(id) {
  setWindows(rows => {
    const w = S.windows.find(x => x.id === id);
    return [...withoutWindow(rows, id), windowRow(id, w || nextBox(S), topZ(S))];
  });
  render();
}

function editNote(it) {
  const o = modal(`<div class="prow"><h2>${it ? 'Edit note' : 'New note'}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <div class="note">In ${escTxt(cwd)}. Everyone can read it; it goes on the desktop only if the GM opens it.</div>
    <textarea class="in rtext" data-text aria-label="Note">${escTxt(it?.body || '')}</textarea>
    <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-save>Save</button></div>`, { label: 'Note' });
  const ta = o.querySelector('[data-text]');
  ta.focus();
  o.querySelector('[data-save]').addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) return;
    const author = isGm() && !client.me ? 'GM' : client.me;
    const row = noteRow(it?.id || logId(), it?.folder || cwd, it?.author || author, text);
    store.change(store.rows, [...store.rows.filter(r => !(low(r[0]) === 'note' && r[1] === row[1])), row]);
    closeModal();
    sel = row[1];
    render();
  });
}

function sceneCard() {
  const o = modal(`<div class="prow"><h2>Scene card</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <label class="field"><span class="lbl">Title</span><input class="in" data-title placeholder="Three days later"></label>
    <textarea class="in rtext" data-text aria-label="Text" placeholder="Vega Station"></textarea>
    <label class="eff"><input type="checkbox" data-openit checked>Open it for everyone</label>
    <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-save>Share</button></div>`, { label: 'Scene card' });
  o.querySelector('[data-title]').focus();
  o.querySelector('[data-save]').addEventListener('click', () => {
    const title = o.querySelector('[data-title]').value.trim();
    if (!title) return;
    const id = logId();
    const open = o.querySelector('[data-openit]').checked;
    store.change(store.rows, [...store.rows, shareRow(id, cwd, { type: 'scene', ref: title, body: o.querySelector('[data-text]').value.trim() }), ...(open ? [windowRow(id, nextBox(S), topZ(S))] : [])]);
    closeModal();
    sel = id;
    render();
  });
}

function mkdir() {
  const o = modal(`<div class="prow"><h2>New folder</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <label class="field"><span class="lbl">Name${cwd ? ` (in ${escTxt(cwd)})` : ''}</span><input class="in" data-name placeholder="Vega Station"></label>
    <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-save>Make it</button></div>`, { label: 'New folder' });
  o.querySelector('[data-name]').focus();
  o.querySelector('[data-save]').addEventListener('click', async () => {
    const name = cleanPath(o.querySelector('[data-name]').value);
    if (!name) return;
    const path = cleanPath(cwd ? `${cwd}/${name}` : name);
    await writeRows(client, SESSION_TAB, rows => [...rows, ['folder', path, '', '']]);
    closeModal();
    cwd = path;
    render();
  });
}

// Deleting a share: from its folder only, or everywhere it went when it was shared.
function del(it) {
  const everywhere = it.kind === 'share' && ['lore', 'npc', 'place', 'level'].includes(it.type);
  const drop = rows => withoutWindow(rows, it.id).filter(r => !(low(r[0]) === it.kind && r[1] === it.id));
  const finish = () => { if (sel === it.id) sel = ''; closeModal(); render(); toast(`Deleted ${titleOf(it)}`); };
  if (!everywhere) {
    const o = modal(`<div class="prow"><h2>Delete ${escTxt(titleOf(it))}?</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
      <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary del" data-here>Delete</button></div>`, { label: 'Delete' });
    o.querySelector('[data-here]').addEventListener('click', () => { store.change(store.rows, drop(store.rows)); finish(); });
    return;
  }
  const where = { lore: 'the Lore page', npc: 'the NPCs page', place: 'the crew’s map', level: 'the crew’s map' }[it.type];
  const o = modal(`<div class="prow"><h2>Delete ${escTxt(titleOf(it))}?</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <div class="note">Take it out of this folder only, or off ${where} too?</div>
    <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn" data-here>This folder only</button><button class="pbtn primary del" data-all>Everywhere</button></div>`, { label: 'Delete' });
  o.querySelector('[data-here]').addEventListener('click', () => { store.change(store.rows, drop(store.rows)); finish(); });
  o.querySelector('[data-all]').addEventListener('click', async () => {
    const [a, b] = refParts(it.ref);
    try {
      if (it.type === 'lore') { const L = client.tab('Lore'); L.change(L.rows, L.rows.filter(r => rowKey(r[0], r[1]) !== rowKey(a, b))); }
      if (it.type === 'npc') { const N = client.tab(NPCS_TAB); N.change(N.rows, N.rows.filter(r => low(r[1]) !== low(it.ref))); }
      if (it.type === 'place') await client.request({ op: 'show', location: it.ref, on: false });
      if (it.type === 'level') await client.request({ op: 'show', location: a, level: b, on: false });
    } catch (e) { toast(e.message, 'lo'); }
    store.change(store.rows, drop(store.rows));
    finish();
  });
}

main.addEventListener('click', e => {
  if (e.target.closest('.mapapp')) return; // the map's own clicks
  const cd = e.target.closest('[data-cd]');
  if (cd) { cwd = cd.dataset.cd; sel = ''; render(); return; }
  const s = e.target.closest('[data-sel]');
  if (s) { sel = sel === s.dataset.sel ? '' : s.dataset.sel; render(); return; }
  const op = e.target.closest('[data-open]');
  if (op && isGm()) { const it = itemOf(op.dataset.open); if (it && (it.type === 'place' || it.type === 'level')) showOnMap(it); else openWindow(op.dataset.open); return; }
  const ap = e.target.closest('[data-app]')?.dataset.app;
  if (ap === 'map' && isGm()) { if (apps.map) delete apps.map; saveApps(); openWindow(MAP_WIN); return; }
  if (ap) { openApp(ap); return; }
  const ac = e.target.closest('[data-aclose]');
  if (ac) { closeApp(ac.dataset.aclose); return; }
  const cl = e.target.closest('[data-wclose]');
  if (cl && isGm()) { setWindows(rows => withoutWindow(rows, cl.dataset.wclose)); render(); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) { const it = itemOf(ed.dataset.edit); if (it && mine(it)) editNote(it); return; }
  const dl = e.target.closest('[data-del]');
  if (dl) { const it = itemOf(dl.dataset.del); if (it && (isGm() || mine(it))) del(it); return; }
  const run = e.target.closest('[data-run]');
  if (run) { runPrompt(run.dataset.run, run.dataset.stamp); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'note') editNote(null);
  if (act === 'scene' && isGm()) sceneCard();
  if (act === 'mkdir' && isGm()) mkdir();
});

// The GM drags a window by its title bar, or resizes it by its corner; everyone's desktop follows
// once it's dropped.
main.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-drag]');
  if (!h || e.target.closest('button')) return;
  const app = h.closest('[data-app-win]')?.dataset.appWin;
  if (!app && !isGm()) return;
  const win = h.closest('[data-win],[data-app-win]');
  const desk = document.getElementById('desktop');
  const w = app ? apps[app] : S.windows.find(x => x.id === win.dataset.win);
  if (!w || !desk) return;
  e.preventDefault();
  const r = desk.getBoundingClientRect();
  drag = { id: app || w.id, app: !!app, mode: h.dataset.drag, x0: e.clientX, y0: e.clientY, box: { x: w.x, y: w.y, w: w.w, h: w.h }, r, win, now: null };
  win.style.zIndex = String(app ? 1000 + appTop() : 1 + topZ(S));
  win.setPointerCapture?.(e.pointerId);
});
main.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = ((e.clientX - drag.x0) / drag.r.width) * 100;
  const dy = ((e.clientY - drag.y0) / drag.r.height) * 100;
  const b = drag.box;
  drag.now = clampBox(drag.mode === 'move' ? { ...b, x: b.x + dx, y: b.y + dy } : { ...b, w: b.w + dx, h: b.h + dy });
  Object.assign(drag.win.style, { left: `${drag.now.x}%`, top: `${drag.now.y}%`, width: `${drag.now.w}%`, height: `${drag.now.h}%` });
});
const drop = () => {
  if (!drag) return;
  const { id, now, app } = drag;
  drag = null;
  if (app) { if (now) apps[id] = { ...now, z: appTop() }; saveApps(); render(); return; }
  setWindows(rows => [...withoutWindow(rows, id), windowRow(id, now || S.windows.find(x => x.id === id), topZ(S))]);
  render();
};
main.addEventListener('pointerup', drop);
main.addEventListener('pointercancel', drop);
// A click on a window brings it to the front, for the GM.
main.addEventListener('dblclick', e => {
  const a = e.target.closest('[data-app-win]');
  if (a) { openApp(a.dataset.appWin); return; }
  const win = e.target.closest('[data-win]');
  if (win && isGm()) openWindow(win.dataset.win);
});

/* ---------- start ---------- */
render();
client.watch(SESSION_TAB, NPCS_TAB, 'Map', 'Lore', 'Ship', ...characters());
characters().forEach(n => client.tab(n).on(() => later(render)));
client.read([...RULE_TABS, ...client.watched]).catch(() => render());
client.startPolling();
