// Browser tests for rolls shared with the table (rolls.js) against the dev server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn, until, polls } from './harness.mjs';
import { KEYS } from '../fixtures/game.mjs';

let h;
let api;
test.before(async () => { h = await harness(); [api] = h.srv.apis; });
test.after(async () => { await h.close(); });

const rollStat = async (p, i = 0) => {
  await p.click(`[data-act="roll-stat"][data-i="${i}"]`);
  await p.click('#toast .roll-go');
  await p.waitForSelector('#toast .tot');
  return { faces: await p.$$eval('#toast .die', ds => ds.map(d => +d.textContent)), total: +(await p.textContent('#toast .tot')) };
};
const rolls = async () => ((await h.tab(api, 'Rolls')) || []).slice(1);

test('a roll on a sheet reaches the Rolls tab, pops up on the rest of the crew’s pages, and waits in the feed', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url)}`);
  await p.waitForSelector('h1.name');
  await signIn(p, 'Testa');
  const crew = await h.page();
  await crew.goto(`${h.srv.site}/#join=${invite(api.url)}`);
  await crew.waitForSelector('.crewcard h2');
  await crew.waitForSelector('.rl');
  assert.equal(await crew.$eval('.rcount', e => e.hidden), true, 'nothing new yet');

  const { faces, total } = await rollStat(p, 3); // Spitfire +2
  const got = await until(async () => { const r = await rolls(); return r.length && r; });
  const [when, who, label, dice, mod, tot, as] = got.at(-1);
  assert.match(when, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual([who, label, dice, mod, tot, as], ['Testa', 'Spitfire', faces.join(' '), '+2', String(total), '']);
  assert.deepEqual((await h.tab(api, 'Rolls'))[0], ['When', 'Who', 'Roll', 'Dice', 'Mod', 'Total', 'By']);

  // the crew page hears of it: a pop-up and a count on the die button
  await crew.waitForSelector('.rpeek');
  assert.match(await crew.textContent('.rpeek'), new RegExp(`Testa.*Spitfire.*=${total}`, 's'));
  assert.equal(await crew.textContent('.rcount'), '1');
  await crew.click('.rl');
  assert.equal(await crew.$$eval('.rfeed .rroll', es => es.length), 1);
  assert.equal(await crew.$eval('.rcount', e => e.hidden), true, 'looked at');
  assert.equal(await crew.$('.rfeed [data-rshare]'), null, 'no sharing switch on a page without dice');
  await crew.click('.rfeed [data-rclose]');
  assert.equal(await crew.$eval('.rfeed', e => e.hidden), true);

  // the roller's own page shows it in the feed, without a pop-up or a count
  await until(async () => (await p.$$eval('.rfeed', () => 1)) && !(await p.$('.rpeek')));
  assert.equal(await p.$eval('.rcount', e => e.hidden), true);
  await p.click('.rl');
  await p.waitForSelector('.rfeed .rroll');

  // turned off, rolls stay on this page
  await p.uncheck('.rfeed [data-rshare]');
  await rollStat(p);
  await polls(p, 3);
  assert.equal((await rolls()).length, 1);
  await p.check('.rfeed [data-rshare]');
});

test('the GM’s roll on a character’s sheet says the GM rolled it', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url, KEYS.GM_KEY)}`);
  await p.waitForSelector('h1.name');
  await p.waitForSelector('.gnav .who-gm');
  const before = (await rolls()).length;
  await rollStat(p);
  const got = await until(async () => { const r = await rolls(); return r.length > before && r; });
  assert.deepEqual([got.at(-1)[1], got.at(-1)[6]], ['Testa', 'GM']);
});

test('a roll made with real dice is entered under a stat and shared, even with sharing off', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url)}`);
  await p.waitForSelector('h1.name');
  await signIn(p, 'Testa');
  await p.click('.rl');
  await p.uncheck('.rfeed [data-rshare]');
  assert.deepEqual(await p.$$eval('.rfeed [data-rstat] option', os => os.map(o => o.textContent)), ['Blood 0', 'Vinegar −1', 'Polish 0', 'Spitfire +2']);
  const before = (await rolls()).length;

  // a die that isn't 1 to 6 is turned down
  await p.selectOption('.rfeed [data-rstat]', { label: 'Vinegar −1' });
  await p.fill('.rfeed [data-rdie="0"]', '7');
  await p.fill('.rfeed [data-rdie="1"]', '3');
  await p.click('.rfeed [data-rmanual] button');
  await p.waitForSelector('.rfeed .status.err');
  assert.equal((await rolls()).length, before);

  await p.fill('.rfeed [data-rdie="0"]', '6');
  await p.click('.rfeed [data-rmanual] button');
  const got = await until(async () => { const r = await rolls(); return r.length > before && r; });
  assert.deepEqual(got.at(-1).slice(1), ['Testa', 'Vinegar · real dice', '6 3', '-1', '8', '']);
  await until(async () => (await p.inputValue('.rfeed [data-rdie="0"]')) === '');
  assert.match(await p.textContent('.rfeed .rroll:last-child'), /Vinegar · real dice.*=8.*7-9/s);
  assert.equal(await p.$('.rfeed .status.err'), null, 'the note about the bad die goes once one is shared');
  assert.equal(await p.inputValue('.rfeed [data-rstat]'), '1', 'the stat stays picked');
  await p.check('.rfeed [data-rshare]');
});

test('a player deletes their own rolls (with a second click), not anyone else’s; the GM deletes any', async () => {
  await h.setTab(api, 'Rolls', [
    ['When', 'Who', 'Roll', 'Dice', 'Mod', 'Total', 'By'],
    ['2026-11-06T10:00:00Z', 'Rook', 'Blood', '2 3', '', '5', ''],
    ['2026-11-06T10:01:00Z', 'Testa', 'Polish', '6 6', '', '12', ''],
    ['2026-11-06T10:02:00Z', 'The Ship', 'Speed', '1 1', '+2', '4', 'Testa'],
  ]);
  const p = await h.page();
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url)}`);
  await p.waitForSelector('h1.name');
  await signIn(p, 'Testa');
  await p.click('.rl');
  await until(async () => (await p.$$('.rfeed .rroll')).length === 3);
  assert.deepEqual(await p.$$eval('.rfeed .rroll', es => es.map(e => !!e.querySelector('[data-rdel]'))), [false, true, true]);
  await p.click('.rfeed [data-rdel="1"]');
  await polls(p, 2);
  assert.equal((await rolls()).length, 3, 'one click only arms it');
  await p.click('.rfeed [data-rdel="1"]');
  const left = await until(async () => { const r = await rolls(); return r.length === 2 && r; });
  assert.deepEqual(left.map(r => r[2]), ['Blood', 'Speed']);
  await until(async () => (await p.$$('.rfeed .rroll')).length === 2);

  const gm = await h.page();
  await gm.goto(`${h.srv.site}/lore.html#join=${invite(api.url, KEYS.GM_KEY)}`);
  await gm.waitForSelector('.rl');
  await gm.click('.rl');
  await until(async () => (await gm.$$('.rfeed [data-rdel]')).length === 2);
  await gm.click('.rfeed [data-rdel="0"]');
  await gm.click('.rfeed [data-rdel="0"]');
  assert.deepEqual((await until(async () => { const r = await rolls(); return r.length === 1 && r; })).map(r => r[2]), ['Speed']);
});

test('pages without a sheet have no form for real dice', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/lore.html#join=${invite(api.url)}`);
  await p.waitForSelector('.rl');
  await p.click('.rl');
  assert.equal(await p.$('.rfeed [data-rmanual]'), null);
});

test('no page errors', () => { assert.deepEqual(h.errors, []); });
