// The game's mechanics, as the System tab describes them. The site knows no stat, track or move
// names and no numbers of its own: it reads them from these rows (Group = a playbook type, as
// in a playbook's type=, e.g. a character type, "ship" or "npc"):
//
//   stat    | type | Name  | what it's for                    the stats, in sheet order
//   track   | type | Name  | what it's for | role=… size=…    the tracks a new sheet starts with
//   section | type | Title | starting note | role=… tab=… fill=…   the cards a new sheet starts with
//   choice  | action, npc or clock | Label | | gain=… heal=… slots=… size=…
//
// Track meta: role (what the site does with it: harm, luck, vice, xp, treasure, hoard),
// size (pips; a playbook's meta for the track's name or role overrides it, e.g. harm=8), start (marks a new
// sheet starts with), refill (Session Begins marks it back up to this), skulls (how many of its last
// pips are drawn as skulls, the last one bloody, as on the book's harm tally). A number is a sum like
// "6", "Steadfast+3", "level+6" or "Spitfire": numbers, stat names and the character's level.
// Section meta: role (vice, oddity, bonds, troubles, xp, treasure, kit, cargo, crew, specials; the kit
// and cargo cards are lists of item and cargo rows, the crew's are a little sheet per crew row),
// tab (sheet, notes, kit or crew), fill (vices, oddity, kit, specials, questions, lastwords: copied
// from the playbook; the kit section's card lists the kit as items instead), size (pips per bond),
// full (what filling a bond gives, e.g. xp:1). The section row's Text is the card's starting note;
// {sum} in it is worked out, e.g. "({Fortune+5} space)". The crew section's type (a playbook type,
// e.g. npc) gives crew members their tracks and tags (tag rows of that group), table names the Rules
// table group whose rows are the kinds of crew member (each with tags= and its track sizes, e.g.
// harm=2), and serves is what to call whose they are, e.g. serves="Hand of".
//
// Rows with actions, rolls and costs say so in their meta:
//   action=session-begin|session-end|chapter-end|begin-downtime|leave-downtime|level-up, label="…"
//   roll=Stat | roll=2d6 | roll=1d6 | roll="+bonds spent" (the player says how much); per="-1 per scar"; adj
//   session=start|end|start,end; gain="luck:1,xp:1" (or luck:<track> for what that track has marked)
//   spend=luck:1 | spend=luck:x (the player says how much); heal=harm:2; refresh=bonds
// House rules: floor=luck:1 (refills and new sheets start with at least this much).

import { formatTrack } from './codec.js';

const low = s => String(s ?? '').trim().toLowerCase();
export const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// "Steadfast+3", "level+6", "-1", "Spitfire": numbers, stat names and the level, added up.
export function sum(expr, { stats = [], level = 0 } = {}) {
  let total = 0;
  for (const m of String(expr ?? '').replace(/\s+/g, '').replace(/[−–]/g, '-').matchAll(/([+-]?)([^+-]+)/g)) {
    const t = m[2];
    const v = /^\d+$/.test(t) ? +t : low(t) === 'level' ? level : (stats.find(s => low(s.k ?? s) === low(t))?.v ?? 0);
    total += m[1] === '-' ? -v : v;
  }
  return total;
}

// "{Fortune+5} cargo space" with the sums worked out.
export const fillIn = (text, ctx) => String(text ?? '').replace(/\{([^}]+)\}/g, (_, e) => String(sum(e, ctx)));

// "luck:1,xp:1" -> [{role: 'luck', n: 1}, {role: 'xp', n: 1}]; "luck:unrest" -> [{role: 'luck', from: 'unrest'}];
// "luck:x" -> [{role: 'luck', n: null}] (the player picks).
export function effects(spec) {
  if (spec == null || spec === true) return [];
  return String(spec).split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [role, v = '1'] = s.split(':').map(x => x.trim());
    if (/^\d+$/.test(v)) return { role: low(role), n: +v };
    if (low(v) === 'x' || low(v) === 'all') return { role: low(role), n: null };
    return { role: low(role), from: low(v) };
  });
}

// Remembered per Rules index and type: pages ask for it many times per redraw.
const systems = new WeakMap();
export function systemOf(R, type) {
  const t = low(type);
  let mine = systems.get(R);
  if (!mine) systems.set(R, mine = new Map());
  if (!mine.has(t)) mine.set(t, systemFor(R, t));
  return mine.get(t);
}

function systemFor(R, t) {
  const tracks = R.by('track', t).map(r => ({ name: r.name, role: low(r.meta.role), size: r.meta.size, start: r.meta.start, refill: r.meta.refill, skulls: r.meta.skulls, text: r.text }));
  const sections = R.by('section', t).map(r => ({
    title: r.name, role: low(r.meta.role), tab: low(r.meta.tab) || 'sheet', fill: low(r.meta.fill), size: r.meta.size, full: r.meta.full, note: r.text,
    table: r.meta.table || '', type: low(r.meta.type), serves: r.meta.serves || '',
  }));
  const track = role => tracks.find(x => x.role === role) || null;
  const section = role => sections.find(x => x.role === role) || null;
  return {
    type: t,
    stats: R.by('stat', t).map(r => r.name),
    statText: name => R.by('stat', t).find(r => low(r.name) === low(name))?.text || '',
    tracks,
    sections,
    track,
    section,
    // A role's track or section name, as the sheet has it (blank if the game has none).
    name: role => track(role)?.name || '',
    title: role => section(role)?.title || '',
    // "+2 luck", in the sheet's words.
    word: role => low(track(role)?.name || role),
  };
}

// Playbook types: the ship's is "ship"; every other is a kind of character.
export const SHIP = 'ship';
export function characterTypes(R) {
  const seen = [];
  for (const r of R.recs) {
    const t = r.kind === 'playbook' ? low(r.meta.type) : ['stat', 'track', 'section'].includes(r.kind) ? low(r.group) : '';
    if (t && t !== SHIP && t !== 'npc' && !seen.includes(t)) seen.push(t);
  }
  return seen;
}
// A character's type: their playbook's, or the game's first.
export const typeOf = (R, playbook) => low(R.playbook(playbook)?.meta.type) || characterTypes(R)[0] || '';

// A house rule's floor for a role's track: floor=luck:1.
export const floorOf = (R, role) => Math.max(0, ...R.by('house').flatMap(r => effects(r.meta.floor)).filter(e => e.role === role).map(e => e.n || 0));

// A track's pips for a new sheet, or after levelling up.
export function trackSize(def, { pb, stats, level } = {}) {
  const fromPb = pb?.meta?.[low(def.name)] ?? (def.role ? pb?.meta?.[def.role] : undefined);
  return Math.max(0, parseInt(fromPb, 10) || sum(def.size, { stats, level }));
}
export const circles = (n, marked = 0) => formatTrack(Array.from({ length: Math.max(0, n) }, (_, i) => (i < marked ? 1 : 0)));

// Which roll a row asks for: one of the character's stats, plain dice, or a number the player
// says ("+bonds spent"). per= is a modifier the player counts up; adj a free +/- modifier.
export function rollOf(meta = {}, stats = []) {
  const spec = typeof meta.roll === 'string' ? meta.roll.trim() : '';
  if (!spec) return null;
  const extra = meta.per ? { per: String(meta.per) } : meta.adj ? { adj: 'Modifier' } : {};
  const dice = spec.match(/^(\d)d6$/i);
  if (dice) return { label: spec.toLowerCase(), mod: 0, dice: +dice[1], ...extra };
  if (spec.startsWith('+')) return { label: spec, mod: 0, dice: 2, ask: cap(spec.slice(1).trim()), ...extra };
  const s = stats.find(x => low(x.k) === low(spec));
  return s ? { label: s.k, mod: s.v || 0, dice: 2, stat: true, ...extra } : null;
}

// Whether a row does something when a session starts or ends.
export function atSession(when, meta = {}) {
  return typeof meta.session === 'string' && meta.session.toLowerCase().split(/[,|]/).map(x => x.trim()).includes(when);
}
