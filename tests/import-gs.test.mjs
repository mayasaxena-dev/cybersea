// Unit tests for apps-script/Import.gs (the Cybersea menu's Import an xlsx…), run against
// tools/gas-fake.mjs with .xlsx files built by tests/fixtures/xlsx.mjs. Rules text here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, loadCodeGs } from '../tools/gas-fake.mjs';
import { makeXlsx } from './fixtures/xlsx.mjs';

const H = ['Kind', 'Name', 'Value', 'Notes'];
const RULES = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'];

function setup() {
  const gas = createGas({
    name: 'Cybersea',
    props: { GM_KEY: 'gm-pass' },
    tabs: {
      Rules: [RULES, ['move', 'basic', 'POKE', 'Old text.', '', 'crew']],
      Nexa: [H, ['info', 'Name', 'Nexa', '']],
      Old: [H, ['note', 'Gone soon', '', '']],
    },
  });
  gas.docProps['gone:nexa'] = '{"x":[1,"s"]}';
  gas.docProps.other = 'kept';
  const api = loadCodeGs(gas);
  const { ctx } = api;
  const sheet = name => gas.ss.getSheetByName(name);
  const replace = (tabs, opts, choice) => ctx.replaceWithXlsx('cybersea.xlsx', makeXlsx(tabs, opts).toString('base64'), choice);
  const list = tabs => ctx.listXlsxTabs('cybersea.xlsx', makeXlsx(tabs).toString('base64'));
  // _Import (what the last import brought in) is checked on its own.
  return { gas, api, ctx, sheet, replace, list, names: () => gas.ss.getSheets().map(s => s.getName()).filter(n => n !== '_Import') };
}

const FRESH = [
  { name: 'README', header: false, style: 0, rows: [['Read me & <enjoy>']], cols: [{ min: 1, max: 1, width: 120 }] },
  {
    name: 'Rules', inline: true, freeze: { rows: 1 }, cols: [{ min: 1, max: 1, width: 12 }, { min: 4, max: 4, width: 90 }],
    rows: [RULES, ['move', 'basic', 'POKE', 'New text.', '', 'crew'], ['move', 'basic', 'PROD', 'Roll +2 when\nyou “prod”.', '', 'crew']],
  },
  { name: 'Nexa', freeze: { rows: 1 }, rows: [H, ['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', '+2', ''], ['note', 'Typed', '=1+1', "'quoted"]] },
  { name: '_Overrides', hidden: true, rows: [['scratch']] },
];

test('replaces every tab with the file’s, in its order, and the site reads the new rows', () => {
  const { api, replace, names, gas } = setup();
  const res = replace(FRESH);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual([...res.tabs], ['README', 'Rules', 'Nexa', '_Overrides']);
  assert.deepEqual([...res.skipped], []);
  assert.deepEqual(names(), ['README', 'Rules', 'Nexa', '_Overrides']);
  assert.equal(gas.ss.getName(), 'Cybersea', 'the spreadsheet keeps its name');

  const read = api.call({ key: 'gm-pass', op: 'read', tabs: '*' });
  assert.equal(read.ok, true);
  assert.deepEqual(read.tabs.Rules.rows.map(r => r[3]), ['New text.', 'Roll +2 when\nyou “prod”.']);
  assert.deepEqual(read.tabs.Nexa.rows.slice(1).map(r => r.slice(0, 4)), [
    ['stat', 'Spitfire', '+2', ''],
    ['note', 'Typed', '=1+1', "'quoted"],
  ], 'plain text stays as typed: no numbers, formulas or dropped quotes');
  assert.equal(read.tabs.Old, undefined);
});

test('keeps formatting, widths, frozen rows, hidden tabs and columns', () => {
  const { replace, sheet } = setup();
  const res = replace([
    ...FRESH.slice(0, 3),
    { name: 'Lore', freeze: { rows: 1, cols: 1 }, cols: [{ min: 2, max: 3, width: 20, hidden: true }],
      rows: [[...H, 'Image'], ['place', 'Port', { v: 'A port.', s: 3 }, '', { f: 'IMAGE("https://example.com/a.png")' }], ['n', 'Count', { v: 7, s: 0 }, { v: true, s: 0 }, '']] },
    FRESH[3],
  ]);
  assert.equal(res.ok, true, res.error);
  const rules = sheet('Rules');
  assert.equal(rules.getFrozenRows(), 1);
  assert.equal(rules.getColumnWidth(4), 90 * 7 + 5);
  assert.equal(rules.getRange(1, 1).getNumberFormat(), 'General', 'the header row is bold, not plain text');
  assert.equal(rules.cell(1, 1).bold, true);
  assert.equal(rules.cell(1, 1).bg, '#E8EEF3');
  assert.equal(rules.getRange(2, 4).getNumberFormat(), '@');
  assert.equal(sheet('README').getColumnWidth(1), 120 * 7 + 5);
  assert.equal(sheet('README').getRange(1, 1).getDisplayValue(), 'Read me & <enjoy>');
  assert.equal(sheet('_Overrides').isSheetHidden(), true);
  assert.equal(rules.isSheetHidden(), false);

  const lore = sheet('Lore');
  assert.equal(lore.getFrozenColumns(), 1);
  assert.equal(lore.isColumnHiddenByUser(2) && lore.isColumnHiddenByUser(3), true);
  assert.equal(lore.isColumnHiddenByUser(4), false);
  assert.equal(lore.cell(2, 3).wrap, true);
  assert.deepEqual(lore.getRange(2, 5).getFormulas(), [['=IMAGE("https://example.com/a.png")']]);
  assert.deepEqual(lore.getRange(3, 3, 1, 2).getValues(), [[7, true]]);
});

test('keeps list data validation, and says what it left out', () => {
  const { replace, sheet } = setup();
  const res = replace([
    FRESH[1],
    { name: 'Map', merge: 'A1:B1', rows: [['Region', 'Shown'], ['Vega', 'on']], validations: [
      { sqref: 'B2:B5 D2', formula: '"on"', strict: true },
      { sqref: 'C2:C5', formula: '"a,b, c"' },
      { sqref: 'E2', formula: '0', type: 'whole' },
    ] },
  ]);
  assert.equal(res.ok, true, res.error);
  const map = sheet('Map');
  assert.deepEqual(map.getRange('B5').getDataValidation().list, ['on', 'static'], 'setUpChecks\'s Shown check, set after the import\'s own');
  assert.deepEqual(map.getRange('D2').getDataValidation().list, ['on']);
  assert.deepEqual(map.getRange('C2').getDataValidation(), { list: ['a', 'b', 'c'], dropdown: true, allowInvalid: true });
  assert.equal(map.getRange('C6').getDataValidation(), null);
  assert.equal(map.getRange('E2').getDataValidation(), null);
  assert.deepEqual([...res.skipped].sort(), ['data validation that isn’t a list of choices (Map E2)', 'merged cells (Map)']);
});

test('a protected sheet warns before an edit, locking no one out; its "allow edit" ranges left open', () => {
  const { replace, sheet } = setup();
  const res = replace([{ ...FRESH[1], protect: { open: ['G2:G5', 'B9'] } }, FRESH[2]]);
  assert.equal(res.ok, true, res.error);
  const [p] = sheet('Rules').getProtections('SHEET');
  assert.equal(p.isWarningOnly(), true);
  assert.match(p.getDescription(), /^Cybersea: /);
  assert.deepEqual([...p.getUnprotectedRanges()].map(r => [r.getSheet().getName(), r.getA1Notation()]), [['Rules', 'G2:G5'], ['Rules', 'B9']]);
  assert.deepEqual(sheet('Nexa').getProtections('SHEET'), []);
});

test('lists the file’s tabs, which the sheet has, and the sheet’s tabs the file lacks', () => {
  const { list } = setup();
  const res = list(FRESH);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(JSON.parse(JSON.stringify(res.file)), [
    { name: 'README', exists: false },
    { name: 'Rules', exists: true },
    { name: 'Nexa', exists: true },
    { name: '_Overrides', exists: false },
  ]);
  assert.deepEqual([...res.sheetOnly], ['Old']);
  assert.equal(list([{ name: 'Rules', rows: [['x']] }]).ok, true);
});

test('replaces only the ticked tabs, in their places; adds new ones at the end; keeps the rest', () => {
  const { api, replace, names, gas } = setup();
  const res = replace(FRESH, {}, { tabs: ['Nexa', '_Overrides'], remove: [] });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual([...res.tabs], ['Nexa', '_Overrides']);
  assert.deepEqual([...res.removed], []);
  assert.deepEqual(names(), ['Rules', 'Nexa', 'Old', '_Overrides']);
  const read = api.call({ key: 'gm-pass', op: 'read', tabs: '*' });
  assert.deepEqual(read.tabs.Rules.rows.map(r => r[3]), ['Old text.'], 'Rules was not ticked');
  assert.equal(read.tabs.Nexa.rows.find(r => r[0] === 'stat')[2], '+2');
  assert.equal(read.tabs.Old.rows[0][1], 'Gone soon');
  assert.equal(gas.docProps['gone:nexa'], undefined, 'Nexa’s removed rows are forgotten');
  assert.equal(gas.docProps.other, 'kept');
});

test('removes the ticked tabs the file lacks, and only those', () => {
  const { replace, names } = setup();
  const res = replace(FRESH, {}, { tabs: ['Rules'], remove: ['Old', 'README'] });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual([...res.removed], ['Old']);
  assert.deepEqual(names(), ['Rules', 'Nexa']);
});

test('turns down a choice with no tabs, or one that leaves no Rules tab', () => {
  const { replace, names } = setup();
  const before = names();
  const none = replace(FRESH, {}, { tabs: [], remove: ['Old'] });
  assert.equal(none.ok, false);
  assert.match(none.error, /Tick at least one tab/);
  const noRules = replace([FRESH[2]], {}, { tabs: ['Nexa'], remove: ['Rules'] });
  assert.equal(noRules.ok, false);
  assert.match(noRules.error, /no Rules tab/);
  assert.equal(replace([FRESH[2]], {}, { tabs: ['Nexa'], remove: [] }).ok, true, 'the sheet’s own Rules tab stays');
  assert.deepEqual(names(), before);
});

test('forgets rows remembered as removed from the old tabs, and nothing else', () => {
  const { replace, gas } = setup();
  replace(FRESH);
  assert.equal(gas.docProps['gone:nexa'], undefined);
  assert.equal(gas.docProps.other, 'kept');
});

test('turns down a file with no Rules tab, a file that isn’t an xlsx, and others, without changing anything', () => {
  const { ctx, replace, names } = setup();
  const before = names();
  const res = replace([{ name: 'Sheet1', rows: [['a']] }]);
  assert.equal(res.ok, false);
  assert.match(res.error, /no Rules tab/);
  const junk = ctx.replaceWithXlsx('cybersea.xlsx', Buffer.from('not a zip').toString('base64'));
  assert.equal(junk.ok, false);
  assert.match(junk.error, /doesn’t look like an \.xlsx/);
  assert.equal(ctx.replaceWithXlsx('notes.csv', makeXlsx(FRESH).toString('base64')).ok, false);
  assert.equal(ctx.replaceWithXlsx('empty.xlsx', '').ok, false);
  assert.deepEqual(names(), before);
});

test('turns down a file too big, or one that would unpack to far more than a workbook, before unpacking it', () => {
  const { ctx, names } = setup();
  const before = names();
  assert.match(ctx.replaceWithXlsx('big.xlsx', 'A'.repeat(8 * 1024 * 1024)).error, /too big/);
  const zip = makeXlsx(FRESH);
  // Claim the first part unpacks to 2 GB, in the zip's central directory.
  let end = zip.length - 22;
  while (zip.readUInt32LE(end) !== 0x06054b50) end--;
  zip.writeUInt32LE(0x7fffffff, zip.readUInt32LE(end + 16) + 24);
  assert.match(ctx.replaceWithXlsx('bomb.xlsx', zip.toString('base64')).error, /unpacks to far more/);
  assert.match(ctx.replaceWithXlsx('junk.xlsx', Buffer.from('not a zip at all').toString('base64')).error, /doesn’t look like an \.xlsx/);
  assert.deepEqual(names(), before);
});

test('listing a file\'s tabs reads none of their cells, shared strings or styles', () => {
  const { gas, ctx } = setup();
  const unzip = gas.services.Utilities.unzip;
  const read = [];
  ctx.Utilities = { ...gas.services.Utilities, unzip: b => unzip(b).map(x => ({ ...x, getDataAsString: () => { read.push(x.getName()); return x.getDataAsString(); } })) };
  const r = ctx.listXlsxTabs('cybersea.xlsx', makeXlsx(FRESH).toString('base64'));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(read.filter(n => !/workbook/.test(n)), []);
});

test('formulas Excel filled down, newer functions, dates and theme colors: kept, or listed', () => {
  const { replace, sheet } = setup();
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const styles = `<?xml version="1.0"?><styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="1"><font/></fonts><fills count="3"><fill><patternFill/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4"/></patternFill></fill></fills>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="49" fontId="0" fillId="0"/><xf numFmtId="164" fontId="0" fillId="0"/><xf numFmtId="14" fontId="0" fillId="2"/></cellXfs></styleSheet>`;
  const r = replace([FRESH[1], {
    name: 'Calc', header: false, style: 0,
    rows: [
      [{ raw: ref => `<c r="${ref}"><f t="shared" ref="A1:A2" si="0">1+1</f><v>2</v></c>` }, { raw: ref => `<c r="${ref}"><f>_xlfn.CONCAT("a","b")</f><v>ab</v></c>` }],
      [{ raw: ref => `<c r="${ref}"><f t="shared" si="0"/><v>2</v></c>` }, { raw: ref => `<c r="${ref}" t="d"><v>2024-05-01T00:00:00</v></c>` }],
      [{ v: 45413, s: 2 }, { v: 45413, s: 3 }],
    ],
  }], { extra: { 'xl/styles.xml': styles } });
  assert.equal(r.ok, true, r.error);
  const calc = sheet('Calc');
  assert.equal(calc.getRange(1, 1).getFormulas()[0][0], '=1+1');
  assert.equal(calc.getRange(1, 2).getFormulas()[0][0], '=CONCAT("a","b")', 'no _xlfn. mark');
  assert.equal(calc.getRange(2, 1).getValue(), 2, 'a filled-down formula keeps its value');
  assert.equal(calc.getRange(2, 2).getDisplayValue(), '2024-05-01T00:00:00', 'an ISO date stays as written');
  assert.equal(calc.getRange(3, 1).getNumberFormat(), 'yyyy-mm-dd');
  assert.equal(calc.getRange(3, 2).getNumberFormat(), 'm/d/yyyy', 'a built-in date format');
  assert.ok(r.skipped.some(x => /filled down in Excel.*Calc/.test(x)), r.skipped.join('; '));
  assert.ok(r.skipped.some(x => /theme colors/.test(x)), r.skipped.join('; '));
});

test('if a tab can’t be filled in, the old tabs stay as they were', () => {
  const { replace, names } = setup();
  const before = names();
  const rows = [H, ...Array.from({ length: 1200 }, (_, i) => ['note', `Row ${i}`, '', ''])];
  assert.throws(() => replace([FRESH[1], { name: 'Huge', rows }]), /1000 rows/);
  assert.deepEqual(names(), before);
});

test('the site never sees the tabs an import is still filling in', () => {
  const { api, ctx, replace } = setup();
  const fill = ctx.fillSheet_;
  const seen = [];
  ctx.fillSheet_ = (sh, t, skipped) => {
    fill(sh, t, skipped);
    seen.push(...api.call({ op: 'read', tabs: [] }).list.map(x => x.name));
  };
  replace(FRESH);
  assert.ok(seen.length);
  assert.deepEqual(seen.filter(n => /import/i.test(n)), []);
});

test('a write Sheets turns down late still names its tab and leaves the old tabs', () => {
  const { gas, replace, names, sheet } = setup();
  const before = names();
  gas.onFlush = () => { if (sheet('_overrides') || gas.ss.getSheets().some(s => /_importing 4/.test(s.getName()))) throw new Error('Service error'); };
  assert.throws(() => replace(FRESH), /Service error \(the _Overrides tab\)/);
  assert.deepEqual(names(), before);
});

test('a file whose tabs are all hidden still imports, with one tab left showing', () => {
  const { replace, names, sheet } = setup();
  const hidden = FRESH.filter(t => t.name !== 'README').map(t => ({ ...t, hidden: true }));
  const r = replace(hidden);
  assert.equal(r.ok, true);
  assert.deepEqual(names(), ['Rules', 'Nexa', '_Overrides']);
  assert.equal(names().filter(n => !sheet(n).isSheetHidden()).length, 1);
  assert.ok(r.skipped.some(x => /hiding the _Overrides tab/.test(x)), r.skipped.join());
});

test('a check or format Sheets turns down is listed, not fatal; a value it turns down names the tab', () => {
  const { ctx, replace, names, sheet } = setup();
  ctx.guard_ = () => { throw new Error('Invalid argument'); };
  ctx.SpreadsheetApp.newDataValidation = () => { throw new Error('Invalid argument'); };
  const res = replace([{ ...FRESH[1], validations: [{ sqref: 'F2:F9', formula: '"crew,gm"' }] }, FRESH[2]]);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual([...res.skipped].sort(), [
    'data validation (Rules F2:F9): Invalid argument',
    'the site’s checks on the Nexa tab: Invalid argument',
    'the site’s checks on the Rules tab: Invalid argument',
  ]);
  assert.equal(sheet('Rules').getRange(2, 4).getDisplayValue(), 'New text.');

  const before = names();
  const rows = [H, ...Array.from({ length: 1200 }, (_, i) => ['note', `Row ${i}`, '', ''])];
  assert.throws(() => replace([FRESH[1], { name: 'Huge', rows }]), /\(the Huge tab\)$/);
  assert.deepEqual(names(), before);
});

test('waits for the site’s writes: a busy sheet is turned down', () => {
  const { ctx, replace, names } = setup();
  const lock = ctx.LockService.getScriptLock();
  lock.tryLock();
  const before = names();
  const res = replace(FRESH);
  lock.releaseLock();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'busy');
  assert.deepEqual(names(), before);
});

test('the site can still save while the new tabs are being filled in', () => {
  const { api, ctx, replace } = setup();
  const fill = ctx.fillSheet_;
  const saves = [];
  ctx.fillSheet_ = (sh, t, skipped) => {
    fill(sh, t, skipped);
    saves.push(api.call({ op: 'patch', tab: 'Old', set: [['note', 'Saved', 'yes', '']] }).ok);
  };
  assert.equal(replace(FRESH.slice(1, 3)).ok, true);
  assert.ok(saves.length && saves.every(Boolean), saves.join());
});

test('adds the Cybersea menu when the spreadsheet opens', () => {
  const { ctx } = setup();
  const items = [];
  let added = false;
  ctx.SpreadsheetApp.getUi = () => ({
    createMenu: name => {
      assert.equal(name, 'Cybersea');
      const m = { addItem: (label, fn) => { items.push([label, fn]); return m; }, addToUi: () => { added = true; } };
      return m;
    },
  });
  ctx.onOpen();
  assert.equal(added, true);
  assert.deepEqual(items, [['Import an xlsx…', 'showReplaceDialog'], ['Update the script', 'updateScript']]);
  for (const [, fn] of items) assert.equal(typeof ctx[fn], 'function');
});

test('the new tabs get the checks setUpChecks makes', () => {
  const { replace, gas } = setup();
  replace(FRESH);
  const sheet = n => gas.ss.getSheetByName(n);
  for (const n of ['Rules', 'README']) assert.ok(sheet(n).getProtections('SHEET')[0]?.isWarningOnly(), n);
  assert.equal(sheet('Nexa').getProtections('SHEET').length, 0, 'players’ tabs stay open');
  assert.ok(sheet('Nexa').getRange('C2').getDataValidation()?.formula, 'Value checks on a character tab');
  assert.equal(sheet('_Overrides').validations.length, 0);
});

test('never replaces or removes the Images tab; a file’s Images tab comes in only when the sheet has none', () => {
  const { replace, list, names, sheet, gas } = setup();
  const IMAGES = { name: 'Images', rows: [['Name', 'Image'], ['From the file', '']] };
  // The first import makes it.
  let res = replace([...FRESH, IMAGES]);
  assert.equal(res.ok, true, res.error);
  assert.ok(names().includes('Images'));
  // Then a picture is added in Sheets, and later imports leave the tab alone.
  sheet('Images').getRange(3, 1, 1, 2).setValues([['Haven', { image: { type: 'image/png', bytes: Buffer.from([1, 2]) } }]]);
  const listed = list([...FRESH, IMAGES]);
  assert.ok(!listed.file.some(t => t.name === 'Images'), 'not offered from the file');
  assert.ok(!listed.sheetOnly.includes('Images'), 'nor offered for removal');
  res = replace([...FRESH, IMAGES]);
  assert.equal(res.ok, true, res.error);
  assert.ok(![...res.tabs].includes('Images'));
  res = replace(FRESH); // a whole-sheet replace by a file without one
  assert.equal(res.ok, true, res.error);
  assert.deepEqual([...res.removed], []);
  assert.equal(sheet('Images').getRange(3, 1).getDisplayValue(), 'Haven');
  assert.equal(replace(FRESH, {}, { tabs: ['Rules'], remove: ['Images'] }).removed.length, 0);
  assert.ok(gas.ss.getSheetByName('Images'));
});

test('filling a tab costs the same few Sheets round trips however many rows it has', () => {
  const cost = n => {
    const { replace, gas } = setup();
    const rows = [H, ...Array.from({ length: n }, (_, i) => ['log', `Entry ${i}`, 'x', ''])];
    const c = gas.ss.calls;
    const res = replace([FRESH[1], { name: 'Nexa', rows }]);
    assert.equal(res.ok, true, res.error);
    return gas.ss.calls - c;
  };
  const few = cost(5);
  assert.equal(cost(300), few, 'no call per row');
  assert.ok(few <= 40, `${few} calls`);
});

// A workbook made by openpyxl (tools/xlsx), as a real one is, not only the hand-built fixture.
// Skipped where Python or openpyxl isn't installed.
test('imports a workbook built by tools/xlsx with openpyxl, then mechanics.py', async t => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  try { execFileSync('python3', ['-I', '-c', 'import openpyxl']); } catch { t.skip('no python3 with openpyxl'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'cybersea-xlsx-'));
  const file = (name, data) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(data)); return p; };
  const rules = file('rules.json', [
    { kind: 'move', group: 'basic', name: 'POKE', text: 'When you poke, roll +SNARK.', meta: '', vis: 'crew' },
    { kind: 'playbook', group: '', name: 'Tester', text: 'Pokes things.', meta: '', vis: 'crew' },
  ]);
  const nexa = file('nexa.json', [['info', 'Name', 'Nexa', ''], ['stat', 'Snark', '+2', ''], ['jot', 'Notes', 'Owe Vex', '']]);
  const mech = file('mechanics.json', { rows: [{ kind: 'stat', group: 'character', name: 'Snark', text: '', meta: '' }], meta: [] });
  const built = join(dir, 'built.xlsx');
  const out = join(dir, 'game.xlsx');
  execFileSync('python3', ['-I', 'tools/xlsx/build.py', '--rules', rules, '--tab', `Nexa=${nexa}`, '--out', built]);
  execFileSync('python3', ['-I', 'tools/xlsx/mechanics.py', '--mechanics', mech, built, '--out', out]);

  const { api, ctx, names } = setup();
  assert.equal(ctx.openXlsx_('game.xlsx', readFileSync(out).toString('base64'), null).book.schema, 1, 'the schema build.py wrote');
  const res = ctx.replaceWithXlsx('game.xlsx', readFileSync(out).toString('base64'));
  assert.equal(res.ok, true, res.error);
  assert.ok(names().includes('System') && names().includes('Nexa'), names().join(', '));
  const read = api.call({ key: 'gm-pass', op: 'read', tabs: ['Rules', 'System', 'Nexa'] });
  assert.deepEqual(read.tabs.Rules.rows.map(r => r[2]), ['POKE', 'Tester']);
  assert.deepEqual(read.tabs.System.rows.map(r => r.slice(0, 3)), [['stat', 'character', 'Snark']]);
  assert.deepEqual(read.tabs.Nexa.rows.map(r => r.slice(0, 3)), [['info', 'Name', 'Nexa'], ['stat', 'Snark', '+2'], ['jot', 'Notes', 'Owe Vex']]);
});
