// Read-only summary cards for the crew home and the GM page.
import { parseSheet, isSignedIn } from './codec.js';
import { href } from './games.js';
import { plain } from './markup.js';
import { esc, escTxt, fmt, pipClass, skullClass } from './core.js';
import { pictureHTML } from './pictures.js';
import { wealth, wealthOf } from './kit.js';
import { gameRules } from './rules.js';
import { systemOf, typeOf, sum, SHIP } from './system.js';
import { shareButtonHTML } from './share.js';

// The game's Rules and System tabs, indexed once per change.
let seen = null;
let rulesIdx = null;
function rulesOf(client) {
  const rows = [client.tab('Rules').rows, client.tab('System').rows];
  if (!seen || rows.some((r, i) => r !== seen[i])) { seen = rows; rulesIdx = gameRules(client); }
  return rulesIdx;
}
// A sheet's tracks with a role (harm, luck, …), under the game's names for them.
const roleRow = (st, sys, role, cls) => {
  const name = sys.name(role);
  const t = name && st.tracks[name.toLowerCase()];
  return t ? `<div class="cc-row"><span class="lbl">${escTxt(t.name)}</span><span class="pips ${cls}">${staticPips(t.pips, false, Math.max(0, sum(sys.track(role)?.skulls)))}</span></div>` : '';
};

export const staticPips = (arr, bond = false, skulls = 0) => arr.map((v, j) => `<span class="pip${pipClass(v, bond)}${skullClass(j, arr.length, skulls)}" aria-hidden="true"></span>`).join('');

// The GM's at-a-glance lines: the name a section starts with in bold, and a list's first-level lines.
const section = (st, title) => (title ? st.sections.find(x => x.title.toLowerCase() === title.toLowerCase())?.text || '' : '');
const boldName = t => (String(t).match(/^\*\*(.+?)\*\*/)?.[1] || '').replace(/[.:]$/, '').trim();
const line = (label, text) => (text ? `<div class="cc-row"><span class="lbl">${label}</span> <span class="cc-text">${escTxt(text)}</span></div>` : '');

// A sheet's picture (its info|Name row's: see pictures.js), small, beside the name.
const portrait = (client, tab, label) => pictureHTML(tab, client.tab(tab).imageOf('info', 'Name'), label, 'portrait sm', { still: true });

const roleLine = (st, sys, role) => line(escTxt(sys.title(role)), boldName(section(st, sys.title(role))));

function gmLinesHTML(st, sys) {
  const moves = st.moves.filter(m => m.marked).map(m => m.name);
  const w = wealthOf(sys);
  const { treasure, hoard } = wealth(st, w);
  const has = n => n && st.tracks[n.toLowerCase()];
  return roleLine(st, sys, 'vice') + roleLine(st, sys, 'oddity') +
    line('Moves', moves.join(', ')) +
    (has(w.t) || has(w.h) ? line('Wealth', `${hoard}-${w.h.toLowerCase()}, ${treasure}-${w.t.toLowerCase()} · ${st.items.length} items`) : '');
}

// A tab the sheet has answered for (its rows, or that it isn't there).
const ready = (client, tab) => client.tab(tab).loaded || client.tab(tab).missing;
// Until the sheet and the Rules and System tabs it's read by have come in, a card says so, not 0s.
const loadingCard = (client, page, q, title) => `<a class="card crewcard loading" aria-busy="true" href="${esc(href(page, client.game, q))}">
    <div class="shead"><h2>${escTxt(title)}</h2></div><div class="note">Loading…</div></a>`;

// share: the GM's Share button on the card (share.js).
export function crewCardHTML(client, name, { gm = false, me = false, share = false } = {}) {
  if (![name, 'Rules', 'System'].every(t => ready(client, t))) return loadingCard(client, 'sheet.html', { c: name }, name);
  const rows = client.tab(name).rows;
  const st = parseSheet(rows);
  const R = rulesOf(client);
  const sys = systemOf(R, typeOf(R, st.info.playbook));
  const pipsOf = role => (sys.name(role) && st.tracks[sys.name(role).toLowerCase()]?.pips) || [];
  const xp = pipsOf('xp').filter(v => v === 1).length;
  const vice = pipsOf('vice');
  const troubles = section(st, sys.title('troubles'));
  return `<a class="card crewcard" href="${esc(href('sheet.html', client.game, { c: name }))}">
    <div class="shead">${portrait(client, name, st.info.name || name)}<h2>${escTxt(st.info.name || name)}</h2>${me ? '<span class="pill me">You</span>' : isSignedIn(rows) ? '<span class="pill in">Signed in</span>' : ''}${st.state.downtime ? '<span class="pill">Downtime</span>' : ''}${gm && vice.includes(1) ? `<span class="pill vice">${escTxt(sys.name('vice'))}</span>` : ''}${share ? `<span class="grow"></span>${shareButtonHTML({ type: 'crew', ref: name, title: st.info.name || name })}` : ''}</div>
    <div class="note">${escTxt([st.info.playbook, st.info.player].filter(Boolean).join(' · '))}</div>
    ${roleRow(st, sys, 'harm', 'harm')}${roleRow(st, sys, 'luck', 'luck')}
    <div class="cc-row cc-stats">${st.stats.map(x => `<span><span class="lbl">${escTxt(x.k)}</span> ${fmt(x.v)}</span>`).join('')}</div>
    ${st.bonds.length ? `<div class="cc-bonds">${st.bonds.map(b => `<span class="cc-bond">${escTxt(b.name)} <span class="pips">${staticPips(b.pips, true)}</span></span>`).join('')}</div>` : ''}
    ${troubles.trim() ? `<div class="cc-row"><span class="lbl">${escTxt(sys.title('troubles'))}</span> <span class="cc-text">${escTxt(plain(troubles))}</span></div>` : ''}
    ${gm ? gmLinesHTML(st, sys) : ''}
    <div class="cc-row"><span class="lbl">Level ${parseInt(st.info.level, 10) || 0}</span>${sys.name('xp') ? `<span class="cnt">${xp} ${escTxt(sys.word('xp'))}</span>` : ''}</div>
  </a>`;
}

export function shipCardHTML(client, { gm = false, share = false } = {}) {
  const s = client.tab('Ship');
  if (!['Ship', 'Rules', 'System'].every(t => ready(client, t))) return loadingCard(client, 'ship.html', undefined, 'Ship');
  if (s.missing) return `<a class="card crewcard" href="${esc(href('ship.html', client.game))}"><h2>Ship</h2><div class="note">Not set up yet.</div></a>`;
  const st = parseSheet(s.rows);
  const sys = systemOf(rulesOf(client), SHIP);
  return `<a class="card crewcard" href="${esc(href('ship.html', client.game))}">
    <div class="shead">${portrait(client, 'Ship', st.info.name || 'Ship')}<h2>${escTxt(st.info.name || 'Ship')}</h2>${share ? `<span class="grow"></span>${shareButtonHTML({ type: 'ship', title: st.info.name || 'The ship' })}` : ''}</div>
    <div class="note">${escTxt(st.info.playbook || '')}</div>
    ${roleRow(st, sys, 'harm', 'harm')}${roleRow(st, sys, 'luck', 'luck')}
    <div class="cc-row cc-stats">${st.stats.map(x => `<span><span class="lbl">${escTxt(x.k)}</span> ${fmt(x.v)}</span>`).join('')}</div>
    ${gm ? roleLine(st, sys, 'oddity') + line('Moves', st.moves.filter(m => m.marked).map(m => m.name).join(', ')) +
      line(escTxt(sys.title('specials')), [...section(st, sys.title('specials')).matchAll(/^\[x\]\s*(.+)$/gim)].map(m => m[1].trim()).join(', ')) +
      line(escTxt(sys.title('crew')), st.crew.map(c => c.name).join(', ')) + line(escTxt(sys.title('cargo')), st.cargo.map(c => c.name).join(', ')) : ''}
  </a>`;
}
