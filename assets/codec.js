// Rows <-> page state. Every sheet tab except Rules is rows of [Kind, Name, Value, Notes];
// a row's identity is Kind+Name (case-insensitive). Pages edit a state object; on each change
// the state is serialized and diffed against its previous serialization, so only rows that
// actually changed are sent, and rows the site doesn't know about are never touched.

export const rowKey = (kind, name) => `${String(kind ?? '').trim().toLowerCase()}|${String(name ?? '').trim().toLowerCase()}`;

/* ---------- pips ---------- */
// Tracks: ○ open, ● marked. Bonds: · not marked, ● marked, ○ marked but used.
// Hand-typed variants are accepted: * • 1 for marked; anything else (o O 0 - . _) is open.
export function parseTrack(s) {
  return [...String(s ?? '').replace(/\s+/g, '')].map(ch => (/[●•*1■◉⬤]/.test(ch) ? 1 : 0));
}
export const formatTrack = pips => pips.map(v => (v === 1 ? '●' : '○')).join('');

export function parseBond(s) {
  return [...String(s ?? '').replace(/\s+/g, '')].map(ch =>
    /[●•*1■◉⬤]/.test(ch) ? 1 : /[○◯oO]/.test(ch) ? 2 : 0);
}
export const formatBond = pips => pips.map(v => (v === 1 ? '●' : v === 2 ? '○' : '·')).join('');

export const parseStat = s => {
  const n = parseInt(String(s ?? '').replace(/[−–]/g, '-').replace(/^\+/, ''), 10);
  return Number.isFinite(n) ? n : 0;
};
// An item's count: blank for items that aren't counted.
export const parseCount = s => {
  const n = parseInt(String(s ?? '').trim(), 10);
  return Number.isFinite(n) ? Math.max(0, n) : null;
};
export const formatStat = v => (v > 0 ? `+${v}` : String(v | 0));

/* ---------- log entries ---------- */
// Name is "<ISO time>~<random>", Value the title, Notes "- item" lines, a blank line, then the note.
export function parseLog(name, value, notes) {
  const [itemsPart, ...rest] = String(notes ?? '').split(/\n\s*\n/);
  const lines = itemsPart.split('\n');
  const isItems = lines.every(l => !l.trim() || /^\s*- /.test(l));
  const items = isItems ? lines.filter(l => l.trim()).map(l => l.replace(/^\s*- /, '')) : [];
  const note = (isItems ? rest : [itemsPart, ...rest]).join('\n\n').trim();
  return { id: name, at: Date.parse(String(name).split('~')[0]) || 0, title: value, items, note };
}
export function formatLog(e) {
  const items = (e.items || []).map(t => `- ${t}`).join('\n');
  return [items, e.note || ''].filter(Boolean).join('\n\n');
}
export const logId = (at = Date.now()) => `${new Date(at).toISOString()}~${Math.random().toString(36).slice(2, 6)}`;

/* ---------- the ship's crew ---------- */
// One row per crew member (a lackey, in Rapscallion) on the Ship tab: crew | Name | harm pips | Notes.
// Notes starts with "Type: …", "Serves: …" (whose they are: a character's tab name) and "Tags: …"
// lines, each left out when blank; anything after them is notes.
const CREW_FIELDS = [['type', 'Type'], ['serves', 'Serves'], ['tags', 'Tags']];
function parseFields(fields, notes, into) {
  const lines = String(notes ?? '').split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\w+)\s*:\s*(.*)$/);
    const f = m && fields.find(([k]) => k === m[1].toLowerCase());
    if (!f) break;
    into[f[0]] = m[2].trim();
  }
  into.note = lines.slice(i).join('\n').trim();
  return into;
}
function formatFields(fields, c) {
  const head = fields.filter(([k]) => String(c[k] || '').trim()).map(([k, label]) => `${label}: ${String(c[k]).trim()}`);
  return [head.join('\n'), c.note || ''].filter(Boolean).join('\n\n');
}
export const parseCrew = (name, value, notes) => parseFields(CREW_FIELDS, notes, { name, pips: parseTrack(value), type: '', serves: '', tags: '', note: '' });
export const formatCrew = c => formatFields(CREW_FIELDS, c);

/* ---------- items and cargo ---------- */
// item | Name | how many | Notes, where Notes may start with a "Tags: …" line (comma-separated), then a
// blank line and the notes.
const ITEM_FIELDS = [['tags', 'Tags']];
export const parseItem = (name, value, notes) => parseFields(ITEM_FIELDS, notes, { name, count: parseCount(value), tags: '', note: '' });
export const formatItem = it => formatFields(ITEM_FIELDS, it);

/* ---------- signing in as a character ---------- */
// One row on a character's tab says someone is playing them: signin | Signed in | yes.
// It stays until someone signs out. The sheet page neither reads nor writes it.
export const isSigninRow = r => String(r[0]).trim().toLowerCase() === 'signin';
export const isSignedIn = rows => rows.some(r => isSigninRow(r) && /^(yes|y|true|1|●|x)$/i.test(String(r[2] ?? '').trim()));
export const signinRow = on => ['signin', 'Signed in', on ? 'yes' : '', ''];

/* ---------- characters and the ship ---------- */
// Both use the same shape; a ship just has different stats and tracks.
export function parseSheet(rows) {
  const st = {
    info: {}, stats: [], tracks: {}, bonds: [], sections: [], moves: [], specials: [],
    advances: {}, log: [], state: {}, items: [], cargo: [], crew: [], jot: '',
  };
  for (const [kind, name, value = '', notes = ''] of rows) {
    const k = String(kind).trim().toLowerCase();
    const n = String(name).trim();
    if (!n) continue;
    switch (k) {
      case 'info': st.info[n.toLowerCase()] = value; break;
      case 'stat': st.stats.push({ k: n, v: parseStat(value) }); break;
      case 'track': st.tracks[n.toLowerCase()] = { name: n, pips: parseTrack(value) }; break;
      case 'bond': st.bonds.push({ name: n, pips: parseBond(value), to: String(notes).trim() }); break; // to: who it links to (see links.js)
      case 'sheet': case 'notes': case 'kit': st.sections.push({ tab: k, title: n, text: value, note: notes }); break;
      case 'move': st.moves.push({ name: n, marked: parseTrack(value)[0] === 1, text: notes }); break;
      case 'special': st.specials.push({ name: n, marked: parseTrack(value)[0] === 1, text: notes }); break;
      case 'item': st.items.push(parseItem(n, value, notes)); break;
      case 'cargo': st.cargo.push(parseItem(n, value, notes)); break; // like items, in their own list
      case 'crew': st.crew.push(parseCrew(n, value, notes)); break;
      case 'jot': st.jot = value; break; // the scratchpad: jot | Notes | whatever was jotted down
      case 'advance': st.advances[n] = parseInt(value, 10) || 0; break;
      case 'log': st.log.push(parseLog(n, value, notes)); break;
      case 'state': try { st.state[n.toLowerCase()] = value ? JSON.parse(value) : null; } catch { st.state[n.toLowerCase()] = null; } break;
      default: break; // unknown kinds stay in the sheet untouched
    }
  }
  st.log.sort((a, b) => a.at - b.at);
  return st;
}

// Section cards: the kind is the sheet-page tab they show on.
const SECTION_KINDS = ['sheet', 'notes', 'kit'];
const INFO_ORDER = ['Name', 'Playbook', 'Player', 'Level'];

export function serializeSheet(st) {
  const rows = [];
  const infoKeys = [...INFO_ORDER.map(k => k.toLowerCase()), ...Object.keys(st.info).filter(k => !INFO_ORDER.some(o => o.toLowerCase() === k))];
  for (const k of infoKeys) {
    if (st.info[k] == null) continue;
    const label = INFO_ORDER.find(o => o.toLowerCase() === k) || k.charAt(0).toUpperCase() + k.slice(1);
    rows.push(['info', label, String(st.info[k]), '']);
  }
  for (const s of st.stats) rows.push(['stat', s.k, formatStat(s.v), '']);
  for (const t of Object.values(st.tracks)) rows.push(['track', t.name, formatTrack(t.pips), '']);
  for (const b of st.bonds) rows.push(['bond', b.name, formatBond(b.pips), b.to || '']);
  for (const s of st.sections) rows.push([SECTION_KINDS.includes(s.tab) ? s.tab : 'sheet', s.title, s.text || '', s.note || '']);
  if (st.jot) rows.push(['jot', 'Notes', st.jot, '']);
  for (const it of st.items || []) rows.push(['item', it.name, it.count == null ? '' : String(it.count), formatItem(it)]);
  for (const it of st.cargo || []) rows.push(['cargo', it.name, it.count == null ? '' : String(it.count), formatItem(it)]);
  for (const c of st.crew || []) rows.push(['crew', c.name, formatTrack(c.pips), formatCrew(c)]);
  for (const m of st.moves) rows.push(['move', m.name, m.marked ? '●' : '○', m.text || '']);
  for (const m of st.specials) rows.push(['special', m.name, m.marked ? '●' : '○', m.text || '']);
  for (const [k, n] of Object.entries(st.advances)) rows.push(['advance', k, String(n), '']);
  for (const e of st.log) rows.push(['log', e.id, e.title || '', formatLog(e)]);
  for (const [k, v] of Object.entries(st.state)) if (v != null) rows.push(['state', k, JSON.stringify(v), '']);
  return rows;
}

/* ---------- diffs ---------- */
// What changed between two serializations: rows to upsert, keys to delete, and renames.
// A row that disappeared while a new row of the same Kind appeared with the same Value and
// Notes is a rename; sending it as one keeps the row where it is in the sheet.
// Rows with blank Kind/Name are skipped; duplicate keys keep the first, like the server.
export function diffRows(prev, next) {
  const index = rows => {
    const m = new Map();
    for (const r of rows) {
      const k = rowKey(r[0], r[1]);
      if (k !== '|' && !m.has(k)) m.set(k, r);
    }
    return m;
  };
  const a = index(prev);
  const b = index(next);
  const set = [];
  const del = [];
  for (const [k, r] of b) {
    const old = a.get(k);
    if (!old || old.slice(0, 4).map(String).join('\u0001') !== r.slice(0, 4).map(String).join('\u0001')) set.push(r.slice(0, 4).map(String));
  }
  const ren = [];
  for (const [k, r] of a) {
    if (b.has(k)) continue;
    const kind = String(r[0]).trim().toLowerCase();
    const twin = set.find(n => !a.has(rowKey(n[0], n[1])) && String(n[0]).trim().toLowerCase() === kind &&
      String(n[2]) === String(r[2] ?? '') && String(n[3]) === String(r[3] ?? '') && !ren.some(x => rowKey(x[0], x[2]) === rowKey(n[0], n[1])));
    if (twin) ren.push([r[0], r[1], twin[1]]);
    else del.push([r[0], r[1]]);
  }
  return { set, del, ren };
}

// Apply pending changes on top of server rows (for display before the server confirms them).
export function applyPending(rows, pending) {
  const out = rows.map(r => r.slice());
  for (const p of [...pending].sort((x, y) => (x.seq || 0) - (y.seq || 0))) {
    if (p.ren) {
      const i = out.findIndex(r => rowKey(r[0], r[1]) === rowKey(p.ren[0], p.ren[1]));
      if (i >= 0 && !out.some(r => rowKey(r[0], r[1]) === rowKey(p.ren[0], p.ren[2]))) out[i][1] = p.ren[2];
      continue;
    }
    const k = rowKey(p.row[0], p.row[1]);
    const i = out.findIndex(r => rowKey(r[0], r[1]) === k);
    if (p.del) { if (i >= 0) out.splice(i, 1); }
    else if (i >= 0) out[i] = p.row.slice(0, 4);
    else {
      // keep rows grouped by Kind, like the server does
      const kind = String(p.row[0]).trim().toLowerCase();
      let at = -1;
      out.forEach((r, j) => { if (String(r[0]).trim().toLowerCase() === kind) at = j; });
      out.splice(at >= 0 ? at + 1 : out.length, 0, p.row.slice(0, 4));
    }
  }
  return out;
}
