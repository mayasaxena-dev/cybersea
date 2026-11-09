// The Session tab: the shared session desktop, as Kind | Name | Value | Notes rows.
//   folder | <path>     |                   |                 a folder ("Vega Station/NPCs": "/" between folders)
//   session| <title>    | <started (ISO)>   | <ended (ISO)>   a session; its folder is its title
//   share  | <id>       | <folder>          | <type>: <ref>   something the GM shared (see SHARE_TYPES);
//                                              <body>        lines after the first: its text, if it keeps any
//   note   | <id>       | <folder>          | note: <author>  a note someone added to a folder
//                                              <text>
//   window | <id>       | <x> <y> <w> <h>   | <z>             a share or note open on the desktop, in % of it
//   prompt | <action>   | <stamp>           | <session title> the GM ran session-begin, session-end or chapter-end
//   done   | <action>:<character> | <stamp> |                 that character ran it, for the prompt with that stamp
//   rolls  | <session title> | <rolls>      |                 the session's rolls, kept when it ended (rollLine)
//   focus  | <place>    | <level>           |                 the place the Map app shows everyone (the GM opened its share)
// The window called "map" is the Map app: the crew's map (mapview.js), on the desktop.
// Ids are logId()s, so they sort by when they were made. The crew write only note and done rows
// (Code.gs holds to that); the rest is the GM's.
//
// The NPCs tab: what the GM shared of each NPC, for the crew's NPC page.
//   npc  | <name> | <tags> | <notes>   (either may be empty: not shared)
//   harm | <name> | <pips> |
//   crew | <name> | <the crew's notes on them> |
import { rowKey } from './codec.js';

export const SESSION_TAB = 'Session';
export const NPCS_TAB = 'NPCs';
export const ACTIONS = ['session-begin', 'session-end', 'chapter-end'];
export const MAP_WIN = 'map';
// What can be shared, and what the share's ref names (the body is its own text, kept in the row):
//   place: <place>   level: <place> / <level>   region: <region>   (the Map tab)
//   lore: <category> / <title>   (the Lore tab; secrets and notes are copied there first)
//   rule: <name>   npc: <name> (the NPCs tab)   clock: <name> (body: its pips)
//   crew: <character>   ship   picture: <tab> / <kind or place> / <name>   scene: <title> (body: text)
export const SHARE_TYPES = ['place', 'level', 'region', 'lore', 'rule', 'npc', 'clock', 'crew', 'ship', 'picture', 'scene'];

const low = s => String(s ?? '').trim().toLowerCase();
const trim = s => String(s ?? '').trim();

// "type: ref\nbody" <-> {type, ref, body}
export function parseSpec(s) {
  const text = String(s ?? '');
  const nl = text.indexOf('\n');
  const head = nl < 0 ? text : text.slice(0, nl);
  const body = nl < 0 ? '' : text.slice(nl + 1);
  const c = head.indexOf(':');
  return c < 0 ? { type: low(head), ref: '', body } : { type: low(head.slice(0, c)), ref: trim(head.slice(c + 1)), body };
}
export const formatSpec = ({ type, ref = '', body = '' }) => `${type}: ${trim(ref)}`.trimEnd() + (body ? `\n${body}` : '');

// "a / b / c" <-> ['a', 'b', 'c']
export const refParts = ref => String(ref ?? '').split(' / ').map(trim);
export const joinRef = (...parts) => parts.map(trim).join(' / ');

// Folder paths: trimmed, no empty parts.
export const cleanPath = p => String(p ?? '').split('/').map(trim).filter(Boolean).join('/');
export const parentOf = p => cleanPath(p).split('/').slice(0, -1).join('/');
export const baseName = p => cleanPath(p).split('/').pop() || '';

// When an id (a logId) was made, in ms, or 0.
export const idTime = id => { const t = Date.parse(String(id ?? '').split('~')[0]); return Number.isFinite(t) ? t : 0; };

export function parseBox(v) {
  const [x, y, w, h] = String(v ?? '').trim().split(/\s+/).map(Number);
  const ok = n => Number.isFinite(n);
  return ok(x) && ok(y) && ok(w) && ok(h) ? { x, y, w, h } : null;
}
const r1 = n => Math.round(n * 10) / 10;
export const formatBox = ({ x, y, w, h }) => [x, y, w, h].map(r1).join(' ');
export const clampBox = ({ x, y, w, h }) => {
  w = Math.min(100, Math.max(12, w));
  h = Math.min(100, Math.max(10, h));
  return { x: Math.min(100 - w, Math.max(0, x)), y: Math.min(100 - h, Math.max(0, y)), w, h };
};

export function parseSession(rows = []) {
  const s = { folders: [], sessions: [], current: null, items: [], windows: [], prompts: {}, done: {}, rolls: {}, focus: null };
  const folders = new Set();
  const addFolder = p => {
    const parts = cleanPath(p).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  };
  for (const [k, name = '', value = '', notes = ''] of rows) {
    const kind = low(k);
    if (kind === 'folder') addFolder(name);
    else if (kind === 'session' && trim(name)) {
      s.sessions.push({ title: trim(name), start: trim(value), end: trim(notes) });
      addFolder(name);
    } else if (kind === 'share' || kind === 'note') {
      if (!trim(name)) continue;
      const spec = parseSpec(notes);
      const item = { kind, id: trim(name), folder: cleanPath(value), at: idTime(name), ...spec };
      if (kind === 'note') { item.author = spec.ref; item.type = 'note'; item.ref = ''; }
      s.items.push(item);
      if (item.folder) addFolder(item.folder);
    } else if (kind === 'window') {
      const box = parseBox(value);
      if (trim(name) && box) s.windows.push({ id: trim(name), ...box, z: Number(notes) || 0 });
    } else if (kind === 'prompt' && ACTIONS.includes(low(name))) s.prompts[low(name)] = { stamp: trim(value), title: trim(notes) };
    else if (kind === 'done') s.done[low(name)] = trim(value);
    else if (kind === 'rolls') s.rolls[low(name)] = String(value ?? '');
    else if (kind === 'focus' && trim(name)) s.focus = { place: trim(name), level: trim(value) };
  }
  s.sessions.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  s.current = [...s.sessions].reverse().find(x => x.start && !x.end) || null;
  s.items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  s.windows = s.windows.filter(w => w.id === MAP_WIN || s.items.some(i => i.id === w.id)).sort((a, b) => a.z - b.z);
  s.folders = [...folders].sort((a, b) => a.localeCompare(b));
  return s;
}

export const itemsIn = (s, folder) => s.items.filter(i => i.folder === cleanPath(folder));
export const subfolders = (s, folder) => s.folders.filter(f => parentOf(f) === cleanPath(folder));
export const sessionOf = (s, folder) => s.sessions.find(x => low(x.title) === low(cleanPath(folder))) || null;
// Whether a character has run the prompt for an action (the latest one the GM started).
export const hasDone = (s, action, who) => !!s.prompts[action]?.stamp && s.done[low(`${action}:${who}`)] === s.prompts[action].stamp;
// The open prompt a character still owes, or null: the latest action the GM ran, if not done yet.
export function owedPrompt(s, who) {
  if (!who) return null;
  const open = ACTIONS.map(a => ({ action: a, ...s.prompts[a] })).filter(p => p.stamp && !hasDone(s, p.action, who));
  return open.sort((a, b) => b.stamp.localeCompare(a.stamp))[0] || null;
}

// A lore entry is new while the session it was shared in is running.
export function isNewLore(s, category, title) {
  if (!s.current) return false;
  const start = Date.parse(s.current.start) || 0;
  const want = low(joinRef(category, title));
  return s.items.some(i => i.kind === 'share' && i.type === 'lore' && low(i.ref) === want && i.at >= start);
}

// The rows that put a share, note or window in, or take one out.
export const shareRow = (id, folder, spec) => ['share', id, cleanPath(folder), formatSpec(spec)];
export const noteRow = (id, folder, author, text) => ['note', id, cleanPath(folder), formatSpec({ type: 'note', ref: author, body: text })];
export const windowRow = (id, box, z) => ['window', id, formatBox(clampBox(box)), String(z)];
export const focusRow = (place, level = '') => ['focus', trim(place), trim(level), ''];

// Where a new window opens: cascading from the top left, so a stack of them stays readable.
export function nextBox(s) {
  const n = s.windows.length % 6;
  return { x: 4 + n * 5, y: 4 + n * 6, w: 46, h: 52 };
}
export const topZ = s => Math.max(0, ...s.windows.map(w => w.z)) + 1;

// Sharing an NPC: the parts ticked replace what the crew had of those parts; the rest stays.
// parts: {tags, harm, notes} (each a string, or undefined when not ticked). Returns the NPCs tab's
// rows after the share.
export function mergeNpc(rows, name, parts) {
  const out = rows.map(r => r.slice());
  const find = kind => out.find(r => rowKey(r[0], r[1]) === rowKey(kind, name));
  let npc = find('npc');
  if (!npc) out.push(npc = ['npc', name, '', '']);
  if (parts.tags !== undefined) npc[2] = parts.tags;
  if (parts.notes !== undefined) npc[3] = parts.notes;
  if (parts.harm !== undefined) {
    const h = find('harm');
    if (h) h[2] = parts.harm;
    else if (parts.harm) out.push(['harm', name, parts.harm, '']);
  }
  return out;
}

// The NPCs tab as NPCs: [{name, tags, notes, harm, crew}].
export function parseNpcs(rows = []) {
  const by = new Map();
  const get = name => { const k = low(name); if (!by.has(k)) by.set(k, { name: trim(name), tags: '', notes: '', harm: '', crew: '' }); return by.get(k); };
  for (const [k, name = '', value = '', notes = ''] of rows) {
    if (!trim(name)) continue;
    const kind = low(k);
    if (kind === 'npc') Object.assign(get(name), { tags: String(value ?? ''), notes: String(notes ?? '') });
    else if (kind === 'harm') get(name).harm = String(value ?? '');
    else if (kind === 'crew') get(name).crew = String(value ?? '');
  }
  return [...by.values()].filter(n => rows.some(r => low(r[0]) === 'npc' && low(r[1]) === low(n.name)));
}

// The rolls a session keeps when it ends: one per line, "who · label · total (dice mod) · by".
export const rollLine = r => [r.who, r.label, `${r.total} (${[r.dice, r.mod].filter(Boolean).join(' ')})`, r.as].filter(Boolean).join(' · ');
