// The ship's crew (crew rows on the Ship tab: see codec.js) and who a name on a sheet means.
// A crew member gets a little sheet on the ship page's crew tab: their kind, whose they are, their
// tracks, tags (explained by the Rules tab's tag rows), the bonds characters have with them, and notes.
// What a crew member has comes from the crew section's System row (see system.js): its type gives
// the tracks and tag group, and its table names the Rules rows that are the kinds of crew member.
import { parseSheet } from './codec.js';
import { href } from './games.js';
import { systemOf, trackSize } from './system.js';

const low = s => String(s ?? '').trim().toLowerCase();
// "Death (lover)" means Death.
const norm = s => low(String(s ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' '));

/* ---------- who a name means ---------- */
// Everyone a bond (or a crew member's Serves) can name, from the tabs this page has: each character
// (by tab name or full name), the ship (as "Ship" or its name) and its crew.
// [{key, label, name (what a bond's link stores), names, href, crew?}]
export function people(client) {
  const out = [];
  for (const t of client.list.filter(x => x.kind === 'character')) {
    const s = client.tab(t.name);
    const full = s.loaded && !s.missing ? parseSheet(s.rows).info.name || '' : '';
    out.push({ key: `c:${low(t.name)}`, label: full || t.name, name: t.name, names: [t.name, full], href: href('sheet.html', client.game, { c: t.name }) });
  }
  const ship = client.tab('Ship');
  const st = ship.loaded && !ship.missing ? parseSheet(ship.rows) : null;
  if (st || client.list.some(x => x.kind === 'ship')) {
    out.push({ key: 'ship', label: st?.info.name || 'Ship', name: 'Ship', names: ['Ship', st?.info.name], href: href('ship.html', client.game) });
  }
  for (const c of st?.crew || []) {
    out.push({ key: `crew:${low(c.name)}`, label: c.name, name: c.name, names: [c.name], crew: c, href: crewHref(client, c.name) });
  }
  return out;
}
export const crewHref = (client, name) => href('ship.html', client.game, { crew: name });

// The one person a name means: a full match, else the only one with it as a whole word of their
// name ("Bo" for Bo Brine).
export function whoIs(name, all) {
  const n = norm(name);
  if (!n) return null;
  const exact = all.find(p => p.names.some(x => norm(x) === n));
  if (exact) return exact;
  const word = all.filter(p => p.names.some(x => x && ` ${norm(x)} `.includes(` ${n} `)));
  return word.length === 1 ? word[0] : null;
}
// A bond's link: who its Notes name, "-" for no one, or else who its name means.
export const bondTarget = (b, all) => (b.to === '-' ? null : whoIs(b.to || b.name, all));

/* ---------- tags ---------- */
// A tag's Rules row: "Aids [something]" explains "aids science", "Tough-x" explains "tough-2" and
// "harm-x [something]" explains "harm-2 cutlasses".
const tagRe = new Map();
function patternOf(name) {
  if (!tagRe.has(name)) {
    const src = low(name).split(/(\[[^\]]*\])/).map(part => (/^\[.*\]$/.test(part) ? '.+'
      : part.replace(/[.*+?^${}()|\\]/g, '\\$&').replace(/(^|-)x(?=-|\s|$)/g, '$1\\d+'))).join('');
    tagRe.set(name, new RegExp(`^${src}$`));
  }
  return tagRe.get(name);
}
// group: a tag group, a list of them, or none for every tag.
export function tagRows(R, group) {
  const groups = [group].flat().filter(Boolean);
  return groups.length ? groups.flatMap(g => R.by('tag', g)) : R.by('tag');
}
export function tagDef(R, tag, group) {
  const t = low(tag);
  const rows = tagRows(R, group);
  return rows.find(r => low(r.name) === t) || rows.find(r => patternOf(r.name).test(t)) || null;
}
// "2-harm, aids science (and fixing), wild": commas inside brackets don't split.
export function splitTags(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(s ?? '')) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

// The list with v added (once; commas would split it, so they become spaces), or with tag k taken off.
export function addTag(s, v) {
  const t = String(v ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const tags = splitTags(s);
  return !t || tags.some(x => x.toLowerCase() === t.toLowerCase()) ? tags.join(', ') : [...tags, t].join(', ');
}
export const removeTag = (s, k) => splitTags(s).filter((_, i) => i !== k).join(', ');

/* ---------- kinds of crew member and new ones ---------- */
// The crew section's System row, its tracks (type's role=harm and so on), and the kinds of crew member.
export function crewSystem(R, shipSys) {
  const def = shipSys.section('crew');
  if (!def) return null;
  const sys = def.type ? systemOf(R, def.type) : null;
  return {
    def,
    harm: sys?.track('harm') || null,
    kinds: def.table ? R.by('table', def.table) : [],
    kind: name => (def.table && name ? R.by('table', def.table).find(r => low(r.name) === low(name)) : null) || null,
    tagGroup: def.type || '',
  };
}

// A new crew member of a kind: its first sample name not on the crew yet (a kind's Text lists them,
// "Name, what they look like; …"), its tags and its harm pips.
export function newCrew(cs, kindName, taken) {
  const k = cs.kind(kindName);
  const samples = String(k?.text || '').split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const [name, ...rest] = x.split(',');
    return { name: name.trim(), note: rest.join(',').trim() };
  });
  const free = samples.find(s => s.name && !taken.some(t => low(t) === low(s.name)));
  const size = cs.harm ? trackSize(cs.harm, { pb: k }) : 0;
  return {
    name: free?.name || '',
    pips: Array(Math.max(0, size)).fill(0),
    type: k?.name || '',
    serves: '',
    tags: k?.meta.tags || '',
    note: free?.note ? `${free.note.charAt(0).toUpperCase()}${free.note.slice(1)}.` : '',
  };
}
