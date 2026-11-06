/**
 * Cybersea game API. One spreadsheet = one game; this script is bound to it.
 *
 * Setup (see SETUP.md):
 *   Project Settings > Script properties: GM_KEY (the GM's passphrase). Optional: CREW_KEY, if
 *   players should need a passphrase too; without it, anyone with the web app URL (the invite
 *   link) is crew.
 *   Optional: FIREBASE_URL, for live updates (Push.gs).
 *   Deploy > New deployment > Web app; Execute as: Me; Who has access: Anyone.
 *
 * Every request is a POST whose body is JSON sent as text/plain (no CORS preflight),
 * carrying any passphrase as "key".
 *
 * Tabs: Rules (Kind|Group|Name|Text|Meta|Vis, plus optional Override name|Override text|Override
 * meta columns, found by their headers), System (the game's mechanics), GM, Lore, Ship, Map (the world: see mapRows_),
 * Images (pictures by name: see namedImages_), Rolls (dice the crew shared: see roll_), and one
 * tab per character (Kind|Name|Value|Notes, plus an optional Image column: see picture_). Tabs starting with "_" and README are ignored. The tabs the site
 * edits also get a hidden Version column (see "row versions" below).
 *
 *
 * The game's mechanics (stats, tracks, starting cards: Kind|Group|Name|Text|Meta) are in the System
 * tab, and what a Rules row rolls or does is in its Meta, so the site has none of its own.
 * setUpChecks (run it from the Apps Script editor) guards them: see "checks" below.
 *
 * @OnlyCurrentDoc
 */

const API_VERSION = 11; // the site turns away a script older than the one it needs (assets/api.js)
const HEADER = ['Kind', 'Name', 'Value', 'Notes'];
const RULES_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'];
// The game's mechanics (stats, tracks, starting cards, options): read by everyone, edited only in Sheets.
const SYSTEM_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta'];
// A game's own wording for a Rules row, kept beside the book's (which stays as it is). Found by
// header, so they can sit in any column after Vis; sent as the 7th to 9th cells of each row.
const OVERRIDE_HEADERS = ['Override name', 'Override text', 'Override meta'];
const VER_HEADER = 'Version';
const MAX_CELL = 50000;
const MAX_TAB_NAME = 40;
const MAX_GONE = 150;          // removed rows remembered per tab (see gone_)
const BAD_KEY_LIMIT = 10;      // wrong passphrases per minute before pausing
const KEY_CACHE_SECONDS = 120; // passphrase changes take effect within this long
const DIGEST_SECONDS = 60;    // a tab's remembered digest; bounds how stale an edit Sheets runs no onEdit for can be
const KNOWN_KEY_SECONDS = 6 * 60 * 60; // a passphrase that worked skips the wrong-guess pause this long (CacheService's most)
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// The Map tab's columns, found by their headers (see mapRows_).
const MAP_HEADER = ['Region', 'Location', 'Level', 'Image', 'Text', 'GM notes', 'Shown'];
// The Images tab: every picture once, by name. An Image cell (Map, Lore, a character's) can name one (see imageTokens_).
const IMAGES_TAB = 'Images';
const IMAGES_HEADER = ['Name', 'Image'];
// Tabs with an optional Image column after Notes (see imageColIn_). A character's (or the ship's)
// picture is its info|Name row's Image (see picture_).
const PICTURE_KINDS = ['lore', 'character', 'ship'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // a picture the GM adds from the site
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// The Feedback tab: anonymous notes about the site, added by the feedback button (see feedback_).
const FEEDBACK_TAB = 'Feedback';
const FEEDBACK_HEADER = ['Date', 'Feedback'];
const FEEDBACK_LIMIT = 30; // per minute, from everyone
// The Rolls tab: dice rolls shared with the table, oldest first (see roll_).
const ROLLS_TAB = 'Rolls';
const ROLLS_HEADER = ['When', 'Who', 'Roll', 'Dice', 'Mod', 'Total', 'By'];
const ROLLS_SENT = 50;   // the latest rows a read sends
const ROLLS_KEPT = 500;  // older rows are cleared once the tab passes this by ROLLS_SENT
const ROLL_LIMIT = 120;  // per minute, from everyone
const ROLL_MAX_DICE = 12;
const ROLL_MAX_TEXT = 200;

function doGet(e) {
  const op = e && e.parameter ? e.parameter.op : '';
  if (op === 'ping') return out_({ ok: true, v: API_VERSION });
  return out_({ ok: false, error: 'Send requests as POST.' });
}

function doPost(e) {
  let res;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = handle_(req);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }
  return out_(res);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  if (req.op === 'ping') return { ok: true, v: API_VERSION };
  const role = role_(req.key);
  if (!role && !req.key) return { ok: false, code: 'auth', error: 'This game needs a passphrase.' };
  // Wrong guesses pause new sign-ins for a minute. Requests that carry no passphrase guess
  // nothing, and a passphrase that already worked lately keeps working, so one player's typos
  // don't lock out the table or the GM.
  if (req.key && !(role && knownKey_(req.key))) {
    if (throttled_()) return { ok: false, code: 'throttled', error: 'Too many wrong passphrases. Wait a minute and try again.' };
    if (!role) {
      noteBadKey_();
      return { ok: false, code: 'auth', error: 'Wrong passphrase.' };
    }
    noteKnownKey_(req.key);
  }
  try {
    return op_(role, req);
  } finally {
    pushIfDue_(req.by); // live updates (Push.gs), once the change is done
  }
}

function op_(role, req) {
  switch (req.op) {
    case 'read': return read_(role, req);
    case 'patch': return withLock_(() => patch_(role, req));
    case 'create': return withLock_(() => create_(role, req));
    case 'image': return image_(role, req);
    case 'feedback': return withLock_(() => feedback_(req));
    case 'roll': return withLock_(() => roll_(req));
    case 'show': return role === 'gm' ? withLock_(() => show_(req)) : forbidden_();
    case 'place': return role === 'gm' ? withLock_(() => place_(req)) : forbidden_();
    case 'images': return role === 'gm' ? images_() : forbidden_();
    case 'picture': return withLock_(() => picture_(role, req));
    case 'selftest': return role === 'gm' ? withLock_(selftest_) : forbidden_();
  }
  return { ok: false, error: 'Unknown op: ' + req.op };
}

/* ---------- passphrases ---------- */

function keys_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('keys');
  if (hit) return JSON.parse(hit);
  const props = PropertiesService.getScriptProperties();
  const keys = { crew: props.getProperty('CREW_KEY') || '', gm: props.getProperty('GM_KEY') || '' };
  cache.put('keys', JSON.stringify(keys), KEY_CACHE_SECONDS);
  return keys;
}

// GM with the GM passphrase; crew with the crew passphrase, or with none if CREW_KEY isn't set.
function role_(key) {
  const keys = keys_();
  if (!keys.gm) throw new Error('No GM passphrase set yet: add GM_KEY under Project Settings > Script properties.');
  key = String(key || '');
  if (key && key === keys.gm) return 'gm';
  if (keys.crew ? key === keys.crew : !key) return 'crew';
  return null;
}

function throttled_() {
  return Number(CacheService.getScriptCache().get('bad') || 0) >= BAD_KEY_LIMIT;
}

function noteBadKey_() {
  const cache = CacheService.getScriptCache();
  cache.put('bad', String(Number(cache.get('bad') || 0) + 1), 60);
}

// A passphrase that worked within the last KNOWN_KEY_SECONDS, remembered by its digest.
function knownKey_(key) {
  return !!CacheService.getScriptCache().get('known:' + digest_(String(key)));
}

function noteKnownKey_(key) {
  CacheService.getScriptCache().put('known:' + digest_(String(key)), '1', KNOWN_KEY_SECONDS);
}

function forbidden_() {
  return { ok: false, code: 'forbidden', error: 'That needs the GM passphrase.' };
}

/* ---------- tabs ---------- */

// Tabs named one of these are that kind; any other tab (but README and _hidden ones) is a character.
const TAB_KINDS = ['rules', 'system', 'gm', 'lore', 'ship', 'map', 'feedback', 'images', 'rolls'];
// Kinds the site never patches (tools/xlsx keeps the same lists). Rolls only grow, through roll_.
const SHEETS_ONLY = ['rules', 'system', 'map', 'feedback', 'images', 'rolls'];
const sheetsOnly_ = kind => SHEETS_ONLY.indexOf(kind) >= 0;

function tabKind_(name) {
  const n = String(name).trim().toLowerCase();
  if (!n || n.charAt(0) === '_' || n === 'readme') return null;
  return TAB_KINDS.indexOf(n) >= 0 ? n : 'character';
}

// Feedback is read in Sheets only, so the site never shows it, even to the GM. Nor Images: its
// pictures reach the site only through the rows that name them.
function canRead_(role, kind) {
  return !!kind && kind !== 'feedback' && kind !== 'images' && (kind !== 'gm' || role === 'gm');
}

function canWrite_(role, kind) {
  return !!kind && !sheetsOnly_(kind) && (kind !== 'gm' || role === 'gm');
}

function findSheet_(ss, name) {
  const want = String(name || '').trim().toLowerCase();
  return ss.getSheets().find(sh => sh.getName().trim().toLowerCase() === want) || null;
}

/*
 * A tab's rows as the site sees them, and a digest of them. Rules rows are as typed; other tabs'
 * rows each come with their version (vers[i] is rows[i]'s), and the digest covers both.
 */
// named: the Images tab's names (see namedImages_), or a function that gives them, so one read
// of several tabs looks them up once.
function table_(sh, kind, role, named) {
  if (kind === 'map') return mapTable_(sh, role, named);
  if (kind === 'rolls') return rollsTable_(sh);
  const grid = sh.getDataRange().getDisplayValues();
  const fixed = kind === 'rules' || kind === 'system'; // edited only in Sheets: no versions
  const rules = kind === 'rules';
  const width = rules ? RULES_HEADER.length : kind === 'system' ? SYSTEM_HEADER.length : HEADER.length;
  const vc = fixed ? 0 : verColIn_(grid[0]);
  const oc = rules ? overrideCols_(grid[0]) : [];
  const tokens = pictureTokens_(sh, kind, grid, named);
  const rows = [];
  const vers = [];
  const imgs = [];
  grid.slice(1).forEach((line, n) => {
    const r = line.slice(0, width);
    while (r.length < width) r.push('');
    if (oc.some(c => c >= 0)) oc.forEach(c => r.push(c >= 0 && line[c] != null ? line[c] : ''));
    if (r.join('').trim() === '') return;
    if (rules && role !== 'gm' && String(r[5]).trim().toLowerCase() === 'gm') return;
    rows.push(r);
    if (!fixed) vers.push(version_(vc ? line[vc - 1] : '', r));
    if (tokens) imgs.push(tokens[n]);
  });
  if (fixed) return { d: digest_(rows), rows };
  // An Image column (Lore's, a character's): imgs[i] is rows[i]'s picture, sent beside the rows so that rows stay
  // Kind|Name|Value|Notes for the site to edit (see imageTokens_).
  return tokens && imgs.some(Boolean) ? { d: digest_([rows, vers, imgs]), rows, vers, imgs } : { d: digest_([rows, vers]), rows, vers };
}

// A tab the site edits as table_ sends it, from its rows (Kind|Name|Value|Notes) and their marks.
function tableOf_(vals, marks) {
  const rows = [];
  const vers = [];
  vals.forEach((r, i) => {
    if (r.join('').trim() === '') return;
    rows.push(r.slice());
    vers.push(version_(marks[i], r));
  });
  return { d: digest_([rows, vers]), rows, vers };
}

// Where the Rules tab's override columns are (-1 for one it doesn't have).
function overrideCols_(header) {
  const hs = (header || []).map(h => String(h).trim().toLowerCase());
  return OVERRIDE_HEADERS.map(h => {
    const i = hs.indexOf(h.toLowerCase());
    return i >= RULES_HEADER.length ? i : -1;
  });
}

function digest_(rows) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function key_(kind, name) {
  return String(kind || '').trim().toLowerCase() + '|' + String(name || '').trim().toLowerCase();
}

/* Sheets would read "=…" as a formula and drop a leading "'"; a leading "'" keeps either as text. */
function safe_(v) {
  return /^[=']/.test(v) ? "'" + v : v;
}

function cells_(row, width) {
  const out = [];
  for (let i = 0; i < width; i++) {
    const v = row && row[i] != null ? String(row[i]) : '';
    if (v.length > MAX_CELL) throw new Error('A cell is too long (over ' + MAX_CELL + ' characters).');
    out.push(v);
  }
  return out;
}

// A row's cells, as plain text, and its mark in the Version column (column vc).
function writeRow_(sh, rowNum, cells, vc, mark) {
  const next = vc === cells.length + 1; // the usual layout: one write for both
  const range = sh.getRange(rowNum, 1, 1, next ? vc : cells.length);
  range.setNumberFormat('@');
  range.setValues([cells.map(safe_).concat(next ? [mark] : [])]);
  if (!next) putMarks_(sh, rowNum, vc, [mark]);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'busy', error: 'The sheet is busy; try again in a moment.' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ---------- row versions ----------
 * Each row on a tab the site edits has a version, so that a change made to an out-of-date copy of
 * a row (sent again after the page was offline, say) is turned down instead of undoing newer
 * changes. The hidden Version column holds "stamp:hash of the row:hash of its Kind+Name". Every
 * write gives the row a new stamp: patch_ (the page picks it, so it knows what its own
 * unconfirmed changes leave), create_, and onEdit for edits made in Sheets. If the hash doesn't
 * match, the row was changed some other way (or was never stamped), and its version is "~" and
 * its hash instead, so the change still shows.
 *
 * Rows that go away (deleted, renamed, or their Kind+Name cleared or typed over) are remembered
 * for a while in the document's properties, so a change made before that doesn't bring them
 * back. Whole rows deleted by hand aren't noticed: Sheets runs no onEdit for that.
 */

// cyrb53: a quick 53-bit string hash, in base 36.
function hash_(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// The site makes stamps the same way (assets/api.js).
function stamp_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function mark_(stamp, cells) {
  return stamp + ':' + hash_(cells.join('\u0001')) + ':' + hash_(key_(cells[0], cells[1]));
}

function version_(mark, cells) {
  const m = String(mark || '').split(':');
  const h = hash_(cells.join('\u0001'));
  return m[0] && m[1] === h ? m[0] : '~' + h;
}

function verColIn_(header) {
  return (header || []).findIndex(h => String(h).trim().toLowerCase() === VER_HEADER.toLowerCase()) + 1;
}

// The tab's Version column, added (hidden, plain text) after any other columns if it has none yet.
function verCol_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const found = verColIn_(sh.getRange(1, 1, 1, width).getDisplayValues()[0]);
  if (found) return found;
  const col = Math.max(width, HEADER.length) + 1;
  if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
  sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, col).setValues([[VER_HEADER]]);
  sh.hideColumns(col);
  return col;
}

function putMarks_(sh, rowNum, vc, marks) {
  if (!marks.length) return;
  const range = sh.getRange(rowNum, vc, marks.length, 1);
  range.setNumberFormat('@');
  range.setValues(marks.map(m => [m]));
}

// Rows that went away from a tab: {hash of Kind+Name: [when, stamp of the change that removed it]}.
function gone_(sh) {
  try {
    return JSON.parse(PropertiesService.getDocumentProperties().getProperty('gone:' + sh.getName().trim().toLowerCase()) || '{}');
  } catch (err) {
    return {};
  }
}

function saveGone_(sh, gone) {
  const keep = {};
  Object.keys(gone).sort((a, b) => gone[b][0] - gone[a][0]).slice(0, MAX_GONE).forEach(k => { keep[k] = gone[k]; });
  PropertiesService.getDocumentProperties().setProperty('gone:' + sh.getName().trim().toLowerCase(), JSON.stringify(keep));
}

/*
 * What a change is based on. The site ends each ren, set and del entry with
 *   {base: [versions], seen, stamp}
 * base: the versions the row may have for the change to go ahead ('' for no row): the one the page
 *   last saw, then any its own unconfirmed changes would have left.
 * seen: when the page last heard from the sheet (the "at" of a read or patch).
 * stamp: the row's new version.
 * A change made before the page read the tab has no base, and goes ahead regardless.
 */
function when_(x) {
  const w = x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  const stamp = typeof w.stamp === 'string' && /^[a-z0-9]{6,32}$/i.test(w.stamp) ? w.stamp : stamp_();
  const ours = Array.isArray(w.base) ? w.base.slice(0, 100).map(String).concat(stamp) : null;
  return { stamp, ours, seen: Number(w.seen) || 0 };
}

/*
 * Sheets runs this (a simple trigger) after someone edits the spreadsheet by hand. The edited
 * rows get a new stamp, and rows whose Kind+Name went away are remembered as removed.
 */
function onEdit(e) {
  const range = e && e.range;
  if (!range) return;
  const sh = range.getSheet();
  touched_(sh.getName());
  if (range.getColumn() > HEADER.length) return;
  const top = Math.max(range.getRow(), 2);
  sheetLock_(() => stampRows_(sh, top, range.getLastRow() - top + 1));
}

/*
 * Stamps rows top..top+n-1 of a tab the site edits whose stamp doesn't match what they hold (so
 * a row stamped already, by onEdit or by pushChange in Push.gs, keeps its version), and remembers
 * rows whose Kind+Name went away as removed.
 */
function stampRows_(sh, top, n) {
  const kind = tabKind_(sh.getName());
  if (!kind || sheetsOnly_(kind) || n < 1) return;
  const vc = verCol_(sh);
  const stamp = stamp_();
  const removed = [];
  let changed = false;
  const marks = sh.getRange(top, 1, n, vc).getDisplayValues().map(line => {
    const cells = line.slice(0, HEADER.length);
    const mark = String(line[vc - 1] || '');
    const m = mark.split(':');
    const filled = !!cells.join('').trim();
    if (filled ? m[0] && m[1] === hash_(cells.join('\u0001')) : !mark) return mark;
    const keyed = !!(cells[0].trim() || cells[1].trim());
    if (m[2] && (!keyed || m[2] !== hash_(key_(cells[0], cells[1])))) removed.push(m[2]);
    changed = true;
    return filled ? mark_(stamp, cells) : '';
  });
  if (changed) putMarks_(sh, top, vc, marks);
  if (removed.length) {
    const gone = gone_(sh);
    removed.forEach(k => { gone[k] = [Date.now(), stamp]; });
    saveGone_(sh, gone);
  }
}

// Runs fn holding the script lock when it can, and without it when it can't: a trigger's stamps
// matter more than waiting its turn.
function sheetLock_(fn) {
  let lock = null;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) lock = null;
  } catch (err) {
    lock = null;
  }
  try {
    return fn();
  } finally {
    if (lock) lock.releaseLock();
  }
}

/* ---------- remembered digests ----------
 * A poll mostly finds its tabs unchanged, so a tab's digest is remembered (per role) and a read
 * whose copy matches it is answered without reading the tab. Each tab has a generation, a random
 * stamp that every write to it replaces (patch, create, show, place, onEdit, an import); a
 * remembered digest counts only under the generation it was read in, so a read that overlaps a
 * write never vouches for rows from before it. Sheets runs no onEdit for some edits by hand
 * (deleting whole rows, say, or a formula's result changing), so a digest is only trusted for
 * DIGEST_SECONDS.
 */

// The remembered digests of these tabs for role: {digest: {tab key: digest}, save({tab key: digest})}.
function digests_(role, names) {
  const cache = CacheService.getScriptCache();
  const ks = names.map(n => String(n).trim().toLowerCase());
  const got = ks.length ? cache.getAll(ks.map(k => 'gen:' + k).concat(ks.map(k => 'dig:' + role + ':' + k))) : {};
  const gens = {};
  const newGens = {};
  const digest = {};
  ks.forEach(k => {
    gens[k] = got['gen:' + k] || (newGens['gen:' + k] = stamp_());
    const hit = String(got['dig:' + role + ':' + k] || '').split('|');
    if (hit[0] === gens[k]) digest[k] = hit[1];
  });
  // Before reading: a write from here on replaces the generation, which voids what's saved below.
  if (Object.keys(newGens).length) cache.putAll(newGens, 21600);
  return {
    digest,
    save(fresh) {
      const out = {};
      Object.keys(fresh).forEach(k => { out['dig:' + role + ':' + k] = gens[k] + '|' + fresh[k]; });
      if (Object.keys(out).length) cache.putAll(out, DIGEST_SECONDS);
    },
  };
}

// The tabs named have changed: forget their digests. A change to the Images tab changes what
// every Image cell shows, so it touches the Map tab and the tabs that may have one too.
function touched_(...names) {
  const ks = names.map(n => String(n).trim().toLowerCase());
  if (ks.indexOf(IMAGES_TAB.toLowerCase()) >= 0) ks.push('map', ...pictureTabs_(SpreadsheetApp.getActiveSpreadsheet()).map(sh => sh.getName().trim().toLowerCase()));
  const out = {};
  ks.forEach(k => { out['gen:' + k] = stamp_(); });
  CacheService.getScriptCache().putAll(out, 21600);
  pushDue_ = true;
}

/* ---------- ops ---------- */

/*
 * read {tabs: '*' | [names], have: {name: digest}} -> rows (and versions) only for tabs whose
 * digest changed. "at" is when the read started.
 */
function read_(role, req) {
  const at = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const want = Array.isArray(req.tabs) ? req.tabs.map(t => String(t).trim().toLowerCase()) : null;
  const have = req.have || {};
  const list = [];
  const read = [];
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    const kind = tabKind_(name);
    if (!canRead_(role, kind)) return;
    list.push({ name, kind });
    if (!want || want.indexOf(name.trim().toLowerCase()) >= 0) read.push({ sh, name, kind });
  });
  const tabs = {};
  const known = digests_(role, read.map(r => r.name));
  const fresh = {};
  let names = null;
  const named = () => names || (names = namedImages_());
  read.forEach(({ sh, name, kind }) => {
    const k = name.trim().toLowerCase();
    if (have[name] && known.digest[k] === have[name]) { tabs[name] = { d: have[name] }; return; }
    const t = table_(sh, kind, role, named);
    fresh[k] = t.d;
    tabs[name] = have[name] === t.d ? { d: t.d } : t;
  });
  known.save(fresh);
  const res = { ok: true, v: API_VERSION, role, game: ss.getName(), at, list, tabs };
  if (role === 'gm') res.crewKey = keys_().crew; // lets the GM copy a crew invite link
  const push = pushUrl_();
  if (push) res.push = push; // where to listen for live updates (Push.gs)
  return res;
}

/*
 * patch {tab, ren: [[Kind, From, To, when]...], set: [[Kind, Name, Value, Notes, when]...], del: [[Kind, Name, when]...]}
 * Rows are keyed by Kind+Name (case-insensitive; the first match wins). Renames happen first and
 * in place, so a renamed row keeps its position. Only touched rows are written, so formulas,
 * formatting and rows added by hand elsewhere in the tab are kept.
 * A change whose row isn't as it was when the change was made (see when_) is skipped, and listed
 * in "skipped" as [Kind, Name]. So are changes to the new name of a skipped rename.
 */
function patch_(role, req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = findSheet_(ss, req.tab);
  if (!sh) return { ok: false, code: 'missing', error: 'No tab called "' + req.tab + '".' };
  const kind = tabKind_(sh.getName());
  if (!canWrite_(role, kind)) return sheetsOnly_(kind) ? { ok: false, code: 'forbidden', error: 'That tab is edited in the spreadsheet itself.' } : forbidden_();

  const sets = (req.set || []).map(r => ({ cells: cells_(r, 4), w: when_(r[4]) }));
  const vc = verCol_(sh);
  const all = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(vc, sh.getLastColumn())).getDisplayValues();
  const header = all[0];
  const grid = all.slice(1);
  const vals = grid.map(r => r.slice(0, 4));
  const marks = grid.map(r => r[vc - 1]);
  // Row index by Kind+Name (the first match wins), rebuilt after rows move or change name.
  let index = null;
  const moved = () => { index = null; };
  const find = k => {
    if (!index) {
      index = {};
      vals.forEach((r, i) => { const rk = key_(r[0], r[1]); if (!(rk in index)) index[rk] = i; });
    }
    return k in index ? index[k] : -1;
  };
  let gone = null;
  const goneNow = () => gone || (gone = gone_(sh));
  let buried = false;
  const bury = (k, w) => { goneNow()[hash_(k)] = [Date.now(), w.stamp]; buried = true; };
  const renamed = {}; // names rows were renamed to here: the rename checked them already
  const blocked = {}; // names a skipped rename would have made
  const skipped = [];

  // Whether a change to the row keyed k (at index i; -1 if it isn't there) may go ahead.
  const fits = (k, i, w) => {
    if (!w.ours || renamed[k]) return true;
    if (i >= 0) return w.ours.indexOf(version_(marks[i], vals[i])) >= 0;
    const g = goneNow()[hash_(k)];
    if (g && w.ours.indexOf(g[1]) >= 0) return true; // one of our own changes removed it
    return w.ours.indexOf('') >= 0 && !(g && g[0] > w.seen); // there was none, and none was removed since
  };

  (req.ren || []).forEach(r => {
    const w = when_(r[3]);
    const to = String(r[2] == null ? '' : r[2]);
    if (!to.trim()) return;
    if (to.length > MAX_CELL) throw new Error('A cell is too long (over ' + MAX_CELL + ' characters).');
    const k = key_(r[0], r[1]);
    const from = find(k);
    if (from < 0) {
      // Renamed already (this is a retry), or never reached the sheet: the set queued under the
      // new name brings the row. Removed by someone else since: it stays removed.
      if (blocked[k] || !fits(k, -1, w)) { blocked[key_(r[0], to)] = true; skipped.push([r[0], r[1]]); }
      return;
    }
    if (find(key_(r[0], to)) >= 0 || !fits(k, from, w)) {
      if (w.ours) { blocked[key_(r[0], to)] = true; skipped.push([r[0], r[1]]); }
      return;
    }
    const cell = sh.getRange(from + 2, 2);
    cell.setNumberFormat('@');
    cell.setValues([[safe_(to)]]);
    vals[from][1] = to;
    moved();
    marks[from] = mark_(w.stamp, vals[from]);
    putMarks_(sh, from + 2, vc, [marks[from]]);
    bury(k, w);
    renamed[key_(r[0], to)] = true;
  });

  const doomed = [];
  (req.del || []).forEach(r => {
    const w = when_(r[2]);
    const k = key_(r[0], r[1]);
    const i = find(k);
    if (i < 0 || doomed.indexOf(i) >= 0) return;
    if (blocked[k] || !fits(k, i, w)) { skipped.push([r[0], r[1]]); return; }
    doomed.push(i);
    bury(k, w);
  });
  doomed.sort((a, b) => b - a).forEach(i => { sh.deleteRow(i + 2); vals.splice(i, 1); marks.splice(i, 1); });
  if (doomed.length) moved();

  sets.forEach(({ cells, w }) => {
    if (!cells[0].trim() && !cells[1].trim()) return;
    const k = key_(cells[0], cells[1]);
    const at = find(k);
    // Already so (a retry of a change that landed, say): nothing to do. After a rename, the row
    // is written anyway, so it carries this change's stamp.
    if (at >= 0 && !renamed[k] && vals[at].join('\u0001') === cells.join('\u0001')) return;
    if (blocked[k] || !fits(k, at, w)) { skipped.push([cells[0], cells[1]]); return; }
    const mark = mark_(w.stamp, cells);
    if (at >= 0) {
      writeRow_(sh, at + 2, cells, vc, mark);
      vals[at] = cells;
      marks[at] = mark;
      return;
    }
    // New rows go after the last row of the same Kind, so the tab stays grouped for people reading it.
    const kk = cells[0].trim().toLowerCase();
    let pos = -1;
    vals.forEach((r, j) => { if (String(r[0]).trim().toLowerCase() === kk) pos = j; });
    if (pos >= 0 && pos < vals.length - 1) {
      sh.insertRowAfter(pos + 2);
      writeRow_(sh, pos + 3, cells, vc, mark);
      vals.splice(pos + 1, 0, cells);
      marks.splice(pos + 1, 0, mark);
    } else {
      writeRow_(sh, vals.length + 2, cells, vc, mark);
      vals.push(cells);
      marks.push(mark);
    }
    moved();
  });

  if (buried) saveGone_(sh, gone);
  touched_(sh.getName());
  const at = Date.now();
  // The tab as a read would now send it, from what's in hand. An Image column is read afresh
  // (see table_), since its pictures moved with their rows.
  const pictures = PICTURE_KINDS.indexOf(kind) >= 0 && imageColIn_(header) >= 0;
  const t = pictures ? table_(sh, kind, role) : tableOf_(vals, marks);
  return { ok: true, tab: sh.getName(), at, d: t.d, rows: t.rows, vers: t.vers, imgs: t.imgs, skipped };
}

/*
 * feedback {text}: a line added to the Feedback tab (made if the game has none yet). It's
 * anonymous: only the day and the text are kept, not who sent it, their role or their page.
 */
function feedback_(req) {
  const text = String(req.text == null ? '' : req.text).trim();
  if (!text) return { ok: false, error: 'There’s nothing to send.' };
  if (text.length > MAX_CELL) return { ok: false, error: 'That’s too long (over ' + MAX_CELL + ' characters).' };
  const cache = CacheService.getScriptCache();
  const sent = Number(cache.get('feedback') || 0);
  if (sent >= FEEDBACK_LIMIT) return { ok: false, code: 'busy', error: 'Lots of feedback just now. Try again in a minute.' };
  cache.put('feedback', String(sent + 1), 60);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = findSheet_(ss, FEEDBACK_TAB);
  if (!sh) {
    sh = ss.insertSheet(FEEDBACK_TAB);
    sh.getRange(1, 1, 1, FEEDBACK_HEADER.length).setValues([FEEDBACK_HEADER]);
  }
  const day = new Date().toISOString().slice(0, 10);
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, FEEDBACK_HEADER.length);
  range.setNumberFormat('@');
  range.setValues([[day, safe_(text)]]);
  return { ok: true };
}

/*
 * roll {who, label, dice: [faces], mod, total, as}: a roll shared with the table, added to the
 * Rolls tab (made if the game has none yet). who is the sheet rolled on; as is who rolled it
 * when that's someone else ('GM', another character). The dice come from the page: like the rest
 * of the site, it's the honor system. Sends back the tab as a read would.
 */
function roll_(req) {
  const text = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, ROLL_MAX_TEXT);
  const who = text(req.who);
  const label = text(req.label);
  const dice = Array.isArray(req.dice) ? req.dice.map(Number) : [];
  const mod = Number(req.mod) || 0;
  const total = Number(req.total);
  if (!who || !label || !dice.length || dice.length > ROLL_MAX_DICE || dice.some(d => !(d >= 1 && d <= 6 && d % 1 === 0)) ||
      mod % 1 !== 0 || Math.abs(mod) > 99 || total !== dice.reduce((a, b) => a + b, 0) + mod) {
    return { ok: false, error: 'That roll doesn’t add up.' };
  }
  const cache = CacheService.getScriptCache();
  const sent = Number(cache.get('rolls') || 0);
  if (sent >= ROLL_LIMIT) return { ok: false, code: 'busy', error: 'Lots of rolls just now. Try again in a minute.' };
  cache.put('rolls', String(sent + 1), 60);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = findSheet_(ss, ROLLS_TAB);
  if (!sh) {
    sh = ss.insertSheet(ROLLS_TAB);
    sh.getRange(1, 1, 1, ROLLS_HEADER.length).setValues([ROLLS_HEADER]);
    sh.setFrozenRows(1);
  }
  const when = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const cells = [when, who, label, dice.join(' '), mod ? (mod > 0 ? '+' : '') + mod : '', String(total), text(req.as)];
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, ROLLS_HEADER.length);
  range.setNumberFormat('@');
  range.setValues([cells.map(safe_)]);
  const over = sh.getLastRow() - 1 - ROLLS_KEPT;
  if (over >= ROLLS_SENT) sh.deleteRows(2, over);
  touched_(ROLLS_TAB);
  const at = Date.now();
  const t = rollsTable_(sh);
  return { ok: true, tab: sh.getName(), at, d: t.d, rows: t.rows };
}

// The Rolls tab's latest ROLLS_SENT rows, oldest first.
function rollsTable_(sh) {
  const grid = sh.getDataRange().getDisplayValues();
  const rows = grid.slice(1).map(line => {
    const r = line.slice(0, ROLLS_HEADER.length);
    while (r.length < ROLLS_HEADER.length) r.push('');
    return r;
  }).filter(r => r.join('').trim() !== '').slice(-ROLLS_SENT);
  return { d: digest_(rows), rows };
}

/* create {tab, rows}: a new character tab (or a missing Ship/Lore tab; a GM tab needs the GM key) */
function create_(role, req) {
  const name = String(req.tab || '').trim();
  if (!name || name.length > MAX_TAB_NAME || /[\[\]*?\/\\:]/.test(name)) {
    return { ok: false, code: 'name', error: 'Pick a different name: up to ' + MAX_TAB_NAME + ' characters, without [ ] * ? / \\ :' };
  }
  const kind = tabKind_(name);
  if (!kind || sheetsOnly_(kind) || (kind === 'gm' && role !== 'gm')) {
    return { ok: false, code: 'name', error: '"' + name + '" is a reserved name.' };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (findSheet_(ss, name)) return { ok: false, code: 'exists', error: 'A tab called "' + name + '" already exists.' };

  const rows = (req.rows || []).map(r => cells_(r, 4)).filter(c => c[0].trim() || c[1].trim());
  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, 4).setValues([HEADER]);
  sh.setFrozenRows(1);
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 4).setNumberFormat('@');
  const vc = verCol_(sh);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows.map(c => c.map(safe_)));
    const stamp = stamp_();
    putMarks_(sh, 2, vc, rows.map(c => mark_(stamp, c)));
  }
  guard_(sh);
  touched_(name);
  const at = Date.now();
  const t = table_(sh, kind, role);
  return { ok: true, tab: name, kind, at, d: t.d, rows: t.rows, vers: t.vers };
}

/* ---------- the Map tab ----------
 * Region | Location | Level | Image | Text | GM notes | Shown, one row each for:
 *   a region's own map:   Region, no Location            (always shown)
 *   a place:              Region, Location, no Level     (shown to the crew once Shown is "on")
 *   a floor of a place:   Location, Level                (in order; shown with its place)
 * A place with no Level rows is one picture. Image is a picture placed in the cell (Insert > Image >
 * Insert image in cell), an =IMAGE("https://…") formula, or the name of a row of the Images tab.
 * GM notes are only sent to the GM. Rows go out as those 7 cells, the Image cell as imageTokens_
 * sends it.
 */
function mapCols_(header) {
  const hs = (header || []).map(h => String(h).trim().toLowerCase());
  return MAP_HEADER.map(h => hs.indexOf(h.toLowerCase()));
}

const isOn_ = v => /^(on|yes|y|x|true|●|1)$/i.test(String(v || '').trim());

// The Map tab's rows that role may see: [{n: sheet row, cells}].
function mapRows_(sh, role, named) {
  const grid = sh.getDataRange().getDisplayValues();
  const cols = mapCols_(grid[0]);
  const tokens = cols[3] >= 0 ? imageTokens_(sh, cols[3], grid.length - 1, named) : null;
  const out = [];
  const shown = {};
  grid.slice(1).forEach((line, i) => {
    const cells = cols.map(c => (c >= 0 && line[c] != null ? String(line[c]) : ''));
    if (tokens) cells[3] = tokens[i];
    if (!cells.join('').trim()) return;
    const loc = cells[1].trim().toLowerCase();
    cells[6] = isOn_(cells[6]) ? 'on' : '';
    if (loc && !cells[2].trim() && !(loc in shown)) shown[loc] = cells[6] === 'on';
    if (role !== 'gm') cells[5] = '';
    out.push({ n: i + 2, cells, loc });
  });
  return role === 'gm' ? out : out.filter(r => !r.loc || shown[r.loc]);
}

// The GM also gets each row's place in the sheet (ns), to edit it by (see place_).
function mapTable_(sh, role, named) {
  const seen = mapRows_(sh, role, named);
  const rows = seen.map(r => r.cells);
  if (role !== 'gm') return { d: digest_(rows), rows };
  const ns = seen.map(r => r.n);
  return { d: digest_([rows, ns]), rows, ns };
}

/* show {location, on} (GM): puts a place on the crew's map, or takes it off */
function show_(req) {
  const sh = findSheet_(SpreadsheetApp.getActiveSpreadsheet(), 'Map');
  if (!sh) return { ok: false, code: 'missing', error: 'No Map tab.' };
  const grid = sh.getDataRange().getDisplayValues();
  const cols = mapCols_(grid[0]);
  if (cols[6] < 0) return { ok: false, error: 'Add a "Shown" column to the Map tab.' };
  const want = String(req.location || '').trim().toLowerCase();
  const i = grid.findIndex((line, j) => j > 0 && String(line[cols[1]]).trim().toLowerCase() === want && !(cols[2] >= 0 && String(line[cols[2]]).trim()));
  if (!want || i < 0) return { ok: false, code: 'missing', error: 'No place called "' + req.location + '" in the Map tab.' };
  const cell = sh.getRange(i + 1, cols[6] + 1);
  cell.setNumberFormat('@');
  cell.setValues([[req.on ? 'on' : '']]);
  touched_(sh.getName());
  const t = mapTable_(sh, 'gm');
  return { ok: true, tab: sh.getName(), at: Date.now(), d: t.d, rows: t.rows };
}

/*
 * place {row, was, cells, image} (GM): adds, changes or removes a row of the Map tab.
 *   row: the sheet row to change, or 0 to add one. was: its 7 cells as the GM last read them; if
 *     the row has changed in the sheet since, nothing is changed.
 *   cells: [Region, Location, Level, Text, GM notes]; leave it out to remove the row (a place's
 *     levels go with it).
 *   image: left out keeps the picture; '' clears it; {name} names a row of the Images tab;
 *     {name, type, data (base64)} adds the picture to the Images tab under that name (with a
 *     number added if the name is taken) and names that row.
 * Renaming a place renames its levels' Location too. A new level goes after its place's last
 * row, anything else new at the end. A new place starts hidden.
 */
function place_(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = findSheet_(ss, 'Map');
  const row = Number(req.row) || 0;
  if (!sh) {
    if (row) return { ok: false, code: 'missing', error: 'No Map tab.' };
    sh = ss.insertSheet('Map');
    sh.getRange(1, 1, 1, MAP_HEADER.length).setValues([MAP_HEADER]);
    sh.setFrozenRows(1);
  }
  const cols = mapColsFor_(sh);
  const all = mapRows_(sh, 'gm');
  const old = row ? all.find(r => r.n === row) : null;
  if (row && (!old || JSON.stringify(old.cells) !== JSON.stringify((req.was || []).map(String)))) {
    return { ok: false, code: 'conflict', error: 'That row of the Map tab has changed since this page read it. Look again and redo your change.' };
  }
  const levelsOf = loc => all.filter(r => r.loc === loc && String(r.cells[2]).trim());
  if (!req.cells) {
    if (!old) return { ok: false, error: 'Nothing to remove.' };
    const gone = [old].concat(!String(old.cells[2]).trim() && old.loc ? levelsOf(old.loc) : []);
    gone.map(r => r.n).sort((a, b) => b - a).forEach(n => sh.deleteRow(n));
    return mapResult_(sh);
  }
  const c = cells_(req.cells, 5).map(v => v.trim());
  if (!c[0] && !c[1]) return { ok: false, error: 'Give it a region or a place.' };
  if (c[2] && !c[1]) return { ok: false, error: 'A level needs the place it’s in.' };
  let image = null; // the Image cell's new text, when it changes
  if (req.image === '') image = '';
  else if (req.image && req.image.data) {
    const added = addImage_(ss, req.image);
    if (!added.ok) return added;
    image = added.name;
  } else if (req.image && req.image.name != null) image = String(req.image.name).trim();
  let n = row;
  if (!n) {
    const loc = c[1].toLowerCase();
    const after = c[2] ? all.filter(r => r.loc === loc).map(r => r.n).pop() : 0;
    if (after) {
      sh.insertRowAfter(after);
      n = after + 1;
    } else n = Math.max(sh.getLastRow(), 1) + 1;
  }
  // The row's cells, written a run of side-by-side columns at a time (one run, in the usual layout).
  const cellsAt = {}; // column -> [value, number format]
  [0, 1, 2].forEach(i => { cellsAt[cols[i]] = [c[i], '@']; });
  cellsAt[cols[4]] = [c[3], '@'];
  cellsAt[cols[5]] = [c[4], '@'];
  if (image != null) cellsAt[cols[3]] = [image, 'General']; // a name, or =IMAGE() typed in later, as Sheets reads it
  const order = Object.keys(cellsAt).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1] === order[j] + 1) j++;
    const run = order.slice(i, j + 1).map(col => cellsAt[col]);
    const range = sh.getRange(n, order[i] + 1, 1, run.length);
    range.setNumberFormats([run.map(x => x[1])]);
    range.setValues([run.map(x => safe_(x[0]))]);
    i = j + 1;
  }
  // A renamed place takes its levels along.
  if (old && !String(old.cells[2]).trim() && old.loc && c[1].toLowerCase() !== old.loc) {
    levelsOf(old.loc).forEach(r => {
      const cell = sh.getRange(r.n, cols[1] + 1);
      cell.setNumberFormat('@');
      cell.setValues([[safe_(c[1])]]);
    });
  }
  return mapResult_(sh);
}

function mapResult_(sh) {
  touched_(sh.getName());
  const t = mapTable_(sh, 'gm');
  return { ok: true, tab: sh.getName(), at: Date.now(), d: t.d, rows: t.rows, ns: t.ns };
}

// The Map tab's columns, adding any it lacks after the last.
function mapColsFor_(sh) {
  const last = Math.max(sh.getLastColumn(), 1);
  const cols = mapCols_(sh.getRange(1, 1, 1, last).getDisplayValues()[0]);
  let next = sh.getLastColumn();
  MAP_HEADER.forEach((h, i) => {
    if (cols[i] >= 0) return;
    if (next >= sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, next + 1).setValues([[h]]);
    cols[i] = next++;
  });
  return cols;
}

// Adds {name, type, data (base64)} to the Images tab (made if need be) as a picture placed in a
// cell. Returns {ok, name} with the name it went under.
function addImage_(ss, img) {
  const type = String(img.type || '').toLowerCase();
  if (UPLOAD_TYPES.indexOf(type) < 0) return { ok: false, error: 'Use a PNG, JPEG, GIF or WebP picture.' };
  const data = String(img.data || '');
  if (!data || data.length * 3 / 4 > MAX_UPLOAD_BYTES) return { ok: false, error: 'That picture is too big (over 5 MB).' };
  let sh = findSheet_(ss, IMAGES_TAB);
  if (!sh) {
    sh = ss.insertSheet(IMAGES_TAB);
    sh.getRange(1, 1, 1, IMAGES_HEADER.length).setValues([IMAGES_HEADER]);
    sh.setFrozenRows(1);
  }
  const cols = imagesCols_(sh);
  const base = String(img.name || '').trim().slice(0, 200) || 'Picture';
  const taken = namedImagesAll_(sh, cols);
  let name = base;
  for (let k = 2; taken[name.toLowerCase()]; k++) name = base + ' ' + k;
  let pic;
  try {
    pic = SpreadsheetApp.newCellImage().setSourceUrl('data:' + type + ';base64,' + data).setAltTextTitle(name).build();
  } catch (err) {
    return { ok: false, error: 'The sheet couldn’t take that picture (' + (err.message || err) + '). Try a smaller one.' };
  }
  const n = Math.max(sh.getLastRow(), 1) + 1;
  const cell = sh.getRange(n, cols[0] + 1);
  cell.setNumberFormat('@');
  cell.setValues([[safe_(name)]]);
  sh.getRange(n, cols[1] + 1).setValues([[pic]]);
  touched_(sh.getName());
  return { ok: true, name };
}

/*
 * picture {tab, image, row}: a character's picture (or the ship's), the Image cell of its tab's
 * info|Name row, or with row ['crew', name] a crew member's on the Ship tab; the tab gets an Image
 * column if it has none. Anyone who may edit the tab may set it.
 *   image: '' clears it; {name} names a row of the Images tab; {name, type, data (base64)} adds the
 *     picture to the Images tab under that name (see addImage_) and names that row.
 */
function picture_(role, req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = findSheet_(ss, req.tab);
  if (!sh) return { ok: false, code: 'missing', error: 'No tab called "' + req.tab + '".' };
  const kind = tabKind_(sh.getName());
  if (kind !== 'character' && kind !== 'ship') return { ok: false, error: 'Only a character’s tab or the Ship tab has a picture.' };
  if (!canWrite_(role, kind)) return forbidden_();
  const row = Array.isArray(req.row) ? req.row.map(String) : ['info', 'Name'];
  if (key_(row[0], row[1]) !== key_('info', 'Name') && !(kind === 'ship' && key_(row[0], '') === key_('crew', '')))
    return { ok: false, error: 'Only a sheet’s name row or a crew member has a picture.' };
  const grid = sh.getDataRange().getDisplayValues();
  const n = grid.findIndex((line, i) => i > 0 && key_(line[0], line[1]) === key_(row[0], row[1]));
  if (n < 0) return { ok: false, code: 'missing', error: row[0] === 'info' ? 'Give the sheet a name first.' : 'No crew member called "' + row[1] + '" yet.' };
  let image;
  // A crew member's picture taken off leaves "-", so the Images tab's under their name (see
  // pictureTokens_), which is where an upload goes, doesn't show instead.
  if (req.image === '' || req.image == null) image = row[0].trim().toLowerCase() === 'crew' ? '-' : '';
  else if (req.image.data) {
    const added = addImage_(ss, req.image);
    if (!added.ok) return added;
    image = added.name;
  } else image = String(req.image.name == null ? '' : req.image.name).trim();
  let col = imageColIn_(grid[0]);
  if (col < 0) {
    col = Math.max(sh.getLastColumn(), HEADER.length);
    if (col >= sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, col + 1).setValues([['Image']]);
  }
  const cell = sh.getRange(n + 1, col + 1);
  cell.setNumberFormat('General'); // a name, or =IMAGE() typed in later, as Sheets reads it
  cell.setValues([[safe_(image)]]);
  touched_(sh.getName());
  const t = table_(sh, kind, role);
  return { ok: true, tab: sh.getName(), at: Date.now(), d: t.d, rows: t.rows, vers: t.vers, imgs: t.imgs };
}

// Every name in the Images tab, lowercase -> 1, pictures or not.
function namedImagesAll_(sh, cols) {
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, cols[0] + 1, sh.getLastRow() - 1, 1).getDisplayValues()
    .forEach(line => { const k = String(line[0]).trim().toLowerCase(); if (k) out[k] = 1; });
  return out;
}

/* images (GM): the Images tab's pictures, [[name, token]] in its order, for picking one */
function images_() {
  const sh = findSheet_(SpreadsheetApp.getActiveSpreadsheet(), IMAGES_TAB);
  if (!sh || sh.getLastRow() < 2) return { ok: true, images: [] };
  const cols = imagesCols_(sh);
  const names = sh.getRange(2, cols[0] + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  const tokens = imageTokens_(sh, cols[1], names.length, {});
  const images = [];
  names.forEach((line, i) => {
    const name = String(line[0]).trim();
    if (name && tokens[i]) images.push([name, tokens[i].replace(/^row:/, 'images:')]);
  });
  return { ok: true, images };
}

/*
 * What n rows (from row 2) have in an Image column (0-based col): "row:<the sheet's row>" for a
 * picture placed in the cell (op "image" sends its bytes; its own URL is short-lived), the
 * address of an =IMAGE("https://…") formula, what the Images tab has for a name typed in the
 * cell ("images:<its row>" for a placed picture), or ''.
 */
function imageTokens_(sh, col, n, named) {
  if (n < 1) return [];
  const range = sh.getRange(2, col + 1, n, 1);
  const vals = range.getValues();
  const forms = range.getFormulas();
  return vals.map((v, i) => {
    if (isCellImage_(v[0])) return 'row:' + (i + 2);
    const m = String(forms[i][0] || '').match(/^=\s*IMAGE\s*\(\s*"(https:\/\/[^"\s]+)"/i);
    if (m) return m[1];
    const name = forms[i][0] ? '' : String(v[0] == null ? '' : v[0]).trim().toLowerCase();
    if (!name) return '';
    if (typeof named === 'function') named = named();
    else if (!named) named = namedImages_();
    return named[name] || '';
  });
}

// The Images tab's pictures by name (lowercase): "images:<row>" for one placed in its Image cell,
// or an =IMAGE() formula's address. The first row with a name wins.
function namedImages_() {
  const sh = findSheet_(SpreadsheetApp.getActiveSpreadsheet(), IMAGES_TAB);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const cols = imagesCols_(sh);
  const names = sh.getRange(2, cols[0] + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  const tokens = imageTokens_(sh, cols[1], names.length, out); // a name there never points back
  names.forEach((line, i) => {
    const name = String(line[0]).trim().toLowerCase();
    if (name && !(name in out) && tokens[i]) out[name] = tokens[i].replace(/^row:/, 'images:');
  });
  return out;
}

// The Images tab's Name and Image columns (0-based), by header, else the first two.
function imagesCols_(sh) {
  const hs = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(h => String(h).trim().toLowerCase());
  return IMAGES_HEADER.map((h, i) => (hs.indexOf(h.toLowerCase()) >= 0 ? hs.indexOf(h.toLowerCase()) : i));
}

// A tab's pictures, one per row from row 2 (see imageTokens_), or null when it has none: its Image
// column's, and for a crew row whose Image cell is empty (not "-": taken off), the Images tab's
// picture under the crew member's name. grid: the tab's display values, header first.
function pictureTokens_(sh, kind, grid, named) {
  if (PICTURE_KINDS.indexOf(kind) < 0 || grid.length < 2) return null;
  const ic = imageColIn_(grid[0]);
  const tokens = ic >= 0 ? imageTokens_(sh, ic, grid.length - 1, named) : null;
  const crew = line => String(line[0]).trim().toLowerCase() === 'crew' && String(line[1]).trim() && !(ic >= 0 && String(line[ic]).trim());
  if (kind !== 'ship' || !grid.slice(1).some(crew)) return tokens;
  if (typeof named === 'function') named = named();
  else if (!named) named = namedImages_();
  return grid.slice(1).map((line, i) => (tokens && tokens[i]) || (crew(line) && named[String(line[1]).trim().toLowerCase()]) || '');
}

function isCellImage_(v) {
  return !!v && typeof v === 'object' && typeof v.getContentUrl === 'function';
}

/*
 * image {tab: 'Map' (the default), 'Images', or Lore, a character's tab or Ship, row, have} -> {d, type, data (base64)}: the picture
 * placed in that row's Image cell, if the caller can see the row. The crew see an Images row only
 * while a Map row they can see, or a row of a tab with an Image column, names it. d is the picture's digest; when it's
 * have (the digest of the copy the page kept), the answer is just {d, same: true}.
 */
function image_(role, req) {
  const tab = String(req.tab || 'Map').trim().toLowerCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = tab === 'images' || tab === 'map' ? findSheet_(ss, tab) : findSheet_(ss, req.tab);
  const kind = sh ? tabKind_(sh.getName()) : null;
  const name = kind === 'images' ? IMAGES_TAB : sh ? sh.getName() : '';
  const row = Number(req.row);
  if (!sh || !(kind === 'images' || kind === 'map' || (PICTURE_KINDS.indexOf(kind) >= 0 && canRead_(role, kind))) || !(row >= 2 && row <= sh.getLastRow() && Math.floor(row) === row)) return { ok: false, code: 'missing', error: 'No picture there.' };
  const header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  let col;
  if (kind === 'images') {
    if (role !== 'gm' && !namedOnSight_(ss, 'images:' + row)) return { ok: false, code: 'missing', error: 'No picture there.' };
    col = imagesCols_(sh)[1];
  } else if (kind === 'map') {
    const seen = mapRows_(sh, role).find(r => r.n === row);
    if (!seen || seen.cells[3] !== 'row:' + row) return { ok: false, code: 'missing', error: 'No picture there.' };
    col = mapCols_(header)[3];
  } else {
    col = imageColIn_(header);
  }
  const v = col >= 0 ? sh.getRange(row, col + 1).getValue() : null;
  if (!isCellImage_(v)) return { ok: false, code: 'missing', error: 'No picture there.' };
  let res;
  try {
    res = UrlFetchApp.fetch(v.getContentUrl(), { muteHttpExceptions: true });
  } catch (err) {
    return { ok: false, error: 'Couldn\'t read the picture in row ' + row + ' of the ' + name + ' tab.' };
  }
  if (res.getResponseCode() !== 200) return { ok: false, error: 'Couldn\'t read the picture in row ' + row + ' of the ' + name + ' tab (' + res.getResponseCode() + ').' };
  const blob = res.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'That picture is too big (over 20 MB).' };
  // The page may have it already: then say so rather than send it again.
  const d = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
  if (req.have && String(req.have) === d) return { ok: true, d, same: true };
  return { ok: true, d, type: String(blob.getContentType() || 'image/png'), data: Utilities.base64Encode(bytes) };
}

// Whether a Map row the crew can see, or a row of Lore, a character's tab or Ship (see pictureTokens_), has the picture
// token. Remembered for DIGEST_SECONDS under those tabs' and the Images tab's generations (see
// digests_), since a page asks once for each of its pictures.
function namedOnSight_(ss, token) {
  const cache = CacheService.getScriptCache();
  const tabs = pictureTabs_(ss);
  const ks = ['gen:map', 'gen:images'].concat(tabs.map(sh => 'gen:' + sh.getName().trim().toLowerCase()));
  const gens = cache.getAll(ks);
  const missing = {};
  ks.forEach(k => { if (!gens[k]) gens[k] = missing[k] = stamp_(); });
  if (Object.keys(missing).length) cache.putAll(missing, 21600); // before reading, as in digests_
  const key = 'sight:' + token + ':' + ks.map(k => gens[k]).join(':');
  const hit = cache.get(key);
  if (hit != null) return hit === '1';
  const yes = onSight_(ss, tabs, token);
  cache.put(key, yes ? '1' : '0', DIGEST_SECONDS);
  return yes;
}

function onSight_(ss, tabs, token) {
  const named = namedImages_();
  const map = findSheet_(ss, 'Map');
  if (map && mapRows_(map, 'crew', named).some(r => r.cells[3] === token)) return true;
  return tabs.some(sh => {
    if (sh.getLastRow() < 2) return false;
    const tokens = pictureTokens_(sh, tabKind_(sh.getName()), sh.getDataRange().getDisplayValues(), named);
    return !!tokens && tokens.indexOf(token) >= 0;
  });
}

// The tabs that may have an Image column, which the crew can all read.
function pictureTabs_(ss) {
  return ss.getSheets().filter(sh => PICTURE_KINDS.indexOf(tabKind_(sh.getName())) >= 0);
}

// A tab's Image column (0-based), found by its header after Notes, or -1.
function imageColIn_(header) {
  return (header || []).findIndex((h, i) => i >= HEADER.length && String(h).trim().toLowerCase() === 'image');
}

/* ---------- checks ---------- */

/*
 * Guards against accidental edits in Google Sheets. Run it once from the Apps Script editor
 * (pick setUpChecks in the function list, click Run), and again after adding tabs by hand; a
 * tab the site makes gets the checks itself. Running it again changes nothing.
 *   Rules, System and README: protected, with a warning before any edit (anyone can still edit
 *   on purpose). Their Kind columns, and Rules' Vis, only take the values the site knows.
 *   Character and Ship tabs: Kind suggests the site's kinds; a stat's Value must be a number,
 *   and a track's or bond's only pip symbols. The hidden Version column warns before an edit.
 * The script itself isn't held back by any of this.
 */
const RULES_KINDS = ['move', 'procedure', 'house', 'advance', 'playbook', 'vice', 'oddity', 'kit', 'lastwords', 'question',
  'pmove', 'smove', 'pnote', 'renown', 'rule', 'special', 'tag', 'trouble', 'table', 'fate', 'world', 'faction'];
const SYSTEM_KINDS = ['stat', 'track', 'section', 'choice'];
const SHEET_KINDS = ['info', 'stat', 'track', 'bond', 'sheet', 'notes', 'jot', 'kit', 'item', 'cargo', 'crew', 'move', 'special', 'advance', 'log', 'state', 'signin'];
const GUARD_NOTE = 'Cybersea: ';

function setUpChecks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const done = [];
  ss.getSheets().forEach(sh => { if (guard_(sh)) done.push(sh.getName()); });
  return done;
}

// The checks for one tab (see setUpChecks). Returns whether it has any.
function guard_(sh) {
  const name = sh.getName().trim().toLowerCase();
  const kind = tabKind_(sh.getName());
  if (name === 'readme') { protectTab_(sh, 'how the sheet works'); return true; }
  if (!kind || kind === 'feedback' || kind === 'images' || kind === 'rolls') return false;
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  const list = (values, strict, help) => SpreadsheetApp.newDataValidation().requireValueInList(values, true)
    .setAllowInvalid(!strict).setHelpText(help).build();
  if (kind === 'rules' || kind === 'system') {
    protectTab_(sh, kind === 'rules' ? 'the game’s rules; the site reads them' : 'the game’s mechanics; the site reads them');
    const head = sh.getRange(1, 1, 1, RULES_HEADER.length).getDisplayValues()[0].map(h => String(h).trim().toLowerCase());
    const col = h => head.indexOf(h) + 1;
    if (col('kind')) sh.getRange(2, col('kind'), rows, 1).setDataValidation(list(kind === 'rules' ? RULES_KINDS : SYSTEM_KINDS, true, 'A kind the site knows (see README).'));
    if (kind === 'system') return true;
    if (col('vis')) sh.getRange(2, col('vis'), rows, 1).setDataValidation(list(['crew', 'gm'], true, 'crew (or blank): everyone sees it. gm: only the GM.'));
    return true;
  }
  if (kind === 'character' || kind === 'ship') {
    sh.getRange(2, 1, rows, 1).setDataValidation(list(SHEET_KINDS, false, 'A kind the site knows (see README).'));
    const value = SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=IF($A2="stat",REGEXMATCH(TO_TEXT(C2),"^\\s*[+\\-−–]?\\d+\\s*$"),' +
        'IF($A2="track",REGEXMATCH(TO_TEXT(C2),"^[○●✕xXoO01×*•.\\-_\\s]*$"),' +
        'IF($A2="crew",REGEXMATCH(TO_TEXT(C2),"^[○●✕xXoO01×*•.\\-_\\s]*$"),' +
        'IF($A2="bond",REGEXMATCH(TO_TEXT(C2),"^[·●○oO01*•.\\-\\s]*$"),TRUE))))')
      .setAllowInvalid(false)
      .setHelpText('A stat is a number like +1 or -2. Tracks (and a crew member’s harm): ● marked, ○ open, ✕ crossed out. Bonds: ● marked, ○ used, · not marked.')
      .build();
    sh.getRange(2, 3, rows, 1).setDataValidation(value);
  }
  const vc = verColIn_(sh.getRange(1, 1, 1, sh.getMaxColumns()).getDisplayValues()[0]);
  if (vc) protectRange_(sh.getRange(1, vc, sh.getMaxRows(), 1), 'row versions the site keeps');
  return true;
}

function protectTab_(sh, what) {
  if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
  sh.protect().setDescription(GUARD_NOTE + what).setWarningOnly(true);
}

function protectRange_(range, what) {
  const note = GUARD_NOTE + what;
  if (range.getSheet().getProtections(SpreadsheetApp.ProtectionType.RANGE).some(p => p.getDescription() === note)) return;
  range.protect().setDescription(note).setWarningOnly(true);
}

/* selftest (GM): checks that values survive a round trip through this sheet unchanged */
const PROBES = ['=1+1', "'tis", '+2', '-1', '007', '1/2', 'TRUE', '3.0', '1e3', '- bullet', 'two\nlines',
  '●○✕·', '@mention', 'http://example.com', 'x  y'];

function selftest_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = findSheet_(ss, '_selftest') || ss.insertSheet('_selftest');
  const range = sh.getRange(1, 1, PROBES.length, 1);
  range.setNumberFormat('@');
  range.setValues(PROBES.map(p => [safe_(p)]));
  const back = range.getDisplayValues();
  ss.deleteSheet(sh);
  const results = PROBES.map((p, i) => ({ sent: p, got: back[i][0], ok: back[i][0] === p }));
  return { ok: results.every(r => r.ok), results };
}
