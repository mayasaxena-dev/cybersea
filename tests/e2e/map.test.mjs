// Browser tests for the map you can explore: places on the region's picture open their cards, a
// place's levels and spots, the stack, static, the ship, and the GM arranging it all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, until } from './harness.mjs';
import { KEYS, IMAGES, gameTabs } from '../fixtures/game.mjs';

const pic = image => ({ image });
const H = ['Region', 'Location', 'Level', 'Image', 'Text', 'GM notes', 'Shown', 'On', 'Where', 'Depth'];
const mapRows = () => [
  ['The Test Server', '', '', pic(IMAGES.map), 'Everything, all at once.', '', '', '', '', ''],
  ['The Test Server', 'Packet Reef', '', pic(IMAGES.dock), 'A reef of lost packets.', 'Sharks below.', 'on', '', '30 40 20', '2'],
  ['The Test Server', 'Scrap Town', '', pic(IMAGES.level1), 'A town of scrap.', '', 'on', '', '70 60 16', ''],
  ['', 'Scrap Town', 'Level 1', pic(IMAGES.level1), 'The docks.', '', '', '', '50 10 90 12', ''],
  ['', 'Scrap Town', 'Level 2', pic(IMAGES.level2), 'The market.', '', '', '', '50 30 90 12', ''],
  ['', 'Phreakerz', '', '', 'Hackers, mostly.', '', 'on', 'Scrap Town / Level 1', '50 70 30 20', ''],
  ['The Test Server', 'Secret Lair', '', pic(IMAGES.dock), 'Nobody knows.', '', 'static', '', '85 20 10', ''],
  ['The Test Server', 'Hidden Dock', '', pic(IMAGES.dock), 'Only the GM knows.', '', '', '', '10 85 10', ''],
  ['The Test Server', 'The Gull', '', pic(IMAGES.level2), 'Our ship.', '', 'on', '', '50 20 8', ''],
  ['The Test Server', 'Lost Isle', '', '', 'Off the map.', '', 'on', '', '', ''],
];

let h;
let api;
test.before(async () => {
  const tabs = gameTabs();
  tabs.Map = [H, ...mapRows()];
  h = await harness({ gameOptions: [{ tabs }] });
  [api] = h.srv.apis;
});
test.after(async () => { await h.close(); });

const join = (p, key) => p.goto(`${h.srv.site}/map.html#join=${invite(api.url, key)}`);
const loaded = p => until(() => p.$$eval('.mstage img', is => is.length > 0 && is.every(i => i.complete && i.naturalWidth > 0)));
// Clicks (x, y) percent of the picture on screen.
async function at(p, x, y, sel = '.mstage .mworld') {
  const b = await p.locator(sel).first().boundingBox();
  return { x: b.x + b.width * x / 100, y: b.y + b.height * y / 100 };
}
async function clickAt(p, x, y) { const c = await at(p, x, y); await p.mouse.click(c.x, c.y); }
const cardName = p => p.textContent('#mapcard h2').catch(() => null);
const where = async name => (await h.tab(api, 'Map')).find(r => r[1] === name && !r[2])?.[8];

test('crew explore the map: a click opens the place under it, a static place says nothing, a place off the map is a card', async () => {
  const p = await h.page({ width: 1000, height: 900 });
  await join(p);
  await p.waitForSelector('.mstage .mlay');
  assert.ok(await loaded(p), 'the map and its places load');
  assert.equal(await p.locator('.mgroup .worldmap > .mstage + .mchips').count(), 1, 'the stage sits under the region heading, its places listed under it');
  assert.equal(await p.locator('.mlay.floats').count(), 1, 'Depth floats Packet Reef');
  assert.equal(await p.locator('.mlay.ship .mlabel').textContent(), 'The Gull', 'the ship is a marker with its name');
  assert.equal(await p.locator('.mlay.static').count(), 1);
  assert.doesNotMatch(await p.content(), /Secret Lair|Nobody knows|Hidden Dock/, 'a static place reaches the crew nameless; a hidden one not at all');
  assert.deepEqual(await p.$$eval('.loc:not(.open) h2', hs => hs.map(x => x.textContent)), ['Lost Isle'], 'a place with no Where is a card under the map');

  await clickAt(p, 30, 40);
  assert.equal(await until(() => cardName(p)), 'Packet Reef');
  assert.match(await p.textContent('#mapcard'), /lost packets/);
  assert.doesNotMatch(await p.textContent('#mapcard'), /Sharks/);
  await p.keyboard.press('Escape'); // the card sits over the map's right side
  await clickAt(p, 85, 20);
  assert.equal(await until(async () => (await cardName(p)) === 'Unknown signal' && 'yes'), 'yes');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#mapcard .card').count(), 0);
  await clickAt(p, 5, 5); // nothing there
  assert.equal(await p.locator('#mapcard .card').count(), 0);
  await p.click('.mchips [data-open="packet reef"]');
  assert.equal(await until(() => cardName(p)), 'Packet Reef', 'the place buttons under the map open cards too');
});

test('crew go inside a place: its levels, picked by name, by the side view or from the stack, and its spots', async () => {
  const p = await h.page({ width: 1000, height: 900 });
  await join(p);
  await p.waitForSelector('.mstage .mlay');
  await loaded(p);
  await clickAt(p, 70, 60);
  await p.click('#mapcard [data-enter]');
  await p.waitForSelector('.minside');
  assert.equal(await p.textContent('.minside'), 'Scrap Town');
  await loaded(p);
  assert.match(await p.textContent('main .loc'), /The docks/);
  assert.equal(await p.locator('.mareas .ma.lvl').count(), 2, 'each level\'s band on the picture');

  await clickAt(p, 50, 30);
  await p.waitForSelector('[data-go="1"][aria-pressed="true"]');
  assert.match(await p.textContent('main .loc'), /The market/, 'a click on a band goes to that level');
  await p.click('[data-go="0"]');
  await p.waitForSelector('[data-go="0"][aria-pressed="true"]');
  await loaded(p);
  await clickAt(p, 50, 70);
  assert.equal(await until(() => cardName(p)), 'Phreakerz', 'a spot on the level opens its card');
  assert.match(await p.textContent('#mapcard .mwhere'), /Scrap Town · Level 1/);
  await p.click('[data-close-card]');

  await p.click('[data-stack]');
  assert.equal(await p.locator('.mplane').count(), 2);
  await p.click('.mplane[data-go="1"]');
  await p.waitForSelector('[data-go="1"][aria-pressed="true"]');
  await p.click('[data-out]');
  await p.waitForSelector('.mgroup .mstage');
});

test('the GM arranges the map: drags a place, undoes it, marks out a new one, and shows one as static', async () => {
  const g = await h.page({ width: 1000, height: 900 });
  await join(g, KEYS.GM_KEY);
  await g.waitForSelector('[data-arrange]');
  await loaded(g);
  assert.match(await g.content(), /Hidden Dock/, 'the GM sees every place');
  assert.equal(await g.locator('.mlay.hid').count(), 1);
  await g.click('[data-arrange]');
  const a = await at(g, 30, 40), b = await at(g, 40, 50);
  await g.mouse.move(a.x, a.y);
  await g.mouse.down();
  await g.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await g.mouse.move(b.x, b.y, { steps: 4 });
  await g.mouse.up();
  const moved = await until(async () => { const w = await where('Packet Reef'); return w !== '30 40 20' && w; });
  const [x, y, w] = moved.split(' ').map(Number);
  assert.ok(Math.abs(x - 40) < 1.5 && Math.abs(y - 50) < 1.5 && w === 20, `moved to ${moved}`);
  await g.click('.toast .tact');
  assert.equal(await until(async () => (await where('Packet Reef')) === '30 40 20' && 'back'), 'back', 'Undo puts it back');

  const c = await at(g, 10, 30), d = await at(g, 20, 40);
  await g.mouse.move(c.x, c.y);
  await g.mouse.down();
  await g.mouse.move(d.x, d.y, { steps: 5 });
  await g.mouse.up();
  await g.waitForSelector('#overlay [data-f="where"]');
  const drawn = (await g.inputValue('#overlay [data-f="where"]')).split(' ').map(Number);
  assert.equal(drawn.length, 4, 'an area');
  assert.ok(Math.abs(drawn[0] - 15) < 1.5 && Math.abs(drawn[2] - 10) < 1.5, drawn.join(' '));
  await g.fill('#overlay [data-f="name"]', 'Fresh Spot');
  await g.click('#overlay [data-save]');
  assert.ok(await until(async () => (await h.tab(api, 'Map')).some(r => r[1] === 'Fresh Spot' && r[8].split(' ').length === 4)), 'the new place has its Where');

  await g.click('[data-arrange]');
  await g.click('.mchips [data-open="hidden dock"]');
  await g.click('#mapcard [data-to="static"]');
  assert.ok(await until(async () => (await h.tab(api, 'Map')).find(r => r[1] === 'Hidden Dock')?.[6] === 'static'));
  assert.deepEqual(h.errors, []);
});
