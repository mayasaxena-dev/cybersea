// GM page: gm.html?g=<game>. Needs the GM passphrase.
// The GM tab's rows: npc (Value = tags, Notes = notes), track|<npc name> (that NPC's harm),
// note and secret (Value = text), clock (Value = pips). Other rows are left alone.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { gameRules, TABS as RULE_TABS } from './rules.js';
import { systemOf, characterTypes, sum, circles } from './system.js';
import { md } from './markup.js';
import { parseTrack, formatTrack, logId } from './codec.js';
import { esc, escTxt, ICON, armed, toast, deletedToast, pipClass, pageShell, refreshNav, askKey, whenIdle, debounce, fitText, noGame, freeName, toEntries, toRows, sameRows, typingIn } from './core.js';
import { crewCardHTML, shipCardHTML } from './cards.js';
import { showPictures } from './pictures.js';
import { tagsHTML, tagListHTML, addTag, removeTag } from './tags.js';
import { splitTags } from './crew.js';
import { SECTIONS, sectionHTML, searchAllHTML, sectionHasContent } from './refview.js';
import { SESSION_TAB, NPCS_TAB, ACTIONS, parseSession, hasDone, rollLine, parseSpec, formatSpec } from './session-model.js';
import { shareButtonHTML, wireShare, writeRows } from './share.js';
import { parseRoll, ROLLS_TAB } from './rolls.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) noGame(app, 'gm');

const client = new GameClient(game);
pageShell(app, client, 'gm');
const gmStore = client.tab('GM');
const main = document.createElement('main');
app.append(main);
showPictures(main, client);

const TABS = [['session', 'Session'], ['crew', 'Crew'], ['npcs', 'NPCs'], ['notes', 'Notes'], ['ref', 'Reference']];
const REF_KEYS = ['fates', 'tags', 'moves', 'playbooks', 'reference', 'world', 'other'];
let tab = 'crew';
let refTab = 'fates';
let query = '';
let editing = false;
let R = gameRules(client);

// GM tab rows as editable entries (kinds lower-cased; unknown kinds kept as they are).
let entries = toEntries(gmStore.rows, true);
let base = toRows(entries);
function changed() { const next = toRows(entries); gmStore.change(base, next); base = next; syncClocks(); }
const busy = () => typingIn(main);

// Someone else's change, held while this page is typing (see whenIdle).
const later = whenIdle(main, busy);
function adopt() {
  const ne = toEntries(gmStore.rows, true);
  if (sameRows(toRows(ne), base) && main.dataset.ready) return;
  entries = ne;
  base = toRows(ne);
  if (tab === 'npcs' || tab === 'notes') render();
}
gmStore.on(e => { if (e.fromServer) later(adopt); });
for (const t of RULE_TABS) client.tab(t).on(() => { R = gameRules(client); if (tab !== 'notes') render(); });
// NPC sizes and clocks, from the Rules tab: choice | npc | Mook | | size=1, choice | clock | Clock | | size=6.
const npcSizes = () => R.by('choice', 'npc').map(c => [c.name, sum(c.meta.size)]);
const harmName = () => systemOf(R, 'npc').name('harm') || systemOf(R, characterTypes(R)[0]).name('harm');

const characters = () => client.list.filter(t => t.kind === 'character').map(t => t.name);
const harmOf = name => entries.find(e => e.kind === 'track' && e.name.toLowerCase() === name.toLowerCase());
const unique = (kind, name) => freeName(name, n => entries.some(e => e.kind === kind && e.name.toLowerCase() === n));
const pipsHTML = (id, arr, label) => arr.map((v, j) => `<button class="pip${pipClass(v)}" data-gpip="${esc(id)}" data-j="${j}" aria-label="${esc(label)} ${j + 1}" aria-pressed="${v === 1}"></button>`).join('');

/* ---------- views ---------- */
function crewHTML() {
  const shares = [...characters().map(n => shareButtonHTML({ type: 'crew', ref: n, title: n }, n)), shareButtonHTML({ type: 'ship', title: 'The ship' }, 'Ship')].join('');
  return `<div class="prow shares"><span class="lbl">Share a card</span>${shares}</div>
    <div class="crew">${characters().map(n => crewCardHTML(client, n, { gm: true })).join('')}${shipCardHTML(client, { gm: true })}</div>`;
}

// NPC tags (an npc row's Value): the Rules tab's npc tags as chips linking to them, the rest free text.
const tagGroup = () => (R.by('tag', 'npc').length ? 'npc' : '');
const npcTags = (e, i) => tagsHTML(e.value, { R, group: tagGroup(), game: client.game, edit: editing, key: `npc-${i}` });
function addNpcTag(i) {
  const e = entries[i];
  const el = document.getElementById(`newtag-npc-${i}`);
  if (!e || !el) return;
  const next = addTag(e.value, el.value);
  if (next !== e.value) { e.value = next; changed(); }
  render();
  document.getElementById(`newtag-npc-${i}`)?.focus();
}

function npcHTML() {
  const npcs = entries.map((e, i) => ({ e, i })).filter(x => x.e.kind === 'npc');
  const cards = npcs.map(({ e, i }) => {
    const h = harmOf(e.name);
    const harm = h ? parseTrack(h.value) : [];
    if (editing) {
      return `<section class="card"><div class="shead">
          <input class="in st" data-f="name" data-i="${i}" value="${esc(e.name)}" aria-label="Name">
          <button class="mini del" data-act="rm" data-i="${i}" aria-label="Delete">×</button></div>
        ${npcTags(e, i)}
        <div class="cc-row"><span class="lbl">${escTxt(harmName())}</span><span class="pips harm">${pipsHTML(e.name, harm, `${e.name} ${harmName()}`)}</span>
          <span class="pm"><button class="mini" data-act="harm-" data-name="${esc(e.name)}" aria-label="Less">−</button><button class="mini" data-act="harm+" data-name="${esc(e.name)}" aria-label="More">+</button></span></div>
        <textarea class="in rtext" data-f="notes" data-i="${i}" aria-label="Notes">${escTxt(e.notes)}</textarea></section>`;
    }
    return `<section class="card"><div class="shead"><h2>${escTxt(e.name)}</h2><span class="grow"></span>${shareButtonHTML({ type: 'npc', ref: e.name, i })}</div>
      ${npcTags(e, i)}
      ${harm.length ? `<div class="cc-row"><span class="lbl">${escTxt(harmName())}</span><span class="pips harm">${pipsHTML(e.name, harm, `${e.name} ${harmName()}`)}</span></div>` : ''}
      ${e.notes ? `<div class="rich">${md(e.notes)}</div>` : ''}</section>`;
  }).join('');
  return `<div class="mtools"><span class="grow"></span>${editToggle()}</div>
    <div class="cols">${cards || '<div class="empty">No NPCs yet.</div>'}</div>${editing ? tagListHTML(R, tagGroup()) : ''}
    <div class="prow npcadd"><span class="lbl">Add</span>${(npcSizes().length ? npcSizes() : [['NPC', 0]]).map(([l, n]) => `<button class="pbtn" data-act="add-npc" data-harm="${n}">${escTxt(l)}</button>`).join('')}</div>`;
}

function notesHTML() {
  const groups = [['secret', 'Secrets'], ['note', 'Notes'], ['clock', 'Clocks']];
  const body = groups.map(([kind, label]) => {
    const items = entries.map((e, i) => ({ e, i })).filter(x => x.e.kind === kind);
    if (!items.length && !editing) return '';
    const cards = items.map(({ e, i }) => {
      if (kind === 'clock') {
        const p = parseTrack(e.value);
        return `<section class="card"><div class="shead">${editing ? `<input class="in st" data-f="name" data-i="${i}" value="${esc(e.name)}" aria-label="Clock">` : `<h2>${escTxt(e.name)}</h2>${shareButtonHTML({ type: 'clock', ref: e.name, i })}`}
          <span class="pips">${pipsHTML(`clock:${i}`, p, e.name)}</span>
          ${editing ? `<span class="pm"><button class="mini" data-act="clock-" data-i="${i}" aria-label="Fewer">−</button><button class="mini" data-act="clock+" data-i="${i}" aria-label="More">+</button></span><button class="mini del" data-act="rm" data-i="${i}" aria-label="Delete">×</button>` : ''}</div></section>`;
      }
      return editing
        ? `<section class="card"><div class="shead"><input class="in st" data-f="name" data-i="${i}" value="${esc(e.name)}" aria-label="Title"><button class="mini del" data-act="rm" data-i="${i}" aria-label="Delete">×</button></div>
            <textarea class="in rtext" data-f="value" data-i="${i}" aria-label="Text">${escTxt(e.value)}</textarea></section>`
        : `<section class="card"><div class="shead"><h2>${escTxt(e.name)}</h2><span class="grow"></span>${shareButtonHTML({ type: 'secret', title: e.name, i })}</div>${e.value ? `<div class="rich">${md(e.value)}</div>` : ''}</section>`;
    }).join('');
    return `<div class="mgroup"><h3>${label}</h3><div class="cols">${cards}</div>${editing ? `<button class="add sm" data-act="add-note" data-kind="${kind}">+</button>` : ''}</div>`;
  }).join('');
  return `<div class="mtools"><span class="grow"></span>${editToggle()}</div>${body || '<div class="empty">No notes yet. Use the pencil to add some.</div>'}`;
}

function refHTML() {
  const keys = REF_KEYS.filter(k => sectionHasContent(R, k));
  if (!keys.includes(refTab)) refTab = keys[0] || 'fates';
  return `<div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search everything" value="${esc(query)}" aria-label="Search" autocomplete="off">
      <div class="cats">${keys.map(k => `<button data-ref="${k}" aria-pressed="${!query && refTab === k}" class="${!query && refTab === k ? 'on' : ''}">${SECTIONS[k].label}</button>`).join('')}</div>
    </div><div id="ref">${query.trim() ? searchAllHTML(R, keys, query) : keys.length ? sectionHTML(R, refTab) : '<div class="empty">The Rules tab is empty.</div>'}</div>`;
}

const editToggle = () => `<button class="ic${editing ? ' on' : ''}" data-act="edit" title="Edit" aria-pressed="${editing}">${ICON.pen}</button>`;

const search = debounce(() => {
  const ref = document.getElementById('ref');
  if (!ref) return;
  const keys = REF_KEYS.filter(k => sectionHasContent(R, k));
  ref.innerHTML = query.trim() ? searchAllHTML(R, keys, query) : sectionHTML(R, refTab);
  main.querySelectorAll('[data-ref]').forEach(b => { const on = !query.trim() && b.dataset.ref === refTab; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
});
function render() {
  search.cancel();
  main.dataset.ready = gmStore.loaded ? '1' : '';
  if (client.role && client.role !== 'gm') {
    main.innerHTML = `<div class="empty-page"><p>This page needs the GM passphrase.</p><p><button class="pbtn" data-act="gm-key">Enter the GM passphrase</button></p></div>`;
    return;
  }
  if (!gmStore.loaded && !gmStore.missing) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const view = tab === 'session' ? sessionHTML() : tab === 'crew' ? crewHTML() : tab === 'npcs' ? npcHTML() : tab === 'notes' ? notesHTML() : refHTML();
  main.innerHTML = `<nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav><div class="gmview">${view}</div>`;
  fitText(main.querySelectorAll('textarea'), 70);
}

/* ---------- sessions ---------- */
// Starting a session, ending it, or ending a chapter prompts each player, on the Session page, to
// run that on their sheet; the ticks show who has.
const ACTION_LABEL = { 'session-begin': 'Session Begins', 'session-end': 'Session Ends', 'chapter-end': 'Chapter’s End' };
const labelOf = a => R.recs.find(r => String(r.meta.action).toLowerCase() === a && r.meta.label)?.meta.label || R.recs.find(r => String(r.meta.action).toLowerCase() === a)?.name || ACTION_LABEL[a];
function sessionHTML() {
  const S = parseSession(client.tab(SESSION_TAB).rows);
  const cur = S.current;
  const chars = characters();
  const ticks = ACTIONS.filter(a => S.prompts[a]?.stamp).map(a => `<div class="cc-row"><span class="lbl">${escTxt(labelOf(a))}</span>${escTxt(S.prompts[a].title)}
      <span class="grow"></span>${chars.map(n => `<span class="pill${hasDone(S, a, n) ? ' in' : ''}" title="${hasDone(S, a, n) ? 'Done' : 'Not yet'}">${hasDone(S, a, n) ? '✓' : '·'} ${escTxt(n)}</span>`).join(' ')}</div>`).join('');
  return `<section class="card"><div class="shead"><h2>${cur ? escTxt(cur.title) : 'No session running'}</h2></div>
    ${cur ? `<div class="note">Started ${escTxt(new Date(cur.start).toLocaleString())}</div>
      <div class="prow"><button class="pbtn" data-act="ses-end">End the session</button><button class="pbtn" data-act="chapter-end">End the chapter</button></div>`
    : `<div class="prow"><input class="in" id="ses-title" placeholder="Session ${S.sessions.length + 1}: …" aria-label="Session title"><button class="pbtn primary" data-act="ses-start">Start a session</button></div>`}
    <div class="note">The crew get a prompt on the Session page to run it on their sheets. Share things from here, the Map, Lore, Rules, Crew and Ship pages.</div>
    ${ticks}</section>`;
}

const sessionRows = next => writeRows(client, SESSION_TAB, next).catch(e => toast(e.message, 'lo'));
const promptRow = (a, title) => ['prompt', a, logId(), title];
function startSession() {
  const S = parseSession(client.tab(SESSION_TAB).rows);
  const title = (document.getElementById('ses-title')?.value || '').trim() || `Session ${S.sessions.length + 1}`;
  if (S.sessions.some(x => x.title.toLowerCase() === title.toLowerCase())) { toast(`There’s a session called “${title}” already.`, 'lo'); return; }
  const now = new Date().toISOString();
  sessionRows(rows => [...rows.filter(r => !(String(r[0]).toLowerCase() === 'prompt')), ['session', title, now, ''], promptRow('session-begin', title)]).then(render);
}
function endSession() {
  const S = parseSession(client.tab(SESSION_TAB).rows);
  const cur = S.current;
  if (!cur) return;
  const now = new Date().toISOString();
  const from = Date.parse(cur.start) || 0;
  const rolls = client.tab(ROLLS_TAB).rows.map(parseRoll).filter(r => Date.parse(r.when) >= from).map(rollLine).join('\n');
  sessionRows(rows => [...rows.filter(r => !(String(r[0]).toLowerCase() === 'session' && r[1] === cur.title) && String(r[0]).toLowerCase() !== 'prompt'),
    ['session', cur.title, cur.start, now], ['rolls', cur.title, rolls, ''], promptRow('session-end', cur.title)]).then(render);
}
function endChapter() {
  const S = parseSession(client.tab(SESSION_TAB).rows);
  sessionRows(rows => [...rows.filter(r => !(String(r[0]).toLowerCase() === 'prompt' && String(r[1]).toLowerCase() === 'chapter-end')), promptRow('chapter-end', S.current?.title || '')]).then(render);
}

// A shared clock follows the GM's: ticking it here ticks it on the Session page.
function syncClocks() {
  const st = client.tab(SESSION_TAB);
  const clocks = new Map(entries.filter(e => e.kind === 'clock').map(e => [e.name.toLowerCase(), e.value]));
  const next = st.rows.map(r => {
    if (String(r[0]).toLowerCase() !== 'share') return r;
    const sp = parseSpec(r[3]);
    if (sp.type !== 'clock' || !clocks.has(sp.ref.toLowerCase()) || clocks.get(sp.ref.toLowerCase()) === sp.body) return r;
    return [r[0], r[1], r[2], formatSpec({ ...sp, body: clocks.get(sp.ref.toLowerCase()) })];
  });
  if (next.some((r, i) => r !== st.rows[i])) st.change(st.rows, next);
}

// What a Share button here shares: an NPC's parts to pick from, a secret's text, a clock's pips.
wireShare(main, client, spec => {
  const e = entries[spec.i];
  if (!e) return spec;
  if (spec.type === 'npc') { const h = harmOf(e.name); return { type: 'npc', ref: e.name, npc: { tags: e.value, harm: h ? h.value : '', notes: e.notes } }; }
  if (spec.type === 'clock') return { type: 'clock', ref: e.name, body: e.value };
  if (spec.type === 'secret') return { type: 'secret', title: e.name, body: e.value };
  return spec;
});

/* ---------- interactions ---------- */
function setHarm(name, fn) {
  let h = harmOf(name);
  if (!h) { h = { kind: 'track', name, value: '', notes: '' }; entries.push(h); }
  const p = parseTrack(h.value);
  fn(p);
  h.value = formatTrack(p);
  if (!p.length) entries.splice(entries.indexOf(h), 1);
}

main.addEventListener('click', e => {
  const pip = e.target.closest('[data-gpip]');
  if (pip) {
    const id = pip.dataset.gpip;
    const j = +pip.dataset.j;
    if (id.startsWith('clock:')) { const c = entries[+id.slice(6)]; const p = parseTrack(c.value); p[j] = p[j] === 1 ? 0 : 1; c.value = formatTrack(p); }
    else setHarm(id, p => { p[j] = p[j] === 1 ? 0 : 1; });
    changed();
    render();
    return;
  }
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; render(); return; }
  const r = e.target.closest('[data-ref]');
  if (r) { refTab = r.dataset.ref; query = ''; render(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const i = +b.dataset.i;
  if (act === 'gm-key') askKey(client, 'Enter the GM passphrase.');
  if (act === 'ses-start') startSession();
  if (act === 'ses-end' && armed(b)) endSession();
  if (act === 'chapter-end' && armed(b)) endChapter();
  if (act === 'edit') { editing = !editing; render(); }
  if (act === 'add-npc') {
    const name = unique('npc', 'New NPC');
    entries.push({ kind: 'npc', name, value: '', notes: '' });
    setHarm(name, p => { p.push(...Array(Math.max(0, +b.dataset.harm || 0)).fill(0)); }); // harm tally by NPC size (choice rows)
    editing = true;
    changed(); render();
  }
  if (act === 'add-note') {
    const kind = b.dataset.kind;
    entries.push({ kind, name: unique(kind, kind === 'clock' ? 'New clock' : kind === 'secret' ? 'New secret' : 'New note'), value: kind === 'clock' ? circles(sum(R.by('choice', 'clock')[0]?.meta.size)) : '', notes: '' });
    changed(); render();
  }
  if (act === 'add-tag') addNpcTag(+b.dataset.tags.slice(4));
  if (act === 'rm-tag') {
    const en = entries[+b.dataset.tags.slice(4)];
    if (en) {
      const was = en.value;
      en.value = removeTag(was, +b.dataset.k);
      changed(); render();
      deletedToast(splitTags(was)[+b.dataset.k], () => {
        const x = entries.find(e => e.kind === en.kind && e.name === en.name);
        if (x) { x.value = was; changed(); render(); }
      });
    }
  }
  if (act === 'harm+' || act === 'harm-') { setHarm(b.dataset.name, p => (act === 'harm+' ? p.push(0) : p.pop())); changed(); render(); }
  if (act === 'clock+' || act === 'clock-') { const c = entries[i]; const p = parseTrack(c.value); if (act === 'clock+') p.push(0); else p.pop(); c.value = formatTrack(p); changed(); render(); }
  if (act === 'rm' && armed(b)) {
    const gone = entries[i];
    if (!gone) return;
    const h = gone.kind === 'npc' && harmOf(gone.name);
    entries.splice(i, 1);
    if (h) entries.splice(entries.indexOf(h), 1);
    // gone from here now, from the sheet in a few seconds unless undone (TabStore.hideGone)
    const undo = gmStore.hideGone(base, toRows(entries));
    changed(); render();
    deletedToast(gone.name, () => { if (undo()) later(adopt); });
  }
});

main.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { query = t.value; search(); return; }
  if (t.dataset.f === 'value' || t.dataset.f === 'notes') {
    entries[+t.dataset.i][t.dataset.f] = t.value;
    if (t.tagName === 'TEXTAREA') fitText([t], 70);
    changed();
  }
});
main.addEventListener('keydown', e => {
  const m = e.target.id?.match(/^newtag-npc-(\d+)$/);
  if (e.key === 'Enter' && m) { e.preventDefault(); addNpcTag(+m[1]); }
});
// Names are row keys: apply them when the field is left, and carry an NPC's harm along.
main.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.f !== 'name') return;
  const en = entries[+t.dataset.i];
  const v = t.value.trim();
  if (!v || v.toLowerCase() === en.name.toLowerCase()) { if (v) { en.name = v; changed(); } return; }
  const nn = unique(en.kind, v);
  if (en.kind === 'npc') { const h = harmOf(en.name); if (h && !harmOf(nn)) h.name = nn; }
  en.name = nn;
  changed();
  render();
});

/* ---------- start ---------- */
// Every poll reports the tab list. Redraw only when it (or our access) changed: a redraw resets
// half-typed fields and the first click of a two-click delete. Tab contents redraw on their own.
let listSig = null;
client.on(e => {
  if (e.list) {
    refreshNav(client, 'gm');
    const fresh = ['Ship', ...characters()].filter(n => !client.watched.has(n));
    fresh.forEach(n => { client.watch(n); client.tab(n).on(() => { if (tab === 'crew') render(); }); });
    if (fresh.length) client.read().catch(() => {});
    const sig = JSON.stringify([client.role, client.list]);
    if (sig !== listSig) { listSig = sig; render(); }
  }
});
client.tab(SESSION_TAB).on(() => { if (tab === 'session') later(render); });
render();
client.watch('GM', 'Ship', NPCS_TAB, 'Lore', ...characters());
for (const n of ['Ship', ...characters()]) client.tab(n).on(() => { if (tab === 'crew') render(); });
client.read([...RULE_TABS, ...client.watched]).catch(() => render());
client.startPolling();

