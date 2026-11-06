// Character sheet: sheet.html?g=<game>&c=<tab name>. ship.html uses the same page in ship mode
// (<body data-tab="Ship">): the ship's stats and tracks, ship moves, no actions. Which stats,
// tracks and cards a sheet has, and what they're called, come from the Rules tab (system.js).
import { bootstrap, href, ls, gkey, inviteUrl } from './games.js';
import { GameClient } from './api.js';
import { parseSheet, serializeSheet, logId, parseCount } from './codec.js';
import { md, toggleCheck, plain, short } from './markup.js';
import { gameRules, TABS } from './rules.js';
import { systemOf, typeOf, rollOf, cap, sum, fillIn, SHIP as SHIP_TYPE } from './system.js';
import { esc, escTxt, ICON, pips, pipClass, fmt, armed, doRoll, toast, deletedToast, modal, closeModal, pageShell, refreshNav, readOnlyHTML, whenIdle, keepFocus, debounce, fitText, freeName, noGame } from './core.js';
import { makeActions } from './actions.js';
import { shipRows } from './build.js';
import { wealth, wealthOf, setWealth, addTreasure, kitRows, uniqueName } from './kit.js';
import { makeUsage, useItem, useOf, signed } from './usage.js';
import { pictureHTML, showPictures, shrink } from './pictures.js';
import { people, whoIs, bondTarget, crewSystem, newCrew, splitTags } from './crew.js';
import { hold } from './hold.js';
import { tagsHTML, tagListHTML, addTag, removeTag } from './tags.js';
import { staticPips } from './cards.js';

const SHIP = (document.body.dataset.tab || '').toLowerCase() === 'ship';
// The ship's crew tab is there when the game has a crew section (named as the System tab has it).
const SECTION_TABS = SHIP ? [['sheet', 'Ship'], ['crew', ''], ['moves', 'Moves'], ['notes', 'Notes']] : [['sheet', 'Sheet'], ['kit', 'Kit'], ['moves', 'Moves'], ['notes', 'Notes'], ['log', 'Log']];
const PAGE = SHIP ? 'ship' : '';
const params = new URLSearchParams(location.search);

const app = document.getElementById('app');
const game = bootstrap();
const tabName = document.body.dataset.tab || params.get('c') || '';

if (!game || !tabName) {
  noGame(app, '', { ...(game ? { msg: 'No character picked.' } : {}), to: href('index.html', game), label: 'Go to the crew page' });
}

const client = new GameClient(game);
pageShell(app, client, PAGE);
const store = client.tab(tabName);
const uiKey = gkey(game, `ui:${tabName.toLowerCase()}`);
// Only the character's signed-in player (or the GM) edits a sheet; anyone signed in edits the ship.
const canEdit = () => client.canEdit(SHIP ? 'Ship' : tabName);
const ui = Object.assign({ tab: 'sheet', cat: 'all', open: [] }, ls.get(uiKey, {}));
if (!SECTION_TABS.some(([k]) => k === ui.tab)) ui.tab = 'sheet';
// ship.html?crew=<name> (a bond's link) opens that crew member's sheet
let showCrew = SHIP ? params.get('crew') || '' : '';
if (showCrew) ui.tab = 'crew';
const openSet = new Set(ui.open);
const saveUi = () => { ui.open = [...openSet]; ls.set(uiKey, ui); };

let R = gameRules(client);
let st = parseSheet(store.rows);
let base = serializeSheet(st);
let editing = false;
let query = '';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Record a change: only rows that differ from the last serialization are sent.
function changed() {
  const next = serializeSheet(st);
  store.change(base, next);
  base = next;
}

// While someone is typing or a dialog is open, hold remote updates until they're done.
const busy = () => !!document.getElementById('overlay') || (document.activeElement && app.contains(document.activeElement) && document.activeElement.matches('input, textarea, select'));
const later = whenIdle(app, busy);
let shown = store.loaded; // has the page rendered real sheet data yet?
function adopt() {
  const ns = parseSheet(store.rows);
  const nb = serializeSheet(ns);
  if (shown && same(nb, base)) return;
  st = ns;
  base = nb;
  shown = true;
  render();
}
store.on(e => {
  if (e.missing) render();
  else if (e.fromServer) later(adopt);
});
for (const t of TABS) client.tab(t).on(() => { R = gameRules(client); later(render); });
let couldEdit = canEdit();
client.on(e => {
  if (e.list || e.key) refreshNav(client, PAGE);
  if ((e.me || e.list || e.key || e.auth) && canEdit() !== couldEdit) { couldEdit = canEdit(); render(); }
  else if (SHIP && e.me) render(); // ship moves roll with the signed-in character's stats
});

// Changes made outside edit mode offer to go in the log (usage.js), or to be undone.
const usage = makeUsage({
  log: e => { const at = Date.now(); st.log.push({ id: logId(at), at, ...e }); changed(); render(); },
  undone: () => { changed(); render(); },
});
const used = (key, n, line, undo) => { if (!editing && n) usage.add(key, n, line, undo); };

// keep.x(name) notes what something is now, and gives back a function that puts it back. Things are
// found again by name, so it still works after the sheet updates underneath.
const byName = (list, name) => list.find(x => x.name.toLowerCase() === name.toLowerCase());
const keep = {
  tracks: (...names) => {
    const was = names.map(n => [n.toLowerCase(), track(n) && { name: track(n).name, pips: track(n).pips.slice() }]);
    return () => { for (const [k, t] of was) { if (t) st.tracks[k] = { name: t.name, pips: t.pips.slice() }; else delete st.tracks[k]; } };
  },
  bond: name => { const p = byName(st.bonds, name)?.pips.slice(); return () => { const b = byName(st.bonds, name); if (b && p) b.pips = p.slice(); }; },
  crew: name => { const p = byName(st.crew, name)?.pips.slice(); return () => { const c = byName(st.crew, name); if (c && p) c.pips = p.slice(); }; },
  section: title => {
    const text = st.sections.find(s => same_(s.title, title))?.text;
    return () => { const s = st.sections.find(x => same_(x.title, title)); if (s && text != null) s.text = text; };
  },
  move: name => {
    const m = charMove(name);
    const was = m && { marked: m.marked, text: m.text };
    return () => {
      const now = charMove(name);
      if (was && now) Object.assign(now, was);
      else if (!was && now) st.moves.splice(st.moves.indexOf(now), 1);
    };
  },
};
const actions = makeActions({ st: () => st, rules: () => R, changed, render: () => render(), editing: () => editing, used, keep });

// Deleting something: it goes from the page at once and from the sheet a few seconds later
// (TabStore.hideGone), and until then the toast's Undo brings it back where it was.
function removed(what, list, i) {
  if (i < 0 || !list[i]) return;
  const before = serializeSheet(st);
  list.splice(i, 1);
  const undo = store.hideGone(before, serializeSheet(st));
  changed();
  render();
  deletedToast(what, () => { if (undo()) later(adopt); });
}

/* ---------- helpers ---------- */
const track = name => (name ? st.tracks[name.toLowerCase()] : undefined);
const playbook = () => R.playbook(st.info.playbook);
const sys = () => systemOf(R, SHIP ? SHIP_TYPE : typeOf(R, st.info.playbook));
const W = () => wealthOf(sys());
const same_ = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
// Move groups from the Rules tab, in its order; the ship page shows the ship's.
const CATS = () => {
  const groups = [];
  for (const m of R.by('move')) { const g = m.group.toLowerCase(); if (g && !groups.includes(g)) groups.push(g); }
  return ['playbook', ...(SHIP ? groups.filter(g => g === SHIP_TYPE) : groups)];
};
const charMove = name => st.moves.find(m => m.name.toUpperCase() === String(name).toUpperCase());

// The character's moves: their playbook's moves (marked or not) plus any custom ones,
// then the shared moves from the Rules tab.
function moveList() {
  const out = [];
  const pb = playbook();
  const pbMoves = pb ? (SHIP ? pb.smoves : [...pb.moves, ...pb.smoves]) : [];
  for (const m of pbMoves) {
    const mine = charMove(m.name);
    out.push({ cat: 'playbook', name: m.name, text: mine?.text || m.text, meta: m.meta, marked: !!mine?.marked, own: true, base: m.text });
  }
  for (const m of st.moves) {
    if (!pbMoves.some(x => x.name.toUpperCase() === m.name.toUpperCase())) out.push({ cat: 'playbook', name: m.name, text: m.text, meta: {}, marked: m.marked, own: true, custom: true });
  }
  for (const cat of CATS().slice(1)) for (const m of R.moves(cat)) out.push({ cat, name: m.name, text: m.text, meta: m.meta, marked: true });
  return out;
}

// Whose stats a move rolls. A ship move can name the ship's stats or the crew member's making it, so
// on a character's sheet it has both; on the ship's page, the signed-in character's join the ship's.
function rollStats() {
  const of = name => (name ? parseSheet(client.tab(name).rows).stats : []);
  if (SHIP) { const both = [...st.stats, ...of(client.me)]; return () => both; }
  const both = [...st.stats, ...of('Ship')];
  return m => (m.cat.toLowerCase() === SHIP_TYPE ? both : st.stats);
}

const catLabel = c => (c === 'playbook' ? st.info.playbook || 'Playbook' : cap(c));
const CS = () => (SHIP ? crewSystem(R, sys()) : null);
const sectionTabs = () => SECTION_TABS.map(([k, l]) => (k === 'crew' ? [k, CS()?.def.title || ''] : [k, l])).filter(([, l]) => l);
const tabNow = () => (sectionTabs().some(([k]) => k === ui.tab) ? ui.tab : 'sheet');

/* ---------- rendering ---------- */
function headerHTML() {
  const E = editing;
  // The harm and luck tracks (role=harm, role=luck) sit at the top, under whatever names the game gives them.
  const vitals = sys().tracks.filter(d => VITALS.includes(d.role)).map(d => [d, track(d.name)]).filter(([, t]) => t);
  const trackHTML = (label, t, kind, skulls) => `<div class="track ${kind}"><span class="lbl">${escTxt(label)}</span><span class="pips">${pips(`t:${t.name}`, t.pips, label, false, skulls)}</span>${E ? pm(`t:${t.name}`) : ''}</div>`;
  const stats = st.stats.map((s, i) => E
    ? `<div class="stat"><input class="in sk" data-bind="stat:${i}:k" value="${esc(s.k)}" aria-label="Stat"><input class="in sv" type="number" step="1" data-bind="stat:${i}:v" value="${s.v}" aria-label="${esc(s.k)}"></div>`
    : `<button class="stat" data-act="roll-stat" data-i="${i}" title="Roll"><span class="sk">${escTxt(s.k)}</span>${ICON.die}<span class="sv">${fmt(s.v)}</span></button>`).join('');
  return `<header class="top">
    <div class="idrow">
      ${portraitHTML()}
      <div class="ident">
        ${E ? `<input class="in name" data-bind="info:name" value="${esc(st.info.name || '')}" aria-label="Name">` : `<h1 class="name">${escTxt(st.info.name || tabName)}</h1>`}
        <div class="pb"><span class="lbl">Playbook</span>${E ? `<input class="in" data-bind="info:playbook" value="${esc(st.info.playbook || '')}" aria-label="Playbook">` : `<span>${escTxt(st.info.playbook || '—')}</span>`}</div>
        ${st.state.downtime ? `<button class="pill" data-act="tab" data-tab="log">${escTxt(cap(actions.dtGroup()))}</button>` : ''}
      </div>
      <div class="tools">
        ${canEdit() ? `<button class="ic${E ? ' on' : ''}" data-act="edit" title="Edit" aria-pressed="${E}">${ICON.pen}</button>` : ''}
        <button class="ic" data-act="sheet-menu" title="Sheet options" aria-label="Sheet options">${ICON.dots}</button>
      </div>
    </div>
    <div class="vitals">${vitals.map(([d, t]) => trackHTML(t.name, t, d.role, skullsOf(d))).join('')}</div>
    <div class="stats">${stats}</div>
    <nav class="tabs">${sectionTabs().map(([k, l]) => `<button data-act="tab" data-tab="${k}" aria-pressed="${tabNow() === k}" class="${tabNow() === k ? 'on' : ''}">${escTxt(l)}</button>`).join('')}</nav>
  </header>`;
}

// The character's picture (the ship's, on the ship page): their info|Name row's Image; a crew
// member's is their crew row's. In edit mode it can be uploaded, changed or taken off (op
// "picture"; the picture goes to the Images tab).
let uploading = ''; // the row whose picture is on its way, as "kind|name"
const INFO_ROW = ['info', 'Name'];
function portraitHTML(row = INFO_ROW, label = st.info.name || tabName, cls = 'portrait') {
  const pic = picGone.has(row.join('|')) ? '' : store.imageOf(...row);
  const r = esc(row.join('|'));
  if (!editing) return pic ? pictureHTML(store.name, pic, label, cls) : '';
  if (uploading === row.join('|')) return `<div class="${cls} none" aria-busy="true"><span class="sub">Uploading…</span></div>`;
  return pic
    ? `<div class="pwrap">${pictureHTML(store.name, pic, label, cls)}<div class="ptools">` +
      `<button class="mini" data-act="pic-add" data-row="${r}" title="Change the picture" aria-label="Change the picture">${ICON.pen}</button>` +
      `<button class="mini del" data-act="pic-rm" data-row="${r}" title="Take the picture off" aria-label="Take the picture off">×</button></div></div>`
    : `<button class="${cls} none" data-act="pic-add" data-row="${r}" title="Add a picture"><span aria-hidden="true">+</span><span class="sub">Picture</span></button>`;
}
const rowOfAttr = v => {
  const i = String(v || '').indexOf('|');
  const row = i < 0 ? INFO_ROW : [v.slice(0, i), v.slice(i + 1)];
  return row.join('|').toLowerCase() === INFO_ROW.join('|').toLowerCase() ? INFO_ROW : row;
};

function pickPicture(row) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    let up;
    try {
      up = await shrink(file, PORTRAIT_SIDE);
    } catch (err) { toast(err.message, 'lo'); return; }
    URL.revokeObjectURL(up.url);
    sendPicture({ name: row === INFO_ROW ? st.info.name || tabName : row[1], type: up.type, data: up.data }, row);
  });
  input.click();
}

async function sendPicture(image, row = INFO_ROW) {
  uploading = row.join('|');
  render();
  try {
    const r = await client.request({ op: 'picture', tab: store.name, image, ...(row === INFO_ROW ? {} : { row }) }, { timeout: 90000 });
    store.receive(r, r.at);
    if (image) toast('Picture saved to the sheet.');
  } catch (err) {
    toast(err.message, 'lo');
  } finally {
    uploading = '';
    render();
  }
}
// Taking a picture off waits a few seconds (hold.js), so Undo can keep it.
const picGone = new Map(); // "kind|name" -> hold
function takePictureOff(row) {
  const k = row.join('|');
  picGone.set(k, hold(() => { picGone.delete(k); sendPicture('', row); }));
  render();
  deletedToast('the picture', () => { picGone.get(k)?.cancel(); if (picGone.delete(k)) render(); });
}
const PORTRAIT_SIDE = 1024;

const VITALS = ['harm', 'luck'];
// How many of a track's last pips are skulls (its skulls= in the System tab).
const skullsOf = d => Math.max(0, sum(d.skulls));
// Tracks shown somewhere other than their section card's header.
const placed = () => sys().tracks.filter(d => [...VITALS, 'treasure', 'hoard'].includes(d.role)).map(d => d.name.toLowerCase());

const pm = path => `<span class="pm"><button class="mini" data-act="rm-pip" data-path="${esc(path)}" aria-label="Remove">−</button><button class="mini" data-act="add-pip" data-path="${esc(path)}" aria-label="Add">+</button></span>`;

function sectionHTML(s, i) {
  const E = editing;
  const t = track(s.title);
  const isBonds = same_(s.title, sys().title('bonds') || '\u0000');
  const isXp = same_(s.title, sys().title('xp') || '\u0000');
  let h = '<section class="card"><div class="shead">' +
    (E ? `<input class="in st" data-bind="sec:${i}:title" value="${esc(s.title)}" aria-label="Title">` : `<h2>${escTxt(s.title)}</h2>`) +
    (t && !placed().includes(t.name.toLowerCase()) ? `<span class="pips">${pips(`t:${t.name}`, t.pips, s.title)}</span>` : '') +
    (E && !isBonds ? pm(`t:${s.title}`) : '') +
    (E ? `<button class="mini del" data-act="rm-section" data-i="${i}" title="Delete" aria-label="Delete">×</button>` : '') +
    (isXp && !E ? `<span class="lvl">Level ${parseInt(st.info.level, 10) || 0}</span>` : '') +
    (isXp && E ? `<label class="lvl">Level <input class="in lv" type="number" min="0" step="1" data-bind="info:level" value="${esc(parseInt(st.info.level, 10) || 0)}"></label>` : '') +
    '</div>';
  if (E) h += `<input class="in note" data-bind="sec:${i}:note" value="${esc(s.note || '')}" aria-label="Note">`;
  else if (s.note) h += `<div class="note">${escTxt(s.note)}</div>`;
  if (isBonds) {
    const all = people(client).filter(p => p.key !== `c:${tabName.toLowerCase()}`);
    h += '<div class="bonds">' + st.bonds.map((b, j) => {
      const to = bondTarget(b, all);
      return `<div class="bond${E ? ' edit' : ''}">` +
        (E ? `<input class="in" data-bind="bond:${j}:name" value="${esc(b.name)}" aria-label="Name">` + bondToHTML(b, j, all, to)
          : to ? `<a class="bn" href="${esc(to.href)}" title="${esc(to.label)}">${escTxt(b.name)}</a>` : `<span class="bn">${escTxt(b.name)}</span>`) +
        `<span class="pips">${pips(`b:${j}`, b.pips, b.name, true)}</span>` +
        (E ? `<button class="mini del" data-act="rm-bond" data-j="${j}" aria-label="Delete">×</button>` : '') + '</div>';
    }).join('') + '</div>';
    if (E && st.bonds.length < 8) h += '<button class="add sm" data-act="add-bond">+</button>';
  }
  if (E) h += `<textarea class="in rtext" data-bind="sec:${i}:text" aria-label="${esc(s.title)}">${escTxt(s.text || '')}</textarea>`;
  else if (s.text) h += `<div class="rich" data-sec="${i}">${md(s.text)}</div>`;
  return h + '</section>';
}

// Who a bond links to: by its name, unless its row's Notes names someone (or "-" for no one).
function bondToHTML(b, j, all, to) {
  const opt = (v, label) => `<option value="${esc(v)}"${(b.to || '') === v ? ' selected' : ''}>${escTxt(label)}</option>`;
  const byName = whoIs(b.name, all);
  return `<select class="in bto" data-bind="bond:${j}:to" aria-label="${esc(`Who ${b.name} links to`)}" title="${esc(to ? `Links to ${to.label}` : 'Links to no one')}">` +
    opt('', byName ? `→ ${byName.label}` : '→ No match') +
    all.filter(p => p !== byName).map(p => opt(p.name, `→ ${p.label}`)).join('') + opt('-', 'No link') + '</select>';
}

// The scratchpad on the Notes tab, for anything the sheet has no place for. Unlike the cards it
// needs no edit mode: it saves as you type, here first and then to the sheet, like any change.
function jotHTML() {
  if (!canEdit()) return st.jot ? `<section class="card jot"><div class="shead"><h2>Scratchpad</h2></div><div class="rich">${md(st.jot)}</div></section>` : '';
  return '<section class="card jot"><div class="shead"><h2>Scratchpad</h2></div>' +
    `<textarea class="in rtext" data-bind="jot" aria-label="Scratchpad" placeholder="Jot down anything the sheet doesn’t have a place for">${escTxt(st.jot || '')}</textarea></section>`;
}

function sectionsHTML(tab) {
  // an item list's card (the ship's kit and cargo) stands where its section row is; the crew's
  // section row is the crew tab's
  const listAt = s => lists().find(l => l.def && same_(s.title, l.def.title));
  const isCrew = s => !!CS() && same_(s.title, CS().def.title);
  const cards = (tab === 'notes' ? jotHTML() : '') +
    st.sections.map((s, i) => (s.tab !== tab || isCrew(s) ? '' : listAt(s) ? listHTML(listAt(s), editing, canEdit()) : sectionHTML(s, i))).join('') +
    lists().filter(l => !rowOf(l) && l.def?.tab === tab).map(l => listHTML(l, editing, canEdit())).join('') +
    (tab === 'notes' ? keptNotesHTML() : '');
  return `<div class="cols">${cards}</div>` + (editing ? `<button class="add" data-act="add-section" data-tab="${tab}">+</button>` : '');
}

function moveHTML(m, i, forceOpen) {
  const id = `${m.cat}:${m.name}`;
  const mk = m.cat === 'playbook' ? `<i class="mk${m.marked ? ' on' : ''}" aria-hidden="true"></i>` : '';
  if (editing && m.own) {
    return `<div class="move edit"><div class="mhead">` +
      `<button class="mk${m.marked ? ' on' : ''}" data-act="mv-mark" data-name="${esc(m.name)}" aria-pressed="${m.marked}" aria-label="Marked"></button>` +
      (m.custom ? `<input class="in mn" data-bind="move:${esc(encodeURIComponent(m.name))}:name" value="${esc(m.name)}" aria-label="Move">` : `<span class="mn">${escTxt(m.name)}</span>`) +
      (m.custom ? `<button class="mini del" data-act="rm-move" data-name="${esc(m.name)}" aria-label="Delete">×</button>` : '') +
      `</div><textarea class="in rtext" data-bind="move:${esc(encodeURIComponent(m.name))}:text" aria-label="${esc(m.name)}">${escTxt(m.text || '')}</textarea></div>`;
  }
  const no = m.cat === 'playbook' && !m.marked ? 'Not marked' : actions.why(m);
  const tip = (ok, why = no) => (why ? ` title="${esc(why)}" disabled` : ` title="${esc(ok)}"`);
  const r = rollOf(m.meta, m.stats || st.stats);
  const roll = typeof m.meta.roll === 'string' && m.meta.roll.trim();
  const chip = r ? `<button class="chip" data-act="roll-move" data-i="${i}"${tip('Roll')}>${ICON.die}<span>${escTxt(r.label)}${r.stat ? ' ' + fmt(r.mod) : ''}</span></button>`
    : roll ? `<button class="chip"${tip('', no || (SHIP && !client.me ? 'Sign in as a character to roll this' : `No ${roll} to roll`))}>${ICON.die}<span>${escTxt(roll)}</span></button>` : '';
  // What changes the sheet shows to everyone, but works only for whoever can edit it.
  const lock = canEdit() ? '' : SHIP ? 'Sign in to use this' : `Sign in as ${st.info.name || tabName} to use this`;
  const a = actions.forMove(m);
  const act = a ? `<button class="chip" data-act="run" data-kind="${a.kind}"${tip(a.label, lock || (a.ok ? '' : a.why))}>${escTxt(a.label)}</button>` : '';
  const lc = !SHIP && actions.cost(m);
  const luck = lc ? `<button class="chip" data-act="spend" data-i="${i}"${tip(`Spend ${lc.word}`, lock || no || (lc.ok ? '' : `Not enough ${lc.word}`))}>${escTxt(lc.n ? `${lc.n} ${lc.word}` : cap(lc.word))}</button>` : '';
  // A move with nothing to roll, spend or run is still made: Use offers it for the log.
  const use = !chip && !act && !luck && !editing ? `<button class="chip" data-act="use-move" data-i="${i}"${tip('Log that this move was made', lock || no)}>Use</button>` : '';
  const open = forceOpen || openSet.has(id);
  return `<details class="move${m.cat === 'playbook' && !m.marked ? ' off' : ''}" data-id="${esc(id)}"${open ? ' open' : ''}><summary>${mk}<span class="mn">${escTxt(m.name)}</span>${chip}${luck}${act}${use}</summary>` +
    `<div class="mbody"${m.own ? ` data-move="${esc(m.name)}"` : ''}>${md(m.text)}</div></details>`;
}

// Moves that can't be made now (not taken, or out of their time) stay off the list unless asked for.
const offNow = m => {
  if (m.cat === 'playbook' && !m.marked) return true;
  const a = actions.forMove(m);
  return a ? !a.ok : !!actions.why(m);
};

let lastMoves = [];
function moveListHTML() {
  const q = query.trim().toLowerCase();
  const all = moveList();
  lastMoves = all;
  const rolls = rollStats();
  all.forEach(m => { m.stats = rolls(m); });
  const cats = ui.cat === 'all' ? CATS() : [ui.cat];
  const filter = !editing && !q;
  let out = '';
  let off = 0;
  for (const c of cats) {
    const items = [];
    all.forEach((m, i) => {
      if (m.cat !== c) return;
      if (q && !`${m.name} ${m.text}`.toLowerCase().includes(q)) return;
      if (filter && offNow(m)) { off++; if (!ui.more) return; }
      items.push(moveHTML(m, i, !!q));
    });
    if (!items.length && !(editing && c === 'playbook' && !q)) continue;
    out += `<div class="mgroup"><h3>${escTxt(`${catLabel(c)} moves`)}</h3>${items.join('')}` +
      (editing && c === 'playbook' ? '<button class="add sm" data-act="add-move">+</button>' : '') + '</div>';
  }
  if (R.empty && !out) return '<div class="empty">The Rules tab hasn’t loaded yet.</div>';
  const more = off ? `<div class="cats mmore"><button data-act="more" aria-pressed="${!!ui.more}" class="${ui.more ? 'on' : ''}">${ui.more ? 'Hide moves not available now' : `Show ${off} move${off === 1 ? '' : 's'} not available now`}</button></div>` : '';
  return (out || (off ? '' : '<div class="empty">No moves match.</div>')) + more;
}

function movesHTML() {
  const cats = [['all', 'All'], ...CATS().map(c => [c, catLabel(c)])];
  return `<div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search" value="${esc(query)}" aria-label="Search moves" autocomplete="off">
      <div class="cats">${cats.map(([k, l]) => `<button data-act="cat" data-cat="${esc(k)}" aria-pressed="${ui.cat === k}" class="${ui.cat === k ? 'on' : ''}">${escTxt(l)}</button>`).join('')}</div>
    </div><div id="mlist">${moveListHTML()}</div>`;
}

/* ---------- kit: treasure and hoard pips, notes, and item lists ---------- */
const isWealth = name => { const w = W(); return [w.t, w.h].some(n => n && same_(n, name)); };
const isTnotes = s => s.tab === 'kit' && !!W().title && same_(s.title, W().title);
const lw = s => String(s).toLowerCase();

// Item lists: the kit's items (item rows) and, where the game has a cargo section, cargo (cargo
// rows). Each card is its section's (section role=kit, role=cargo) and shows on that section's tab;
// a character's items, with no kit section, show on the Kit tab under "Items".
const LISTS = [['item', 'kit'], ['cargo', 'cargo']];
const listOf = kind => (kind === 'cargo' ? st.cargo : st.items);
const lists = () => LISTS.map(([kind, role]) => ({ kind, def: sys().section(role) })).filter(l => l.def || l.kind === 'item');
const isListSec = s => lists().some(l => l.def && same_(s.title, l.def.title));
const rowOf = l => (l.def ? st.sections.find(s => same_(s.title, l.def.title)) : null);
const onKitTab = l => !l.def || (rowOf(l)?.tab || l.def.tab) === 'kit';
const newId = kind => `new${kind}`;

function kitHTML() {
  const E = editing;
  const can = canEdit();
  const w = W();
  const others = st.sections.map((s, i) => (s.tab === 'kit' && !isTnotes(s) && !isListSec(s) ? sectionHTML(s, i) : '')).join('');
  const more = `<div class="cols">${others}</div>` + (E ? '<button class="add" data-act="add-section" data-tab="kit">+</button>' : '');
  if (!st.items.length && !st.cargo.length && !track(w.t) && !track(w.h)) return fillHTML() + more;
  const ti = st.sections.findIndex(isTnotes);
  const ts = st.sections[ti];
  const row = name => {
    const t = track(name) || { name, pips: [] };
    return `<div class="wrow"><span class="lbl">${escTxt(name)}</span><span class="pips${name === w.t ? ' treasure' : name === w.h ? ' hoard' : ''}">${pips(`t:${t.name}`, t.pips, name)}</span>` +
      (can && name === w.t ? `<span class="pm"><button class="mini" data-act="treasure" data-n="-1" aria-label="${esc(`Spend 1-${lw(w.t)}`)}">−</button><button class="mini" data-act="treasure" data-n="1" aria-label="${esc(`Gain 1-${lw(w.t)}`)}">+</button></span>` : '') + '</div>';
  };
  let h = '';
  if (w.t || w.h) {
    h += `<section class="card wealth"><div class="shead"><h2>${escTxt(w.title || w.t)}</h2></div>` +
      `<div class="note">${escTxt(ts?.note || w.note)}</div>` + (w.t ? row(w.t) : '') + (w.h ? row(w.h) : '');
    if (ts && E) h += `<textarea class="in rtext" data-bind="sec:${ti}:text" aria-label="${esc(`${w.title} notes`)}" placeholder="When you got it">${escTxt(ts.text || '')}</textarea>`;
    else if (ts?.text) h += `<div class="rich" data-sec="${ti}">${md(ts.text)}</div>`;
    else if (!ts && E && w.title) h += '<button class="add sm" data-act="add-tnotes">+ Notes</button>';
    h += '</section>';
  }
  return '<div class="cols">' + h + lists().filter(onKitTab).map(l => listHTML(l, E, can)).join('') + '</div>' + more;
}

// One list's card: its section's title and note (worked out from the stats if the sheet has no
// such row), the items, and the section's own text as notes.
function listHTML({ kind, def }, E, can) {
  const arr = listOf(kind);
  const si = def ? st.sections.findIndex(s => same_(s.title, def.title)) : -1;
  const s = st.sections[si];
  const note = s ? s.note : fillIn(def?.note || '', { stats: st.stats, level: parseInt(st.info.level, 10) || 0 });
  let h = `<section class="card" data-list="${kind}"><div class="shead"><h2>${escTxt(def?.title || 'Items')}</h2><span class="cnt">${arr.length}</span></div>` +
    (note ? `<div class="note">${escTxt(note)}</div>` : '') + '<ul class="items">' +
    arr.map((it, j) => (E ? itemEditHTML(kind, it, j) : itemHTML(kind, it, j, can))).join('') + '</ul>' +
    (E ? `<div class="additem"><input class="in" id="${newId(kind)}" placeholder="Add an item" aria-label="${esc(`New ${lw(def?.title || 'item')}`)}" autocomplete="off"><button class="pbtn" data-act="add-item" data-kind="${kind}">Add</button></div>` : '');
  if (s && E) h += `<textarea class="in rtext" data-bind="sec:${si}:text" aria-label="${esc(`${s.title} notes`)}" placeholder="Notes">${escTxt(s.text || '')}</textarea>`;
  else if (s?.text) h += `<div class="rich" data-sec="${si}">${md(s.text)}</div>`;
  return h + '</section>';
}

// Outside edit mode an item can only be used: its count goes down and the use is logged.
function itemHTML(kind, it, j, can) {
  const out = it.count === 0;
  return `<li class="item${out ? ' out' : ''}"><div class="ibody"><span class="iname">${escTxt(it.name)}</span>` +
    (it.count != null ? `<span class="cnt">×${it.count}</span>` : '') +
    (it.note ? `<div class="inote">${escTxt(plain(it.note))}</div>` : '') + '</div>' +
    (can ? `<button class="chip" data-act="use-item" data-kind="${kind}" data-j="${j}"${out ? ' disabled title="None left"' : ` title="Use ${esc(it.name)}"`}>Use</button>` : '') + '</li>';
}

// In edit mode: name, count (blank for items that aren't counted), notes, and removing it.
function itemEditHTML(kind, it, j) {
  return `<li class="item edit"><div class="irow"><input class="in" data-bind="${kind}:${j}:name" value="${esc(it.name)}" aria-label="Item">` +
    `<input class="in icount" type="number" min="0" step="1" data-bind="${kind}:${j}:count" value="${it.count ?? ''}" placeholder="—" aria-label="How many ${esc(it.name)}" title="How many (blank if not counted)">` +
    `<button class="mini del" data-act="rm-item" data-kind="${kind}" data-j="${j}" title="Remove" aria-label="Remove ${esc(it.name)}">×</button></div>` +
    `<textarea class="in rtext inote" data-bind="${kind}:${j}:note" aria-label="Notes on ${esc(it.name)}" placeholder="Notes">${escTxt(it.note || '')}</textarea></li>`;
}

// The Notes tab gathers notes kept elsewhere, each under what it's a note for.
function keptNotesHTML() {
  return lists().map(({ kind, def }) => {
    const noted = listOf(kind).map((it, j) => [it, j]).filter(([it]) => editing || it.note);
    if (!noted.length) return '';
    return `<section class="card kept"><div class="shead"><h2>${escTxt(def?.title || 'Items')}</h2></div>` + noted.map(([it, j]) => `<div class="kn"><h3>${escTxt(it.name)}</h3>` +
      (editing ? `<textarea class="in rtext inote" data-bind="${kind}:${j}:note" aria-label="Notes on ${esc(it.name)}" placeholder="Notes">${escTxt(it.note || '')}</textarea>` : `<div class="rich">${md(it.note)}</div>`) +
      '</div>').join('') + '</section>';
  }).join('');
}

// The Use dialog for an item: how many (for counted items) and, for the log, a note. onUse(n, note).
function openUseItem(item, onUse) {
  const counted = item.count != null;
  const o = modal(`<div class="prow"><h2>${escTxt(item.name)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    ${item.note ? `<div class="mbody rule">${md(item.note)}</div>` : ''}
    ${counted ? `<label class="field"><span class="lbl">How many (${item.count} left)</span><input class="in" type="number" data-n min="1" max="${esc(item.count)}" value="1"></label>` : ''}
    ${SHIP ? '' : '<textarea class="in anote" placeholder="Note (optional)" aria-label="Note"></textarea>'}
    <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-use>Use</button></div>`, { label: `Use ${item.name}` });
  (o.querySelector('[data-n]') || o.querySelector('textarea') || o.querySelector('[data-use]')).focus();
  o.addEventListener('click', e => {
    if (!e.target.closest('[data-use]')) return;
    const n = counted ? parseInt(o.querySelector('[data-n]').value, 10) || 1 : 0;
    const text = o.querySelector('textarea')?.value.trim() || '';
    closeModal();
    onUse(n, text);
  });
}

// On a character the use goes in their log, and undoing it takes it out again. The ship has no
// log, so its undo just gives the count back.
function useItemAt(kind, j) {
  const it = listOf(kind)[j];
  if (!it || !canEdit() || editing || it.count === 0) return;
  openUseItem(it, (n, note) => {
    const cur = listOf(kind).find(x => x.name === it.name);
    if (!cur) return;
    const { used: k, left } = useItem(cur, n);
    if (left != null) cur.count = left;
    let undo;
    if (SHIP) {
      undo = () => {
        const c = canEdit() && listOf(kind).find(x => x.name === cur.name);
        if (!c) return;
        if (c.count != null) c.count += k;
        changed();
        render();
      };
    } else {
      const at = Date.now();
      const id = logId(at);
      st.log.push({ id, at, title: cur.name, items: [left != null ? `Used ${k}, ${left} left` : 'Used'], note });
      undo = () => undoUse(id);
    }
    changed();
    render();
    toast(left != null ? `Used ${k} ${cur.name} (${left} left)` : `Used ${cur.name}`, '', { label: 'Undo', run: undo });
  });
}

// Undoing a use gives back what it took and removes its log entry.
const allItems = () => [...st.items, ...st.cargo];
function undoUse(id) {
  const i = st.log.findIndex(e => e.id === id);
  const u = i >= 0 && canEdit() && useOf(st.log[i], allItems());
  if (!u) return;
  if (u.n) u.item.count += u.n;
  st.log.splice(i, 1);
  changed();
  render();
  toast(u.n ? `Gave back ${u.n} ${u.item.name} (${u.item.count} left)` : `Undid using ${u.item.name}`);
}
const undoHTML = (e, i) => (!editing && canEdit() && useOf(e, allItems()) ? `<button class="chip" data-act="undo-use" data-i="${i}" title="Undo this use">Undo</button>` : '');

// A sheet with no kit yet: offer to start one from one of its playbook's kits.
function fillHTML() {
  if (!canEdit()) return '<div class="empty">No kit yet.</div>';
  const kits = (playbook()?.kits || []).filter(k => !k.meta.extra);
  if (!kits.length) return '<section class="card setup"><h2>Kit</h2><div class="prow"><span class="grow"></span><button class="pbtn primary" data-act="fill-kit" data-src="">Start an empty kit</button></div></section>';
  const opt = (v, label) => `<option value="${esc(v)}"${v === kits[0].name ? ' selected' : ''}>${escTxt(label)}</option>`;
  const t = W().t;
  return `<section class="card setup"><h2>Start the kit</h2>
    <div class="status">Each item in the kit becomes its own line${t ? `, and its ${escTxt(lw(t))} goes on the pips` : ''}.</div>
    <label class="field"><span class="lbl">From</span><select class="in" id="kitpick">${kits.map(k => opt(k.name, `${k.name}: ${short(k.text)}`)).join('')}</select></label>
    <div class="prow"><span class="grow"></span><button class="pbtn primary" data-act="fill-kit">Fill the kit</button></div></section>`;
}

function fillKit(src) {
  const kit = playbook()?.kits.find(k => k.name === src)?.text;
  const inv = parseSheet(kitRows(sys(), kit || ''));
  Object.assign(st.tracks, inv.tracks);
  if (!st.sections.some(isTnotes)) st.sections.push(...inv.sections);
  st.items = inv.items;
}

function addItem(kind) {
  const el = document.getElementById(newId(kind));
  const v = el?.value.trim();
  if (!v || !canEdit() || !editing) return;
  const arr = listOf(kind);
  arr.push({ name: uniqueName(v, arr.map(i => i.name)), count: null, note: '' });
  changed();
  render();
  document.getElementById(newId(kind))?.focus();
}

/* ---------- the ship's crew: a little sheet each ---------- */
function crewTabHTML() {
  const cs = CS();
  const E = editing;
  const si = st.sections.findIndex(s => same_(s.title, cs.def.title));
  const s = st.sections[si];
  const note = s ? s.note : fillIn(cs.def.note || '', { stats: st.stats, level: 0 });
  let head = `<section class="card crewhead"><div class="shead"><h2>${escTxt(cs.def.title)}</h2><span class="cnt">${st.crew.length}</span></div>` +
    (note ? `<div class="note">${escTxt(note)}</div>` : '');
  if (s && E) head += `<textarea class="in rtext" data-bind="sec:${si}:text" aria-label="${esc(`${s.title} notes`)}" placeholder="Notes">${escTxt(s.text || '')}</textarea>`;
  else if (s?.text) head += `<div class="rich" data-sec="${si}">${md(s.text)}</div>`;
  head += '</section>';
  const all = people(client);
  const cards = st.crew.map((c, j) => (E ? crewEditHTML(cs, c, j, all) : crewHTML(cs, c, j, all))).join('');
  const add = E ? `<div class="additem crewadd"><select class="in" id="newcrew" aria-label="${esc(`Kind of ${lw(cs.def.title)} member`)}">` +
    cs.kinds.map(k => `<option value="${esc(k.name)}">${escTxt(k.name)}</option>`).join('') + '<option value="">Someone else</option></select>' +
    '<button class="pbtn" data-act="add-crew">Add</button></div>' : '';
  return head + (cards ? `<div class="cols">${cards}</div>` : (E ? '' : `<div class="empty">No ${escTxt(lw(cs.def.title))} yet.</div>`)) + add + (E ? tagListHTML(R, cs.tagGroup) : '');
}

// Whose they are: a link to that character's sheet.
function servesHTML(cs, c, all) {
  if (!c.serves) return '';
  const p = whoIs(c.serves, all);
  const who = p ? `<a href="${esc(p.href)}">${escTxt(p.label)}</a>` : escTxt(c.serves);
  return `<span class="serves">${cs.def.serves ? `${escTxt(cs.def.serves)} ` : ''}${who}</span>`;
}

// The bonds the characters have with a crew member, each linking to that character.
function crewBondsHTML(c, all) {
  const me = `crew:${c.name.toLowerCase()}`;
  const out = [];
  let title = '';
  for (const p of all.filter(x => x.key.startsWith('c:'))) {
    const t = client.tab(p.name);
    if (!t.loaded || t.missing) continue;
    const cst = parseSheet(t.rows);
    title ||= systemOf(R, typeOf(R, cst.info.playbook)).title('bonds');
    for (const b of cst.bonds) if (bondTarget(b, all)?.key === me) out.push(`<a class="cc-bond" href="${esc(p.href)}">${escTxt(p.label)} <span class="pips">${staticPips(b.pips, true)}</span></a>`);
  }
  return out.length ? `<div class="cc-row lbonds"><span class="lbl">${escTxt(title || 'Bonds')}</span>${out.join('')}</div>` : '';
}

function crewTrackHTML(cs, c, j) {
  if (!cs.harm && !c.pips.length) return '';
  const label = cs.harm?.name || 'Harm';
  return `<div class="track harm"><span class="lbl">${escTxt(label)}</span><span class="pips">${pips(`c:${j}`, c.pips, `${c.name} ${label}`)}</span>${editing ? pm(`c:${j}`) : ''}</div>`;
}

function crewTagsHTML(cs, c, j) {
  return tagsHTML(c.tags, { R, group: cs.tagGroup, game: client.game, edit: editing, key: `crew-${j}` });
}
function addCrewTag(j) {
  const c = st.crew[j];
  const el = document.getElementById(`newtag-crew-${j}`);
  if (!c || !el || !canEdit() || !editing) return;
  const next = addTag(c.tags, el.value);
  if (next !== c.tags) { c.tags = next; changed(); }
  render();
  document.getElementById(`newtag-crew-${j}`)?.focus();
}

function crewHTML(cs, c, j, all) {
  return `<section class="card crewsheet" data-crew="${esc(c.name)}"><div class="lhead">${portraitHTML(['crew', c.name], c.name, 'portrait sm')}` +
    `<div class="ident"><h2>${escTxt(c.name)}</h2><div class="note">${[c.type ? `<span>${escTxt(c.type)}</span>` : '', servesHTML(cs, c, all)].filter(Boolean).join(' · ')}</div></div></div>` +
    crewTrackHTML(cs, c, j) +
    crewTagsHTML(cs, c, j) +
    crewBondsHTML(c, all) +
    (c.note ? `<div class="rich">${md(c.note)}</div>` : '') + '</section>';
}

function crewEditHTML(cs, c, j, all) {
  const opt = (v, label, cur) => `<option value="${esc(v)}"${same_(v, cur) ? ' selected' : ''}>${escTxt(label)}</option>`;
  const kinds = cs.kinds.map(k => k.name);
  if (c.type && !kinds.some(k => same_(k, c.type))) kinds.push(c.type);
  const chars = all.filter(p => p.key.startsWith('c:'));
  const serves = chars.some(p => same_(p.name, c.serves)) || !c.serves ? '' : opt(c.serves, c.serves, c.serves);
  return `<section class="card crewsheet edit" data-crew="${esc(c.name)}"><div class="lhead">${portraitHTML(['crew', c.name], c.name, 'portrait sm')}` +
    `<input class="in st" data-bind="crew:${j}:name" value="${esc(c.name)}" aria-label="Name">` +
    `<button class="mini del" data-act="rm-crew" data-j="${j}" title="Remove" aria-label="${esc(`Remove ${c.name}`)}">×</button></div>` +
    `<label class="field"><span class="lbl">Kind</span><select class="in" data-bind="crew:${j}:type">${opt('', '—', c.type)}${kinds.map(k => opt(k, k, c.type)).join('')}</select></label>` +
    `<label class="field"><span class="lbl">${escTxt(cs.def.serves || 'Serves')}</span><select class="in" data-bind="crew:${j}:serves">${opt('', 'No one', c.serves)}${chars.map(p => opt(p.name, p.label, c.serves)).join('')}${serves}</select></label>` +
    crewTrackHTML(cs, c, j) +
    crewTagsHTML(cs, c, j) +
    `<textarea class="in rtext" data-bind="crew:${j}:note" aria-label="${esc(`Notes on ${c.name}`)}" placeholder="Notes">${escTxt(c.note || '')}</textarea></section>`;
}

function addCrew() {
  if (!canEdit() || !editing) return;
  const cs = CS();
  const kind = document.getElementById('newcrew')?.value || '';
  const c = newCrew(cs, kind, st.crew.map(x => x.name));
  c.name = freeName(c.name || 'Someone', n => st.crew.some(x => x.name.toLowerCase() === n));
  st.crew.push(c);
  changed();
  render();
}

// After a bond's link opens the crew tab: bring that crew member's sheet into view, once.
function revealCrew() {
  if (!showCrew || !store.loaded || ui.tab !== 'crew') return;
  const card = [...app.querySelectorAll('.crewsheet[data-crew]')].find(el => same_(el.dataset.crew, showCrew)) ||
    [...app.querySelectorAll('.crewsheet[data-crew]')].find(el => whoIs(showCrew, [{ names: [el.dataset.crew] }]));
  if (!card) return;
  showCrew = '';
  card.classList.add('hl');
  card.scrollIntoView({ block: 'center' });
}

/* ---------- a new game has no Ship tab yet: set one up from a ship playbook ---------- */
const setup = { name: '', playbook: '', kit: '', oddity: '' };
function shipSetupHTML() {
  if (!canEdit()) return `<div class="empty-page"><p>This game has no Ship tab yet.</p>${readOnlyHTML(client, 'Ship')}</div>`;
  const ships = R.playbooks('ship');
  if (!ships.length) return '<div class="empty-page"><p>This game has no Ship tab yet, and its Rules tab has no ship playbooks to start one from.</p></div>';
  if (!ships.some(p => p.name === setup.playbook)) setup.playbook = ships[0].name;
  const pb = R.playbook(setup.playbook);
  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${escTxt(label)}</option>`;
  return `<section class="card setup"><h2>Set up the ship</h2>
    <label class="field"><span class="lbl">Name</span><input class="in" data-setup="name" value="${esc(setup.name)}" placeholder="The ship’s name"></label>
    <label class="field"><span class="lbl">Playbook</span><select class="in" data-setup="playbook">${ships.map(p => opt(p.name, p.name, setup.playbook)).join('')}</select></label>
    ${pb.text ? `<div class="rich">${md(pb.text)}</div>` : ''}
    ${pb.kits.length ? `<label class="field"><span class="lbl">Kit</span><select class="in" data-setup="kit">${pb.kits.map(k => opt(k.name, `${k.name} (${k.meta.traits || ''}): ${short(k.text)}`, setup.kit)).join('')}</select></label>` : ''}
    ${pb.oddities.length ? `<label class="field"><span class="lbl">Oddity</span><select class="in" data-setup="oddity">${pb.oddities.map(o => opt(o.name, `${o.name}: ${short(o.text)}`, setup.oddity)).join('')}</select></label>` : ''}
    <div class="prow"><span class="grow"></span><button class="pbtn primary" data-act="ship-create">Create the Ship tab</button></div>
    <div class="status" id="setup-msg"></div></section>`;
}

async function createShip() {
  const msg = document.getElementById('setup-msg');
  const pb = R.playbook(setup.playbook);
  msg.textContent = 'Creating…';
  try {
    const rows = shipRows(R, { name: setup.name.trim() || 'The ship', playbook: setup.playbook, kit: setup.kit || pb.kits[0]?.name, oddity: setup.oddity || pb.oddities[0]?.name });
    const r = await client.request({ op: 'create', tab: 'Ship', rows });
    store.receive(r, r.at);
  } catch (e) { msg.textContent = e.message; }
}

// Bonds show in the bonds section's card (section role=bonds); add one if the tab has bonds but no such row yet.
function ensureBondsCard() {
  const t = sys().title('bonds');
  if (t && st.bonds.length && !st.sections.some(s => same_(s.title, t))) st.sections.push({ tab: 'sheet', title: t, text: '', note: '' });
}

const searchMoves = debounce(() => { const l = document.getElementById('mlist'); if (l) l.innerHTML = moveListHTML(); });
function render() {
  searchMoves.cancel();
  ensureBondsCard();
  const ro = !canEdit();
  if (ro) editing = false;
  const sheetShown = store.loaded && !store.missing;
  document.body.classList.toggle('editing', editing);
  document.body.classList.toggle('readonly', ro && sheetShown);
  let main;
  if (store.missing) main = SHIP ? shipSetupHTML() : `<div class="empty-page"><p>There’s no tab called “${escTxt(tabName)}” in this game’s sheet.</p><p><a href="${esc(href('index.html', client.game))}">Back to the crew</a></p></div>`;
  else if (!store.loaded) main = '<div class="empty">Loading…</div>';
  else if (tabNow() === 'moves') main = movesHTML();
  else if (tabNow() === 'log' && !SHIP) main = actions.logHTML(editing, ro, undoHTML);
  else if (tabNow() === 'kit') main = kitHTML();
  else if (tabNow() === 'crew') main = crewTabHTML();
  else main = sectionsHTML(tabNow());
  const hdr = store.loaded && !store.missing ? headerHTML() : '';
  let body = document.getElementById('sheet');
  if (!body) { body = document.createElement('div'); body.id = 'sheet'; app.append(body); }
  keepFocus(body, () => { body.innerHTML = hdr + `<main>${ro && sheetShown ? readOnlyHTML(client, SHIP ? 'Ship' : tabName, st.info.name || tabName) : ''}${main}</main>`; });
  document.title = `${st.info.name || tabName} · ${client.game.name || 'Cybersea'}`;
  autoSize();
  revealCrew();
}

function autoSize() {
  fitText(app.querySelectorAll('textarea.rtext, textarea.enote'));
}

/* ---------- interactions ---------- */
function clickPip(btn) {
  if (!canEdit()) return;
  const path = btn.dataset.pip;
  const j = +btn.dataset.j;
  const bond = btn.hasAttribute('data-bond');
  const crew = path.startsWith('c:') ? st.crew[+path.slice(2)] : null;
  const arr = path.startsWith('b:') ? st.bonds[+path.slice(2)]?.pips : crew ? crew.pips : st.tracks[path.slice(2).toLowerCase()]?.pips;
  if (!arr) return;
  if (!bond && !crew && isWealth(path.slice(2))) { // treasure and hoard are counts: a full treasure track carries into hoard
    const W_ = W();
    const w = wealth(st, W_);
    const isT = same_(path.slice(2), W_.t);
    const cur = isT ? w.treasure : w.hoard;
    const n = cur === j + 1 ? j : j + 1;
    const undo = keep.tracks(W_.t, W_.h);
    const r = isT ? setWealth(st, W_, n, w.hoard) : setWealth(st, W_, w.treasure, n);
    if (r.hoard > w.hoard && isT) toast(`${W_.per}-${lw(W_.t)} became 1-${lw(W_.h)}.`);
    const name = track(path.slice(2)).name;
    used(`t:${name.toLowerCase()}`, n - cur, k => `${name} ${signed(k)}`, undo);
    changed();
    render();
    return;
  }
  let v = arr[j] || 0;
  if (bond) {
    if (editing) v = v ? 0 : 1;      // mark / unmark
    else if (!v) return;             // unmarked bonds can't be used
    else v = v === 1 ? 2 : 1;        // use / restore
  } else v = v ? 0 : 1;
  const was = arr[j] || 0;
  const undo = bond ? keep.bond(st.bonds[+path.slice(2)].name) : crew ? keep.crew(crew.name) : keep.tracks(path.slice(2));
  arr[j] = v;
  if (bond) btn.className = 'pip' + pipClass(v, bond);
  else btn.classList.toggle('on', v === 1); // keeps skull classes
  btn.setAttribute('aria-pressed', v === 1);
  changed();
  if (bond) {
    const b = st.bonds[+path.slice(2)];
    const title = sys().title('bonds');
    used(`b:${b.name.toLowerCase()}`, v === 2 ? 1 : -1, k => `${title ? `${title}: ` : ''}${b.name} ${k > 0 ? 'used' : 'restored'}${Math.abs(k) > 1 ? ` ×${Math.abs(k)}` : ''}`, undo);
  } else if (crew && was !== v) {
    const label = CS()?.harm?.name || 'Harm';
    used(`c:${crew.name.toLowerCase()}`, v === 1 ? 1 : -1, k => `${crew.name}: ${label} ${signed(k)}`, undo);
  } else if (was !== v) {
    const t = st.tracks[path.slice(2).toLowerCase()];
    used(`t:${t.name.toLowerCase()}`, v === 1 ? 1 : -1, k => `${t.name} ${signed(k)}`, undo);
  }
}

function setTrack(path, fn) {
  if (path.startsWith('c:')) { const c = st.crew[+path.slice(2)]; if (c) fn(c.pips); return; }
  const name = path.slice(2);
  const k = name.toLowerCase();
  if (!st.tracks[k]) st.tracks[k] = { name, pips: [] };
  fn(st.tracks[k].pips);
  if (!st.tracks[k].pips.length) delete st.tracks[k];
}

app.addEventListener('click', e => {
  const pip = e.target.closest('.pip');
  if (pip) { clickPip(pip); return; }

  if (!editing && canEdit()) {
    const li = e.target.closest('ul.ck > li[data-ck]');
    if (li) {
      const sec = li.closest('[data-sec]');
      const mv = li.closest('[data-move]');
      const ticked = (where, k, undo) => used(`ck:${where}:${li.dataset.ck}`, k, n => `${n > 0 ? 'Checked' : 'Unchecked'}: ${li.textContent.trim()} (${where})`, undo);
      const on = li.classList.contains('on') ? -1 : 1;
      if (sec) {
        const s = st.sections[+sec.dataset.sec];
        const undo = keep.section(s.title);
        s.text = toggleCheck(s.text, +li.dataset.ck);
        changed(); ticked(s.title, on, undo); render(); return;
      }
      if (mv) {
        const m = moveList().find(x => x.own && x.name === mv.dataset.move);
        if (m) {
          const text = toggleCheck(m.text, +li.dataset.ck);
          const undo = keep.move(m.name);
          const mine = charMove(m.name);
          if (mine) mine.text = text; else st.moves.push({ name: m.name, marked: m.marked, text });
          changed();
          li.classList.toggle('on');
          ticked(m.name, on, undo);
        }
        return;
      }
    }
  }

  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.closest('summary')) e.preventDefault();
  const act = b.dataset.act;
  const i = +b.dataset.i;
  switch (act) {
    case 'edit': editing = !editing && canEdit(); render(); if (!editing) later.run(); break;
    case 'tab': ui.tab = b.dataset.tab; saveUi(); render(); break;
    case 'cat': ui.cat = b.dataset.cat; saveUi(); render(); break;
    case 'more': ui.more = !ui.more; saveUi(); render(); break;
    case 'sheet-menu': sheetMenu(); break;
    case 'pic-add': if (editing && !uploading) pickPicture(rowOfAttr(b.dataset.row)); break;
    case 'pic-rm': if (editing && !uploading && armed(b)) takePictureOff(rowOfAttr(b.dataset.row)); break;
    case 'add-crew': addCrew(); break;
    case 'add-tag': addCrewTag(+b.dataset.tags.slice(5)); break;
    case 'rm-tag': {
      const c = st.crew[+b.dataset.tags.slice(5)];
      if (!c || !canEdit() || !editing) break;
      const was = c.tags;
      const tag = splitTags(was)[+b.dataset.k];
      c.tags = removeTag(was, +b.dataset.k);
      changed(); render();
      deletedToast(tag, () => { const x = byName(st.crew, c.name); if (x && canEdit()) { x.tags = was; changed(); render(); } });
      break;
    }
    case 'rm-crew': if (canEdit() && editing && armed(b)) removed(st.crew[+b.dataset.j]?.name, st.crew, +b.dataset.j); break;
    case 'roll-stat': { const s = st.stats[i]; doRoll(s.k, s.v, 2); break; }
    case 'roll-move': {
      const m = lastMoves[i];
      const r = m && rollOf(m.meta, m.stats || st.stats);
      if (!r) break;
      doRoll(r.stat || r.ask ? `${m.name} · ${r.label}` : m.name, r.mod, r.dice, ({ total }) => {
        if (canEdit() && actions.noteRoll(m, total)) changed();
      }, r);
      break;
    }
    case 'add-pip': setTrack(b.dataset.path, p => { if (p.length < 20) p.push(0); }); changed(); render(); break;
    case 'rm-pip': setTrack(b.dataset.path, p => p.pop()); changed(); render(); break;
    case 'add-section': st.sections.push({ tab: b.dataset.tab, title: uniqueTitle('New section'), text: '', note: '' }); changed(); render(); break;
    case 'rm-section': if (armed(b)) removed(st.sections[i]?.title, st.sections, i); break;
    case 'add-bond': st.bonds.push({ name: uniqueBond('Someone'), pips: Array(Math.max(1, sum(sys().section('bonds')?.size))).fill(0) }); changed(); render(); break;
    case 'rm-bond': if (armed(b)) removed(st.bonds[+b.dataset.j]?.name, st.bonds, +b.dataset.j); break;
    case 'mv-mark': {
      const m = charMove(b.dataset.name);
      if (m) m.marked = !m.marked; else st.moves.push({ name: b.dataset.name, marked: true, text: '' });
      changed(); render(); break;
    }
    case 'add-move': st.moves.push({ name: uniqueMove('NEW MOVE'), marked: true, text: '' }); changed(); render(); break;
    case 'rm-move': if (armed(b)) removed(b.dataset.name, st.moves, st.moves.findIndex(m => m.name === b.dataset.name)); break;
    case 'run': if (canEdit()) actions.open(b.dataset.kind); break;
    case 'spend': if (canEdit() && lastMoves[i]) actions.spend(lastMoves[i]); break;
    case 'use-move': {
      const m = lastMoves[i];
      if (m && canEdit()) used(`mv:${m.name.toLowerCase()}`, 1, k => (k > 1 ? `${m.name} ×${k}` : m.name));
      break;
    }
    case 'rm-log': if (armed(b)) removed(`log entry: ${st.log[i]?.title}`, st.log, i); break;
    case 'dt-moves': ui.tab = 'moves'; ui.cat = actions.dtGroup() || 'all'; saveUi(); render(); break;
    case 'ship-create': if (canEdit()) createShip(); break;
    case 'treasure': {
      if (!canEdit()) break;
      const w = W();
      const before = wealth(st, w);
      const undo = keep.tracks(w.t, w.h);
      const r = addTreasure(st, w, +b.dataset.n);
      if (!r) { toast(`No ${lw(w.t)} left to spend.`); break; }
      used(`t:${lw(w.t)}`, +b.dataset.n, k => `${w.t} ${signed(k)}`, undo);
      if (r.hoard > before.hoard) toast(`${w.per}-${lw(w.t)} became 1-${lw(w.h)}.`);
      else if (r.hoard < before.hoard) toast(`Broke 1-${lw(w.h)} into ${w.per}-${lw(w.t)}.`);
      changed(); render(); break;
    }
    case 'add-item': addItem(b.dataset.kind); break;
    case 'use-item': useItemAt(b.dataset.kind, +b.dataset.j); break;
    case 'undo-use': if (st.log[i]) undoUse(st.log[i].id); break;
    case 'rm-item': if (canEdit() && editing && armed(b)) removed(listOf(b.dataset.kind)[+b.dataset.j]?.name, listOf(b.dataset.kind), +b.dataset.j); break;
    case 'add-tnotes': if (W().title) { st.sections.push({ tab: 'kit', title: W().title, text: '', note: W().note }); changed(); render(); } break;
    case 'fill-kit': {
      if (!canEdit()) break;
      const src = b.dataset.src ?? document.getElementById('kitpick')?.value ?? '';
      fillKit(src); changed(); render(); break;
    }
  }
});

const uniqueTitle = t => freeName(t, n => st.sections.some(s => s.title.toLowerCase() === n));
const uniqueBond = t => freeName(t, n => st.bonds.some(s => s.name.toLowerCase() === n));
const uniqueMove = t => freeName(t, n => moveList().some(s => s.name.toLowerCase() === n));

// Text inputs: names/titles apply when you leave the field (they're row keys); text applies as you type.
function bind(el, final) {
  const spec = el.dataset.bind;
  if (!spec) return;
  const [what, rawA, b] = spec.split(':');
  const a = what === 'move' ? decodeURIComponent(rawA) : rawA;
  const v = el.value;
  if (what === 'info') { st.info[a] = el.type === 'number' ? String(parseInt(v, 10) || 0) : v; }
  else if (what === 'jot') st.jot = v;
  else if (what === 'stat') { const s = st.stats[+a]; if (b === 'v') s.v = parseInt(v, 10) || 0; else if (final && v.trim()) s.k = v.trim(); else return; }
  else if (what === 'sec') {
    const s = st.sections[+a];
    if (b === 'title') {
      if (!final || !v.trim() || v.trim() === s.title) return;
      const t = track(s.title);
      const nt = uniqueTitle(v.trim());
      if (t) { delete st.tracks[s.title.toLowerCase()]; st.tracks[nt.toLowerCase()] = { name: nt, pips: t.pips }; }
      s.title = nt;
    } else s[b] = v;
  } else if (what === 'bond') {
    if (b === 'to') st.bonds[+a].to = v;
    else { if (!final || !v.trim()) return; st.bonds[+a].name = v.trim(); }
  } else if (what === 'crew') {
    const c = st.crew[+a];
    if (!c) return;
    if (b === 'name') {
      if (!final || !v.trim() || v.trim() === c.name) return;
      c.name = freeName(v.trim(), n => st.crew.some(x => x !== c && x.name.toLowerCase() === n));
    } else if (b === 'type') {
      const fresh = !c.tags && !c.pips.length;
      c.type = v;
      if (fresh && v) { const n = newCrew(CS(), v, []); c.tags = n.tags; c.pips = n.pips; }
    } else c[b] = v;
  }
  else if (what === 'item' || what === 'cargo') {
    const arr = listOf(what);
    const it = arr[+a];
    if (!it) return;
    if (b === 'note') it.note = v;
    else if (b === 'count') it.count = parseCount(v);
    else {
      if (!final || !v.trim() || v.trim() === it.name) return;
      it.name = uniqueName(v.trim(), arr.filter(x => x !== it).map(x => x.name));
    }
  } else if (what === 'move') {
    const m = charMove(a) || (() => { const lm = moveList().find(x => x.name === a); const n = { name: a, marked: !!lm?.marked, text: lm?.text || '' }; st.moves.push(n); return n; })();
    if (b === 'name') { if (!final || !v.trim()) return; m.name = v.trim(); }
    else m.text = v;
  }
  changed();
  if (final && /title|name|to|type|serves/.test(b || '')) render();
}

app.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { query = t.value; searchMoves(); return; }
  if (t.dataset.setup) { setup[t.dataset.setup] = t.value; return; }
  if (t.dataset.log != null) { st.log[+t.dataset.log].note = t.value; changed(); return; }
  if (t.matches('textarea')) fitText([t]);
  const spec = t.dataset.bind || '';
  if (/:(title|name|k|to|type|serves)$/.test(spec) || spec.startsWith('bond:')) return; // applied on change
  bind(t, false);
});
app.addEventListener('change', e => {
  if (e.target.dataset.bind) bind(e.target, true);
  if (e.target.dataset.setup) { setup[e.target.dataset.setup] = e.target.value; if (e.target.dataset.setup === 'playbook') { setup.kit = ''; setup.oddity = ''; render(); } }
});

app.addEventListener('toggle', e => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.id || query) return;
  if (d.open) openSet.add(d.dataset.id); else openSet.delete(d.dataset.id);
  saveUi();
}, true);

document.addEventListener('keydown', e => {
  const nk = LISTS.find(([kind]) => e.target.id === newId(kind));
  if (e.key === 'Enter' && nk) { e.preventDefault(); addItem(nk[0]); return; }
  const nt = e.target.id?.match(/^newtag-crew-(\d+)$/);
  if (e.key === 'Enter' && nt) { e.preventDefault(); addCrewTag(+nt[1]); return; }
  if (e.key === '/' && !e.target.closest('input,textarea,select') && !document.getElementById('overlay')) {
    e.preventDefault();
    if (ui.tab !== 'moves') { ui.tab = 'moves'; saveUi(); render(); }
    document.getElementById('q')?.focus();
  }
});

/* ---------- sheet menu: embed link ---------- */
function sheetMenu() {
  const o = modal(`
    <div class="prow"><h2>${escTxt(st.info.name || tabName)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <div class="prow"><button class="pbtn" data-s="embed">Copy Notion embed link</button></div>
    <div class="status" data-msg></div>`, { label: 'Sheet options' });
  const say = m => { o.querySelector('[data-msg]').textContent = m; };
  o.addEventListener('click', async e => {
    const s = e.target.closest('[data-s]')?.dataset.s;
    if (s === 'embed') {
      const url = new URL(inviteUrl(client.game));
      const link = `${url.origin}${url.pathname}sheet.html?c=${encodeURIComponent(tabName)}${url.hash}`;
      try { await navigator.clipboard.writeText(link); say('Copied. Paste it into a Notion /embed block.'); } catch { say(link); }
    }
  });
}

/* ---------- start ---------- */
// Bonds link to the characters, the ship and its crew: a character's page reads the Ship tab once;
// the ship page follows the characters' tabs, for the bonds they have with its crew.
const characters = () => client.list.filter(t => t.kind === 'character').map(t => t.name);
const others = new Set();
function follow(names) {
  const fresh = names.filter(n => n.toLowerCase() !== tabName.toLowerCase() && !others.has(n.toLowerCase()));
  for (const n of fresh) { others.add(n.toLowerCase()); client.tab(n).on(() => later(render)); }
  return fresh;
}
const toRead = () => (SHIP ? characters() : ['Ship']);
showPictures(app, client);
render();
client.watch(tabName); // Rules is read once per visit (cached by digest), not polled
if (SHIP) client.watch(...characters());
client.read([tabName, ...TABS, ...follow(toRead())]).catch(() => render()); // a wrong or missing passphrase opens the prompt (see wireNav)
client.on(e => {
  if (!e.list) return;
  const fresh = follow(toRead());
  if (!fresh.length) return;
  if (SHIP) client.watch(...fresh);
  client.read(fresh).catch(() => {});
  render();
});
client.startPolling();
