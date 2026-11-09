// Searchable views of the Rules tab, shared by rules.html (crew) and gm.html (GM).
import { md, plain } from './markup.js';
import { escTxt } from './core.js';
import { systemOf, typeOf, cap, SHIP } from './system.js';

const PLAYBOOK_KINDS = ['playbook', 'vice', 'kit', 'lastwords', 'question', 'pmove', 'smove', 'pnote', 'renown'];
// The game's mechanics (see system.js): the site uses them, the Rules page doesn't list them.
const SYSTEM_KINDS = ['stat', 'track', 'section', 'choice'];
const FATE_GROUPS = { responsibility: 'Responsibilities', agenda: 'Agendas', compass: 'Compass points', move: 'Fate moves', movescale: 'Move scale', inplay: 'Playbooks in play', appropriate: 'Appropriate Fates moves' };

function groupLabel(r) {
  switch (r.kind) {
    case 'move': return `${cap(r.group)} moves`;
    case 'procedure': return 'Sessions, chapters, downtime and levels';
    case 'house': return 'House rules';
    case 'advance': return 'Advances';
    case 'tag': return `${cap(r.group)} tags`;
    case 'trouble': return 'Troubles';
    case 'table': return r.group;
    case 'rule': return cap(r.group);
    case 'special': return 'Ship specials';
    case 'oddity': return 'Example oddities';
    case 'fate': return FATE_GROUPS[r.group.toLowerCase()] || cap(r.group);
    case 'faction': return r.group;
    default: return r.group ? cap(r.group) : cap(r.kind);
  }
}

export const SECTIONS = {
  moves: { label: 'Moves', test: r => r.kind === 'move' },
  playbooks: { label: 'Playbooks', test: r => PLAYBOOK_KINDS.includes(r.kind) || (r.kind === 'oddity' && r.group !== 'Example') },
  tags: { label: 'Tags', test: r => r.kind === 'tag' || r.kind === 'trouble' },
  reference: { label: 'Reference', test: r => ['procedure', 'house', 'advance', 'table', 'rule', 'special'].includes(r.kind) || (r.kind === 'oddity' && r.group === 'Example') },
  fates: { label: 'Fates', test: r => r.kind === 'fate' },
  world: { label: 'World', test: r => ['world', 'faction'].includes(r.kind) },
  other: { label: 'Other', test: r => !['move', 'fate', 'world', 'faction', 'procedure', 'house', 'advance', 'tag', 'trouble', 'table', 'rule', 'special', 'oddity', ...PLAYBOOK_KINDS, ...SYSTEM_KINDS].includes(r.kind) },
};

const metaLine = r => Object.entries(r.meta).filter(([k]) => !['start', 'adv'].includes(k)).map(([k, v]) => (v === true ? k : `${k} ${v}`)).join(' · ');

// The book's wording, under the game's own, for a row with overrides.
export function origHTML(r) {
  if (!r.orig || (r.orig.name === r.name && r.orig.text === r.text)) return '';
  return `<details class="orig"><summary>Rapscallion original</summary>${r.orig.name !== r.name ? `<p><b>${escTxt(r.orig.name)}</b></p>` : ''}${r.orig.text.trim() ? md(r.orig.text) : ''}</details>`;
}

// Tags and troubles are short: show them as an always-visible glossary.
const GLOSSARY = ['tag', 'trouble'];

export function recordHTML(r, open = false) {
  if (GLOSSARY.includes(r.kind)) {
    return `<div class="gloss" data-rec="${r.i}"><b>${escTxt(r.name)}</b><div class="gdef">${md(r.text)}${origHTML(r)}</div></div>`;
  }
  const meta = r.kind === 'table' ? metaLine(r) : '';
  const body = (r.text.trim() ? md(r.text) : '') + origHTML(r);
  if (!body) return `<div class="refline" data-rec="${r.i}"><b>${escTxt(r.name)}</b>${meta ? ` <span class="cnt">${escTxt(meta)}</span>` : ''}</div>`;
  return `<details class="move" data-rec="${r.i}"${open ? ' open' : ''}><summary><span class="mn">${escTxt(r.name)}</span>${meta ? `<span class="cnt">${escTxt(meta)}</span>` : ''}</summary><div class="mbody">${body}</div></details>`;
}

function grouped(recs, open) {
  const groups = new Map();
  for (const r of recs) {
    const g = groupLabel(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  return [...groups].map(([g, rs]) => `<div class="mgroup"><h3>${escTxt(g)}</h3>${rs.map(r => recordHTML(r, open)).join('')}</div>`).join('');
}

function playbookHTML(R, p) {
  const pb = R.playbook(p.name);
  const part = (title, body) => (body ? `<div class="pbpart"><h4>${title}</h4>${body}</div>` : '');
  const items = (rs, f) => rs.map(f).join('');
  // A playbook's own track sizes (harm=8): shown under the game's names for those tracks.
  const meta = systemOf(R, typeOf(R, p.name)).tracks.map(t => [t, p.meta[t.name.toLowerCase()] ?? (t.role ? p.meta[t.role] : undefined)]).filter(([, v]) => v != null && v !== true).map(([t, v]) => `${t.name} ${v}`).join(' · ');
  return `<details class="move pbook"><summary><span class="mn">${escTxt(p.name)}</span>${meta ? `<span class="cnt">${escTxt(meta)}</span>` : ''}</summary><div class="mbody">
    ${p.text ? md(p.text) : ''}
    ${part('Vice', items(pb.vices, v => `<p><b>${escTxt(v.name)}.</b></p>${md(v.text)}${origHTML(v)}`))}
    ${part('Oddities', items(pb.oddities, o => `<p><b>${escTxt(o.name)}</b>${o.meta.traits ? ` <span class="cnt">${escTxt(o.meta.traits)}</span>` : ''}</p>${md(o.text)}${origHTML(o)}`))}
    ${part('Kits', items(pb.kits, k => `<p><b>${escTxt(k.name)}</b>${k.meta.traits ? ` <span class="cnt">${escTxt(k.meta.traits)}</span>` : ''}</p>${md(k.text)}${origHTML(k)}`))}
    ${part('Moves', items([...pb.moves, ...pb.smoves], m => `<p><b>${escTxt(m.name)}</b>${m.meta.start ? ' <span class="cnt">start</span>' : ''}</p>${md(m.text)}${origHTML(m)}`))}
    ${part('Renown', items(pb.renown, r => `<p><b>${escTxt(r.name)}</b></p>${md(r.text)}`))}
    ${part('Last words', pb.lastwords ? md(pb.lastwords.text) : '')}
    ${part('Questions', items(pb.questions, q => `<p><b>${escTxt(q.name)}.</b> ${escTxt(plain(q.text))}</p>`))}
    ${part('Notes', items(pb.notes, n => md(n.text)))}
  </div></details>`;
}

export function sectionHTML(R, key, query = '') {
  const sec = SECTIONS[key];
  const q = query.trim().toLowerCase();
  if (q) {
    const hits = R.recs.filter(r => sec.test(r) && r.search.includes(q));
    return hits.length ? grouped(hits, true) : '<div class="empty">No matches.</div>';
  }
  if (key === 'playbooks') {
    // Grouped by type (type= in a playbook's meta), ships last.
    const types = [];
    for (const p of R.playbooks()) { const t = typeOf(R, p.name); if (!types.includes(t)) types.push(t); }
    types.sort((a, b) => (a === SHIP) - (b === SHIP));
    return types.map(t => {
      const pbs = R.playbooks().filter(p => typeOf(R, p.name) === t);
      return `<div class="mgroup"><h3>${escTxt(cap(t || 'other'))} playbooks</h3>${pbs.map(p => playbookHTML(R, p)).join('')}</div>`;
    }).join('') || '<div class="empty">No playbooks in the Rules tab.</div>';
  }
  const recs = R.recs.filter(sec.test);
  return recs.length ? grouped(recs, false) : '<div class="empty">Nothing in the Rules tab for this yet.</div>';
}

export function searchAllHTML(R, keys, query) {
  const q = query.trim().toLowerCase();
  const hits = R.recs.filter(r => keys.some(k => SECTIONS[k].test(r)) && r.search.includes(q));
  return hits.length ? grouped(hits, true) : '<div class="empty">No matches.</div>';
}

export const sectionHasContent = (R, key) => R.recs.some(SECTIONS[key].test);
