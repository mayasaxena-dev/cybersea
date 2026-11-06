// Browser tests for the character sheet against the dev server (real Code.gs, fake sheet).
// Run: NODE_PATH=$(npm root -g) node --test tests/e2e/
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn, until, polls, sleep } from './harness.mjs';
import { KEYS } from '../fixtures/game.mjs';
import { png } from '../fixtures/png.mjs';

const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);

let h;
let api;
test.before(async () => { h = await harness(); [api] = h.srv.apis; });
test.after(async () => { await h.close(); });

// Opens Testa's sheet signed in as Testa (pass as: null to stay signed out).
async function openSheet(opts, { c = 'Testa', as = 'Testa', game = api } = {}) {
  const p = await h.page(opts);
  await p.goto(`${h.srv.site}/sheet.html?c=${encodeURIComponent(c)}#join=${invite(game.url)}`);
  await p.waitForSelector('h1.name');
  if (as) {
    await signIn(p, as);
    if (as === c) await p.waitForSelector('[data-act="edit"]');
  }
  return p;
}
const who = p => p.$eval('.gnav .who', b => b.textContent.trim());
const withRow = (rows, r) => rows.map(x => x.slice(0, 4)).filter(x => !(x[0] === r[0] && x[1] === r[1])).concat([r]);
// The next `count` answers from the sheet are lost (the script still runs).
const fail = (count, game = api) => fetch(`${game.base}/__test/fail`, { method: 'POST', body: JSON.stringify({ count }) });
const track = (p, cls) => p.$$eval(`.${cls} .pip`, ps => ps.map(e => (e.classList.contains('on') ? '●' : '○')).join(''));
const queued = p => p.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':pending:')).some(k => localStorage.getItem(k) !== '{}'));
// Change one row of a tab in Sheets, where it is.
async function editRow(game, tab, r) {
  const rows = (await h.tab(game, tab)).map(x => x.slice(0, 4));
  await h.setTab(game, tab, rows.map(x => (x[0] === r[0] && x[1] === r[1] ? r : x)));
}

test('editing needs you signed in as that character', async () => {
  const before = row(await h.tab(api, 'Testa'), 'track', 'Harm')[2];
  const p = await openSheet(undefined, { as: null });
  await p.waitForSelector('.robar');
  assert.equal(await p.$('[data-act="edit"]'), null, 'no edit button');
  await p.click('.harm .pip[data-j="1"]');
  await polls(p);
  assert.equal(row(await h.tab(api, 'Testa'), 'track', 'Harm')[2], before, 'pips do nothing');
  await p.click('[data-act="tab"][data-tab="log"]');
  assert.equal(await p.$('.actions'), null, 'no chapter/downtime/level-up buttons');
  await p.click('[data-act="tab"][data-tab="sheet"]');

  // signing in as Testa from the bar's button makes it editable
  await p.click('.robar [data-nav="who"]');
  await p.click('[role="dialog"] [data-me="Testa"]');
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-act="edit"]');
  assert.equal(await p.$('.robar'), null);

  // someone else's sheet stays read-only
  await h.setTab(api, 'Rook', withRow((await h.tab(api, 'Testa')).filter(r => r[0] !== 'signin'), ['info', 'Name', 'Rook', '']));
  await p.goto(p.url().replace('c=Testa', 'c=Rook'));
  await p.waitForSelector('.robar');
  assert.match(await p.textContent('.robar'), /only Rook’s player/);
  assert.equal(await p.$('[data-act="edit"]'), null);
  assert.equal(await who(p), 'Testa');
  await h.setTab(api, 'Rook', null);
});

test('the sheet has the last word: signed out there, signed out here', async () => {
  const p = await openSheet();
  assert.ok(await until(async () => row(await h.tab(api, 'Testa'), 'signin', 'Signed in')?.[2] === 'yes'));
  await h.setTab(api, 'Testa', withRow(await h.tab(api, 'Testa'), ['signin', 'Signed in', '', '']));
  await p.waitForSelector('.robar');
  assert.equal(await p.$('[data-act="edit"]'), null);
  assert.equal(await who(p), 'Sign in');
});

test('an invite opens the sheet and the passphrase leaves the URL', async () => {
  const p = await openSheet();
  assert.equal(await p.textContent('h1.name'), 'Testa');
  assert.ok(!p.url().includes('#join'), p.url());
  assert.match(p.url(), /[?&]g=/);
  assert.deepEqual(await p.$$eval('.glinks a', as => as.map(a => a.textContent)), ['Crew', 'Ship', 'Lore', 'Map', 'Rules']);
  assert.ok(await p.$('.bonds .bond'), 'bonds card is shown');
});

test('pips: tracks toggle; bonds are used and restored, unmarked bonds ignore clicks', async () => {
  const p = await openSheet();
  const kinds = () => p.$$eval('.harm .pip', ps => ps.map(e => (e.classList.contains('bloody') ? 'B' : e.classList.contains('skull') ? 'S' : 'o')).join(''));
  assert.equal(await kinds(), 'oooSSB', 'the harm track’s last skulls=3 pips are skulls, the last bloody');
  await p.click('.harm .pip[data-j="5"]');
  assert.equal(await kinds(), 'oooSSB', 'marking a skull keeps it a skull');
  await p.click('.harm .pip[data-j="5"]');
  await p.click('.harm .pip[data-j="1"]');
  await p.click('[data-pip="b:0"][data-j="0"]');  // Ship ● → used
  await p.click('[data-pip="b:0"][data-j="2"]');  // unmarked: ignored outside edit mode
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'bond', 'Ship')?.[2] === '○●·' && r; });
  assert.equal(row(rows, 'track', 'Harm')[2], '●●○○○○');
  assert.equal(row(rows, 'bond', 'Ship')[2], '○●·');
  // restore it
  await p.click('[data-pip="b:0"][data-j="0"]');
  assert.ok(await until(async () => row(await h.tab(api, 'Testa'), 'bond', 'Ship')[2] === '●●·'));
});

test('edit mode: text, renamed sections, new pips, and marking bonds', async () => {
  const p = await openSheet();
  await p.click('[data-act="edit"]');
  await p.fill('textarea[data-bind="sec:2:text"]', '- Dagger\n- Cloak\n- Lantern');
  const title = p.locator('input[data-bind="sec:3:title"]');
  await title.fill('Problems');
  await title.press('Tab');
  await p.click('[data-path="t:Experience"][data-act="add-pip"]');
  await p.click('[data-pip="b:1"][data-j="2"]'); // edit mode marks an unmarked bond
  await p.click('[data-act="edit"]');
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'sheet', 'Problems') && row(r, 'track', 'Experience')[2].length === 7 && r; });
  assert.equal(row(rows, 'sheet', 'Kit')[2], '- Dagger\n- Cloak\n- Lantern');
  assert.equal(row(rows, 'sheet', 'Troubles'), undefined, 'old title removed');
  assert.equal(row(rows, 'track', 'Experience')[2], '●●○○○○○');
  assert.equal(row(rows, 'bond', 'Passenger')[2], '●○●');
  assert.equal(await p.textContent('.cols .card:nth-child(4) h2').catch(() => ''), 'Problems');
});

test('checklists on playbook moves save per character', async () => {
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="moves"]');
  await p.click('details[data-id="playbook:SUMMON"] summary');
  await p.click('details[data-id="playbook:SUMMON"] li[data-ck="1"]');
  const r = await until(async () => { const x = row(await h.tab(api, 'Testa'), 'move', 'SUMMON'); return x && x[3].includes('[x] Fire burst.') && x; });
  assert.match(r[3], /\[x\] Shadow cloak\.\n\[x\] Fire burst\.\n\[x\] Shape change\./);
  // unmarked advance moves show greyed out
  assert.ok(await p.$('details.move.off[data-id="playbook:HEX"]'));
  // a roll chip shows the stat and modifier
  assert.match(await p.textContent('details[data-id="playbook:SUMMON"] .chip'), /Spitfire \+2/);
  await p.click('details[data-id="playbook:SUMMON"] .chip');
  // the toast previews the roll; nothing is rolled until Roll is pressed
  assert.match(await p.textContent('#toast'), /SUMMON · Spitfire/);
  assert.match(await p.textContent('#toast .roll-go'), /Roll 2d6/);
  assert.equal(await p.$('#toast .tot'), null, 'not rolled yet');
  assert.deepEqual(await p.$$eval('#toast .die', ds => ds.map(d => d.textContent)), ['?', '?']);
  await p.click('#toast .roll-go');
  await p.waitForSelector('#toast.rolling');
  await p.waitForSelector('#toast .tot');
  const faces = await p.$$eval('#toast .die', ds => ds.map(d => +d.textContent));
  assert.ok(faces.every(f => f >= 1 && f <= 6));
  assert.equal(+(await p.textContent('#toast .tot')), faces[0] + faces[1] + 2);
  assert.equal(await p.$('#toast .roll-go'), null);
});

test('rolls that need a number: set it in the preview before rolling', async () => {
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="moves"]');
  await p.click('details[data-id="special:SCARPER"] .chip');
  assert.match(await p.textContent('#toast .tl'), /SCARPER · \+bonds spent/);
  await p.click('#toast .ab[data-d="1"]');
  await p.click('#toast .ab[data-d="1"]');
  assert.equal(await p.textContent('#toast .av'), '2');
  assert.equal(await p.textContent('#toast .pm'), '+2');
  await p.click('#toast .roll-go');
  await p.waitForSelector('#toast .tot');
  let faces = await p.$$eval('#toast .die', ds => ds.map(d => +d.textContent));
  assert.equal(+(await p.textContent('#toast .tot')), faces[0] + faces[1] + 2);
  assert.equal(await p.$('#toast .adj'), null);

  await p.click('details[data-id="special:CHEAT DEATH"] .chip');
  assert.match(await p.textContent('#toast .an'), /-1 per scar/);
  await p.click('#toast .ab[data-d="1"]');
  assert.equal(await p.textContent('#toast .pm'), '−1');
  await p.click('#toast .roll-go');
  await p.waitForSelector('#toast .tot');
  faces = await p.$$eval('#toast .die', ds => ds.map(d => +d.textContent));
  assert.equal(+(await p.textContent('#toast .tot')), faces[0] + faces[1] - 1);
});

test('two people editing different rows keep both changes, live', async () => {
  const a = await openSheet();
  const b = await openSheet();
  await a.click('.luck .pip[data-j="6"]');
  await b.click('.harm .pip[data-j="2"]');
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'track', 'Luck')[2][6] === '●' && row(r, 'track', 'Harm')[2][2] === '●' && r; });
  assert.ok(rows, 'both edits landed');
  // each page picks up the other's change by polling
  assert.ok(await until(() => a.$eval('.harm .pip[data-j="2"]', el => el.classList.contains('on'))));
  assert.ok(await until(() => b.$eval('.luck .pip[data-j="6"]', el => el.classList.contains('on'))));
});

test('an edit made directly in the spreadsheet is not overwritten by a pending local edit', async () => {
  const p = await openSheet();
  await fetch(`${api.base}/__test/fail`, { method: 'POST', body: JSON.stringify({ count: 3 }) });
  await p.click('.luck .pip[data-j="7"]'); // stays pending while the API fails
  const sheet = await h.tab(api, 'Testa');
  const edited = sheet.slice(1).map(r => r.slice(0, 4)).map(r => (r[0] === 'sheet' && r[1] === 'Vice' ? ['sheet', 'Vice', 'Edited in the sheet.', ''] : r));
  await h.setTab(api, 'Testa', [['Kind', 'Name', 'Value', 'Notes'], ...edited]);
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'track', 'Luck')[2][7] === '●' && r; }, 15000);
  assert.ok(rows, 'pending edit eventually saved');
  assert.equal(row(rows, 'sheet', 'Vice')[2], 'Edited in the sheet.');
  assert.ok(await until(async () => (await p.textContent('.cols')).includes('Edited in the sheet.')));
});

test('edits made while the sheet is unreachable survive a reload', async () => {
  const p = await openSheet();
  await fetch(`${api.base}/__test/fail`, { method: 'POST', body: JSON.stringify({ count: 50 }) });
  await p.click('.harm .pip[data-j="0"]'); // toggles whatever it is
  const want = await p.$eval('.harm .pip[data-j="0"]', el => (el.classList.contains('on') ? '●' : '○'));
  assert.ok(await until(() => queued(p)), 'kept in localStorage');
  await p.reload();
  await p.waitForSelector('h1.name');
  assert.equal(await p.$eval('.harm .pip[data-j="0"]', el => (el.classList.contains('on') ? '●' : '○')), want, 'shown from the saved pending edit');
  await fetch(`${api.base}/__test/fail`, { method: 'POST', body: JSON.stringify({ count: 0 }) });
  assert.ok(await until(async () => row(await h.tab(api, 'Testa'), 'track', 'Harm')[2][0] === want, 20000));
});

test('a change sent as the page closed doesn’t undo a newer edit when the page sends it again', async () => {
  const p = await openSheet();
  const harm = async () => row(await h.tab(api, 'Testa'), 'track', 'Harm')[2];
  const before = await harm();
  await fail(50);
  await p.click('.harm .pip[data-j="0"]');
  const mine = await track(p, 'harm');
  assert.ok(await until(() => queued(p)), 'kept in localStorage');
  await p.reload(); // the beacon sent on the way out lands, but nothing tells the page
  await p.waitForSelector('h1.name');
  assert.ok(await until(async () => (await harm()) === mine), 'the beacon landed');
  assert.ok(await queued(p), 'the page still has it queued');
  // Meanwhile the GM puts Harm back as it was, in Sheets. Then the page gets through.
  await editRow(api, 'Testa', ['track', 'Harm', before, '']);
  await fail(0);
  assert.ok(await until(async () => !(await queued(p)), 30000), 'the page settled its queue');
  assert.equal(await harm(), before, 'the GM’s edit stands');
  assert.ok(await until(async () => (await track(p, 'harm')) === before), 'and the page shows it');
  assert.match(await p.textContent('#toast'), /Not saved: Harm changed on the sheet first/);
});

test('an edit made on top of one the sheet never answered still saves', async () => {
  const p = await openSheet();
  const luck = async () => row(await h.tab(api, 'Testa'), 'track', 'Luck')[2];
  await fail(3);
  await p.click('.luck .pip[data-j="7"]');
  const first = await track(p, 'luck');
  assert.ok(await until(async () => (await luck()) === first), 'it landed, unanswered');
  await p.click('.luck .pip[data-j="6"]');
  const second = await track(p, 'luck');
  assert.ok(await until(async () => (await luck()) === second && !(await queued(p)), 30000));
  assert.doesNotMatch(await p.textContent('body'), /Not saved/);
});

test('actions: session, chapter’s end, downtime with a rolled move, level up', async () => {
  // reset the character
  const { sampleCharacter, HEADER } = await import('../fixtures/game.mjs');
  await h.setTab(api, 'Testa', [HEADER, ...sampleCharacter]);
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="log"]');

  await p.click('[data-kind="session-begin"]');
  assert.match(await p.textContent('.eff'), /up to 2 \(4\)/); // already has 4 luck, Spitfire +2
  await p.click('[data-run]');

  await p.click('[data-act="tab"][data-tab="sheet"]');
  await p.click('[data-pip="b:0"][data-j="0"]'); // use a bond
  await p.click('[data-act="tab"][data-tab="log"]');
  await p.click('[data-kind="chapter-end"]');
  await p.selectOption('[data-pick="0"]', { label: '+1 experience' }); // the choice rows in the Rules tab
  await p.selectOption('[data-pick="1"]', { label: 'Heal 2 harm' });
  await p.click('[data-run]');

  // Begin and Leave Downtime run from their moves on the Moves tab too
  await p.click('[data-act="tab"][data-tab="moves"]');
  await p.click('[data-act="cat"][data-cat="downtime"]');
  assert.ok(await p.isDisabled('details[data-id="downtime:LEAVE DOWNTIME"] .chip'), 'not in downtime yet');
  assert.ok(await p.isDisabled('details[data-id="downtime:DICE GAME"] .chip'), 'downtime moves wait for downtime');
  await p.click('details[data-id="downtime:BEGIN DOWNTIME"] .chip');
  await p.check('input[name=where][value="1"]'); // At sea, the second choice
  await p.click('[data-run]');
  assert.ok(await p.isDisabled('details[data-id="downtime:BEGIN DOWNTIME"] .chip'), 'already in downtime');
  await p.click('[data-act="tab"][data-tab="sheet"]');
  await p.click('.harm .pip[data-j="2"]'); // fresh harm during downtime
  await p.click('[data-act="tab"][data-tab="log"]');
  await p.click('[data-act="dt-moves"]');
  await p.click('details[data-id="downtime:DICE GAME"] .chip');
  await p.click('#toast'); // closing the preview doesn't count the move
  await p.click('[data-act="tab"][data-tab="log"]');
  assert.match(await p.textContent('.dtbar'), /At sea 0\/1/);
  await p.click('[data-act="dt-moves"]');
  await p.click('details[data-id="downtime:DICE GAME"] .chip');
  await p.click('#toast .roll-go');
  await p.waitForSelector('#toast .tot');
  await p.click('[data-act="tab"][data-tab="log"]');
  assert.match(await p.textContent('.dtbar'), /At sea 1\/1/);
  await p.click('[data-act="tab"][data-tab="moves"]');
  assert.ok(await p.isDisabled('details[data-id="downtime:DICE GAME"] .chip'), 'no downtime moves left at sea');
  await p.click('details[data-id="downtime:LEAVE DOWNTIME"] .chip');
  await p.click('[data-run]');
  await p.click('[data-act="tab"][data-tab="log"]');

  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return r.filter(x => x[0] === 'log').length === 4 && r; });
  const logs = rows.filter(x => x[0] === 'log').map(x => `${x[2]}: ${x[3].replace(/\n/g, ' ')}`);
  assert.deepEqual(logs, [
    'Session Begins: ',
    'Chapter’s End: - Replenish all bonds (2) - +1 experience - Healed 1 harm',
    'Begin Downtime: - At sea',
    `Leave Downtime: - DICE GAME (${logs[3].match(/\((\d+)\)/)?.[1]})`,
  ]);
  assert.equal(row(rows, 'track', 'Harm')[2], '○○●○○○', 'harm from before downtime healed by chapter’s end; fresh harm stays');
  assert.equal(row(rows, 'track', 'Experience')[2], '●●●○○○');
  assert.match(row(rows, 'sheet', 'Experience')[2], /- 1 \(Chapter’s End\)$/);
  assert.equal(row(rows, 'bond', 'Ship')[2], '●●·');
  assert.equal(row(rows, 'state', 'downtime'), undefined);

  // level up: fill experience, raise Spitfire
  await h.setTab(api, 'Testa', [HEADER, ...rows.map(r => r.slice(0, 4)).filter(r => r[0] !== 'Kind').map(r => (r[1] === 'Experience' && r[0] === 'track' ? ['track', 'Experience', '●●●●●●', ''] : r))]);
  await p.reload();
  await p.waitForSelector('[data-kind="level-up"]:not([disabled])');
  await p.click('[data-kind="level-up"]');
  await p.selectOption('[data-sub="0"]', 'Spitfire');
  await p.click('[data-run]');
  const after = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'info', 'Level')?.[2] === '1' && r; });
  assert.equal(row(after, 'stat', 'Spitfire')[2], '+3');
  assert.equal(row(after, 'track', 'Experience')[2], '○○○○○○○');
  assert.equal(row(after, 'advance', 'trait')[2], '1');
});

test('moves that spend luck have a button that spends it', async () => {
  const { sampleCharacter, HEADER } = await import('../fixtures/game.mjs');
  await h.setTab(api, 'Testa', [HEADER, ...sampleCharacter]);
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="moves"]');
  await p.click('[data-act="cat"][data-cat="basic"]');
  assert.equal(await p.$('details[data-id="basic:POKE AROUND"] [data-act="spend"]'), null, 'no luck button on a plain roll');
  await p.click('details[data-id="basic:FLIP A COIN"] [data-act="spend"]');
  assert.match(await p.textContent('#toast'), /Spent 1 luck: FLIP A COIN \(3 left\)/);
  assert.equal(await track(p, 'luck'), '●●●○○○○○');
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'track', 'Luck')[2] === '●●●○○○○○' && r; });
  assert.ok(rows, 'saved to the sheet');
});

test('every move can be made by someone; moves not taken are off', async () => {
  const { sampleCharacter, HEADER } = await import('../fixtures/game.mjs');
  await h.setTab(api, 'Testa', [HEADER, ...sampleCharacter, ['move', 'HEX', '●', '']]);
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="moves"]');
  assert.ok(await p.isDisabled('details[data-id="playbook:OMEN"] [data-act="roll-move"]'), 'an unmarked move can’t be rolled');
  assert.ok(await p.isDisabled('details[data-id="playbook:BAD PENNY"] [data-act="use-move"]'));
  // a move with nothing to roll or spend is used, and the use goes in the log
  await p.click('details[data-id="playbook:HEX"] [data-act="use-move"]');
  await p.click('details[data-id="playbook:HEX"] [data-act="use-move"]');
  assert.deepEqual(await p.$$eval('.usage li', ls => ls.map(l => l.textContent)), ['HEX ×2']);
  await p.click('.usage [data-log]');
  assert.ok(await until(async () => (await h.tab(api, 'Testa')).some(r => r[0] === 'log' && r[2] === 'HEX ×2')));
  // a ship move rolls the ship's stat on a character's sheet
  assert.match(await p.textContent('details[data-id="ship:RAM IT"] [data-act="roll-move"]'), /Steadfast 0/i);
  assert.match(await p.textContent('details[data-id="ship:CHART A COURSE"] [data-act="roll-move"]'), /Spitfire \+2/i);
  // and on the ship's page, the signed-in character's
  await p.goto(`${h.srv.site}/ship.html#join=${invite(api.url)}`);
  await p.click('[data-act="tab"][data-tab="moves"]');
  await p.waitForSelector('details[data-id="ship:CHART A COURSE"] [data-act="roll-move"]');
  assert.match(await p.textContent('details[data-id="ship:CHART A COURSE"] [data-act="roll-move"]'), /Spitfire \+2/i);
});

test('session ends: the vice and marked moves that end-of-session touches', async () => {
  const { sampleCharacter, HEADER } = await import('../fixtures/game.mjs');
  await h.setTab(api, 'Testa', [HEADER, ...sampleCharacter, ['move', 'LUCKY BREAK', '●', '']]);
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="log"]');
  await p.click('[data-kind="session-end"]');
  assert.match(await p.textContent('.panel .rule'), /When the session closes/);
  const listed = await p.$$eval('.endm .eff', ls => ls.map(l => l.textContent));
  assert.deepEqual(listed, ['HAUNTED+1 experience', 'LUCKY BREAK+1 luck'], 'not SUMMON or HAGGLE');
  assert.equal(await p.$$eval('.endm input:checked', x => x.length), 0, 'nothing applied until ticked');
  await p.check('[data-eff="sess:0"]');
  await p.check('[data-eff="sess:1"]');
  await p.fill('.anote', 'Still haunted.');
  await p.click('[data-run]');
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return r.some(x => x[0] === 'log') && r; });
  const log = rows.find(x => x[0] === 'log');
  assert.equal(log[2], 'Session Ends');
  assert.equal(log[3], '- HAUNTED: +1 experience\n- LUCKY BREAK: +1 luck\n\nStill haunted.');
  assert.equal(row(rows, 'track', 'Luck')[2], '●●●●●○○○');
  assert.equal(row(rows, 'track', 'Experience')[2], '●●●○○○');
  assert.match(row(rows, 'sheet', 'Experience')[2], /- 1 \(HAUNTED\)$/);
});

test('session begins: marked moves that start a session, and their hold at the end', async () => {
  const { sampleCharacter, HEADER } = await import('../fixtures/game.mjs');
  await h.setTab(api, 'Testa', [HEADER, ...sampleCharacter, ['move', 'OMEN', '●', ''], ['move', 'BAD PENNY', '●', '']]);
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="log"]');
  await p.click('[data-kind="session-begin"]');
  const listed = await p.$$eval('.endm .eff', ls => ls.map(l => l.textContent));
  assert.deepEqual(listed, ['OMENroll Spitfire +2 on the Moves tab', 'BAD PENNY'], 'not LUCKY BREAK or the vice');
  await p.check('[data-eff="sess:0"]');
  await p.click('[data-run]');
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return r.some(x => x[0] === 'log') && r; });
  assert.match(rows.find(x => x[0] === 'log')[3], /- OMEN$/m);
  await p.click('[data-kind="session-end"]');
  const atEnd = await p.$$eval('.endm .eff', ls => ls.map(l => l.textContent));
  assert.ok(atEnd.includes('OMENroll Spitfire +2 on the Moves tab'), 'its hold ends with the session');
  assert.ok(!atEnd.includes('BAD PENNY'));
});

test('a wrong passphrase asks for the right one, or you can carry on as crew', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url, 'nope')}`);
  await p.waitForSelector('form[data-keyform]');
  await p.fill('form[data-keyform] input', KEYS.GM_KEY);
  await p.click('form[data-keyform] button');
  await p.waitForSelector('h1.name');
  assert.equal(await p.textContent('h1.name'), row(await h.tab(api, 'Testa'), 'info', 'Name')[2]);

  const q = await h.page();
  await q.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url, 'nope')}`);
  await q.waitForSelector('form[data-keyform]');
  await q.keyboard.press('Escape');
  await q.click('.gnav .who');
  await q.click('[data-w="gm-out"]');
  await q.waitForSelector('[role="dialog"] [data-me]'); // then it asks who you are
  await q.keyboard.press('Escape');
  await q.waitForSelector('h1.name');
  assert.equal(await q.textContent('.gnav .who'), 'Sign in');
});

test('kit: fill from a kit, add and remove items, treasure carries into hoard', async () => {
  const { sampleCharacter, HEADER } = await import('../fixtures/game.mjs');
  await h.setTab(api, 'Testa', [HEADER, ...sampleCharacter]);
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="kit"]');
  await p.waitForSelector('#kitpick');
  await p.selectOption('#kitpick', 'Kit 2');
  await p.click('[data-act="fill-kit"]');
  await p.waitForSelector('.items');
  let rows = await until(async () => { const r = await h.tab(api, 'Testa'); return r.some(x => x[0] === 'item') && r; });
  assert.deepEqual(rows.filter(r => r[0] === 'item').map(r => r[1]), ['Bone dice', 'A lantern (cracked, still works)']);
  assert.equal(row(rows, 'kit', 'Treasure')[3], '(5-treasure = 1-hoard)', 'the note is the Rules tab’s');
  assert.equal(row(rows, 'track', 'Treasure')[2], '●○○○○', '6-treasure is 1-hoard and 1-treasure');
  assert.equal(row(rows, 'track', 'Hoard')[2], '●○○○○');

  assert.equal(await p.$('#newitem'), null, 'adding items needs edit mode');
  assert.equal(await p.$('[data-act="rm-item"]'), null, 'so does removing them');
  await p.click('[data-act="edit"]');
  await p.fill('#newitem', 'Rope');
  await p.press('#newitem', 'Enter');
  await p.fill('#newitem', 'Rope');
  await p.click('[data-act="add-item"]');
  await p.click('[data-act="rm-item"][data-j="0"]');
  await p.click('[data-act="rm-item"][data-j="0"]');
  await p.click('[data-act="edit"]');
  await p.click('.wealth [data-pip="t:Treasure"][data-j="4"]'); // fill treasure: it rolls over into hoard
  await p.click('[data-act="treasure"][data-n="-1"]'); // spending with no loose treasure breaks a hoard
  rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'track', 'Treasure')?.[2] === '●●●●○' && !row(r, 'item', 'Bone dice') && r; }); // the delete goes after a short hold
  assert.deepEqual(rows.filter(r => r[0] === 'item').map(r => r[1]), ['A lantern (cracked, still works)', 'Rope', 'Rope (2)']);
  assert.equal(row(rows, 'track', 'Hoard')[2], '●○○○○');
  assert.match(row(rows, 'kit', 'Treasure')[2], /6-treasure/);
});

test('items have counts and notes; using one, or changing the sheet outside edit mode, can go in the log', async () => {
  const base = (await h.tab(api, 'Testa')).map(r => r.slice(0, 4)).filter(r => r[0] !== 'item' && r[0] !== 'log');
  await h.setTab(api, 'Testa', [...base, ['item', 'Medkit', '2', 'From the clinic.'], ['item', 'Rope', '', '']]);
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="kit"]');
  await p.waitForSelector('[data-act="use-item"]');
  assert.match(await p.textContent('.items'), /×2/);

  // edit mode sets counts and notes
  await p.click('[data-act="edit"]');
  await p.fill('[data-bind="item:1:count"]', '5');
  await p.fill('[data-bind="item:1:note"]', 'Fifty feet.');
  await p.click('[data-act="edit"]');
  let rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'item', 'Rope')?.[2] === '5' && r; });
  assert.deepEqual(row(rows, 'item', 'Rope').slice(2, 4), ['5', 'Fifty feet.']);

  // notes show on the Notes tab under the item's name
  await p.click('[data-act="tab"][data-tab="notes"]');
  assert.match(await p.textContent('.kept'), /Medkit\s*From the clinic\.\s*Rope\s*Fifty feet\./);

  // using an item takes from its count and logs, with a note
  await p.click('[data-act="tab"][data-tab="kit"]');
  await p.click('[data-act="use-item"][data-j="0"]');
  await p.fill('[role="dialog"] [data-n]', '2');
  await p.fill('[role="dialog"] textarea', 'Patched up');
  await p.click('[role="dialog"] [data-use]');
  await p.waitForSelector('[data-act="use-item"][data-j="0"][disabled]');
  rows = await until(async () => { const r = await h.tab(api, 'Testa'); return r.some(x => x[0] === 'log' && x[2] === 'Medkit') && r; });
  assert.equal(row(rows, 'item', 'Medkit')[2], '0');
  assert.equal(rows.find(x => x[0] === 'log' && x[2] === 'Medkit')[3], '- Used 2, 0 left\n\nPatched up');

  // a use can be undone from the toast, or later from its log entry
  await p.click('.toast .tact');
  rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'item', 'Medkit')?.[2] === '2' && r; });
  assert.equal(rows.some(x => x[0] === 'log' && x[2] === 'Medkit'), false, 'its log entry is gone');
  await p.click('[data-act="use-item"][data-j="0"]');
  await p.fill('[role="dialog"] [data-n]', '2');
  await p.fill('[role="dialog"] textarea', 'Patched up');
  await p.click('[role="dialog"] [data-use]');
  await p.click('[data-act="tab"][data-tab="log"]');
  await p.click('[data-act="undo-use"]');
  rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'item', 'Medkit')?.[2] === '2' && r; });
  assert.equal(rows.some(x => x[0] === 'log' && x[2] === 'Medkit'), false);
  await p.click('[data-act="tab"][data-tab="kit"]');
  await p.click('[data-act="use-item"][data-j="0"]');
  await p.fill('[role="dialog"] [data-n]', '2');
  await p.click('[role="dialog"] [data-use]');
  await p.waitForSelector('[data-act="use-item"][data-j="0"][disabled]');

  // pips changed outside edit mode gather in one panel; clicks that cancel out drop off
  await p.click('[data-act="tab"][data-tab="sheet"]');
  await p.click('.harm .pip[data-j="1"]');
  await p.click('.harm .pip[data-j="2"]');
  await p.click('.luck .pip[data-j="0"]');
  await p.click('.luck .pip[data-j="0"]');
  assert.deepEqual(await p.$$eval('.usage li', ls => ls.map(l => l.textContent)), ['Harm +2']);
  await p.fill('.usage input', 'Dock fight');
  await p.click('.usage [data-log]');
  assert.equal(await p.$('.usage'), null);
  rows = await until(async () => { const r = await h.tab(api, 'Testa'); return r.some(x => x[0] === 'log' && x[2] === 'Harm +2') && r; });
  assert.equal(rows.find(x => x[0] === 'log' && x[2] === 'Harm +2')[3], 'Dock fight');

  // the panel's × undoes what it lists instead, even changes that went back and forth
  const harm = await track(p, 'harm');
  const sheetHarm = row(rows, 'track', 'Harm')[2];
  await p.click('.luck .pip[data-j="0"]');
  await p.click('.harm .pip[data-j="2"]');
  await p.click('.harm .pip[data-j="4"]');
  await p.click('.harm .pip[data-j="4"]');
  assert.deepEqual(await p.$$eval('.usage li', ls => ls.map(l => l.textContent)), ['Luck −1', 'Harm −1']);
  await until(async () => row(await h.tab(api, 'Testa'), 'track', 'Harm')[2] !== sheetHarm); // the change reached the sheet
  await p.click('.usage [data-undo]');
  assert.equal(await p.$('.usage'), null);
  // Cmd+Z undoes what the panel lists, too
  await p.click('.harm .pip[data-j="5"]');
  await p.keyboard.press('ControlOrMeta+KeyZ');
  assert.equal(await p.$('.usage'), null);
  assert.equal(await track(p, 'harm'), harm);
  rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'track', 'Harm')[2] === sheetHarm && r; });
  assert.equal(rows.filter(x => x[0] === 'log').length, 2, 'nothing logged');

  // edit mode changes don't offer to log
  await p.click('[data-act="edit"]');
  await p.click('.luck .pip[data-j="0"]');
  assert.equal(await p.$('.usage'), null);
  await p.click('[data-act="edit"]');
});

test('a delete waits a few seconds before it goes to the sheet, and the toast\'s Undo keeps it where it was', async () => {
  const marks = row(await h.tab(api, 'Testa'), 'bond', 'Passenger')[2];
  const p = await openSheet();
  const names = () => p.$$eval('[data-bind$=":name"][data-bind^="bond"]', bs => bs.map(b => b.value));
  await p.click('[data-act="edit"]');
  await p.click('[data-act="rm-bond"][data-j="1"]');
  await p.click('[data-act="rm-bond"][data-j="1"]');
  assert.deepEqual(await names(), ['Ship', 'Bo'], 'gone from the page at once');
  assert.match(await p.textContent('.toast.show'), /Deleted Passenger/);
  assert.equal(row(await h.tab(api, 'Testa'), 'bond', 'Passenger')[2], marks, 'still in the sheet');
  await p.click('.toast .tact');
  assert.deepEqual(await names(), ['Ship', 'Passenger', 'Bo'], 'back in its place');
  await sleep(2000); // past the (shortened) hold
  assert.equal(row(await h.tab(api, 'Testa'), 'bond', 'Passenger')[2], marks, 'never left the sheet');
  // Cmd+Z does the same
  await p.click('[data-act="rm-bond"][data-j="1"]');
  await p.click('[data-act="rm-bond"][data-j="1"]');
  await p.keyboard.press('ControlOrMeta+KeyZ');
  assert.deepEqual(await names(), ['Ship', 'Passenger', 'Bo']);

  // without Undo it goes once the hold is up, and other changes meanwhile don't send it early
  await p.click('[data-act="rm-bond"][data-j="1"]');
  await p.click('[data-act="rm-bond"][data-j="1"]');
  await p.fill('[data-bind="bond:0:name"]', 'The ship');
  await p.press('[data-bind="bond:0:name"]', 'Tab');
  await until(async () => row(await h.tab(api, 'Testa'), 'bond', 'The ship'));
  assert.ok(row(await h.tab(api, 'Testa'), 'bond', 'Passenger'), 'held while the rename went');
  assert.ok(await until(async () => !row(await h.tab(api, 'Testa'), 'bond', 'Passenger')));
  await p.fill('[data-bind="bond:0:name"]', 'Ship');
  await p.press('[data-bind="bond:0:name"]', 'Tab');
  await h.setTab(api, 'Testa', withRow(await h.tab(api, 'Testa'), ['bond', 'Passenger', marks, '']));
  await p.click('[data-act="edit"]');
});

test('the scratchpad on the Notes tab saves as you type, outside edit mode, here first and then to the sheet', async () => {
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="notes"]');
  await fail(1); // the first save is lost on the way: it stays in this browser and goes again
  await p.fill('.card.jot textarea', 'Owe Vex 2 treasure\nask about the map');
  assert.ok(await until(() => queued(p)), 'kept in this browser');
  assert.ok(await until(async () => row(await h.tab(api, 'Testa'), 'jot', 'Notes')?.[2] === 'Owe Vex 2 treasure\nask about the map'), 'reaches the sheet');
  assert.equal(await p.$('body.editing'), null, 'no edit mode needed');
  // someone else sees it, read-only
  const q = await openSheet(undefined, { as: null });
  await q.click('[data-act="tab"][data-tab="notes"]');
  await q.waitForSelector('.card.jot .rich');
  assert.equal(await q.$('.card.jot textarea'), null);
  assert.match(await q.$eval('.card.jot .rich', e => e.textContent), /Owe Vex/);
  await p.fill('.card.jot textarea', '');
  assert.ok(await until(async () => !row(await h.tab(api, 'Testa'), 'jot', 'Notes')), 'clearing it removes the row');
});

test('feedback: the button sends a note to the Feedback tab without who sent it, and keeps the draft until it goes', async () => {
  const p = await openSheet();
  await p.click('.fb');
  await p.fill('.fbtext', 'The log needs a search box.');
  await p.keyboard.press('Escape');
  await p.click('.fb');
  assert.equal(await p.inputValue('.fbtext'), 'The log needs a search box.', 'draft kept');
  await p.click('[data-send]');
  await p.waitForSelector('#overlay', { state: 'detached' });
  const rows = await until(async () => { const r = await h.tab(api, 'Feedback'); return r?.length > 1 && r; });
  assert.deepEqual(rows[0].slice(0, 2), ['Date', 'Feedback']);
  const last = rows[rows.length - 1];
  assert.equal(last[1], 'The log needs a search box.');
  assert.ok(!JSON.stringify(rows).includes('Testa'), 'nothing about who sent it');
  await p.click('.fb');
  assert.equal(await p.inputValue('.fbtext'), '', 'draft cleared once sent');
  await p.keyboard.press('Escape');
});

test('a full localStorage drops cached tabs to keep unsaved changes, and says so if even that fails', async () => {
  const p = await openSheet();
  await fail(50); // keep the change unsaved
  await p.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      const full = window.__full === 'always' || Object.keys(localStorage).some(x => /:tab:/.test(x));
      if (k.includes(':pending:') && full) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, k, v);
    };
  });
  await p.click('[data-pip="t:Experience"][data-j="4"]');
  const kept = await p.evaluate(() => ({
    tabs: Object.keys(localStorage).filter(k => /:tab:/.test(k)).length,
    pending: Object.keys(localStorage).filter(k => k.includes(':pending:')).map(k => localStorage.getItem(k)).join(''),
  }));
  assert.equal(kept.tabs, 0, 'cached tabs dropped');
  assert.match(kept.pending, /Experience/, 'the change is kept');
  await p.evaluate(() => { window.__full = 'always'; });
  await p.click('[data-pip="t:Experience"][data-j="5"]');
  await p.waitForFunction(() => /storage is full/.test(document.querySelector('.toast.show')?.textContent || ''));
  await fail(0);
});

test('a dialog keeps Tab inside it, scrolls when tall, and gives focus back when closed', async () => {
  const p = await openSheet({ width: 380, height: 260 });
  await p.focus('.gnav [data-nav="menu"]');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[role="dialog"]');
  const inside = () => p.evaluate(() => !!document.activeElement.closest('[role="dialog"]'));
  for (let i = 0; i < 25; i++) { await p.keyboard.press('Tab'); assert.ok(await inside(), `tab ${i}`); }
  await p.keyboard.press('Shift+Tab');
  assert.ok(await inside());
  const panel = await p.$eval('[role="dialog"]', d => ({ scroll: d.scrollHeight > d.clientHeight, fits: d.getBoundingClientRect().bottom <= innerHeight }));
  assert.ok(panel.fits, 'the dialog fits the screen');
  assert.ok(panel.scroll, 'and scrolls');
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.nav), 'menu');
});

test('a player uploads a picture for their character in edit mode; everyone sees it beside the name', async () => {
  const p = await openSheet();
  assert.equal(await p.$('.portrait'), null, 'no picture, no box outside edit mode');
  await p.click('[data-act="edit"]');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act="pic-add"]')]);
  await chooser.setFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png(1600, 800, [200, 40, 90])) });
  await p.waitForSelector('.pwrap .portrait img[src]');
  const images = await h.tab(api, 'Images');
  assert.equal(images.at(-1)[0], 'Testa', 'the upload is a new row of the Images tab, under the character’s name');
  const testa = await h.tab(api, 'Testa');
  const col = testa[0].indexOf('Image');
  assert.ok(col > 3, 'the tab got an Image column');
  assert.equal(row(testa, 'info', 'Name')[col], 'Testa', 'the Name row names the picture');

  // Someone else, not signed in as Testa, sees it too; it was scaled down for the sheet.
  const q = await openSheet(undefined, { as: null });
  await q.waitForSelector('a.portrait img[src]');
  assert.equal(await q.$eval('.portrait img', i => i.naturalWidth), 1024);
  assert.equal(await q.$('[data-act="pic-add"]'), null);

  // Edits elsewhere keep it; the owner can take it off (a second click confirms).
  await p.click('[data-act="add-pip"][data-path="t:Experience"]');
  await until(async () => !(await queued(p)));
  await p.waitForSelector('.pwrap .portrait img[src]');
  await p.click('[data-act="pic-rm"]');
  await p.click('[data-act="pic-rm"]');
  await p.waitForSelector('button.portrait.none[data-act="pic-add"]');
  await p.click('.toast .tact'); // Undo keeps it
  await p.waitForSelector('.pwrap .portrait img[src]');
  await sleep(2000);
  assert.ok(row(await h.tab(api, 'Testa'), 'info', 'Name')[col], 'still in the sheet');
  await p.click('[data-act="pic-rm"]');
  await p.click('[data-act="pic-rm"]');
  await p.waitForSelector('button.portrait.none[data-act="pic-add"]');
  assert.ok(await until(async () => row(await h.tab(api, 'Testa'), 'info', 'Name')[col] === ''));
  await q.close();
  await p.close();
});

test('phone width has no sideways scrolling, and no page errors anywhere', async () => {
  const p = await openSheet({ width: 380, height: 760 });
  for (const t of ['sheet', 'kit', 'moves', 'notes', 'log']) {
    await p.click(`[data-act="tab"][data-tab="${t}"]`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, t);
  }
  assert.deepEqual(h.errors, []);
});

test('a button pressed by keyboard keeps focus through the redraw, so it can be pressed again', async () => {
  const p = await openSheet({ width: 1100 });
  await p.click('[data-act="edit"]');
  const add = '[data-act="add-pip"][data-path="t:Experience"]';
  await p.waitForSelector(add);
  const before = await p.$$eval('[data-pip="t:Experience"]', ps => ps.length);
  await p.focus(add);
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  assert.equal(await p.$$eval('[data-pip="t:Experience"]', ps => ps.length), before + 2);
  assert.equal(await p.evaluate(() => document.activeElement.matches('[data-act="add-pip"][data-path="t:Experience"]')), true);
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Enter'); // the − next to it
  assert.equal(await p.$$eval('[data-pip="t:Experience"]', ps => ps.length), before + 1);
  await p.click('[data-act="edit"]');
});
