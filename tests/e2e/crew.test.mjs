// Browser tests for the ship's crew tab and bonds that link to who they're with.
// Run: NODE_PATH=$(npm root -g) node --test tests/e2e/
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn, until } from './harness.mjs';
import { png } from '../fixtures/png.mjs';

const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);

let h;
let api;
test.before(async () => { h = await harness(); [api] = h.srv.apis; });
test.after(async () => { await h.close(); });

async function open(page, as = 'Testa') {
  const p = await h.page();
  await p.goto(`${h.srv.site}/${page}#join=${invite(api.url)}`);
  await p.waitForSelector('.tabs');
  if (as) await signIn(p, as);
  return p;
}
// A link's page and its params but the game's.
const where = href => { const u = new URL(href, 'http://x/'); u.searchParams.delete('g'); return u.pathname.slice(1) + u.search; };

test('a bond links to the ship, or to a crew member’s sheet on the ship’s crew tab', async () => {
  const p = await open('sheet.html?c=Testa', null);
  await p.waitForSelector('.bonds a.bn[href*="crew="]');
  const bonds = await p.$$eval('.bonds .bn', es => es.map(e => [e.textContent, e.getAttribute('href') || '']));
  assert.deepEqual(bonds.map(([n, l]) => [n, l && where(l)]), [['Ship', 'ship.html'], ['Passenger', ''], ['Bo', 'ship.html?crew=Bo+Brine']]);

  await p.click('.bonds a.bn[href*="crew="]');
  await p.waitForSelector('.crewsheet.hl');
  assert.equal(await p.$eval('.tabs button.on', b => b.dataset.tab), 'crew');
  assert.equal(await p.$eval('.crewsheet.hl h2', e => e.textContent), 'Bo Brine');
  await p.close();
});

test('a crew member’s sheet: kind, whose they are, harm, tags explained, and the bonds characters have with them', async () => {
  const p = await open('ship.html', null);
  await p.click('[data-act="tab"][data-tab="crew"]');
  await p.waitForSelector('.crewsheet');
  assert.match(await p.textContent('.crewhead'), /Crew\s*1\s*\(6 crew space\)/);
  assert.match(await p.textContent('.crewsheet .note'), /Deckhand · Hand of Testa/);
  assert.ok(await until(() => p.$eval('.crewsheet .portrait img', i => i.complete && i.naturalWidth === 32)), 'the Images tab’s picture under their name');
  assert.equal(where(await p.$eval('.crewsheet .note a', a => a.getAttribute('href'))), 'sheet.html?c=Testa');
  assert.deepEqual(await p.$$eval('.crewsheet .tagchip', es => es.map(e => [e.textContent, e.tagName, e.title])), [
    ['good at knots', 'A', 'Good at [something]: Take +1 when they help with it.'], ['jumpy', 'A', 'jumpy: Startles easily.'],
  ], 'tags the Rules tab defines are chips linking to them');
  assert.equal(await p.$eval('.crewsheet .tagchip', e => getComputedStyle(e).cursor), 'help');
  assert.equal(await p.textContent('.crewsheet .tagtext'), '1-harm', 'the rest are plain text');
  await p.click('.crewsheet a.tagchip >> text=good at knots');
  await p.waitForSelector('.gloss.hl');
  assert.equal(await p.$eval('.gloss.hl b', e => e.textContent), 'Good at [something]', 'the chip opens its entry on the Rules page');
  assert.equal(await p.$eval('.cats button.on', b => b.dataset.tab), 'tags');
  await p.goBack();
  await p.click('[data-act="tab"][data-tab="crew"]');
  await p.waitForSelector('.crewsheet');
  assert.match(await p.textContent('.crewsheet .lbonds'), /Bonds\s*Testa/);
  assert.equal(await p.$$eval('.crewsheet .lbonds .pip.on', es => es.length), 1);
  await p.click('[data-act="tab"][data-tab="sheet"]');
  await p.waitForSelector('.card h2 >> text=Cargo');
  assert.ok(!(await p.$$eval('.card h2', es => es.map(e => e.textContent))).includes('Crew'), 'the crew section row isn’t a card on the ship tab');
  await p.close();
});

test('editing the crew: harm pips, a new member from a kind, whose they are, a picture, removing one', async () => {
  const p = await open('ship.html');
  await p.click('[data-act="tab"][data-tab="crew"]');
  await p.waitForSelector('.crewsheet');

  // Harm marks outside edit mode, like any track.
  await p.click('.crewsheet [data-pip="c:0"][data-j="1"]');
  await until(async () => row(await h.tab(api, 'Ship'), 'crew', 'Bo Brine')?.[2] === '●●');

  await p.click('[data-act="edit"]');
  // Tags: one from the Rules tab's list becomes a chip; typed text stays plain; × takes one off.
  assert.deepEqual(await p.$$eval('#taglist option', os => os.map(o => o.value)), ['jumpy', 'Good at [something]', 'Armor-x']);
  await p.fill('#newtag-crew-0', 'armor-2');
  await p.keyboard.press('Enter');
  await p.fill('#newtag-crew-0', 'sings shanties');
  await p.click('[data-act="add-tag"][data-tags="crew-0"]');
  await until(async () => /Tags: 1-harm, good at knots, jumpy, armor-2, sings shanties/.test(row(await h.tab(api, 'Ship'), 'crew', 'Bo Brine')[3]));
  assert.deepEqual(await p.$$eval('.crewsheet.edit .tagchip', es => es.map(e => e.textContent)), ['good at knots', 'jumpy', 'armor-2']);
  assert.deepEqual(await p.$$eval('.crewsheet.edit .tagwrap .tagtext', es => es.map(e => e.textContent)), ['1-harm', 'sings shanties']);
  await p.click('[data-act="rm-tag"][data-tags="crew-0"][data-k="0"]');
  await until(async () => /Tags: good at knots, jumpy, armor-2, sings shanties\n/.test(row(await h.tab(api, 'Ship'), 'crew', 'Bo Brine')[3]));
  await p.click('.toast .tact'); // Undo puts it back first, where it was
  await until(async () => /Tags: 1-harm, good at knots, jumpy, armor-2, sings shanties\n/.test(row(await h.tab(api, 'Ship'), 'crew', 'Bo Brine')[3]));
  await p.click('[data-act="rm-tag"][data-tags="crew-0"][data-k="0"]');
  await until(async () => /Tags: good at knots, jumpy, armor-2, sings shanties\n/.test(row(await h.tab(api, 'Ship'), 'crew', 'Bo Brine')[3]));

  await p.selectOption('#newcrew', 'Deckhand');
  await p.click('[data-act="add-crew"]');
  await p.waitForSelector('.crewsheet.edit >> nth=1');
  let ada = await until(async () => row(await h.tab(api, 'Ship'), 'crew', 'Ada Keel'));
  assert.deepEqual(ada.slice(2, 4), ['○○', 'Type: Deckhand\nTags: 1-harm, good at knots, jumpy\n\nOne gold tooth.'], 'the first free sample name, its tags and harm');

  await p.selectOption('.crewsheet.edit >> nth=1 >> [data-bind="crew:1:serves"]', 'Testa');
  ada = await until(async () => { const r = row(await h.tab(api, 'Ship'), 'crew', 'Ada Keel'); return /Serves: Testa/.test(r[3]) && r; });
  assert.match(ada[3], /^Type: Deckhand\nServes: Testa\n/);

  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.crewsheet.edit >> nth=1 >> [data-act="pic-add"]')]);
  await chooser.setFiles({ name: 'ada.png', mimeType: 'image/png', buffer: Buffer.from(png(300, 300, [20, 140, 90])) });
  await p.waitForSelector('.crewsheet.edit >> nth=1 >> .portrait img[src]');
  const ship = await h.tab(api, 'Ship');
  const col = ship[0].indexOf('Image');
  assert.ok(col > 3, 'the tab got an Image column');
  assert.equal(row(ship, 'crew', 'Ada Keel')[col], 'Ada Keel', 'the crew row names the picture');
  assert.equal(row(ship, 'info', 'Name')[col], '', 'not the ship’s');
  assert.equal((await h.tab(api, 'Images')).at(-1)[0], 'Ada Keel');

  await p.click('.crewsheet.edit >> nth=1 >> [data-act="rm-crew"]');
  await p.click('.crewsheet.edit >> nth=1 >> [data-act="rm-crew"]'); // a second click confirms
  await until(async () => !row(await h.tab(api, 'Ship'), 'crew', 'Ada Keel'));
  await p.close();
});

test('in edit mode a bond can link to someone its name doesn’t match, or to no one', async () => {
  const p = await open('sheet.html?c=Testa');
  await p.click('[data-act="edit"]');
  await p.selectOption('[data-bind="bond:1:to"]', 'Bo Brine');
  await until(async () => row(await h.tab(api, 'Testa'), 'bond', 'Passenger')?.[3] === 'Bo Brine');
  await p.selectOption('[data-bind="bond:0:to"]', '-');
  await until(async () => row(await h.tab(api, 'Testa'), 'bond', 'Ship')?.[3] === '-');
  await p.click('[data-act="edit"]');
  const bonds = await p.$$eval('.bonds .bn', es => es.map(e => [e.textContent, e.tagName]));
  assert.deepEqual(bonds, [['Ship', 'SPAN'], ['Passenger', 'A'], ['Bo', 'A']]);
  await p.close();
});

test('a character’s picture shows on their card on the crew home, without opening it full size', async () => {
  const p = await open('sheet.html?c=Testa');
  await p.click('[data-act="edit"]');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act="pic-add"]')]);
  await chooser.setFiles({ name: 'testa.png', mimeType: 'image/png', buffer: Buffer.from(png(40, 40, [200, 60, 60])) });
  await until(async () => (await h.tab(api, 'Images')).at(-1)[0] === 'Testa');
  await p.goto(p.url().replace(/sheet\.html\?[^#]*/, 'index.html'));
  await p.waitForSelector('.crewcard');
  assert.ok(await until(() => p.$eval('.crewcard:has(h2:text("Testa")) .portrait img', i => i.complete && i.naturalWidth === 40)));
  assert.equal(await p.$eval('.crewcard:has(h2:text("Testa")) .portrait', e => e.tagName), 'SPAN', 'the card itself is the link');
  await p.close();
});
