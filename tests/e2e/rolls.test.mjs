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

test('no page errors', () => { assert.deepEqual(h.errors, []); });
