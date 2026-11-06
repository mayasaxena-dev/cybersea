/**
 * The spreadsheet's Cybersea menu: Import an xlsx… brings in the tabs of an .xlsx file (a fresh
 * workbook from tools/xlsx/build.py, say), picked from the computer. Once a file is picked, the
 * dialog lists its tabs (all ticked: each updates the sheet's tab of the same name, or is added)
 * and the sheet's tabs the file doesn't have (unticked: ticking one removes it). With "Keep this
 * sheet's changes" (the default), a tab the sheet has is merged with the file's, keeping rows
 * added, edited or removed in the sheet since the last import (see "keeping the sheet's own
 * changes" below); without it, it's replaced whole.
 *
 * The spreadsheet itself stays: its name, its script, the script's properties and the web app
 * deployment, so the site's URL and invite links keep working. A tab replaced whole loses
 * everything on it, including pictures placed in cells (File > Version history can bring them
 * back); a merged one keeps them on the rows it keeps from the sheet. The Images tab
 * is never replaced or removed: it holds the pictures, which an .xlsx can't bring in, so a file's
 * Images tab only comes in when the sheet has none yet.
 *
 * The script reads the .xlsx itself (it's a zip of XML files), so it needs no access beyond this
 * spreadsheet. It carries over what the game's workbooks use: values and formulas, plain-text
 * and number formats (dates, say), bold, fill and wrap formatting, column widths, hidden columns and tabs, frozen rows and
 * columns, list data validation, and sheet protection (as a warning; Excel's "allow edit" ranges stay
 * editable). Anything else is left out and listed in the result.
 *
 * appsscript.json lists the scopes itself (as Code.gs's @OnlyCurrentDoc would): this spreadsheet
 * only, script.container.ui (the menu and dialog), script.external_request (Code.gs's pictures,
 * Update.gs's files) and script.projects and script.deployments (Update.gs's update and deploy).
 */

// A game's workbook is a few hundred KB; these leave lots of room and keep a run inside Apps
// Script's time and memory limits.
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024; // what the zip says its parts come to, unpacked

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cybersea')
    .addItem('Import an xlsx…', 'showReplaceDialog')
    .addItem('Update the script', 'updateScript') // Update.gs
    .addToUi();
}

function showReplaceDialog() {
  const html = HtmlService.createHtmlOutput(REPLACE_DIALOG_HTML).setWidth(520).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import an xlsx');
}

// Called from the dialog once a file is picked: the file's tabs (and whether the sheet has a tab
// of the same name), and the sheet's tabs the file doesn't have.
function listXlsxTabs(name, data) {
  const opened = openXlsx_(name, data, () => false);
  if (!opened.ok) return opened;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const base = readBase_(ss);
  // Tab names as the current schema has them (see MIGRATIONS).
  const sheetTabs = {};
  ss.getSheets().map(sh => sh.getName()).filter(n => !keptTab_(ss, n)).forEach(n => {
    sheetTabs[tabKey_(migrateName_(n, base[tabKey_(n)] ? base[tabKey_(n)].schema : schema_()))] = n;
  });
  const file = opened.book.tabs.map(t => migrateName_(t.name, opened.book.schema)).filter(n => !keptTab_(ss, n));
  const inFile = {};
  file.forEach(n => { inFile[tabKey_(n)] = 1; });
  return {
    ok: true,
    file: file.map(n => ({ name: n, exists: !!sheetTabs[tabKey_(n)] })),
    sheetOnly: Object.keys(sheetTabs).filter(k => !inFile[k]).map(k => sheetTabs[k]),
  };
}

// Called from the dialog: name is the file's name, data its bytes in base64. choice: {tabs: the
// file's tabs to bring in (as listXlsxTabs names them), remove: the sheet's tabs to delete, merge:
// keep the sheet's own changes (see "keeping the sheet's own changes"), resolve: how to settle
// conflicts, review: change nothing, only list what would change}; without it, the sheet becomes
// the file (every tab brought in, every other tab removed). With merge, a conflict not yet
// settled changes nothing: the result is {ok: false, code: 'conflicts', conflicts: [{id, tab,
// row, what, cells: [{col, here, file}]}], changes: [{tab, row, what, cells}]}; with review, it's
// {ok: false, code: 'review', conflicts: [], changes}.
function replaceWithXlsx(name, data, choice) {
  const only = choice && Array.isArray(choice.tabs) ? choice.tabs.map(tabKey_) : null;
  const opened = openXlsx_(name, data, only && ((n, schema) => only.indexOf(tabKey_(migrateName_(n, schema))) >= 0));
  if (!opened.ok) return opened;
  const book = opened.book;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (book.schema > schema_()) {
    return { ok: false, error: 'That file is from a newer version of the site than this sheet’s script. Update the script (Import.gs) first. Nothing was changed.' };
  }
  book.tabs = book.tabs.filter(t => !keptTab_(ss, migrateName_(t.name, book.schema)) && (!only || only.indexOf(tabKey_(migrateName_(t.name, book.schema))) >= 0));
  const remove = choice && Array.isArray(choice.remove) ? choice.remove.map(String) : null;
  const resolve = choice && choice.resolve && typeof choice.resolve === 'object' ? choice.resolve : {};
  const merge = !!(choice && choice.merge);
  const { conflicts, changes } = prepareTabs_(ss, book, merge, resolve);
  if (conflicts.length) {
    return { ok: false, code: 'conflicts', conflicts, changes, error: 'Some rows changed both here and in the file. Pick which to keep. Nothing was changed yet.' };
  }
  // review: only say what it would do (the dialog shows it before anything changes).
  if (merge && choice.review) return { ok: false, code: 'review', conflicts, changes };
  const done = replaceTabs_(ss, book, remove);
  pushIfDue_(); // live updates (Push.gs)
  return done;
}

// The workbook in base64 data, its tabs' cells read only for the tabs only(name, the file's
// schema) picks (all if null).
function openXlsx_(name, data, only) {
  name = String(name || '');
  data = String(data || '');
  if (!/\.xlsx$/i.test(name)) return { ok: false, error: 'Pick an .xlsx file.' };
  const tooBig = { ok: false, error: 'That file is too big (over ' + MAX_XLSX_BYTES / 1024 / 1024 + ' MB).' };
  if (data.length * 3 / 4 > MAX_XLSX_BYTES) return tooBig; // before decoding it
  try {
    const bytes = Utilities.base64Decode(data);
    if (!bytes.length) return { ok: false, error: 'That file is empty.' };
    if (bytes.length > MAX_XLSX_BYTES) return tooBig;
    const unpacked = unzippedSize_(bytes);
    if (unpacked < 0) throw new Error('not a zip');
    if (unpacked > MAX_UNZIPPED_BYTES) return { ok: false, error: 'That file unpacks to far more than a game’s workbook. Nothing was changed.' };
    // An .xlsx is a zip, and Utilities.unzip only takes a blob typed as one.
    return { ok: true, book: readXlsx_(Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', name)), only) };
  } catch (err) {
    return { ok: false, error: 'That doesn’t look like an .xlsx file (' + (err.message || err) + '). Nothing was changed.' };
  }
}

// What a zip's parts add up to unpacked, from its central directory (-1 if it has none), so a
// small file that unpacks to gigabytes is turned down before Utilities.unzip tries.
function unzippedSize_(bytes) {
  const u8 = i => bytes[i] & 255;
  const u16 = i => u8(i) | (u8(i + 1) << 8);
  const u32 = i => (u16(i) + u16(i + 2) * 65536);
  let end = bytes.length - 22;
  while (end >= 0 && u32(end) !== 0x06054b50) end--;
  if (end < 0) return -1;
  let p = u32(end + 16);
  let total = 0;
  for (let n = u16(end + 10); n > 0; n--) {
    if (p + 46 > bytes.length || u32(p) !== 0x02014b50) return -1;
    total += u32(p + 24);
    p += 46 + u16(p + 28) + u16(p + 30) + u16(p + 32);
  }
  return total;
}

function tabKey_(name) {
  return String(name).trim().toLowerCase();
}

// Tabs of ss an import never touches: the Images and Rolls tabs, once there are, and _Import.
function keptTab_(ss, name) {
  const kind = tabKind_(name);
  return tabKey_(name) === tabKey_(BASE_TAB) || ((kind === 'images' || kind === 'rolls') && !!findSheet_(ss, name));
}

// Brings book's tabs into ss: each replaces the tab of the same name, keeping its place, or is
// added at the end. Then removes the tabs named in remove (null: every tab the book doesn't
// have, and the tabs end up in the book's order). The new tabs are made first, so a failure
// leaves the old tabs as they were; only the swap holds the script lock, so the site's writes
// wait for that rather than for the whole import.
function replaceTabs_(ss, book, remove) {
  if (!book.tabs.length) return { ok: false, error: 'Tick at least one tab from the file. Nothing was changed.' };
  const incoming = {};
  book.tabs.forEach(t => { incoming[tabKey_(t.name)] = 1; if (t.replaces) incoming[tabKey_(t.replaces)] = 1; });
  const gone = {};
  ss.getSheets().map(sh => sh.getName()).forEach(n => {
    if (!incoming[tabKey_(n)] && !keptTab_(ss, n) && (remove ? remove.some(r => tabKey_(r) === tabKey_(n)) : true)) gone[tabKey_(n)] = n;
  });
  const kept = ss.getSheets().map(sh => sh.getName()).filter(n => !incoming[tabKey_(n)] && !gone[tabKey_(n)] && tabKey_(n) !== tabKey_(BASE_TAB));
  if (!book.tabs.some(t => tabKind_(t.name) === 'rules') && !kept.some(n => tabKind_(n) === 'rules')) {
    return { ok: false, error: 'That would leave no Rules tab, so the site couldn’t read the game. Nothing was changed.' };
  }
  const made = [];
  try {
    book.tabs.forEach((t, i) => {
      // Named with a leading "_", so the site (which ignores such tabs) never shows a half-filled
      // one, nor one left behind if the run is cut off at Apps Script's time limit.
      const sh = ss.insertSheet('_importing ' + (i + 1) + ' ' + Date.now());
      made.push(sh);
      try {
        fillSheet_(sh, t, book.skipped);
        // Pictures placed in the cells of rows kept from the sheet, copied from its tab.
        (t.pictures || []).forEach(p => extra_(book.skipped, 'pictures (' + t.name + ')', () => {
          p.from.getRange(p.r + 1, p.c + 1).copyTo(sh.getRange(p.toR + 1, p.toC + 1));
        }));
        // Sheets batches writes, so one it turns down can fail later, on any call. Make it fail
        // here, while it can still name this tab and before any old tab goes.
        SpreadsheetApp.flush();
      } catch (err) {
        throw new Error((err.message || err) + ' (the ' + t.name + ' tab)');
      }
    });
  } catch (err) {
    made.forEach(sh => ss.deleteSheet(sh));
    throw err;
  }
  // The new tabs were filled without holding the site back; the swap waits for its writes.
  const res = withLock_(() => swapIn_(ss, book, made, gone, kept, incoming));
  if (res.code === 'busy') made.forEach(sh => ss.deleteSheet(sh));
  return res;
}

// Swaps the filled-in tabs (made) for the old ones, then removes the tabs in gone.
function swapIn_(ss, book, made, gone, kept, incoming) {
  // A merged tab was merged with what the sheet had then: if that has changed since (the site
  // saved a change, say), merging again is the only way not to lose it.
  const moved = book.tabs.find(t => t.source && digest_(plainGrid_(t.source.sheet)) !== t.source.digest);
  if (moved) {
    return { ok: false, code: 'busy', error: 'The ' + moved.replaces + ' tab changed while this was importing. Nothing was changed; try again.' };
  }
  // From here on, the old tabs start going.
  try {
    made.forEach((sh, i) => {
      const old = findSheet_(ss, book.tabs[i].replaces || book.tabs[i].name);
      const at = old ? old.getIndex() : 0;
      if (old) ss.deleteSheet(old);
      sh.setName(book.tabs[i].name);
      if (at) {
        ss.setActiveSheet(sh);
        ss.moveActiveSheet(at);
      }
    });
    Object.keys(gone).forEach(k => { const sh = findSheet_(ss, gone[k]); if (sh) ss.deleteSheet(sh); });
    if (!kept.length) made.forEach((sh, i) => { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); });
  } catch (err) {
    throw new Error((err.message || err) + ' (while swapping the new tabs in; File → Version history can undo it)');
  }
  // Sheets won't hide every tab; one it can't hide is listed, as is anything else after the swap.
  made.forEach((sh, i) => { if (book.tabs[i].hidden) extra_(book.skipped, 'hiding the ' + sh.getName() + ' tab', () => sh.hideSheet()); });
  // setUpChecks's checks, as on a tab the site makes. The tabs are in by now, so a check that
  // can't be set is listed rather than stopping the import.
  made.forEach(sh => extra_(book.skipped, 'the site’s checks on the ' + sh.getName() + ' tab', () => guard_(sh)));
  ss.setActiveSheet(made.find(sh => !sh.isSheetHidden()) || made[0]);

  // What came in, for the next import to merge against.
  extra_(book.skipped, 'remembering what came in, so the next import can keep this sheet’s changes', () => writeBase_(ss,
    book.tabs.map(t => ({ name: t.name, file: t.remember ? [t.remember.header].concat(t.remember.rows) : [] })),
    Object.keys(gone).map(k => gone[k]).concat(book.tabs.filter(t => t.replaces && tabKey_(t.replaces) !== tabKey_(t.name)).map(t => t.replaces))));

  // Rows remembered as removed (see gone_) were the old tabs' rows.
  const props = PropertiesService.getDocumentProperties();
  Object.keys(incoming).concat(Object.keys(gone)).forEach(k => props.deleteProperty('gone:' + k));
  touched_(...Object.keys(incoming).concat(Object.keys(gone)));
  const skipped = Object.keys(book.skipped);
  const merged = book.tabs.filter(t => t.merged).map(t => Object.assign({ tab: t.name }, t.merged));
  return { ok: true, tabs: made.map(sh => sh.getName()), removed: Object.keys(gone).map(k => gone[k]), merged, skipped };
}

function fillSheet_(sh, t, skipped) {
  const nr = Math.max(t.values.length, 1);
  const nc = Math.max(t.width, 1);
  if (sh.getMaxRows() < nr) sh.insertRowsAfter(sh.getMaxRows(), nr - sh.getMaxRows());
  if (sh.getMaxColumns() < nc) sh.insertColumnsAfter(sh.getMaxColumns(), nc - sh.getMaxColumns());
  const grid = f => t.values.length ? t.cells.map(line => line.map(f)) : [[f({})]];
  const range = sh.getRange(1, 1, nr, nc);
  range.setNumberFormats(grid(c => (c.text ? '@' : c.fmt || 'General')));
  range.setValues(t.values.length ? t.values : [['']]);
  // The rest is how the tab looks and what it checks: one that can't be set is listed in the
  // result instead of stopping the import.
  const tab = ' (' + t.name + ')';
  extra_(skipped, 'bold' + tab, () => range.setFontWeights(grid(c => (c.bold ? 'bold' : 'normal'))));
  extra_(skipped, 'fill colors' + tab, () => range.setBackgrounds(grid(c => c.fill || null)));
  extra_(skipped, 'wrapping' + tab, () => range.setWraps(grid(c => !!c.wrap)));
  // One call per <col> span (Excel writes a span for side-by-side columns alike).
  t.cols.forEach(c => {
    const from = Math.max(c.min, 1);
    const n = Math.min(c.max, nc) - from + 1;
    if (n < 1) return;
    const px = c.px || (c.width > 0 ? Math.round(c.width * 7 + 5) : 0); // px: a width read from the sheet
    if (px) extra_(skipped, 'column widths' + tab, () => sh.setColumnWidths(from, n, px));
    if (c.hidden) extra_(skipped, 'hidden columns' + tab, () => sh.hideColumns(from, n));
  });
  if (t.frozenRows) extra_(skipped, 'frozen rows' + tab, () => sh.setFrozenRows(t.frozenRows));
  if (t.frozenCols) extra_(skipped, 'frozen columns' + tab, () => sh.setFrozenColumns(t.frozenCols));
  t.validations.forEach(v => {
    const list = listOf_(v.formula);
    if (v.type !== 'list' || !list) {
      skipped['data validation that isn’t a list of choices (' + t.name + ' ' + v.sqref + ')'] = 1;
      return;
    }
    extra_(skipped, 'data validation (' + t.name + ' ' + v.sqref + ')', () => {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, v.dropdown).setAllowInvalid(!v.strict).build();
      v.sqref.split(/\s+/).filter(Boolean).forEach(a1 => sh.getRange(a1).setDataValidation(rule));
    });
  });
  // A protected tab warns before an edit, as setUpChecks's protections do. Locking it to its
  // editors would lock out the web app too when it runs as someone else (the deployer).
  if (t.protect) {
    extra_(skipped, 'protection' + tab, () => {
      const p = sh.protect().setDescription(GUARD_NOTE + 'protected in the imported file').setWarningOnly(true);
      p.setUnprotectedRanges(t.protect.open.map(a1 => sh.getRange(a1)));
    });
  }
}

// Runs fn; if Sheets turns it down, notes what, and why, in skipped.
function extra_(skipped, what, fn) {
  try {
    fn();
  } catch (err) {
    console.warn('Import: ' + what + ': ' + (err.stack || err));
    skipped[what + ': ' + (err.message || err)] = 1;
  }
}

// "on,off" in quotes -> ['on', 'off']; anything else (a range, a formula) -> null.
function listOf_(formula) {
  const m = /^"(.*)"$/.exec(String(formula || '').trim());
  return m ? m[1].split(',').map(s => s.trim()) : null;
}

/* ---------- keeping the sheet's own changes ----------
 * With merge (the dialog's default), a file's tab doesn't simply replace the sheet's: their rows
 * are matched by key (Kind + Name; Kind + Group + Name on Rules and System; Region + Location +
 * Level on Map; Date + Feedback on Feedback) and merged, cell by cell, against what the last
 * import brought in, which the hidden _Import tab remembers:
 *   - a cell the file hasn't changed since then keeps the sheet's value; one only the file changed
 *     takes the file's;
 *   - a row only the sheet has stays; a row the sheet removed stays removed, and one the file
 *     removed goes, unless the other side changed it since;
 *   - a cell both changed, differently, is a conflict, and so is a row one side removed and the
 *     other changed. Nothing changes until each is settled: choice.resolve is {conflict id:
 *     'sheet' | 'file'}.
 * With nothing remembered (a tab's first merge), a cell that differs is a conflict, unless the
 * sheet's is blank. A tab without its key columns (README, tabs starting with _) is replaced whole.
 *
 * Schemas: when the way a workbook is laid out changes, a migration below brings older tabs up to
 * date. The file names its schema (the "Cybersea schema" document property, which tools/xlsx
 * writes) and _Import remembers each tab's. Before merging, the file's tabs, the sheet's and what
 * _Import remembers are all brought up to the current schema, so that a row on the sheet still
 * meets its counterpart in a newer file.
 */

// How a game's workbook has changed, oldest first: schema n has the first n - 1 applied. Each
// may have tab(name) -> the tab's new name, and rows(tab) to change tab = {name, header: [column
// names], rows: [[cells as text]]} in place (cells it changes are written back as plain text).
// tools/xlsx/build.py's SCHEMA must match schema_() (tests/import-gs.test.mjs checks). E.g.
//   { about: 'Inventory tab renamed Kit', tab: n => (/^inventory$/i.test(n) ? 'Kit' : n),
//     rows: t => t.rows.forEach(r => { if (/^inventory$/i.test(r[0])) r[0] = 'kit'; }) }
const MIGRATIONS = [];
const SCHEMA_PROPERTY = 'Cybersea schema';
const BASE_TAB = '_Import';
const BASE_HEADER = ['Tab', 'Schema', 'Side', 'Row'];
const VERSION_COL = VER_HEADER.toLowerCase();

function schema_() {
  return MIGRATIONS.length + 1;
}

// A tab's name brought up from schema `from`.
function migrateName_(name, from) {
  let n = String(name);
  MIGRATIONS.slice(Math.max(from, 1) - 1).forEach(m => { if (m.tab) n = String(m.tab(n) || n); });
  return n;
}

// tab ({name, header, rows}) brought up from schema `from`, in place.
function migrate_(tab, from) {
  MIGRATIONS.slice(Math.max(from, 1) - 1).forEach(m => {
    if (m.tab) tab.name = String(m.tab(tab.name) || tab.name);
    if (m.rows) m.rows(tab);
  });
  return tab;
}

// The columns that tell a tab's rows apart, by header; null for a tab that's replaced whole.
function keyCols_(kind) {
  if (!kind || kind === 'images') return null;
  if (kind === 'rules' || kind === 'system') return ['kind', 'group', 'name'];
  if (kind === 'map') return ['region', 'location', 'level'];
  if (kind === 'feedback') return ['date', 'feedback'];
  return ['kind', 'name'];
}

function colName_(h, i) {
  return String(h).trim().toLowerCase() || '#' + i;
}

// A grid of text (header first) as a tab to migrate. Each row remembers where it came from (at),
// so a cell no migration changed is written back from the original, formats and all.
function tabOf_(name, grid) {
  const rows = grid.map((line, i) => { const r = line.slice(); r.at = i; return r; });
  return { name, header: rows[0] || [], rows: rows.slice(1) };
}

// A tab's rows by key: {tab, names: [column name], col: {name: index}, rows: [{key, label, cells}],
// by: {key: row}}, or null if it lacks a key column. Blank rows are left out; a key that repeats
// is told apart by how many times it came before (key#2, …).
function keyed_(tab, kind) {
  if (!tab) return null;
  const keys = keyCols_(kind);
  const names = tab.header.map(colName_);
  const col = {};
  names.forEach((n, i) => { if (!(n in col)) col[n] = i; });
  if (!keys || keys.some(k => !(k in col))) return null;
  const seen = {};
  const rows = [];
  const by = {};
  tab.rows.forEach(cells => {
    if (names.every((n, i) => n === VERSION_COL || String(cells[i] == null ? '' : cells[i]) === '')) return;
    const parts = keys.map(k => String(cells[col[k]] == null ? '' : cells[col[k]]).trim());
    let key = parts.join('|').toLowerCase();
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) key += '#' + seen[key];
    const row = { key, label: parts.filter(Boolean).join(' · ') || '(no ' + keys.join(' or ') + ')', cells };
    rows.push(row);
    by[key] = row;
  });
  return { tab, names, col, rows, by };
}

// row's cell in the column called name ('' if blank; undefined if side has no such column).
function cellIn_(side, row, name) {
  if (!side || !row || !(name in side.col)) return undefined;
  const v = row.cells[side.col[name]];
  return v == null ? '' : String(v);
}

// Whether row (of side) is as its counterpart in base was, column by column.
function sameAs_(side, row, base) {
  const was = base && base.by[row.key];
  return !!was && side.names.every((n, i) => n === VERSION_COL || String(row.cells[i] == null ? '' : row.cells[i]) === (cellIn_(base, was, n) || ''));
}

/*
 * Merges F (the file's rows) and S (the sheet's) given BF and BS (what the file and the sheet had
 * after the last import; null if nothing is remembered). Returns {names (the merged columns:
 * the file's, then the sheet's own), rows: [[{side: 'f' | 's', row, c}]], conflicts, counts}.
 */
function mergeRows_(tabName, F, S, BF, BS, resolve) {
  const names = F.names.slice();
  const inF = {};
  names.forEach(n => { inF[n] = 1; });
  S.names.forEach(n => { if (!inF[n]) { inF[n] = 1; names.push(n); } });
  const counts = { added: 0, updated: 0, removed: 0, kept: 0 };
  const conflicts = [];
  const changes = []; // what the import will do, row by row, for the dialog to show first
  const show = v => (v.length > 200 ? v.slice(0, 199) + '…' : v);
  const heading = n => (n in F.col ? F.tab.header[F.col[n]] : S.tab.header[S.col[n]]) || n;
  // A conflict's choice, or undefined (and the conflict listed) while it has none.
  const settle = (row, what, cells) => {
    const id = tabKey_(tabName) + '|' + row.key;
    const pick = resolve[id];
    if (pick === 'sheet' || pick === 'file') return pick;
    conflicts.push({ id, tab: tabName, row: row.label, what, cells: cells.map(c => ({ col: heading(c.n), here: show(c.here), file: show(c.file) })) });
    return undefined;
  };
  const note = (row, what, cells) => {
    changes.push({ tab: tabName, row: row.label, what, cells: cells.map(c => ({ col: heading(c.n), here: show(c.here), file: show(c.file) })) });
  };
  const cellsOf = (side, row, here) => side.names.map((n, i) => ({ n, v: String(row.cells[i] == null ? '' : row.cells[i]) }))
    .filter(c => c.n !== VERSION_COL && c.v).map(c => ({ n: c.n, here: here ? c.v : '', file: here ? '' : c.v }));
  const ref = (side, row, n) => (n in (side === 'f' ? F : S).col ? { side, row, c: (side === 'f' ? F : S).col[n] } : null);
  const whole = (side, row) => names.map(n => ref(side, row, n));

  // A row both have: cell by cell.
  const both = (f, s) => {
    const pick = {};
    const clash = [];
    names.forEach(n => {
      if (n === VERSION_COL) return;
      const fv = cellIn_(F, f, n);
      const sv = cellIn_(S, s, n);
      if (fv === undefined) { pick[n] = 's'; return; }
      if (sv === undefined) { pick[n] = 'f'; return; }
      const fb = cellIn_(BF, BF && BF.by[f.key], n);
      const sb = cellIn_(BS, BS && BS.by[s.key], n);
      if (fv === sv || fv === fb) pick[n] = 's';
      else if (sv === sb || (fb === undefined && sb === undefined && sv === '')) pick[n] = 'f';
      else clash.push({ n, here: sv, file: fv });
    });
    if (clash.length) {
      const choice = settle(s, 'changed here and in the file', clash);
      if (!choice) return null;
      clash.forEach(c => { pick[c.n] = choice === 'file' ? 'f' : 's'; });
    }
    const updated = names.some(n => pick[n] === 'f' && cellIn_(S, s, n) !== undefined && cellIn_(F, f, n) !== cellIn_(S, s, n));
    const kept = names.some(n => pick[n] === 's' && cellIn_(F, f, n) !== undefined && cellIn_(F, f, n) !== cellIn_(S, s, n));
    if (updated) counts.updated++;
    if (kept) counts.kept++;
    if ((updated || kept) && !clash.length) {
      const differ = names.filter(n => n !== VERSION_COL && cellIn_(F, f, n) !== undefined && cellIn_(S, s, n) !== undefined && cellIn_(F, f, n) !== cellIn_(S, s, n));
      note(s, updated && kept ? 'keeps this sheet’s edits and takes the file’s' : updated ? 'takes the file’s changes' : 'keeps this sheet’s edit',
        differ.map(n => ({ n, here: cellIn_(S, s, n), file: cellIn_(F, f, n) })));
    }
    // The row's version stays only if the row does: the site sees a row it didn't write as changed.
    return names.map(n => (n === VERSION_COL ? (updated ? null : ref('s', s, n)) : ref(pick[n], pick[n] === 'f' ? f : s, n)));
  };

  const out = {}; // key -> merged cells
  F.rows.forEach(f => {
    const s = S.by[f.key];
    if (s) { out[f.key] = both(f, s); return; }
    if (BF && BF.by[f.key]) { // the sheet removed it since
      if (sameAs_(F, f, BF)) { counts.kept++; note(f, 'stays removed (removed here)', cellsOf(F, f, false)); return; }
      const choice = settle(f, 'removed here, changed in the file', F.names.map((n, i) => ({ n, here: '', file: String(f.cells[i] == null ? '' : f.cells[i]) })).filter(c => c.n !== VERSION_COL && c.file));
      if (choice === 'file') { out[f.key] = whole('f', f); counts.added++; } else if (choice) counts.kept++;
      return;
    }
    out[f.key] = whole('f', f);
    counts.added++;
    note(f, 'added from the file', cellsOf(F, f, false));
  });
  S.rows.forEach(s => {
    if (F.by[s.key]) return;
    if (BF && BF.by[s.key]) { // the file removed it since
      if (sameAs_(S, s, BS)) { counts.removed++; note(s, 'removed (the file no longer has it)', cellsOf(S, s, true)); return; }
      const choice = settle(s, 'changed here, removed from the file', S.names.map((n, i) => ({ n, here: String(s.cells[i] == null ? '' : s.cells[i]), file: '' })).filter(c => c.n !== VERSION_COL && c.here));
      if (choice === 'sheet') { out[s.key] = whole('s', s); counts.kept++; } else if (choice) counts.removed++;
      return;
    }
    out[s.key] = whole('s', s);
    counts.kept++;
    note(s, 'stays (only on this sheet)', cellsOf(S, s, true));
  });

  // The file's order, with the sheet's own rows after the row they followed on the sheet.
  const after = { '': [] };
  let anchor = '';
  S.rows.forEach(s => {
    if (F.by[s.key]) { if (out[s.key]) anchor = s.key; return; }
    if (out[s.key]) (after[anchor] = after[anchor] || []).push(out[s.key]);
  });
  const rows = after[''].slice();
  F.rows.forEach(f => { if (out[f.key]) rows.push(out[f.key]); (after[f.key] || []).forEach(r => rows.push(r)); });
  return { names, rows, conflicts, changes, counts };
}

/* What's on a sheet's tab, read once: a side to merge, and its cells to write back. */
function sheetSource_(sh) {
  const range = sh.getDataRange();
  const formulas = range.getFormulas();
  const values = range.getValues();
  const fmts = range.getNumberFormats();
  const weights = range.getFontWeights();
  const fills = range.getBackgrounds();
  const wraps = range.getWraps();
  const plain = plainGrid_(sh, formulas, values);
  return {
    sheet: sh, plain,
    digest: digest_(plain),
    value(r, c) {
      if (formulas[r][c]) return formulas[r][c];
      const v = values[r][c];
      if (isCellImage_(v)) return '';
      if (typeof v !== 'string') return v;
      // As readSheet_: Sheets would take these as a formula, a number or a boolean.
      return /^[=']/.test(v) || (fmts[r][c] !== '@' && /^\s*([+-]?[\d.]|true\s*$|false\s*$)/i.test(v)) ? "'" + v : v;
    },
    style(r, c) {
      const fmt = String(fmts[r][c] || '');
      const fill = String(fills[r][c] || '');
      return {
        text: fmt === '@', fmt: fmt === '@' || /^general$/i.test(fmt) ? '' : fmt, bold: weights[r][c] === 'bold',
        fill: fill && !/^#ffffff$/i.test(fill) ? fill : null, wrap: !!wraps[r][c],
      };
    },
    picture: (r, c) => isCellImage_(values[r][c]),
  };
}

// A tab's cells as the import compares them (formulas and values: from sh, unless given).
function plainGrid_(sh, formulas, values) {
  if (!formulas) {
    const range = sh.getDataRange();
    formulas = range.getFormulas();
    values = range.getValues();
  }
  return values.map((line, r) => line.map((v, c) => plainOf_(formulas[r][c], v)));
}

// A cell as the import compares it: its formula, else its value as text.
function plainOf_(formula, v) {
  if (formula) return String(formula);
  if (isCellImage_(v)) return '[picture]';
  if (v instanceof Date || (v && typeof v.getTime === 'function')) return 'date:' + v.getTime();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v == null ? '' : String(v);
}

// A file's tab, read by readSheet_, as a source like sheetSource_'s.
function fileSource_(t) {
  const values = t.values;
  const cells = t.cells;
  return { plain: t.plain || [], value: (r, c) => values[r][c], style: (r, c) => cells[r][c] || {}, picture: () => false };
}

// What a merged cell holds: the original cell (src's row at, column c) if no migration changed it,
// else the migrated text.
function cellFrom_(src, side, row, c) {
  const v = row.cells[c] == null ? '' : String(row.cells[c]);
  const oc = src.col[side.names[c]];
  const at = row.cells.at;
  if (at != null && oc != null && src.plain[at] && src.plain[at][oc] === v) return { src, r: at, c: oc };
  return { lit: v };
}

/*
 * The tabs of book made ready to bring in, each brought up to the current schema and, with merge,
 * merged with the sheet's tab of the same name. Returns {conflicts: those still to settle (nothing
 * is changed while there are any), changes: what it will do, for the dialog to show first}. Each tab gets replaces (the sheet's tab it takes the place of,
 * which a migration may have renamed), remember (its rows as the file has them, for _Import),
 * and, if merged, merged (counts) and source (to check the sheet's tab is unchanged at the swap).
 */
function prepareTabs_(ss, book, merge, resolve) {
  const base = readBase_(ss);
  const sheetTabs = ss.getSheets().filter(sh => !keptTab_(ss, sh.getName()));
  const sheetSchema = name => (base[tabKey_(name)] ? base[tabKey_(name)].schema : schema_());
  const conflicts = [];
  const changes = [];
  book.tabs.forEach(t => {
    const fileName = t.name;
    const fileTab = migrate_(tabOf_(fileName, t.plain || []), book.schema);
    t.name = fileTab.name;
    const old = sheetTabs.find(sh => tabKey_(migrateName_(sh.getName(), sheetSchema(sh.getName()))) === tabKey_(t.name)) || null;
    t.replaces = old ? old.getName() : null;
    t.remember = fileTab;
    const kind = tabKind_(t.name);
    const F = keyed_(fileTab, kind);
    const fsrc = fileSource_(t);
    fsrc.col = colsOf_(t.plain);
    if (merge && old && F) {
      const ssrc = sheetSource_(old);
      ssrc.col = colsOf_(ssrc.plain);
      const S = keyed_(migrate_(tabOf_(old.getName(), ssrc.plain), sheetSchema(old.getName())), kind);
      if (S) {
        const was = base[tabKey_(old.getName())];
        const sideOf = which => was && was[which] ? keyed_(migrate_({ name: was.name, header: was[which][0] || [], rows: was[which].slice(1) }, was.schema), kind) : null;
        const m = mergeRows_(t.name, F, S, sideOf('file'), sideOf('sheet'), resolve || {});
        conflicts.push(...m.conflicts);
        changes.push(...m.changes);
        if (m.conflicts.length) return;
        const header = m.names.map(n => (n in F.col ? cellFrom_(fsrc, F, { cells: fileTab.header }, F.col[n]) : cellFrom_(ssrc, S, { cells: S.tab.header }, S.col[n])));
        const rows = m.rows.map(cells => cells.map(x => (x ? cellFrom_(x.side === 'f' ? fsrc : ssrc, x.side === 'f' ? F : S, x.row, x.c) : { lit: '' })));
        emit_(t, [header].concat(rows));
        // The sheet's own columns keep their width and whether they're hidden (the Version column is).
        m.names.forEach((n, j) => {
          if (n in F.col) return;
          const c = S.col[n] + 1;
          t.cols.push({ min: j + 1, max: j + 1, px: old.getColumnWidth(c), hidden: old.isColumnHiddenByUser(c) });
        });
        t.merged = m.counts;
        t.source = ssrc;
        return;
      }
    }
    // Replaced whole: as the file has it, unless a migration changed it.
    changes.push({ tab: t.name, row: '', what: old ? 'the whole tab is replaced by the file’s' : 'new tab', cells: [] });
    if (book.schema < schema_()) {
      const side = { names: fileTab.header.map(colName_) };
      const all = [fileTab.header].concat(fileTab.rows);
      emit_(t, all.map(cells => cells.map((v, c) => cellFrom_(fsrc, side, { cells }, c))));
    }
  });
  return { conflicts, changes };
}

function colsOf_(plain) {
  const col = {};
  (plain[0] || []).forEach((h, i) => { const n = colName_(h, i); if (!(n in col)) col[n] = i; });
  return col;
}

// Lays out t's cells from refs ({src, r, c} or {lit}), for fillSheet_.
function emit_(t, grid) {
  const width = grid.reduce((w, line) => Math.max(w, line.length), 0);
  t.values = [];
  t.cells = [];
  t.pictures = [];
  grid.forEach((line, r) => {
    const vals = [];
    const styles = [];
    for (let c = 0; c < width; c++) {
      const x = line[c] || { lit: '' };
      if (x.src) {
        vals.push(x.src.value(x.r, x.c));
        styles.push(x.src.style(x.r, x.c));
        if (x.src.picture(x.r, x.c)) t.pictures.push({ from: x.src.sheet, r: x.r, c: x.c, toR: r, toC: c });
      } else {
        vals.push(/^[=']/.test(x.lit) ? "'" + x.lit : x.lit);
        styles.push({ text: true });
      }
    }
    t.values.push(vals);
    t.cells.push(styles);
  });
  t.width = width;
}

/* ---------- what the last import brought in (the _Import tab) ----------
 * Tab | Schema | Side | Row: for each tab an import brought in, its rows as the file had them
 * (Side "file") and as the sheet had them just after (Side "sheet"), each row a JSON list of its
 * cells as text, header first. The site ignores the tab (it starts with _).
 */

// {tab key: {name, schema, file: [[cells]], sheet: [[cells]]}}
function readBase_(ss) {
  const sh = findSheet_(ss, BASE_TAB);
  const out = {};
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(([tab, schema, side, row]) => {
    if (side !== 'file' && side !== 'sheet') return;
    let cells;
    try { cells = JSON.parse(String(row)); } catch (err) { return; }
    if (!Array.isArray(cells)) return;
    const e = out[tabKey_(tab)] = out[tabKey_(tab)] || { name: String(tab), schema: Number(schema) || schema_(), file: [], sheet: [] };
    e[side].push(cells.map(String));
  });
  return out;
}

// Remembers what this import brought in (tabs: [{name, file: grid}] for tabs now on the sheet,
// whose rows are read back from it) and forgets the tabs in gone.
function writeBase_(ss, tabs, gone) {
  let sh = findSheet_(ss, BASE_TAB);
  const drop = {};
  tabs.forEach(t => { drop[tabKey_(t.name)] = 1; });
  gone.forEach(n => { drop[tabKey_(n)] = 1; });
  const keep = sh ? sh.getDataRange().getValues().slice(1).filter(line => line[0] !== '' && !drop[tabKey_(line[0])]) : [];
  const rows = [BASE_HEADER].concat(keep.map(line => BASE_HEADER.map((h, i) => (line[i] == null ? '' : line[i]))));
  const line = (name, side, cells) => {
    const json = JSON.stringify(cells);
    // A row too long for a cell is left out: next time, it's merged as if nothing were remembered.
    if (json.length <= MAX_CELL) rows.push([name, String(schema_()), side, json]);
  };
  tabs.forEach(t => {
    const read = plainGrid_(findSheet_(ss, t.name));
    const blank = cells => cells.every(v => v === '');
    t.file.filter((cells, i) => !i || !blank(cells)).forEach(cells => line(t.name, 'file', cells));
    read.filter((cells, i) => !i || !blank(cells)).forEach(cells => line(t.name, 'sheet', cells));
  });
  if (!sh) {
    sh = ss.insertSheet(BASE_TAB, ss.getSheets().length);
    extra_({}, 'hiding ' + BASE_TAB, () => sh.hideSheet());
    extra_({}, 'protecting ' + BASE_TAB, () => sh.protect().setDescription(GUARD_NOTE + 'what the last import brought in, so the next one keeps this sheet’s changes').setWarningOnly(true));
  }
  if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
  sh.clearContents();
  const range = sh.getRange(1, 1, rows.length, BASE_HEADER.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

/* ---------- reading an .xlsx ---------- */

// blobs: the unzipped parts; only(name, schema): whether to read a tab's cells (null: all; others
// get only their name and hidden). Returns {tabs: [{name, hidden, values, cells, plain, width,
// cols, frozenRows, frozenCols, validations, protect}], skipped: {what: 1}, schema}.
function readXlsx_(blobs, only) {
  const parts = {};
  blobs.forEach(b => { parts[b.getName().replace(/^\/+/, '')] = b; });
  const text = path => (parts[path] ? parts[path].getDataAsString('UTF-8') : '');
  if (!parts['xl/workbook.xml']) throw new Error('no xl/workbook.xml');
  const rels = {};
  all_(xml_(text('xl/_rels/workbook.xml.rels')), 'Relationship').forEach(r => { rels[r.a.Id] = r.a.Target; });
  // Listing a file's tabs needs neither, so they're read only for a tab whose cells are.
  let shared = null;
  let styles = null;
  const sheetOf = (path, name, skipped) => {
    if (!shared) shared = all_(xml_(text('xl/sharedStrings.xml')), 'si').map(textOf_);
    if (!styles) styles = readStyles_(xml_(text('xl/styles.xml')), skipped);
    return readSheet_(xml_(text(path)), shared, styles, skipped, name);
  };
  const skipped = {};
  // The workbook's schema: a custom document property tools/xlsx writes (none: the current one).
  const prop = all_(xml_(text('docProps/custom.xml')), 'property').find(p => String(p.a.name).trim().toLowerCase() === SCHEMA_PROPERTY.toLowerCase());
  const said = prop ? Math.floor(Number((prop.c[0] || {}).t)) : 0; // <vt:i4>2</vt:i4>, say
  const schema = said > 0 ? said : schema_();
  const tabs = all_(xml_(text('xl/workbook.xml')), 'sheet').map(s => {
    const target = String(rels[s.a['r:id']] || '');
    const path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    if (!parts[path]) throw new Error('no ' + path + ' for tab ' + s.a.name);
    const tab = only && !only(s.a.name, schema) ? {} : sheetOf(path, s.a.name, skipped);
    tab.name = s.a.name;
    tab.hidden = !!s.a.state && s.a.state !== 'visible';
    return tab;
  });
  if (blobs.some(b => /^xl\/(media|drawings|richData)\//.test(b.getName()))) skipped['pictures'] = 1;
  return { tabs, skipped, schema };
}

// Excel's built-in number formats a game's workbook might use (ids it doesn't write out).
const BUILTIN_FORMATS = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'm/d/yyyy', 15: 'd-mmm-yy',
  16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0',
};

// Each cell style as {text, fmt (a number format other than General, or ''), bold, fill, wrap}.
// A fill given as a theme or palette color (not as RGB) is left out and listed in skipped.
function readStyles_(doc, skipped) {
  const fmts = {};
  all_(doc, 'numFmt').forEach(f => { fmts[f.a.numFmtId] = f.a.formatCode; });
  const fonts = kids_(first_(doc, 'fonts'), 'font').map(f => {
    const b = first_(f, 'b');
    return !!b && b.a.val !== '0' && b.a.val !== 'false';
  });
  const fills = kids_(first_(doc, 'fills'), 'fill').map(f => {
    const p = first_(f, 'patternFill');
    const fg = p && p.a.patternType === 'solid' && first_(p, 'fgColor');
    if (fg && !fg.a.rgb && (fg.a.theme != null || fg.a.indexed != null)) return 'theme';
    return fg && /^[0-9a-f]{8}$/i.test(fg.a.rgb || '') ? '#' + fg.a.rgb.slice(2) : null;
  });
  return kids_(first_(doc, 'cellXfs'), 'xf').map(x => {
    const al = first_(x, 'alignment');
    const text = x.a.numFmtId === '49' || fmts[x.a.numFmtId] === '@';
    const fmt = text ? '' : fmts[x.a.numFmtId] || BUILTIN_FORMATS[x.a.numFmtId] || '';
    let fill = fills[Number(x.a.fillId) || 0] || null;
    if (fill === 'theme') { skipped['fill colors given as theme colors'] = 1; fill = null; }
    return {
      text,
      fmt: /^general$/i.test(fmt) ? '' : fmt,
      bold: !!fonts[Number(x.a.fontId) || 0],
      fill,
      wrap: !!al && (al.a.wrapText === '1' || al.a.wrapText === 'true'),
    };
  });
}

function readSheet_(doc, shared, styles, skipped, name) {
  // Each part of a sheet sits at a known place under <worksheet>, so it's found there rather
  // than by walking the whole tree (every cell) once per part.
  const ws = kids_(doc, 'worksheet')[0] || doc;
  const under = (...path) => path.reduce((els, n) => els.reduce((out, el) => out.concat(kids_(el, n)), []), [ws]);
  const values = [];
  const cells = [];
  const plain = [];
  let width = 0;
  let r = 0;
  under('sheetData', 'row').forEach(row => {
    r = Number(row.a.r) || r + 1;
    let c = 0;
    kids_(row, 'c').forEach(cell => {
      const ref = /^([A-Z]+)(\d+)$/.exec(cell.a.r || '');
      c = ref ? colNum_(ref[1]) : c + 1;
      const style = styles[Number(cell.a.s) || 0] || {};
      const f = kids_(cell, 'f')[0];
      const v = kids_(cell, 'v')[0];
      let value;
      if (f && !f.t && f.a.t === 'shared') skipped['formulas filled down in Excel, kept as their values (' + name + ')'] = 1;
      if (f && f.t) value = '=' + f.t.replace(/_xl(fn|ws)\./g, ''); // Excel's marks on newer functions
      else if (cell.a.t === 'd') value = v ? v.t : ''; // an ISO date, kept as text
      else if (cell.a.t === 's') value = shared[Number(v && v.t)] || '';
      else if (cell.a.t === 'inlineStr') value = textOf_(kids_(cell, 'is')[0] || { c: [] });
      else if (cell.a.t === 'b') value = !!v && v.t === '1';
      else if (cell.a.t === 'str' || cell.a.t === 'e') value = v ? v.t : '';
      else value = v && v.t !== '' ? Number(v.t) : '';
      // Sheets would take "=…" as a formula and drop a leading ' (and, outside plain text, take
      // "+2" or "TRUE" as a number or a boolean); a leading ' keeps it as the text it was.
      // As the import compares it with the sheet (see plainOf_).
      while (plain.length < r) plain.push([]);
      plain[r - 1][c - 1] = f && f.t ? value : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
      if (typeof value === 'string' && !(f && f.t) && (/^[=']/.test(value) ||
          (!style.text && /^\s*([+-]?[\d.]|true\s*$|false\s*$)/i.test(value)))) value = "'" + value;
      while (values.length < r) { values.push([]); cells.push([]); }
      values[r - 1][c - 1] = value;
      cells[r - 1][c - 1] = style;
      width = Math.max(width, c);
    });
  });
  values.forEach((line, i) => {
    if (!plain[i]) plain[i] = [];
    for (let j = 0; j < width; j++) {
      if (plain[i][j] === undefined) plain[i][j] = '';
      if (line[j] === undefined) line[j] = '';
      if (!cells[i][j]) cells[i][j] = styles[0] || {};
    }
  });
  const cols = under('cols', 'col').map(c => ({
    min: Number(c.a.min), max: Number(c.a.max), width: c.a.customWidth === '1' || c.a.customWidth === 'true' ? Number(c.a.width) : 0,
    hidden: c.a.hidden === '1' || c.a.hidden === 'true',
  }));
  const pane = under('sheetViews', 'sheetView', 'pane').find(p => p.a.state === 'frozen' || p.a.state === 'frozenSplit');
  const validations = under('dataValidations', 'dataValidation').map(v => ({
    type: v.a.type || 'any', sqref: v.a.sqref || '', formula: (kids_(v, 'formula1')[0] || {}).t,
    strict: v.a.showErrorMessage === '1' || v.a.showErrorMessage === 'true',
    dropdown: v.a.showDropDown !== '1' && v.a.showDropDown !== 'true', // Excel's flag means "hide it"
  }));
  if (under('mergeCells', 'mergeCell').length) skipped['merged cells (' + name + ')'] = 1;
  if (under('conditionalFormatting').length) skipped['conditional formatting (' + name + ')'] = 1;
  const prot = under('sheetProtection')[0];
  const protect = prot && prot.a.sheet !== '0' && prot.a.sheet !== 'false' && Object.keys(prot.a).length
    ? { open: under('protectedRanges', 'protectedRange').map(p => p.a.sqref).join(' ').split(/\s+/).filter(Boolean) }
    : null;
  return {
    values, cells, plain, width, cols, validations, protect,
    frozenRows: pane ? Number(pane.a.ySplit) || 0 : 0,
    frozenCols: pane ? Number(pane.a.xSplit) || 0 : 0,
  };
}

function colNum_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64;
  return n;
}

/* ---------- a small XML reader, enough for the parts of an .xlsx ----------
 * xml_(text) -> the document as {n: local name, a: {attribute: value}, c: [children], t: text}.
 */
function xml_(s) {
  const root = { n: '', a: {}, c: [], t: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(String(s || '')))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.t += m[1]; continue; }
    if (m[6] !== undefined) { top.t += unescapeXml_(m[6]); continue; }
    if (!m[3]) continue; // a comment, declaration or processing instruction
    if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
    const el = { n: m[3].replace(/^[\w.-]+:/, ''), a: {}, c: [], t: '' };
    const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attr.exec(m[4]))) el.a[a[1]] = unescapeXml_(a[2] !== undefined ? a[2] : a[3]);
    top.c.push(el);
    if (!m[5]) stack.push(el);
  }
  return root;
}

function unescapeXml_(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k.charAt(0) === '#') return String.fromCodePoint(k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[k];
  });
}

function kids_(el, n) { return el ? el.c.filter(x => x.n === n) : []; }
// The first element named n under el, depth first; stops there.
function first_(el, n) {
  if (!el) return null;
  for (const x of el.c) {
    if (x.n === n) return x;
    const deeper = first_(x, n);
    if (deeper) return deeper;
  }
  return null;
}
function all_(el, n, out) {
  out = out || [];
  (el ? el.c : []).forEach(x => { if (x.n === n) out.push(x); all_(x, n, out); });
  return out;
}

// A shared or inline string: its <t> runs, without phonetic hints, and _xHHHH_ escapes undone.
function textOf_(el) {
  let s = '';
  (function walk(x) { x.c.forEach(k => { if (k.n === 't') s += k.t; else if (k.n !== 'rPh') walk(k); }); })(el);
  return s.replace(/_x([0-9a-f]{4})_/gi, (all, h) => String.fromCharCode(parseInt(h, 16)));
}

const REPLACE_DIALOG_HTML = `<!doctype html>
<style>
  body { font: 14px/1.4 Arial, sans-serif; margin: 0; }
  p { margin: 0 0 12px; }
  label { display: block; margin: 0 0 8px; }
  h4 { margin: 12px 0 6px; font-size: 13px; color: #555; }
  #tabs { max-height: 230px; overflow-y: auto; }
  #conflicts { max-height: 300px; overflow-y: auto; }
  #tabs label { margin: 0 0 4px; }
  #tabs label.all { font-weight: bold; }
  .note { color: #777; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  button { font: inherit; padding: 6px 14px; }
  #go { background: #c5221f; color: #fff; border: 0; border-radius: 4px; }
  #go:disabled { background: #ccc; }
  #msg { min-height: 1.4em; margin-top: 12px; }
  .err { color: #c5221f; }
  .conflict { border-top: 1px solid #ddd; padding: 6px 0; }
  .conflict b { display: block; }
  .conflict table { border-collapse: collapse; font-size: 12px; margin: 4px 0; }
  .conflict td { padding: 1px 6px 1px 0; vertical-align: top; white-space: pre-wrap; }
  .conflict label { display: inline; margin-right: 12px; }
  .bulk { display: flex; gap: 8px; margin: 0 0 6px; }
  .bulk button { padding: 2px 8px; font-size: 12px; }
</style>
<p>Brings in the ticked tabs from an .xlsx file, adding any this sheet doesn't have. With
<b>Keep this sheet's changes</b>, rows added, edited or removed here since the last import stay as
they are, and where both changed you choose. Import lists every change first. Without it, each
ticked tab is replaced whole. The
Images tab is never touched. <b>File → Version history</b> can undo it.</p>
<label><input type="file" id="file" accept=".xlsx"></label>
<label><input type="checkbox" id="merge" checked> Keep this sheet's changes</label>
<div id="tabs"></div>
<div id="conflicts"></div>
<p id="msg"></p>
<div class="row">
  <button id="cancel" onclick="google.script.host.close()">Cancel</button>
  <button id="go" disabled>Import</button>
</div>
<script>
  const file = document.getElementById('file');
  const tabs = document.getElementById('tabs');
  const conflicts = document.getElementById('conflicts');
  const merge = document.getElementById('merge');
  const go = document.getElementById('go');
  const msg = document.getElementById('msg');
  let data = null;
  const ticked = kind => [...tabs.querySelectorAll('input[data-kind="' + kind + '"]:checked')].map(i => i.value);
  const ready = () => {
    const all = tabs.querySelector('#all');
    const boxes = [...tabs.querySelectorAll('input[data-kind="file"]')];
    if (all) {
      all.checked = boxes.every(b => b.checked);
      all.indeterminate = !all.checked && boxes.some(b => b.checked);
    }
    go.disabled = !(data && ticked('file').length);
  };
  // A new choice of tabs or mode asks the sheet again, so conflicts shown so far no longer hold.
  let reviewed = false; // whether the list below is what the next Import does
  const reset = () => { conflicts.replaceChildren(); tabs.hidden = false; reviewed = false; go.textContent = 'Import'; ready(); };
  merge.onchange = reset;
  const say = (text, err) => { msg.className = err ? 'err' : ''; msg.textContent = text; };
  const fail = text => { say(text, true); ready(); };
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const box = (kind, name, text, on) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    input.checked = on;
    input.dataset.kind = kind;
    input.onchange = reset;
    label.append(input, ' ' + name + ' ', el('span', text, 'note'));
    return label;
  };
  // A row's cells as here and in the file.
  const cellTable = cells => {
    const table = el('table');
    const head = el('tr');
    head.append(el('td'), el('td', 'Here', 'note'), el('td', 'File', 'note'));
    table.append(head);
    cells.forEach(x => {
      const tr = el('tr');
      tr.append(el('td', x.col, 'note'), el('td', x.here), el('td', x.file));
      table.append(tr);
    });
    return table;
  };
  // What the import will do, before it does it: each conflict, with a choice (this sheet's,
  // picked, or the file's), then every other change.
  const showReview = res => {
    tabs.hidden = true; // the choice of tabs this is for; unticking Keep goes back to it
    reviewed = true;
    conflicts.replaceChildren();
    if (res.conflicts.length) showConflicts(res.conflicts);
    conflicts.append(el('h4', res.changes.length ? 'What will change' : 'Nothing will change'));
    res.changes.forEach(c => {
      const div = el('div', '', 'conflict change');
      div.append(el('b', c.row ? c.tab + ' · ' + c.row : c.tab), el('span', c.what, 'note'));
      if (c.cells.length) div.append(cellTable(c.cells));
      conflicts.append(div);
    });
    go.textContent = res.conflicts.length ? 'Import with these choices' : 'Import these changes';
  };
  // Each conflict, with what each side has, and a choice: this sheet's (picked) or the file's.
  const showConflicts = list => {
    conflicts.append(el('h4', 'Changed both here and in the file: pick which to keep'));
    const bulk = el('div', '', 'bulk');
    const all = (side, text) => {
      const b = el('button', text);
      b.onclick = () => conflicts.querySelectorAll('input[value="' + side + '"]').forEach(r => { r.checked = true; });
      return b;
    };
    bulk.append(all('sheet', 'All: this sheet’s'), all('file', 'All: the file’s'));
    conflicts.append(bulk);
    list.forEach((c, i) => {
      const div = el('div', '', 'conflict');
      div.dataset.id = c.id;
      div.append(el('b', c.tab + ' · ' + c.row), el('span', c.what, 'note'), cellTable(c.cells));
      [['sheet', 'Keep this sheet’s'], ['file', 'Use the file’s']].forEach(([side, text]) => {
        const label = el('label');
        const r = document.createElement('input');
        r.type = 'radio';
        r.name = 'c' + i;
        r.value = side;
        r.checked = side === 'sheet';
        label.append(r, ' ' + text);
        div.append(label);
      });
      conflicts.append(div);
    });
  };
  const resolve = () => {
    const out = {};
    conflicts.querySelectorAll('.conflict[data-id]').forEach(d => { out[d.dataset.id] = d.querySelector('input:checked').value; });
    return out;
  };
  const summary = m => {
    const parts = [];
    if (m.added) parts.push(m.added + ' added');
    if (m.updated) parts.push(m.updated + ' updated');
    if (m.removed) parts.push(m.removed + ' removed');
    if (m.kept) parts.push('kept ' + m.kept + ' of this sheet’s changes');
    return m.tab + ': ' + (parts.join(', ') || 'no changes');
  };
  file.onchange = () => {
    data = null;
    tabs.replaceChildren();
    reset();
    const f = file.files[0];
    if (!f) return;
    if (f.size > ${MAX_XLSX_BYTES}) return fail('That file is too big (over ' + ${MAX_XLSX_BYTES / 1024 / 1024} + ' MB).');
    say('Reading the file…');
    const reader = new FileReader();
    reader.onerror = () => fail('Couldn’t read that file.');
    reader.onload = () => {
      const b64 = String(reader.result).split(',')[1] || '';
      google.script.run
        .withSuccessHandler(res => {
          if (!res || !res.ok) return fail((res && res.error) || 'Something went wrong.');
          data = b64;
          tabs.append(el('h4', 'Tabs in the file'));
          const all = box('all', 'All', '', true);
          all.className = 'all';
          all.querySelector('input').id = 'all';
          all.querySelector('input').onchange = e => {
            tabs.querySelectorAll('input[data-kind="file"]').forEach(b => { b.checked = e.target.checked; });
            reset();
          };
          tabs.append(all);
          res.file.forEach(t => tabs.append(box('file', t.name, t.exists ? '(updates this sheet’s)' : '(new tab)', true)));
          if (res.sheetOnly.length) {
            tabs.append(el('h4', 'Tabs only in this sheet: tick to remove'));
            res.sheetOnly.forEach(n => tabs.append(box('remove', n, '', false)));
          }
          say('');
          ready();
        })
        .withFailureHandler(err => fail(String(err && err.message || err)))
        .listXlsxTabs(f.name, b64);
    };
    reader.readAsDataURL(f);
  };
  go.onclick = () => {
    go.disabled = true;
    // Keeping this sheet's changes, the first Import only lists what it would do.
    const review = merge.checked && !reviewed;
    say(review ? 'Comparing with this sheet…' : 'Importing… this can take a minute.');
    google.script.run
      .withSuccessHandler(res => {
        if (res && (res.code === 'review' || res.code === 'conflicts')) {
          showReview(res);
          if (res.code === 'conflicts' && !review) return fail(res.error); // the sheet changed since the list
          say(res.conflicts.length ? 'Nothing has changed yet. Pick which to keep, then import.' : 'Nothing has changed yet.');
          return ready();
        }
        if (!res || !res.ok) return fail((res && res.error) || 'Something went wrong.');
        conflicts.replaceChildren();
        tabs.hidden = false;
        reviewed = false;
        go.textContent = 'Import';
        let text = 'Done: ' + res.tabs.join(', ') + '.';
        if (res.merged && res.merged.length) text += ' ' + res.merged.map(summary).join('. ') + '.';
        if (res.removed && res.removed.length) text += ' Removed: ' + res.removed.join(', ') + '.';
        if (res.skipped && res.skipped.length) text += ' Left out: ' + res.skipped.join('; ') + '.';
        say(text);
        if (!(res.skipped && res.skipped.length) && !(res.merged && res.merged.length)) setTimeout(() => google.script.host.close(), 1500);
      })
      .withFailureHandler(err => fail(String(err && err.message || err)))
      .replaceWithXlsx(file.files[0].name, data, { tabs: ticked('file'), remove: ticked('remove'), merge: merge.checked, resolve: resolve(), review });
  };
</script>`;
