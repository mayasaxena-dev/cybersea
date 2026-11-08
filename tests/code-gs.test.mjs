// Unit tests for apps-script/Code.gs, run against tools/gas-fake.mjs.
// Rules text here is made up: real rulebook text never goes in the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, loadCodeGs } from '../tools/gas-fake.mjs';

const H = ['Kind', 'Name', 'Value', 'Notes'];
const KEYS = { GM_KEY: 'gm-pass' }; // no CREW_KEY: crew need no passphrase

function setup(opts = {}) {
  let t = 1_000_000;
  const gas = createGas({
    name: 'Cybersea',
    props: KEYS,
    now: () => t,
    tabs: {
      Rules: [
        ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'],
        ['move', 'basic', 'POKE', 'When you poke, roll +SNARK.', '', 'crew'],
        ['fate', 'move', 'LOOM', 'A secret for the GM.', '', 'gm'],
      ],
      Nexa: [H,
        ['info', 'Name', 'Nexa', ''],
        ['stat', 'Spitfire', '+2', ''],
        ['track', 'Harm', '●○○✕✕✕', ''],
        ['custom', 'Hand-added', '=1+1', 'a formula someone typed'],
      ],
      Lore: [H, ['place', 'Hacker’s Haven', 'A port.', '']],
      GM: [H, ['secret', 'Twist', 'The demon lies.', '']],
      Ship: [H],
      README: [['Read me']],
      _scratch: [['ignored']],
    },
    ...opts,
  });
  const api = loadCodeGs(gas);
  return { gas, api, tick: ms => { t += ms; } };
}

const crew = (api, body) => api.call({ ...body });
const gm = (api, body) => api.call({ key: 'gm-pass', ...body });
const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);

// A tab as a page would have it: rows, versions, and when the sheet read them.
function look(api, name, who = crew) {
  const r = who(api, { op: 'read', tabs: [name] });
  const t = r.tabs[name];
  return { ...t, at: r.at, ver: (kind, n) => { const i = t.rows.findIndex(x => x[0] === kind && x[1] === n); return i < 0 ? '' : t.vers[i]; } };
}

// What a change is based on, as the site sends it (see when_ in Code.gs).
let stamps = 0;
const newStamp = () => `stamp${String(++stamps).padStart(4, '0')}`;
const on = (base, seen, stamp = newStamp()) => ({ base, seen, stamp });

// Type into a row as someone would in Sheets; Sheets then runs onEdit (unless trigger is false,
// standing in for a change that bypasses it).
function byHand(gas, api, tab, rowNum, cells, { trigger = true } = {}) {
  const range = gas.ss.getSheetByName(tab).getRange(rowNum, 1, 1, cells.length);
  range.setValues([cells]);
  if (trigger) api.onEdit({ range });
}

test('ping works without a passphrase, GET otherwise refuses', () => {
  const { api } = setup();
  assert.deepEqual(api.doGet({ parameter: { op: 'ping' } }), { ok: true, v: 12 });
  assert.equal(api.doGet({ parameter: {} }).ok, false);
  assert.deepEqual(api.call({ op: 'ping' }), { ok: true, v: 12 });
});

test('explains missing passphrases', () => {
  const { api } = setup({ props: {} });
  const r = api.call({ op: 'read', key: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /GM_KEY/);
});

test('malformed bodies still come back as JSON errors', () => {
  const { api } = setup();
  const r = api.doPostRaw('{not json');
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.equal(crew(api, { op: 'nope' }).ok, false);
});

test('a crew passphrase is optional', () => {
  const { api } = setup({ props: { GM_KEY: 'gm-pass', CREW_KEY: 'crew-pass' } });
  const none = api.call({ op: 'read' });
  assert.equal(none.code, 'auth');
  assert.match(none.error, /needs a passphrase/);
  assert.equal(api.call({ op: 'read', key: 'crew-pass' }).role, 'crew');
  assert.equal(api.call({ op: 'read', key: 'nope' }).code, 'auth');
  assert.equal(gm(api, { op: 'read' }).crewKey, 'crew-pass');
  for (let i = 0; i < 12; i++) api.call({ op: 'read' });
  assert.equal(api.call({ op: 'read', key: 'crew-pass' }).ok, true, 'a missing passphrase isn’t a wrong guess');
});

test('wrong passphrases are refused, then throttled for a minute', () => {
  const { api, tick } = setup();
  for (let i = 0; i < 10; i++) assert.equal(api.call({ op: 'read', key: 'guess' + i }).code, 'auth');
  assert.equal(api.call({ op: 'read', key: 'guess10' }).code, 'throttled');
  tick(61_000);
  assert.equal(api.call({ op: 'read', key: 'guess11' }).code, 'auth');
});

test('wrong guesses never lock out the crew, or a GM who was already signed in', () => {
  const { api } = setup();
  assert.equal(gm(api, { op: 'read' }).role, 'gm');
  for (let i = 0; i < 12; i++) api.call({ op: 'read', key: 'guess' + i });
  assert.equal(crew(api, { op: 'read' }).role, 'crew', 'no passphrase, no guess');
  assert.equal(gm(api, { op: 'read' }).role, 'gm', 'the GM passphrase worked a moment ago');
});

test('while paused, even the right passphrase waits if it hasn’t worked lately', () => {
  const { api, gas } = setup();
  for (let i = 0; i < 10; i++) api.call({ op: 'read', key: 'guess' + i });
  assert.equal(gm(api, { op: 'read' }).code, 'throttled');
  gas.clearCache();
  assert.equal(gm(api, { op: 'read' }).role, 'gm');
});

test('crew reads everything except the GM tab and GM-only rules', () => {
  const { api } = setup();
  const r = crew(api, { op: 'read', tabs: '*' });
  assert.equal(r.ok, true);
  assert.equal(r.role, 'crew');
  assert.equal(r.game, 'Cybersea');
  assert.deepEqual(r.list.map(t => `${t.name}:${t.kind}`).sort(), ['Lore:lore', 'Nexa:character', 'Rules:rules', 'Ship:ship']);
  assert.equal(r.tabs.GM, undefined);
  assert.deepEqual(r.tabs.Rules.rows.map(x => x[2]), ['POKE']);
  assert.deepEqual(r.tabs.Nexa.rows[1], ['stat', 'Spitfire', '2', '']); // typed by hand into an unformatted cell
});

test('Rules rows carry the override columns, found by their headers, when the tab has them', () => {
  const plain = setup();
  assert.equal(crew(plain.api, { op: 'read', tabs: ['Rules'] }).tabs.Rules.rows[0].length, 6, 'no override columns: rows as before');
  const { api } = setup({
    tabs: {
      Rules: [
        ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis', 'Notes to self', 'Override text', 'Override name'],
        ['kit', 'Brute', 'Kit 1', 'Club, rope', '', 'crew', 'ignore me', 'Club, data cable', ''],
        ['location', 'places', 'Gull Rock', 'Gulls.', '', 'crew', '', '', 'Packet Reef'],
      ],
    },
  });
  const rows = crew(api, { op: 'read', tabs: ['Rules'] }).tabs.Rules.rows;
  assert.deepEqual(rows[0], ['kit', 'Brute', 'Kit 1', 'Club, rope', '', 'crew', '', 'Club, data cable', '']);
  assert.deepEqual(rows[1], ['location', 'places', 'Gull Rock', 'Gulls.', '', 'crew', 'Packet Reef', '', '']);
});

test('GM reads everything', () => {
  const { api } = setup();
  const r = gm(api, { op: 'read' });
  assert.equal(r.role, 'gm');
  assert.ok(r.tabs.GM);
  assert.deepEqual(r.tabs.Rules.rows.map(x => x[2]), ['POKE', 'LOOM']);
  assert.equal(r.crewKey, '');
  assert.equal(crew(api, { op: 'read' }).crewKey, undefined);
});

test('digests skip unchanged tabs and notice direct sheet edits', () => {
  const { api, gas } = setup();
  const first = crew(api, { op: 'read', tabs: ['Nexa', 'Lore'] });
  assert.deepEqual(Object.keys(first.tabs).sort(), ['Lore', 'Nexa']);
  const have = { Nexa: first.tabs.Nexa.d, Lore: first.tabs.Lore.d };
  const second = crew(api, { op: 'read', tabs: ['Nexa', 'Lore'], have });
  assert.equal(second.tabs.Nexa.rows, undefined);
  assert.equal(second.tabs.Lore.rows, undefined);
  byHand(gas, api, 'Lore', 2, ['place', 'Hacker’s Haven', 'A busier port.', '']);
  const third = crew(api, { op: 'read', tabs: ['Nexa', 'Lore'], have });
  assert.equal(third.tabs.Nexa.rows, undefined);
  assert.equal(third.tabs.Lore.rows[0][2], 'A busier port.');
});

test('an unchanged tab is answered from its remembered digest, without reading it', () => {
  const { api, gas } = setup();
  const d = crew(api, { op: 'read', tabs: ['Nexa'] }).tabs.Nexa.d;
  const sh = gas.ss.getSheetByName('Nexa');
  const real = sh.getDataRange.bind(sh);
  let reads = 0;
  sh.getDataRange = () => { reads++; return real(); };
  for (let i = 0; i < 3; i++) assert.equal(crew(api, { op: 'read', tabs: ['Nexa'], have: { Nexa: d } }).tabs.Nexa.rows, undefined);
  assert.equal(reads, 0);
  assert.equal(gm(api, { op: 'read', tabs: ['Nexa'], have: { Nexa: d } }).tabs.Nexa.rows, undefined, 'each role reads once');
  assert.equal(reads, 1);
});

test('a write from the site, or by hand, is seen by the next read', () => {
  const { api, gas, tick } = setup();
  const d = crew(api, { op: 'read', tabs: ['Nexa'] }).tabs.Nexa.d;
  gm(api, { op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+3', '']] });
  const after = crew(api, { op: 'read', tabs: ['Nexa'], have: { Nexa: d } }).tabs.Nexa;
  assert.equal(row(after.rows, 'stat', 'Spitfire')[2], '+3');
  // An edit Sheets runs no onEdit for (deleting a row, say) shows within DIGEST_SECONDS.
  byHand(gas, api, 'Nexa', 3, ['stat', 'Spitfire', '+4', ''], { trigger: false });
  assert.equal(crew(api, { op: 'read', tabs: ['Nexa'], have: { Nexa: after.d } }).tabs.Nexa.rows, undefined);
  tick(61_000);
  assert.equal(row(crew(api, { op: 'read', tabs: ['Nexa'], have: { Nexa: after.d } }).tabs.Nexa.rows, 'stat', 'Spitfire')[2], '+4');
});

test('a read that overlaps a write never vouches for the rows from before it', () => {
  const { api, gas } = setup();
  const d = crew(api, { op: 'read', tabs: ['Nexa'] }).tabs.Nexa.d;
  gas.clearCache();
  const sh = gas.ss.getSheetByName('Nexa');
  const real = sh.getDataRange.bind(sh);
  let once = true;
  sh.getDataRange = () => { // the write lands while this read is reading
    const vals = real().getDisplayValues();
    if (once) { once = false; gm(api, { op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+5', '']] }); }
    return { getDisplayValues: () => vals };
  };
  crew(api, { op: 'read', tabs: ['Nexa'], have: { Nexa: 'stale' } });
  sh.getDataRange = real;
  const r = crew(api, { op: 'read', tabs: ['Nexa'], have: { Nexa: d } }).tabs.Nexa;
  assert.equal(row(r.rows, 'stat', 'Spitfire')[2], '+5');
});

test('patch updates, inserts grouped by kind, deletes, and leaves hand-added rows alone', () => {
  const { api, gas } = setup();
  const r = crew(api, {
    op: 'patch', tab: 'nexa', // tab names are matched case-insensitively
    set: [
      ['track', 'Harm', '●●○✕✕✕', ''],      // update
      ['info', 'Playbook', 'Mountebank', ''], // insert after the last info row
      ['bond', 'Ship', '●●·', ''],            // new kind: appended
    ],
    del: [['STAT', 'spitfire']],              // keys are case-insensitive
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map(x => `${x[0]}|${x[1]}|${x[2]}`), [
    'info|Name|Nexa',
    'info|Playbook|Mountebank',
    'track|Harm|●●○✕✕✕',
    'custom|Hand-added|#FORMULA =1+1',
    'bond|Ship|●●·',
  ]);
  // the formula typed into the sheet survived (only touched rows are written)
  const sh = gas.ss.getSheetByName('Nexa');
  assert.ok(sh.getRange(5, 3).getDisplayValues()[0][0].startsWith('#FORMULA'));
});

test('renames happen in place, before sets', () => {
  const { api } = setup();
  const r = crew(api, {
    op: 'patch', tab: 'Nexa',
    ren: [['track', 'Harm', 'Wounds'], ['info', 'Nobody', 'X'], ['info', 'Name', 'Name']],
    set: [['track', 'Wounds', '●●○✕✕✕', '']],
  });
  assert.deepEqual(r.rows.map(x => `${x[0]}|${x[1]}|${x[2]}`), [
    'info|Name|Nexa', 'stat|Spitfire|2', 'track|Wounds|●●○✕✕✕', 'custom|Hand-added|#FORMULA =1+1',
  ]);
});

test('patching is idempotent and returns a digest a read agrees with', () => {
  const { api, gas } = setup();
  const body = { op: 'patch', tab: 'Nexa', set: [['bond', 'Demon', '●●·', '']] };
  const a = crew(api, body);
  const edits = gas.ss.edits;
  const b = crew(api, body);
  assert.equal(b.d, a.d);
  assert.equal(gas.ss.edits, edits, 'an unchanged row is not rewritten');
  assert.equal(crew(api, { op: 'read', tabs: ['Nexa'] }).tabs.Nexa.d, a.d);
});

test('values that Sheets would mangle come back exactly as sent', () => {
  const { api } = setup();
  const tricky = ['=1+1', "'tis", '+2', '-1', '007', '1/2', 'TRUE', '- bullet\n  - nested', '●○✕·'];
  const r = crew(api, { op: 'patch', tab: 'Lore', set: tricky.map((v, i) => ['note', 'n' + i, v, v]) });
  const got = r.rows.filter(x => x[0] === 'note');
  assert.deepEqual(got.map(x => x[2]), tricky);
  assert.deepEqual(got.map(x => x[3]), tricky);
});

test('permissions: crew cannot write GM or Rules; GM can write GM but not Rules', () => {
  const { api } = setup();
  assert.equal(crew(api, { op: 'patch', tab: 'GM', set: [['note', 'x', 'y', '']] }).code, 'forbidden');
  assert.equal(crew(api, { op: 'patch', tab: 'Rules', set: [['move', 'x', 'y', '']] }).code, 'forbidden');
  assert.equal(gm(api, { op: 'patch', tab: 'Rules', set: [['move', 'x', 'y', '']] }).code, 'forbidden');
  assert.equal(gm(api, { op: 'patch', tab: 'GM', set: [['note', 'Session 3', 'Ambush at dawn', '']] }).ok, true);
  assert.equal(crew(api, { op: 'patch', tab: 'Nobody', set: [] }).code, 'missing');
  assert.equal(crew(api, { op: 'selftest' }).code, 'forbidden');
});

test('oversize cells are refused', () => {
  const { api } = setup();
  const r = crew(api, { op: 'patch', tab: 'Lore', set: [['note', 'big', 'x'.repeat(50001), '']] });
  assert.equal(r.ok, false);
  assert.match(r.error, /too long/);
});

test('create makes a character tab and validates names', () => {
  const { api, gas } = setup();
  const r = crew(api, { op: 'create', tab: 'Matt', rows: [['info', 'Name', 'Matt', ''], ['stat', 'Blood', '+1', '']] });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'character');
  assert.deepEqual(r.rows, [['info', 'Name', 'Matt', ''], ['stat', 'Blood', '+1', '']]);
  assert.equal(gas.ss.getSheetByName('Matt').frozen, 1);
  assert.equal(crew(api, { op: 'create', tab: 'matt' }).code, 'exists');
  assert.equal(crew(api, { op: 'create', tab: 'Rules' }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: 'GM' }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: '_hidden' }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: 'a/b' }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: 'x'.repeat(41) }).code, 'name');
  // later edits to the new tab keep text as text
  const p = crew(api, { op: 'patch', tab: 'Matt', set: [['stat', 'Polish', '-1', '']] });
  assert.deepEqual(p.rows.at(-1), ['stat', 'Polish', '-1', '']);
});

test('selftest reports every probe surviving the round trip', () => {
  const { api, gas } = setup();
  const r = gm(api, { op: 'selftest' });
  assert.equal(r.ok, true, JSON.stringify(r.results?.filter(x => !x.ok)));
  assert.equal(gas.ss.getSheetByName('_selftest'), null);
});

/* ---------- row versions ---------- */

test('every row has a version, kept in a hidden plain-text column', () => {
  const { api, gas } = setup();
  const a = look(api, 'Nexa');
  assert.equal(a.vers.length, a.rows.length);
  assert.ok(a.vers.every(v => v.startsWith('~')), 'rows never written by the site go by their contents');
  assert.equal(crew(api, { op: 'read', tabs: ['Rules'] }).tabs.Rules.vers, undefined);
  const again = look(api, 'Nexa');
  assert.deepEqual([again.d, again.vers], [a.d, a.vers]);

  const r = crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', '●●○✕✕✕', '', on([a.ver('track', 'Harm')], a.at)]] });
  assert.deepEqual(r.skipped, []);
  const b = look(api, 'Nexa');
  assert.deepEqual(b.rows, r.rows);
  assert.deepEqual(b.vers, r.vers);
  assert.match(b.ver('track', 'Harm'), /^stamp\d+$/, 'the row has the change’s stamp');
  assert.deepEqual(b.vers.filter((v, i) => i !== 2), a.vers.filter((v, i) => i !== 2), 'other rows keep theirs');

  const sh = gas.ss.getSheetByName('Nexa');
  assert.equal(sh.getRange(1, 5).getDisplayValues()[0][0], 'Version');
  assert.ok(sh.isColumnHiddenByUser(5));
  assert.equal(sh.cell(4, 5).fmt, '@');
  assert.equal(sh.cell(40, 5).fmt, '@', 'the whole column is plain text');
});

test('a change to a row that changed since is skipped, even if it has changed back', () => {
  const { api } = setup();
  const a = look(api, 'Nexa');
  // someone else changes Harm, then puts it back
  for (const v of ['●●●✕✕✕', '●○○✕✕✕']) {
    const b = look(api, 'Nexa');
    assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', v, '', on([b.ver('track', 'Harm')], b.at)]] }).skipped, []);
  }
  const r = crew(api, {
    op: 'patch', tab: 'Nexa', set: [
      ['track', 'Harm', '○○○✕✕✕', '', on([a.ver('track', 'Harm')], a.at)],
      ['stat', 'Spitfire', '+3', '', on([a.ver('stat', 'Spitfire')], a.at)],
    ],
  });
  assert.deepEqual(r.skipped, [['track', 'Harm']]);
  assert.equal(row(r.rows, 'track', 'Harm')[2], '●○○✕✕✕', 'the answer has the sheet’s row to show instead');
  assert.equal(row(r.rows, 'stat', 'Spitfire')[2], '+3', 'rows that didn’t change since still save');
});

test('edits made in Sheets count, with or without onEdit', () => {
  const { api, gas } = setup();
  const a = look(api, 'Nexa');
  const harmTo = (v, base) => crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', v, '', on([base], a.at)]] });
  // typed over and back by hand: onEdit stamps it each time
  byHand(gas, api, 'Nexa', 4, ['track', 'Harm', '●●●●●●']);
  byHand(gas, api, 'Nexa', 4, ['track', 'Harm', '●○○✕✕✕']);
  const b = look(api, 'Nexa');
  assert.notEqual(b.ver('track', 'Harm'), a.ver('track', 'Harm'));
  assert.notEqual(b.d, a.d, 'a new version alone is news to readers');
  assert.deepEqual(harmTo('○○○✕✕✕', a.ver('track', 'Harm')).skipped, [['track', 'Harm']]);

  // changed some way that skips onEdit: the row's hash no longer matches its stamp
  byHand(gas, api, 'Nexa', 4, ['track', 'Harm', '●●○✕✕✕'], { trigger: false });
  const c = look(api, 'Nexa');
  assert.match(c.ver('track', 'Harm'), /^~/);
  assert.deepEqual(harmTo('○○○✕✕✕', b.ver('track', 'Harm')).skipped, [['track', 'Harm']]);
  assert.deepEqual(harmTo('○○○✕✕✕', c.ver('track', 'Harm')).skipped, []);
});

test('onEdit leaves alone what the site doesn’t edit', () => {
  const { api, gas } = setup();
  const a = look(api, 'Nexa');
  for (const [tab, r, c] of [['Rules', 2, 1], ['README', 1, 1], ['_scratch', 1, 1], ['Nexa', 1, 1], ['Nexa', 4, 6]]) {
    api.onEdit({ range: gas.ss.getSheetByName(tab).getRange(r, c) });
  }
  assert.deepEqual(look(api, 'Nexa').vers, a.vers);
  assert.equal(gas.ss.getSheetByName('Rules').getLastColumn(), 6, 'no Version column on Rules');
  assert.equal(gas.ss.getSheetByName('README').getLastColumn(), 1);
});

test('a change sent again after it landed goes through quietly, and so does one made on top of it', () => {
  const { api, gas } = setup();
  const a = look(api, 'Nexa');
  const v0 = a.ver('track', 'Harm');
  const first = ['track', 'Harm', '●●○✕✕✕', '', on([v0], a.at, 'stamp1001')];
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [first] }).skipped, []);
  const edits = gas.ss.edits;
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [first] }).skipped, [], 'the page never heard back, so it sends it again');
  assert.equal(gas.ss.edits, edits, 'nothing to write');
  // a newer change, made before hearing back: based on the old version, or on what the first left
  const second = ['track', 'Harm', '●●●✕✕✕', '', on([v0, 'stamp1001'], a.at, 'stamp1002')];
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [second] }).skipped, []);
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [first] }).skipped, [['track', 'Harm']], 'but not the first again');
  assert.equal(row(look(api, 'Nexa').rows, 'track', 'Harm')[2], '●●●✕✕✕');
});

test('changes sent without versions (pages from before version 3) go ahead as before', () => {
  const { api } = setup();
  const a = look(api, 'Nexa');
  crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', '●●●✕✕✕', '', on([a.ver('track', 'Harm')], a.at)]] });
  const r = crew(api, { op: 'patch', tab: 'Nexa', ren: [['stat', 'Spitfire', 'Fire']], set: [['track', 'Harm', '○○○✕✕✕', ''], ['stat', 'Fire', '2', '']], del: [['info', 'Name']] });
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.rows.map(x => `${x[0]}|${x[1]}|${x[2]}`), ['stat|Fire|2', 'track|Harm|○○○✕✕✕', 'custom|Hand-added|#FORMULA =1+1']);
  assert.match(look(api, 'Nexa').ver('track', 'Harm'), /^[a-z0-9]+$/, 'stamped all the same');
});

test('deletes: a stale change neither brings a row back nor deletes a newer one', () => {
  const { api } = setup();
  const a = look(api, 'Nexa');
  const at = (kind, name) => on([a.ver(kind, name)], a.at);
  let b = look(api, 'Nexa');
  crew(api, { op: 'patch', tab: 'Nexa', del: [['track', 'Harm', on([b.ver('track', 'Harm')], b.at)]], set: [['stat', 'Spitfire', '+3', '', on([b.ver('stat', 'Spitfire')], b.at)]] });
  const r = crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', '●●●✕✕✕', '', at('track', 'Harm')]], del: [['stat', 'Spitfire', at('stat', 'Spitfire')], ['track', 'Harm', at('track', 'Harm')]] });
  assert.deepEqual(r.skipped, [['stat', 'Spitfire'], ['track', 'Harm']], 'deleting what’s gone already is no change');
  assert.equal(row(r.rows, 'track', 'Harm'), undefined);
  assert.equal(row(r.rows, 'stat', 'Spitfire')[2], '+3');
  // the page's own delete, unconfirmed, then the row added back: based on either
  b = look(api, 'Nexa');
  const del = on([b.ver('stat', 'Spitfire')], b.at);
  crew(api, { op: 'patch', tab: 'Nexa', del: [['stat', 'Spitfire', del]] });
  const back = crew(api, { op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+1', '', on([b.ver('stat', 'Spitfire'), del.stamp], b.at)]] });
  assert.deepEqual(back.skipped, []);
  assert.equal(row(back.rows, 'stat', 'Spitfire')[2], '+1');
});

test('a row taken away stays away: a stale change doesn’t bring it back', () => {
  const { api, gas, tick } = setup();
  // signing in adds the row; the page doesn't hear back, so it will send it again
  const a = look(api, 'Nexa');
  const signIn = ['signin', 'Signed in', 'yes', '', on([a.ver('signin', 'Signed in')], a.at)];
  assert.equal(signIn[4].base[0], '', 'no such row yet');
  crew(api, { op: 'patch', tab: 'Nexa', set: [signIn] });
  // the GM signs Nexa out by clearing the row in Sheets
  tick(1000);
  const sh = gas.ss.getSheetByName('Nexa');
  const at = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().findIndex(r => r[0] === 'signin') + 2;
  byHand(gas, api, 'Nexa', at, ['', '', '', '']);
  tick(1000);
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [signIn] }).skipped, [['signin', 'Signed in']]);
  assert.equal(row(look(api, 'Nexa').rows, 'signin', 'Signed in'), undefined);
  // a page that has seen it gone can sign in again
  tick(1000);
  const b = look(api, 'Nexa');
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [['signin', 'Signed in', 'yes', '', on([b.ver('signin', 'Signed in')], b.at)]] }).skipped, []);

  // the same when the row is deleted from the site, or typed over in Sheets
  const lore = look(api, 'Lore');
  const rumor = ['rumor', 'The Bell', 'rings', '', on([''], lore.at)];
  crew(api, { op: 'patch', tab: 'Lore', set: [rumor] });
  tick(1000);
  const c = look(api, 'Lore');
  crew(api, { op: 'patch', tab: 'Lore', del: [['rumor', 'The Bell', on([c.ver('rumor', 'The Bell')], c.at)]] });
  tick(1000);
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Lore', set: [rumor] }).skipped, [['rumor', 'The Bell']]);
  const place = ['place', 'The Reef', 'sharp', '', on([''], c.at)];
  crew(api, { op: 'patch', tab: 'Lore', set: [place] });
  tick(1000);
  byHand(gas, api, 'Lore', 3, ['place', 'The Shoal', 'sharp', '']);
  tick(1000);
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Lore', set: [place] }).skipped, [['place', 'The Reef']]);
});

test('renames are checked against the old name, and a skipped one keeps its new name off the sheet', () => {
  const { api } = setup();
  const a = look(api, 'Nexa');
  const renameHarm = w => ({ op: 'patch', tab: 'Nexa', ren: [['track', 'Harm', 'Wounds', w]], set: [['track', 'Wounds', '●○○✕✕✕', '', on([''], a.at)]] });
  // someone else changed Harm first
  const b = look(api, 'Nexa');
  crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', '●●○✕✕✕', '', on([b.ver('track', 'Harm')], b.at)]] });
  const r = crew(api, renameHarm(on([a.ver('track', 'Harm')], a.at)));
  assert.deepEqual(r.skipped, [['track', 'Harm'], ['track', 'Wounds']]);
  assert.deepEqual(r.rows.filter(x => x[0] === 'track').map(x => `${x[1]}|${x[2]}`), ['Harm|●●○✕✕✕']);

  // made to the current row: renamed in place; sending it again changes nothing
  const c = look(api, 'Nexa');
  const ok = renameHarm(on([c.ver('track', 'Harm')], c.at));
  ok.set[0][2] = '●●○✕✕✕';
  assert.deepEqual(crew(api, ok).skipped, []);
  const again = crew(api, ok);
  assert.deepEqual(again.skipped, []);
  assert.deepEqual(again.rows.map(x => x[1]), ['Name', 'Spitfire', 'Wounds', 'Hand-added']);
  assert.equal(look(api, 'Nexa').ver('track', 'Wounds'), ok.set[0][4].stamp, 'the row carries the set’s stamp');
});

test('renames of rows the sheet never had, and the old name used again', () => {
  const { api } = setup();
  const a = look(api, 'Lore');
  // added and renamed before reaching the sheet: only the new name arrives
  const r = crew(api, { op: 'patch', tab: 'Lore', ren: [['note', 'New note', 'Tides', on([''], a.at)]], set: [['note', 'Tides', 'high', '', on([''], a.at)]] });
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.rows.map(x => x[1]), ['Hacker’s Haven', 'Tides']);
  // renamed, then a new row under the old name in the same patch (it's based on the rename)
  const b = look(api, 'Lore');
  const ren = on([b.ver('note', 'Tides')], b.at);
  const both = crew(api, {
    op: 'patch', tab: 'Lore',
    ren: [['note', 'Tides', 'Currents', ren]],
    set: [['note', 'Currents', 'high', '', on([''], b.at)], ['note', 'Tides', 'low', '', on([b.ver('note', 'Tides'), ren.stamp], b.at)]],
  });
  assert.deepEqual(both.skipped, []);
  assert.deepEqual(both.rows.map(x => `${x[1]}|${x[2]}`), ['Hacker’s Haven|A port.', 'Currents|high', 'Tides|low']);
});

test('the Version column goes after any columns already there', () => {
  const { api, gas } = setup({ tabs: { Ship: [['Kind', 'Name', 'Value', 'Notes', 'Mine'], ['stat', 'Speed', '1', '', 'keep me']] } });
  gas.ss.getSheetByName('Ship').maxCols = 5; // a tab trimmed to its columns
  const a = look(api, 'Ship');
  crew(api, { op: 'patch', tab: 'Ship', set: [['stat', 'Speed', '2', '', on([a.ver('stat', 'Speed')], a.at)]] });
  const sh = gas.ss.getSheetByName('Ship');
  assert.deepEqual(sh.getRange(1, 1, 2, 6).getDisplayValues().map(r => r.join('|')), ['Kind|Name|Value|Notes|Mine|Version', 'stat|Speed|2||keep me|' + sh.getRange(2, 6).getDisplayValues()[0][0]]);
  assert.match(look(api, 'Ship').ver('stat', 'Speed'), /^stamp/);
});

test('create stamps the new tab’s rows; reads and patches say when they read the sheet', () => {
  const { api, tick } = setup();
  const r = crew(api, { op: 'create', tab: 'Matt', rows: [['info', 'Name', 'Matt', '']] });
  assert.equal(r.vers.length, 1);
  assert.match(r.vers[0], /^[a-z0-9]+$/);
  tick(5);
  assert.equal(look(api, 'Matt').at, r.at + 5);
  assert.deepEqual(look(api, 'Matt').vers, r.vers);
});

test('removed rows are remembered within a property’s size', () => {
  const { api, gas } = setup();
  const notes = Array.from({ length: 200 }, (_, i) => ['note', `A fairly long note title, number ${i}`, 'x', '']);
  crew(api, { op: 'patch', tab: 'Lore', set: notes });
  crew(api, { op: 'patch', tab: 'Lore', del: notes.map(n => [n[0], n[1], on(null, 0)]) });
  const gone = gas.docProps['gone:lore'];
  assert.equal(Object.keys(JSON.parse(gone)).length, 150);
  assert.ok(gone.length < 9000, `${gone.length} characters`); // Apps Script allows 9 kB per property
});

const MAP_H = ['Region', 'Location', 'Level', 'Image', 'Text', 'GM notes', 'Shown', 'On', 'Where', 'Depth'];
function mapGame() {
  const b = n => Buffer.from(Array.from({ length: n }, (_, i) => (i * 37) & 255));
  const pics = { region: { type: 'image/png', bytes: b(300) }, hidden: { type: 'image/jpeg', bytes: b(10) }, level: { type: 'image/png', bytes: b(20) } };
  const gas = createGas({
    props: KEYS,
    tabs: {
      Rules: [['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis']],
      Map: [MAP_H,
        ['Vega', '', '', { image: pics.region }, 'The server.', 'Upside down.', ''],
        ['Vega', 'Haven', '', '', 'A port.', 'Secret door.', 'on'],
        ['', 'Haven', 'Level 1', { image: pics.level }, 'Docks.', '', ''],
        ['', 'Haven', 'Level 2', '=IMAGE("https://example.com/l2.png")', 'Market.', '', ''],
        ['Vega', 'Lair', '', { image: pics.hidden }, 'Hidden.', '', ''],
        ['', 'Lair', 'Basement', '', 'Deeper.', '', ''],
      ],
    },
  });
  return { gas, api: loadCodeGs(gas), pics };
}

test('the Map tab: places, levels and pictures; crew get only what the GM has shown, without GM notes', () => {
  const { api } = mapGame();
  const crewRows = crew(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows;
  assert.deepEqual(crewRows, [
    ['Vega', '', '', 'row:2', 'The server.', '', '', '', '', ''],
    ['Vega', 'Haven', '', '', 'A port.', '', 'on', '', '', ''],
    ['', 'Haven', 'Level 1', 'row:4', 'Docks.', '', '', '', '', ''],
    ['', 'Haven', 'Level 2', 'https://example.com/l2.png', 'Market.', '', '', '', '', ''],
  ], 'a placed picture goes as its row; a hidden place and its levels stay out');
  const gmRows = gm(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows;
  assert.equal(gmRows.length, 6);
  assert.equal(gmRows[1][5], 'Secret door.');
  const d = crew(api, { op: 'read', tabs: ['Map'] }).tabs.Map.d;
  assert.equal(crew(api, { op: 'read', tabs: ['Map'], have: { Map: d } }).tabs.Map.rows, undefined, 'the digest holds still between reads');
  assert.equal(gm(api, { op: 'patch', tab: 'Map', set: [['x', 'y', 'z', '']] }).code, 'forbidden', 'edited in the sheet, not by patch');
  assert.equal(gm(api, { op: 'create', tab: 'Map', rows: [] }).code, 'name');
});

test('show: the GM puts a place on the crew\'s map, or takes it off', () => {
  const { api, gas } = mapGame();
  assert.equal(crew(api, { op: 'show', location: 'Lair', on: true }).code, 'forbidden');
  const r = gm(api, { op: 'show', location: 'lair', on: true });
  assert.equal(r.ok, true);
  assert.equal(gas.ss.getSheetByName('Map').getRange(6, 7).getDisplayValues()[0][0], 'on');
  assert.deepEqual(crew(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows.map(x => x[2] || x[1]), ['', 'Haven', 'Level 1', 'Level 2', 'Lair', 'Basement'], 'Lair and its level now reach the crew');
  gm(api, { op: 'show', location: 'Haven', on: false });
  assert.equal(gas.ss.getSheetByName('Map').getRange(3, 7).getDisplayValues()[0][0], '');
  assert.equal(gm(api, { op: 'show', location: 'Nowhere', on: true }).code, 'missing');
});

test('show static: the crew get a hidden place\'s picture and where it is, nothing that names it', () => {
  const { api, gas } = mapGame();
  const map = gas.ss.getSheetByName('Map');
  map.getRange(6, 8, 1, 3).setValues([['', '40 60 20', '2']]);
  assert.equal(gm(api, { op: 'show', location: 'Lair', on: 'static' }).ok, true);
  assert.equal(map.getRange(6, 7).getDisplayValues()[0][0], 'static');
  const rows = crew(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows;
  assert.deepEqual(rows.at(-1), ['Vega', '', '', 'row:6', '', '', 'static', '', '40 60 20', '2'], 'no name, text or levels');
  assert.equal(rows.some(r => r[2] === 'Basement'), false);
  assert.equal(crew(api, { op: 'image', row: 6 }).ok, true, 'its picture shows, as static');
  assert.equal(gm(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows[4][1], 'Lair', 'the GM sees it all');
  map.getRange(6, 9).setValues([['']]);
  assert.equal(crew(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows.length, 4, 'static with nowhere to show: hidden');
});

test('where: the GM moves a row on its picture, and a stale copy is turned down', () => {
  const { api, gas } = mapGame();
  const rows = () => gm(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows;
  assert.equal(crew(api, { op: 'where', row: 3, was: rows()[1], where: '1 2 3' }).code, 'forbidden');
  let r = gm(api, { op: 'where', row: 3, was: rows()[1], where: '50.5 20 30', depth: '1' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rows[1].slice(7), ['', '50.5 20 30', '1']);
  assert.equal(gas.ss.getSheetByName('Map').getRange(3, 9).getDisplayValues()[0][0], '50.5 20 30');
  r = gm(api, { op: 'where', row: 3, was: rows()[1], where: '10,10 20,10 15,20' });
  assert.deepEqual(r.rows[1].slice(7), ['', '10,10 20,10 15,20', '1'], 'Depth left alone');
  assert.equal(gm(api, { op: 'where', row: 3, was: rows()[1], where: 'all' }).ok, true);
  assert.equal(gm(api, { op: 'where', row: 3, was: rows()[1], where: '1 2' }).ok, false);
  assert.equal(gm(api, { op: 'where', row: 3, was: ['old'], where: '1 2 3' }).code, 'conflict');
  r = gm(api, { op: 'place', row: 3, was: rows()[1], cells: ['Vega', 'Haven', '', 'A port.', 'Secret door.', 'Vega', '', '3'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rows[1].slice(7), ['Vega', '', '3'], 'place sets On, Where and Depth when sent');
  assert.equal(gm(api, { op: 'place', row: 3, was: r.rows[1], cells: ['Vega', 'Haven', '', '', '', '', 'nowhere', ''] }).ok, false);
});

test('setUpChecks: the Map tab\'s Shown takes on or static, Depth a number', () => {
  const { api, gas } = mapGame();
  api.ctx.setUpChecks();
  const map = gas.ss.getSheetByName('Map');
  assert.deepEqual(map.getRange(2, 7).getDataValidation().list, ['on', 'static']);
  assert.deepEqual(map.getRange(2, 10).getDataValidation().between, [0, 5]);
});

test('image: sends a picture placed in a Map cell, only to someone who can see its row', () => {
  const { api, pics } = mapGame();
  const r = crew(api, { op: 'image', row: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.type, 'image/png');
  assert.deepEqual(Buffer.from(r.data, 'base64'), pics.region.bytes, 'the bytes come through unchanged');
  assert.equal(crew(api, { op: 'image', row: 4 }).ok, true, 'a level of a shown place');
  assert.equal(crew(api, { op: 'image', row: 6 }).code, 'missing', 'a hidden place\'s picture isn\'t sent to crew');
  assert.equal(gm(api, { op: 'image', row: 6 }).type, 'image/jpeg', 'but is to the GM');
  for (const row of [3, 5, 1, 99, 2.5, 'x']) assert.equal(gm(api, { op: 'image', row }).ok, false, `row ${row}`);
  assert.equal(api.call({ op: 'image', row: 2, key: 'wrong' }).code, 'auth');
});

test('Lore: an Image column after Notes; pictures go beside the rows, which stay Kind|Name|Value|Notes', () => {
  const pic = { type: 'image/png', bytes: Buffer.from([1, 2, 3, 200]) };
  const gas = createGas({
    props: KEYS,
    tabs: {
      Lore: [['Kind', 'Name', 'Value', 'Notes', 'Image'],
        ['Cybersea', 'Welcome', 'Hello.', '', { image: pic }],
        ['Cybersea', 'Timeline', '- 2000', '', '=IMAGE("https://example.com/t.png")'],
        ['place', 'Harbor', 'Rainy.', 'Sam', ''],
      ],
    },
  });
  const api = loadCodeGs(gas);
  const t = crew(api, { op: 'read', tabs: ['Lore'] }).tabs.Lore;
  assert.deepEqual(t.rows.map(r => r.length), [4, 4, 4]);
  assert.deepEqual(t.imgs, ['row:2', 'https://example.com/t.png', '']);
  const r = crew(api, { op: 'image', tab: 'Lore', row: 2 });
  assert.deepEqual(Buffer.from(r.data, 'base64'), pic.bytes);
  assert.equal(crew(api, { op: 'image', tab: 'Lore', row: 3 }).code, 'missing', 'a formula is fetched by the browser itself');
  // A crew edit keeps the picture with its row.
  const p = crew(api, { op: 'patch', tab: 'Lore', set: [['Cybersea', 'Welcome', 'Hello again.', '']] });
  assert.equal(p.ok, true);
  assert.deepEqual(p.imgs, ['row:2', 'https://example.com/t.png', '']);
  assert.equal(crew(api, { op: 'image', tab: 'Lore', row: 2 }).ok, true);
});

test('Lore without an Image column sends no imgs', () => {
  const { api } = setup();
  assert.equal(crew(api, { op: 'read', tabs: ['Lore'] }).tabs.Lore.imgs, undefined);
});

test('setUpChecks guards the rules and the sheets against accidental edits, once', () => {
  const { api, gas } = setup();
  crew(api, { op: 'patch', tab: 'Nexa', set: [['stat', 'Blood', '+1', '']] }); // gives Nexa its Version column
  gas.ss.insertSheet('System').getRange(1, 1, 1, 5).setValues([['Kind', 'Group', 'Name', 'Text', 'Meta']]);
  const done = api.run('setUpChecks');
  assert.deepEqual([...done].sort(), ['GM', 'Lore', 'Nexa', 'README', 'Rules', 'Ship', 'System'].sort());
  const sys = gas.ss.getSheetByName('System');
  assert.equal(sys.getProtections('SHEET').length, 1);
  assert.deepEqual([...sys.validations.find(v => v.col === 1).rule.list], ['stat', 'track', 'section', 'choice']);
  api.run('setUpChecks');
  const sheet = n => gas.ss.getSheetByName(n);
  for (const n of ['Rules', 'System', 'README']) {
    const ps = sheet(n).getProtections('SHEET');
    assert.equal(ps.length, 1, `${n}: protected once, however often it runs`);
    assert.ok(ps[0].isWarningOnly(), 'a warning, so the owner can still edit on purpose');
  }
  assert.equal(sheet('Nexa').getProtections('SHEET').length, 0, 'players’ tabs stay open');
  assert.equal(sheet('Nexa').getProtections('RANGE').length, 1, 'but the Version column warns');
  const rules = sheet('Rules').validations.filter(v => v.col === 1).at(-1).rule;
  assert.ok(rules.list.includes('move') && !rules.list.includes('track') && !rules.allowInvalid, 'Rules kinds: only ones the site knows');
  const vis = sheet('Rules').validations.find(v => v.col === 6).rule;
  assert.deepEqual([[...vis.list], vis.allowInvalid], [['crew', 'gm'], false]);
  const value = sheet('Nexa').validations.find(v => v.col === 3).rule;
  assert.equal(value.allowInvalid, false);
  // The formula's patterns, as Sheets (RE2) would read them.
  const res = [...value.formula.matchAll(/\$A2="(\w+)",REGEXMATCH\(TO_TEXT\(C2\),"([^"]+)"\)/g)].map(m => [m[1], new RegExp(m[2])]);
  const ok = (kind, v) => res.find(r => r[0] === kind)[1].test(v);
  assert.deepEqual(res.map(r => r[0]), ['stat', 'track', 'crew', 'bond']);
  for (const v of ['+2', '-1', '0', '−1', ' 3 ']) assert.ok(ok('stat', v), v);
  for (const v of ['two', '+', '1.5']) assert.ok(!ok('stat', v), v);
  for (const v of ['●○✕', '', 'xxo1', '● ○']) assert.ok(ok('track', v), v);
  for (const v of ['3', 'harm', '●a']) assert.ok(!ok('track', v), v);
  for (const v of ['●○', '']) assert.ok(ok('crew', v), v);
  assert.ok(!ok('crew', 'loyal'));
  for (const v of ['●○·', 'oo*']) assert.ok(ok('bond', v), v);
  assert.ok(!ok('bond', '✕'));
  const kinds = sheet('Nexa').validations.find(v => v.col === 1).rule;
  assert.equal(kinds.allowInvalid, true, 'unknown kinds are only flagged: the site leaves them alone');
  assert.equal(sheet('_scratch').validations.length, 0);
});

test('a tab the site makes gets the checks itself', () => {
  const { api, gas } = setup();
  crew(api, { op: 'create', tab: 'Matt', rows: [['info', 'Name', 'Matt', '']] });
  const sh = gas.ss.getSheetByName('Matt');
  assert.ok(sh.validations.some(v => v.col === 3 && v.rule.formula));
  assert.equal(sh.getProtections('RANGE').length, 1);
});

test('the System tab: everyone reads it, nobody writes or makes it through the site', () => {
  const { api, gas } = setup();
  gas.ss.insertSheet('System').getRange(1, 1, 2, 5).setValues([['Kind', 'Group', 'Name', 'Text', 'Meta'], ['stat', 'pirate', 'Blood', '', '']]);
  assert.deepEqual(look(api, 'System').rows, [['stat', 'pirate', 'Blood', '', '']]);
  assert.equal(gm(api, { op: 'patch', tab: 'System', set: [['stat', 'pirate', 'x', '']] }).code, 'forbidden');
  gas.ss.deleteSheet(gas.ss.getSheetByName('System'));
  assert.equal(gm(api, { op: 'create', tab: 'System' }).code, 'name');
});

test('feedback: anyone signed in adds a line to the Feedback tab, made if missing, with nothing about who sent it', () => {
  const { gas, api } = setup();
  assert.equal(crew(api, { op: 'feedback', text: '  The map needs zoom.  ' }).ok, true);
  assert.equal(gm(api, { op: 'feedback', text: '=HYPERLINK("x")' }).ok, true);
  const sh = gas.ss.getSheetByName('Feedback');
  const grid = sh.getDataRange().getDisplayValues();
  assert.deepEqual(grid[0], ['Date', 'Feedback']);
  assert.deepEqual(grid.slice(1).map(r => r[1]), ['The map needs zoom.', '=HYPERLINK("x")'], 'kept as text, not run as a formula');
  assert.ok(grid.slice(1).every(r => /^\d{4}-\d\d-\d\d$/.test(r[0]) && r.length === 2), 'only the day and the text');
  assert.equal(crew(api, { op: 'feedback', text: '   ' }).ok, false);
  assert.equal(api.call({ op: 'feedback', key: 'nope', text: 'hi' }).code, 'auth');
});

test('feedback: the site never reads, lists, patches or makes the Feedback tab', () => {
  const { api } = setup();
  crew(api, { op: 'feedback', text: 'Secret-ish' });
  for (const who of [crew, gm]) {
    const r = who(api, { op: 'read', tabs: '*' });
    assert.ok(!r.list.some(t => t.name === 'Feedback'));
    assert.equal(r.tabs.Feedback, undefined);
    assert.equal(who(api, { op: 'patch', tab: 'Feedback', set: [['a', 'b', 'c', 'd']] }).code, 'forbidden');
  }
  assert.equal(gm(api, { op: 'create', tab: 'feedback', rows: [] }).code, 'name');
});

test('feedback: a flood is held back for a minute', () => {
  const { api, tick } = setup();
  let r;
  for (let i = 0; i < 31; i++) r = crew(api, { op: 'feedback', text: 'x' + i });
  assert.equal(r.code, 'busy');
  tick(61_000);
  assert.equal(crew(api, { op: 'feedback', text: 'later' }).ok, true);
});

// The Images tab: every picture once, named from Map and Lore Image cells.
function imagesGame() {
  const b = n => Buffer.from(Array.from({ length: n }, (_, i) => (i * 11) & 255));
  const pics = { haven: { type: 'image/png', bytes: b(40) }, lair: { type: 'image/jpeg', bytes: b(30) }, cat: { type: 'image/gif', bytes: b(9) } };
  const gas = createGas({
    props: KEYS,
    tabs: {
      Rules: [['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis']],
      Images: [['Name', 'Image'],
        ['Hackers Haven', { image: pics.haven }],
        ['Lair', { image: pics.lair }],
        ['Online', '=IMAGE("https://example.com/o.png")'],
        ['Cat', { image: pics.cat }],
        ['Unused', ''],
      ],
      Map: [MAP_H,
        ['Vega', 'Haven', '', 'hackers haven ', 'A port.', '', 'on'],
        ['', 'Haven', 'Level 1', 'Online', 'Docks.', '', ''],
        ['', 'Haven', 'Level 2', { image: pics.cat }, 'Market.', '', ''],
        ['Vega', 'Lair', '', 'Lair', 'Hidden.', '', ''],
        ['Vega', 'Typo', '', 'No such picture', '', '', 'on'],
      ],
      Lore: [['Kind', 'Name', 'Value', 'Notes', 'Image'], ['Cybersea', 'Cat', 'Meow.', '', 'Cat']],
    },
  });
  return { gas, api: loadCodeGs(gas), pics };
}

test('Images tab: a name in a Map or Lore Image cell sends that picture; a picture placed in the cell still works', () => {
  const { api } = imagesGame();
  const gmRows = gm(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows;
  assert.deepEqual(gmRows.map(r => r[3]), ['images:2', 'https://example.com/o.png', 'row:4', 'images:3', '']);
  assert.deepEqual(crew(api, { op: 'read', tabs: ['Lore'] }).tabs.Lore.imgs, ['images:5']);
  const r = gm(api, { op: 'read', tabs: '*' });
  assert.ok(!r.list.some(t => t.name === 'Images'), 'the site never reads the Images tab itself');
  assert.equal(gm(api, { op: 'patch', tab: 'Images', set: [['x', 'y', '', '']] }).code, 'forbidden');
});

test('image: an Images row reaches the crew only while something they can see names it', () => {
  const { api, pics } = imagesGame();
  const r = crew(api, { op: 'image', tab: 'Images', row: 2 });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(Buffer.from(r.data, 'base64'), pics.haven.bytes);
  assert.equal(crew(api, { op: 'image', tab: 'Images', row: 5 }).ok, true, 'named by a Lore row');
  assert.equal(crew(api, { op: 'image', tab: 'Images', row: 3 }).code, 'missing', 'only a hidden place names Lair');
  assert.equal(gm(api, { op: 'image', tab: 'Images', row: 3 }).type, 'image/jpeg', 'the GM sees every picture');
  assert.equal(gm(api, { op: 'image', tab: 'Images', row: 4 }).code, 'missing', 'a formula is fetched by the browser itself');
});

test('image: whether the crew may see an Images row is remembered until the Map changes', () => {
  const { api, gas } = imagesGame();
  gm(api, { op: 'read', tabs: ['Map', 'Lore'] }); // the tabs have generations once read
  const map = gas.ss.getSheetByName('Map');
  const real = map.getDataRange.bind(map);
  let reads = 0;
  map.getDataRange = () => { reads++; return real(); };
  assert.equal(crew(api, { op: 'image', tab: 'Images', row: 2 }).ok, true);
  const first = reads;
  assert.equal(crew(api, { op: 'image', tab: 'Images', row: 2 }).ok, true);
  assert.equal(reads, first, 'the second ask reads no Map');
  assert.equal(gm(api, { op: 'show', location: 'Haven', on: false }).ok, true);
  assert.equal(crew(api, { op: 'image', tab: 'Images', row: 2 }).code, 'missing', 'hidden again: gone');
});

test('place: a row goes in with one write when the Map tab has its usual columns', () => {
  const { api, gas } = imagesGame();
  const map = gas.ss.getSheetByName('Map');
  const real = map.getRange.bind(map);
  let writes = 0;
  map.getRange = (...a) => { const r = real(...a); const sv = r.setValues.bind(r); r.setValues = v => { writes++; return sv(v); }; return r; };
  const r = gm(api, { op: 'place', row: 0, cells: ['Vega', 'Dock', '', 'A dock.', 'Notes.'], image: { name: 'Cat' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rows.at(-1), ['Vega', 'Dock', '', 'images:5', 'A dock.', 'Notes.', '', '', '', '']);
  assert.equal(writes, 1);
});

test('image: a page that kept the picture gets just its digest back', () => {
  const { api } = imagesGame();
  const r = gm(api, { op: 'image', tab: 'Images', row: 2 });
  assert.ok(r.d && r.data);
  assert.deepEqual(gm(api, { op: 'image', tab: 'Images', row: 2, have: r.d }), { ok: true, d: r.d, same: true });
  assert.ok(gm(api, { op: 'image', tab: 'Images', row: 3, have: r.d }).data, 'another picture: sent');
});

test('images: the GM lists the Images tab to pick a picture', () => {
  const { api } = imagesGame();
  assert.equal(crew(api, { op: 'images' }).code, 'forbidden');
  assert.deepEqual(gm(api, { op: 'images' }).images, [
    ['Hackers Haven', 'images:2'], ['Lair', 'images:3'], ['Online', 'https://example.com/o.png'], ['Cat', 'images:5'],
  ]);
});

test('place: the GM adds, edits and removes places, levels and maps; renaming a place moves its levels', () => {
  const { api, gas } = imagesGame();
  const map = () => gas.ss.getSheetByName('Map');
  const rows = () => gm(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows;
  const was = n => rows()[n - 2];
  assert.equal(crew(api, { op: 'place', row: 0, cells: ['Vega', 'Dock', '', '', ''] }).code, 'forbidden');

  // A new level goes after its place's last row; a new place at the end, hidden.
  let r = gm(api, { op: 'place', row: 0, cells: ['', 'Haven', 'Level 3', 'Roof.', ''], image: { name: 'Cat' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rows[3], ['', 'Haven', 'Level 3', 'images:5', 'Roof.', '', '', '', '', '']);
  r = gm(api, { op: 'place', row: 0, cells: ['Vega', 'Dock', '', '=not a formula', 'GM only.'] });
  assert.deepEqual(r.rows.at(-1), ['Vega', 'Dock', '', '', '=not a formula', 'GM only.', '', '', '', '']);
  assert.equal(crew(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows.some(x => x[1] === 'Dock'), false, 'new places start hidden');

  // Editing keeps what isn't sent (the picture, Shown) and turns down a stale copy.
  r = gm(api, { op: 'place', row: 2, was: was(2), cells: ['Vega', 'Hacker Haven', '', 'A bigger port.', 'Secret.'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rows.filter(x => x[1] === 'Hacker Haven').map(x => x[2] || x[3]), ['images:2', 'Level 1', 'Level 2', 'Level 3'], 'levels follow the rename');
  assert.equal(rows()[0][6], 'on');
  assert.equal(gm(api, { op: 'place', row: 2, was: ['old'], cells: ['Vega', 'X', '', '', ''] }).code, 'conflict');
  r = gm(api, { op: 'place', row: 2, was: was(2), cells: ['Vega', 'Hacker Haven', '', 'A bigger port.', 'Secret.'], image: '' });
  assert.equal(r.rows[0][3], '');

  // Removing a place takes its levels; removing a level, just that row.
  r = gm(api, { op: 'place', row: 4, was: was(4) });
  assert.deepEqual(r.rows.filter(x => x[1] === 'Hacker Haven').map(x => x[2]), ['', 'Level 1', 'Level 3']);
  r = gm(api, { op: 'place', row: 2, was: was(2) });
  assert.equal(r.rows.some(x => x[1] === 'Hacker Haven'), false);
  assert.equal(map().getLastRow(), 4);
  assert.equal(gm(api, { op: 'place', row: 0, cells: ['', '', 'Level 1', '', ''] }).ok, false);
});

test('place: an uploaded picture goes to the Images tab under a free name, and the row names it', () => {
  const { api, gas } = imagesGame();
  const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const r = gm(api, { op: 'place', row: 0, cells: ['Vega', 'Cat Cafe', '', '', ''], image: { name: 'Cat', type: 'image/png', data: bytes.toString('base64') } });
  assert.equal(r.ok, true, r.error);
  const images = gas.ss.getSheetByName('Images');
  assert.equal(images.getRange(7, 1).getDisplayValue(), 'Cat 2');
  assert.equal(r.rows.at(-1)[3], 'images:7');
  assert.deepEqual(Buffer.from(gm(api, { op: 'image', tab: 'Images', row: 7 }).data, 'base64'), bytes);
  assert.equal(gm(api, { op: 'place', row: 0, cells: ['Vega', 'X', '', '', ''], image: { name: 'X', type: 'text/html', data: 'aGk=' } }).ok, false);
});

test('picture: a character uploads a picture; it goes to the Images tab and their Name row names it', () => {
  const { api, gas } = imagesGame();
  gm(api, { op: 'create', tab: 'Nexa', rows: [['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', '+2', '']] });
  gm(api, { op: 'create', tab: 'Ship', rows: [['info', 'Name', 'The Boat', '']] });
  const bytes = Buffer.from([137, 80, 78, 71, 9, 9]);
  let r = crew(api, { op: 'picture', tab: 'Nexa', image: { name: 'Nexa', type: 'image/png', data: bytes.toString('base64') } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.imgs, ['images:7', ''], 'beside the info|Name row');
  const nexa = gas.ss.getSheetByName('Nexa');
  assert.equal(nexa.getRange(1, 6).getDisplayValue(), 'Image', 'a new column after Version');
  assert.equal(gas.ss.getSheetByName('Images').getRange(7, 1).getDisplayValue(), 'Nexa');
  assert.deepEqual(crew(api, { op: 'read', tabs: ['Nexa'] }).tabs.Nexa.imgs, ['images:7', '']);
  assert.deepEqual(Buffer.from(crew(api, { op: 'image', tab: 'Images', row: 7 }).data, 'base64'), bytes, 'the crew may load it');

  // Edits keep it; a name picks one from the Images tab; '' clears it.
  r = crew(api, { op: 'patch', tab: 'Nexa', set: [['stat', 'Blood', '+1', '']] });
  assert.deepEqual(r.imgs, ['images:7', '', '']);
  r = crew(api, { op: 'picture', tab: 'Ship', image: { name: 'cat' } });
  assert.deepEqual(r.imgs, ['images:5']);
  assert.equal(crew(api, { op: 'picture', tab: 'Nexa', image: '' }).imgs, undefined);
  assert.equal(nexa.getLastColumn(), 6, 'the column is kept, not added again');

  // A picture placed in the cell by hand is sent by the script itself.
  nexa.getRange(2, 6).setValues([[{ image: { type: 'image/gif', bytes: Buffer.from([7]) } }]]);
  assert.deepEqual(crew(api, { op: 'read', tabs: ['Nexa'] }).tabs.Nexa.imgs.slice(0, 1), ['row:2']);
  assert.equal(crew(api, { op: 'image', tab: 'Nexa', row: 2 }).type, 'image/gif');

  assert.equal(crew(api, { op: 'picture', tab: 'Lore', image: '' }).ok, false, 'only characters and the ship');
  assert.equal(crew(api, { op: 'picture', tab: 'Nope', image: '' }).code, 'missing');
  assert.equal(crew(api, { op: 'picture', tab: 'Nexa', image: { name: 'x', type: 'text/html', data: 'aGk=' } }).ok, false);
});

test('picture: a crew member on the Ship tab has one too, on their crew row', () => {
  const { api } = imagesGame();
  gm(api, { op: 'create', tab: 'Ship', rows: [['info', 'Name', 'The Boat', ''], ['crew', 'Bo Brine', '○○', 'Type: Deckhand']] });
  gm(api, { op: 'create', tab: 'Nexa', rows: [['info', 'Name', 'Nexa', ''], ['crew', 'Bo Brine', '', '']] });
  const r = crew(api, { op: 'picture', tab: 'Ship', row: ['crew', 'bo brine'], image: { name: 'cat' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.imgs, ['', 'images:5'], 'beside the crew row, not the Name row');
  assert.equal(crew(api, { op: 'picture', tab: 'Ship', row: ['crew', 'Nobody'], image: '' }).code, 'missing');
  assert.equal(crew(api, { op: 'picture', tab: 'Ship', row: ['stat', 'Speed'], image: '' }).ok, false, 'only a crew row or the Name row');
  assert.equal(crew(api, { op: 'picture', tab: 'Nexa', row: ['crew', 'Bo Brine'], image: '' }).ok, false, 'crew live on the Ship tab');
});

test('picture: a crew member with no picture of their own has the Images tab\'s under their name', () => {
  const { api, gas } = imagesGame();
  gm(api, { op: 'create', tab: 'Ship', rows: [['info', 'Cat', '', ''], ['crew', ' cat ', '○', ''], ['crew', 'Lair', '', ''], ['crew', 'Nobody', '', '']] });
  assert.equal(gas.ss.getSheetByName('Ship').getLastColumn() < 6, true, 'the Ship tab has no Image column');
  assert.deepEqual(crew(api, { op: 'read', tabs: ['Ship'] }).tabs.Ship.imgs, ['', 'images:5', 'images:3', ''], 'crew rows only');
  assert.equal(crew(api, { op: 'image', tab: 'Images', row: 3 }).type, 'image/jpeg', 'the crew may load it');
  const r = crew(api, { op: 'picture', tab: 'Ship', row: ['crew', 'Lair'], image: { name: 'cat' } });
  assert.deepEqual(r.imgs, ['', 'images:5', 'images:5', ''], 'their own picture comes first');
  assert.deepEqual(crew(api, { op: 'picture', tab: 'Ship', row: ['crew', 'cat'], image: '' }).imgs, ['', '', 'images:5', ''], 'taken off stays off');
  assert.deepEqual(crew(api, { op: 'picture', tab: 'Ship', row: ['crew', 'cat'], image: { name: 'lair' } }).imgs, ['', 'images:3', 'images:5', '']);
});

test('picture: a tab with no Name row has nowhere to put one, and the GM tab is the GM\'s', () => {
  const { api } = setup();
  assert.equal(crew(api, { op: 'picture', tab: 'Ship', image: { name: 'x' } }).code, 'missing');
  assert.equal(crew(api, { op: 'picture', tab: 'GM', image: '' }).ok, false);
});

test('place: makes the Map and Images tabs when the sheet has neither', () => {
  const { api } = setup();
  const r = gm(api, { op: 'place', row: 0, cells: ['Vega', '', '', 'The sea.', ''], image: { name: 'Vega', type: 'image/jpeg', data: 'AQID' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.rows, [['Vega', '', '', 'images:2', 'The sea.', '', '', '', '', '']]);
  assert.equal(crew(api, { op: 'image', tab: 'Images', row: 2 }).ok, true, 'a region map always shows');
});

test('one read looks up the Images tab once, for the Map and Lore tabs both', () => {
  const { api, gas } = setup();
  gas.ss.insertSheet('Images').getRange(1, 1, 2, 2).setValues([['Name', 'Image'], ['Port', '=IMAGE("https://example.com/p.png")']]);
  const map = gas.ss.insertSheet('Map');
  map.getRange(1, 1, 2, 7).setValues([['Region', 'Location', 'Level', 'Image', 'Text', 'GM notes', 'Shown'], ['Sea', '', '', 'Port', '', '', '']]);
  const lore = gas.ss.getSheetByName('Lore');
  lore.getRange(1, 5, 2, 1).setValues([['Image'], ['Port']]);
  const images = gas.ss.getSheetByName('Images');
  const real = images.getRange.bind(images);
  let reads = 0;
  images.getRange = (...a) => { reads++; return real(...a); };
  const r = gm(api, { op: 'read', tabs: ['Map', 'Lore'] });
  assert.equal(r.tabs.Map.rows[0][3], 'https://example.com/p.png');
  assert.equal(r.tabs.Lore.imgs[0], 'https://example.com/p.png');
  const once = reads;
  reads = 0;
  api.ctx.namedImages_();
  assert.equal(once, reads, 'the same reads as one lookup');
});

test('a patch answers with the tab exactly as the next read sends it', () => {
  const { api } = setup();
  const steps = [
    { set: [['track', 'Harm', '●●○✕✕✕', ''], ['info', 'Playbook', 'Mountebank', ''], ['bond', 'Ship', '●●·', '']] },
    { ren: [['bond', 'Ship', 'The Gull']], set: [['note', '=2+2', "'tis", '007']] },
    { del: [['info', 'Playbook'], ['custom', 'Hand-added']], set: [['info', 'Level', '1', '']] },
  ];
  for (const step of steps) {
    const r = crew(api, { op: 'patch', tab: 'Nexa', ...step });
    const t = crew(api, { op: 'read', tabs: ['Nexa'] }).tabs.Nexa;
    assert.deepEqual({ d: r.d, rows: r.rows, vers: r.vers }, { d: t.d, rows: t.rows, vers: t.vers });
  }
});

test('Sheets round trips: a few per tab read, none for an unchanged tab, and a patch costs the same however long the tab', () => {
  const { gas, api } = setup();
  const tabs = Object.keys(gm(api, { op: 'read', tabs: '*' }).tabs).length;
  const cost = fn => { const c = gas.ss.calls; const r = fn(); return [gas.ss.calls - c, r]; };
  const [fresh, r] = cost(() => gm(api, { op: 'read', tabs: '*' }));
  assert.ok(fresh <= 3 * tabs, `${fresh} calls to read ${tabs} tabs`);
  const have = Object.fromEntries(Object.entries(r.tabs).map(([k, t]) => [k, t.d]));
  assert.equal(cost(() => gm(api, { op: 'read', tabs: '*', have }))[0], 0, 'unchanged tabs come from the remembered digests');

  const patch = i => cost(() => gm(api, { op: 'patch', tab: 'Nexa', set: [['log', `L${i}`, 'x', '', {}]] }));
  patch(0); // the tab's first versioned write adds the Version column
  const [short] = patch(1);
  for (let i = 2; i < 300; i++) patch(i);
  const [long, res] = patch(300);
  assert.equal(res.ok, true, res.error);
  assert.ok(short <= 4, `${short} calls for a patch`);
  assert.equal(long, short, 'no call per row');
});

test('roll: adds a line to the Rolls tab, made if missing, and sends the tab back as a read would', () => {
  const { gas, api } = setup();
  const r = crew(api, { op: 'roll', who: 'Nexa', label: 'POKE · Spitfire', dice: [3, 5], mod: 2, total: 10, as: '' });
  assert.equal(r.ok, true);
  const grid = gas.ss.getSheetByName('Rolls').getDataRange().getDisplayValues();
  assert.deepEqual(grid[0], ['When', 'Who', 'Roll', 'Dice', 'Mod', 'Total', 'By']);
  assert.deepEqual(grid[1].slice(1), ['Nexa', 'POKE · Spitfire', '3 5', '+2', '10', '']);
  assert.match(grid[1][0], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual(r.rows, grid.slice(1));
  gm(api, { op: 'roll', who: '=Nexa', label: 'Blood', dice: [1, 1], mod: -1, total: 1, as: 'GM' });
  const read = crew(api, { op: 'read', tabs: ['Rolls'] });
  assert.deepEqual(read.list.find(t => t.name === 'Rolls'), { name: 'Rolls', kind: 'rolls' });
  assert.deepEqual(read.tabs.Rolls.rows[1].slice(1), ['=Nexa', 'Blood', '1 1', '-1', '1', 'GM']);
});

test('roll: turns away dice that don’t add up, and the site can’t patch or make the tab', () => {
  const { api } = setup();
  const bad = [
    { who: 'Nexa', label: 'Blood', dice: [3, 5], mod: 0, total: 9 },
    { who: 'Nexa', label: 'Blood', dice: [7, 1], mod: 0, total: 8 },
    { who: 'Nexa', label: 'Blood', dice: [], mod: 0, total: 0 },
    { who: '', label: 'Blood', dice: [1, 2], mod: 0, total: 3 },
    { who: 'Nexa', label: ' ', dice: [1, 2], mod: 0, total: 3 },
  ];
  for (const b of bad) assert.equal(crew(api, { op: 'roll', ...b }).ok, false, JSON.stringify(b));
  crew(api, { op: 'roll', who: 'Nexa', label: 'Blood', dice: [1, 2], mod: 0, total: 3 });
  assert.equal(gm(api, { op: 'patch', tab: 'Rolls', set: [['a', 'b', 'c', 'd']] }).code, 'forbidden');
  assert.equal(gm(api, { op: 'create', tab: 'rolls', rows: [] }).code, 'name');
  assert.equal(api.call({ op: 'roll', key: 'nope', who: 'Nexa', label: 'Blood', dice: [1, 2], mod: 0, total: 3 }).code, 'auth');
});

test('roll: reads send the latest 50, and the tab keeps the latest 500', () => {
  const { gas, api, tick } = setup();
  const one = i => crew(api, { op: 'roll', who: 'Nexa', label: 'R' + i, dice: [1], mod: 0, total: 1 });
  for (let i = 0; i < 549; i++) { tick(1000); if (i % 100 === 0) tick(61_000); assert.equal(one(i).ok, true, 'roll ' + i); }
  assert.equal(gas.ss.getSheetByName('Rolls').getLastRow(), 550);
  tick(61_000);
  const r = one(549);
  assert.equal(gas.ss.getSheetByName('Rolls').getLastRow(), 501);
  assert.equal(r.rows.length, 50);
  assert.deepEqual([r.rows[0][2], r.rows[49][2]], ['R500', 'R549']);
});

test('roll: a flood is held back for a minute', () => {
  const { api, tick } = setup();
  let r;
  for (let i = 0; i < 121; i++) r = crew(api, { op: 'roll', who: 'Nexa', label: 'x', dice: [1], mod: 0, total: 1 });
  assert.equal(r.code, 'busy');
  tick(61_000);
  assert.equal(crew(api, { op: 'roll', who: 'Nexa', label: 'x', dice: [1], mod: 0, total: 1 }).ok, true);
});

test('unroll: clears the latest row that matches, and a roll already gone is no error', () => {
  const { gas, api, tick } = setup();
  const a = crew(api, { op: 'roll', who: 'Nexa', label: 'Blood', dice: [1, 2], mod: 0, total: 3 }).rows[0];
  tick(1000);
  crew(api, { op: 'roll', who: 'Nexa', label: 'Polish', dice: [6, 6], mod: 0, total: 12 });
  const r = crew(api, { op: 'unroll', row: a });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map(x => x[2]), ['Polish']);
  assert.equal(gas.ss.getSheetByName('Rolls').getLastRow(), 2);
  assert.equal(crew(api, { op: 'unroll', row: a }).ok, true);
  assert.equal(gas.ss.getSheetByName('Rolls').getLastRow(), 2);
  assert.equal(crew(api, { op: 'unroll', row: ['x'] }).ok, false);
});

test('show with a level: only the levels shown on their own reach the crew, and the place goes on with them', () => {
  const { api, gas } = mapGame();
  const r = gm(api, { op: 'show', location: 'Lair', level: 'basement', on: true });
  assert.equal(r.ok, true);
  const map = gas.ss.getSheetByName('Map');
  assert.equal(map.getRange(7, 7).getDisplayValues()[0][0], 'on', 'the level');
  assert.equal(map.getRange(6, 7).getDisplayValues()[0][0], 'on', 'its place');
  gm(api, { op: 'show', location: 'Haven', level: 'Level 2', on: true });
  const names = crew(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows.map(x => x[2] || x[1]);
  assert.deepEqual(names, ['', 'Haven', 'Level 2', 'Lair', 'Basement'], 'Level 1 of Haven stays out once Level 2 is shown on its own');
  assert.equal(gm(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows.length, 6, 'the GM still sees every row');
  gm(api, { op: 'show', location: 'Haven', level: 'Level 2', on: false });
  assert.equal(map.getRange(3, 7).getDisplayValues()[0][0], 'on', 'taking a level off leaves its place');
  assert.deepEqual(crew(api, { op: 'read', tabs: ['Map'] }).tabs.Map.rows.filter(x => x[1] === 'Haven').map(x => x[2]), ['', 'Level 1', 'Level 2'], 'no level on its own: all of them show again');
  assert.equal(gm(api, { op: 'show', location: 'Haven', level: 'Attic', on: true }).code, 'missing');
});

test('Session and NPCs tabs: only the GM makes them; the crew write only their own kinds of row', () => {
  const { api } = setup();
  assert.equal(crew(api, { op: 'create', tab: 'Session', rows: [] }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: 'NPCs', rows: [] }).code, 'name');
  assert.equal(gm(api, { op: 'create', tab: 'Session', rows: [['folder', 'Vega Station', '', '']] }).ok, true);
  assert.equal(gm(api, { op: 'create', tab: 'NPCs', rows: [['npc', 'Captain Vex', 'loud', '']] }).ok, true);
  const list = crew(api, { op: 'read', tabs: ['Session', 'NPCs'] }).list;
  assert.deepEqual(list.filter(t => t.kind === 'session' || t.kind === 'npcs'), [{ name: 'Session', kind: 'session' }, { name: 'NPCs', kind: 'npcs' }]);

  assert.equal(crew(api, { op: 'patch', tab: 'Session', set: [['share', 'x1', 'Vega Station', 'scene: A trick']] }).code, 'forbidden', 'crew can’t share');
  assert.equal(crew(api, { op: 'patch', tab: 'Session', del: [['folder', 'Vega Station']] }).code, 'forbidden');
  assert.equal(crew(api, { op: 'patch', tab: 'Session', set: [['note', 'n1', 'Vega Station', 'note: Nexa\nWatch the door.'], ['done', 'session-begin:Nexa', 's1', '']] }).ok, true);
  assert.equal(crew(api, { op: 'patch', tab: 'NPCs', set: [['npc', 'Captain Vex', 'quiet', '']] }).code, 'forbidden');
  assert.equal(crew(api, { op: 'patch', tab: 'NPCs', set: [['crew', 'Captain Vex', 'Owes us.', '']] }).ok, true);
  assert.equal(gm(api, { op: 'patch', tab: 'Session', set: [['share', 'x1', 'Vega Station', 'scene: A trick']] }).ok, true);
  const rows = crew(api, { op: 'read', tabs: ['Session'] }).tabs.Session.rows;
  assert.deepEqual(rows.map(r => r[0]), ['folder', 'note', 'done', 'share']);
});
