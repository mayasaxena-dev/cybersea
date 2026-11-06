// Browser tests for the crew home, ship, lore and rules pages, and for running two games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn, until, polls, sleep } from './harness.mjs';
import { KEYS, IMAGES, gameTabs } from '../fixtures/game.mjs';
import { png } from '../fixtures/png.mjs';

const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);
// fn's answer once it equals want (a search redraws once typing pauses), or its last answer.
async function settled(fn, want) {
  return until(async () => { const v = await fn(); return JSON.stringify(v) === JSON.stringify(want) ? v : null; }) ?? fn();
}

let h;
let g1;
let g2;
test.before(async () => {
  const noShip = gameTabs();
  delete noShip.Ship;
  delete noShip.Map;
  h = await harness({ games: 2, gameOptions: [{}, { tabs: noShip }] });
  [g1, g2] = h.srv.apis;
});
test.after(async () => { await h.close(); });

const join = (p, api, page = '', key) => p.goto(`${h.srv.site}/${page}#join=${invite(api.url, key, api === g1 ? 'Fixture Game' : 'Second Game')}`);

test('with no game, the start page offers to join by invite link', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/`);
  await p.fill('[data-join] input', `${h.srv.site}/#join=${invite(g1.url)}`);
  await p.click('[data-join] button');
  await p.waitForSelector('.crewcard');
  assert.match(p.url(), /[?&]g=/);
});

test('crew home shows each character (not the ship) and makes new characters', async () => {
  const p = await h.page();
  await join(p, g1);
  await p.waitForSelector('.crewcard h2');
  const names = await until(async () => { const n = await p.$$eval('.crewcard h2', hs => hs.map(x => x.textContent)); return n.length === 1 && n; });
  assert.deepEqual(names, ['Testa']);
  assert.equal(await p.$('.crewcard[href*="ship.html"]'), null, 'the ship has its own page');
  await p.click('[data-act="new"]');
  await p.fill('[data-f="name"]', 'Matt');
  await p.fill('[data-f="player"]', 'Jo');
  await p.selectOption('[data-f="playbook"]', 'Trickster');
  await p.selectOption('[data-f="oddity"]', 'CARD SHARP');
  await p.click('[data-create]');
  await p.waitForURL(/sheet\.html\?.*c=Matt/);
  await p.waitForSelector('h1.name');
  assert.ok(await until(async () => (await p.textContent('.gnav .who')) === 'Matt'), 'a player\'s new character is theirs');
  assert.ok(await until(async () => (await signedIn(g1, 'Matt')) === 'yes'));
  const rows = await h.tab(g1, 'Matt');
  assert.equal(row(rows, 'info', 'Player')[2], 'Jo');
  assert.equal(row(rows, 'stat', 'Blood')[2], '-2');
  assert.equal(row(rows, 'stat', 'Spitfire')[2], '+1');
  assert.equal(row(rows, 'track', 'Harm')[2], '○○○○○○');
  assert.equal(row(rows, 'track', 'Luck')[2], '●○○○○○○○', 'luck starts at Spitfire');
  assert.equal(row(rows, 'move', 'SUMMON')[2], '●');
  assert.equal(row(rows, 'move', 'HEX'), undefined, 'advance moves start unmarked');
  assert.match(row(rows, 'sheet', 'Oddity')[2], /^\*\*CARD SHARP\*\*/);
  assert.match(row(rows, 'notes', 'Last Words')[2], /last words/);
  assert.equal(row(rows, 'sheet', 'Kit'), undefined, 'the kit is items now');
  assert.deepEqual(rows.filter(r => r[0] === 'item').map(r => r[1]), ['Dagger', 'Cloak', 'Tarot deck']);
  assert.equal(row(rows, 'track', 'Treasure')[2], '○○○○○');
});

test('playbooks with an extra starting move offer the pick', async () => {
  const p = await h.page();
  await join(p, g1);
  await p.waitForSelector('[data-act="new"]');
  await p.click('[data-act="new"]');
  await p.fill('[data-f="name"]', 'Bruno');
  await p.selectOption('[data-f="playbook"]', 'Brute');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.f), 'playbook', 'focus stays on the playbook');
  await p.selectOption('[data-f="extraMove"]', 'ROAR');
  await p.click('[data-create]');
  await p.waitForURL(/c=Bruno/);
  const rows = await h.tab(g1, 'Bruno');
  assert.deepEqual(rows.filter(r => r[0] === 'move').map(r => r[1]), ['SMASH', 'ROAR']);
});

test('ship page: ship stats roll, ship moves only', async () => {
  const p = await h.page();
  await join(p, g1, 'ship.html');
  await p.waitForSelector('h1.name');
  assert.equal(await p.textContent('h1.name'), 'The Gull');
  assert.deepEqual(await p.$$eval('.vitals .lbl', ls => ls.map(l => l.textContent)), ['Wreck', 'Renown']);
  await p.click('[data-act="roll-stat"][data-i="1"]');
  assert.match(await p.textContent('#toast'), /Speed/);
  await p.click('[data-act="tab"][data-tab="moves"]');
  assert.deepEqual(await p.$$eval('.mgroup h3', hs => hs.map(x => x.textContent)), ['Ship moves'], 'the ship hasn’t marked its own move');
  await p.click('[data-act="more"]');
  assert.deepEqual(await p.$$eval('.mgroup h3', hs => hs.map(x => x.textContent)), ['Skiff moves', 'Ship moves']);
  assert.equal(await p.$('[data-tab="log"]'), null, 'no actions tab for the ship');
});

test('ship kit and cargo: lists on the Ship tab like a character’s items, used without a log', async () => {
  const p = await h.page();
  await join(p, g1, 'ship.html');
  await p.waitForSelector('[data-list="cargo"]');
  assert.equal(await p.$('[data-act="tab"][data-tab="kit"]'), null, 'the ship has no Kit tab');
  assert.deepEqual(await p.$$eval('main [data-list] h2', hs => hs.map(x => x.textContent)), ['Kit', 'Cargo']);
  assert.match(await p.textContent('[data-list="cargo"]'), /6 cargo space.*Crate of limes\s*×2/s);
  assert.match(await p.textContent('[data-list="item"]'), /Two oars/);
  assert.equal(await p.$('[data-act="use-item"]'), null, 'using cargo needs a sign-in');
  await signIn(p, 'Testa');
  await p.click('[data-act="use-item"][data-kind="cargo"][data-j="0"]');
  assert.equal(await p.$('[role="dialog"] textarea'), null, 'no log, so no note');
  await p.click('[role="dialog"] [data-use]');
  let rows = await until(async () => { const r = await h.tab(g1, 'Ship'); return row(r, 'cargo', 'Crate of limes')?.[2] === '1' && r; });
  assert.ok(rows, 'one crate used');
  assert.equal(rows.some(r => r[0] === 'log'), false);
  await p.click('.toast .tact');
  rows = await until(async () => { const r = await h.tab(g1, 'Ship'); return row(r, 'cargo', 'Crate of limes')?.[2] === '2' && r; });
  assert.ok(rows, 'undo gives it back');

  // edit mode adds cargo; its notes show on the Notes tab
  await p.click('[data-act="edit"]');
  await p.fill('#newcargo', 'Barrel of rum');
  await p.press('#newcargo', 'Enter');
  await p.fill('[data-bind="cargo:1:note"]', 'Stolen.');
  await p.click('[data-act="edit"]');
  rows = await until(async () => { const r = await h.tab(g1, 'Ship'); return row(r, 'cargo', 'Barrel of rum')?.[3] === 'Stolen.' && r; });
  assert.ok(rows);
  assert.equal(row(rows, 'item', 'Barrel of rum'), undefined, 'cargo, not a kit item');
  await p.click('[data-act="tab"][data-tab="notes"]');
  assert.match(await p.textContent('.kept'), /Cargo\s*Barrel of rum\s*Stolen\./);
});

test('a game without a Ship tab offers to set one up from a ship playbook', async () => {
  const p = await h.page();
  await join(p, g2, 'ship.html');
  await p.waitForSelector('.robar');
  assert.equal(await p.$('.setup'), null, 'setting up the ship needs a sign-in');
  await signIn(p, 'Testa');
  await p.waitForSelector('.setup');
  await p.fill('[data-setup="name"]', 'Sea Wasp');
  await p.click('[data-act="ship-create"]');
  await p.waitForSelector('h1.name');
  const rows = await h.tab(g2, 'Ship');
  assert.equal(row(rows, 'info', 'Name')[2], 'Sea Wasp');
  assert.equal(row(rows, 'stat', 'Speed')[2], '+2');
  assert.equal(row(rows, 'track', 'Wreck')[2], '○○○', 'wreck tally is Steadfast + 3');
  assert.equal(row(rows, 'move', 'SLIP AWAY')[2], '●');
  assert.deepEqual(rows.filter(r => r[0] === 'item').map(r => r[1]), ['Two oars', 'A lantern'], 'the kit is items');
  assert.deepEqual(row(rows, 'sheet', 'Cargo').slice(2, 4), ['', '(6 cargo space)']);
});

test('lore: read, search, add, edit and delete entries', async () => {
  const p = await h.page();
  await join(p, g1, 'lore.html');
  await p.waitForSelector('main .card h2');
  assert.equal(await p.textContent('main .card h2'), 'Gull Harbor');
  assert.equal(await p.$('[data-act="edit"]'), null, 'read-only until signed in');
  await signIn(p, 'Testa');
  await p.click('[data-act="edit"]');
  await p.click('[data-act="add"]');
  const title = p.locator('input[data-f="name"]').nth(1);
  await title.fill('The Drowned Bell');
  await title.press('Tab');
  await p.locator('textarea[data-f="value"]').nth(1).fill('- rings at low tide');
  const kind = p.locator('input[data-f="kind"]').nth(1);
  await kind.fill('Rumors');
  await kind.press('Tab');
  const rows = await until(async () => { const r = await h.tab(g1, 'Lore'); return row(r, 'Rumors', 'The Drowned Bell')?.[2] === '- rings at low tide' && r; });
  assert.ok(rows, 'new entry saved');
  assert.equal(row(rows, 'place', 'New entry'), undefined);
  await p.click('[data-act="edit"]');
  await p.fill('#q', 'bell');
  assert.deepEqual(await settled(() => p.$$eval('main .card h2', hs => hs.map(x => x.textContent)), ['The Drowned Bell']), ['The Drowned Bell']);
  await p.fill('#q', '');
  await p.click('[data-act="edit"]');
  // the toast's Undo puts it back where it was, if pressed in time
  await p.click('[data-act="rm"][data-i="1"]');
  await p.click('[data-act="rm"][data-i="1"]');
  assert.match(await p.textContent('.toast.show'), /Deleted The Drowned Bell/);
  await p.click('.toast .tact');
  await p.waitForSelector('[data-act="rm"][data-i="1"]');
  assert.equal(await p.$eval('[data-f="name"][data-i="1"]', e => e.value), 'The Drowned Bell');
  await sleep(2000);
  assert.ok(row(await h.tab(g1, 'Lore'), 'Rumors', 'The Drowned Bell'), 'never left the sheet');
  await p.click('[data-act="rm"][data-i="1"]');
  await p.click('[data-act="rm"][data-i="1"]');
  assert.ok(await until(async () => !row(await h.tab(g1, 'Lore'), 'Rumors', 'The Drowned Bell')));
});

test('lore: someone else\'s edit made while you type shows once you stop', async () => {
  const p = await h.page();
  await join(p, g2, 'lore.html');
  await signIn(p, 'Testa');
  await p.click('[data-act="edit"]');
  await p.locator('input[data-f="name"]').first().click();
  await h.setTab(g2, 'Lore', [['Kind', 'Name', 'Value', 'Notes', 'Image'], ['place', 'Gull Harbor', 'A sunny port.', 'Sam', '']]);
  await polls(p); // polls bring it while the field has focus: held
  assert.equal(await p.locator('textarea[data-f="value"]').first().inputValue(), 'A rainy port.');
  await p.evaluate(() => document.activeElement.blur());
  assert.ok(await until(async () => (await p.locator('textarea[data-f="value"]').first().inputValue()) === 'A sunny port.'));
});

test('rules page: sections, search, and no GM-only rules for the crew', async () => {
  const p = await h.page();
  await join(p, g1, 'rules.html');
  await p.waitForSelector('#ref .mgroup');
  const tabs = await p.$$eval('.cats button', bs => bs.map(b => b.textContent));
  assert.ok(!tabs.includes('Fates'), tabs.join());
  await p.fill('#q', 'poke');
  assert.deepEqual(await settled(() => p.$$eval('#ref .mn', ms => ms.map(m => m.textContent)), ['POKE AROUND']), ['POKE AROUND']);
  await p.fill('#q', 'trap');
  await p.waitForSelector('#ref :text("No matches")');
  await p.fill('#q', '');
  await p.click('.cats button:has-text("Playbooks")');
  assert.deepEqual(await p.$$eval('#ref .move.pbook .mn', ms => ms.map(m => m.textContent)), ['Trickster', 'Brute', 'Skiff']);
  // a playbook opens below its name in sentence case, not beside it in capitals (the sheet's .pb)
  await p.click('#ref .move.pbook >> nth=0 >> summary');
  const look = await p.$eval('#ref .move.pbook', d => {
    const s = d.querySelector('summary').getBoundingClientRect(), b = d.querySelector('.mbody').getBoundingClientRect();
    return { below: b.top >= s.bottom, upper: getComputedStyle(d.querySelector('.mbody')).textTransform === 'uppercase' };
  });
  assert.deepEqual(look, { below: true, upper: false });
});

test("rules page: a row's override first, with the book's under it", async () => {
  const p = await h.page();
  await join(p, g1, 'rules.html');
  await p.waitForSelector('#ref .mgroup');
  await p.fill('#q', 'data cable');
  await p.waitForSelector('#ref details.orig');
  assert.match(await p.textContent('#ref .mbody'), /Club, sack, data cable/);
  assert.match(await p.textContent('#ref details.orig'), /Club, sack, rope/);
});

test('long kit items and notes stay inside their card', async () => {
  const { sampleCharacter, HEADER } = await import('../fixtures/game.mjs');
  const long = 'word '.repeat(60).trim();
  await h.setTab(g1, 'Kitty', [HEADER, ...sampleCharacter.filter(r => r[1] !== 'Name'), ['info', 'Name', 'Kitty', ''],
    ['item', `Lantern (${long})`, '', ''], ['item', 'Box', '', long]]);
  const p = await h.page({ width: 900 });
  await p.goto(`${h.srv.site}/sheet.html?c=Kitty#join=${invite(g1.url)}`);
  await p.click('[data-act="tab"][data-tab="kit"]');
  await p.waitForSelector('[data-list="item"] .inote');
  const fit = await p.evaluate(() => {
    const card = document.querySelector('[data-list="item"]').getBoundingClientRect();
    const out = [...document.querySelectorAll('[data-list="item"] .item')].filter(i => i.getBoundingClientRect().right > card.right);
    return { page: document.documentElement.scrollWidth <= innerWidth, items: out.length };
  });
  assert.deepEqual(fit, { page: true, items: 0 });
  await h.setTab(g1, 'Kitty', null);
});

const place = (rows, name) => (rows || []).find(r => r[1] === name && !r[2]);

test("map page: from the Map tab; crew see the region's map and only the places the GM has shown, with their levels", async () => {
  const p = await h.page();
  await join(p, g1, 'map.html');
  await p.waitForSelector('.worldmap img');
  assert.deepEqual(await p.$$eval('.mgroup h3', hs => hs.map(x => x.textContent)), ['The Test Server'], 'the region is named once, over its map and places');
  assert.ok(await p.$('.mgroup > h3 + .worldmap + .cols'), 'its map sits under the heading, above the place cards');
  assert.ok(await until(() => p.$eval('.worldmap img', i => i.complete && i.naturalWidth === 64)), 'the picture placed in the cell loads, through the script');
  await p.waitForSelector('.loc h2');
  assert.deepEqual(await p.$$eval('.loc h2', hs => hs.map(x => x.textContent)), ['Packet Reef'], 'hidden places never reach the crew');
  assert.equal(await p.$('[data-place]'), null, 'crew can\'t change what\'s on the map');
  assert.doesNotMatch(await p.textContent('main'), /Sharks below|upside down/, 'GM notes stay with the GM');

  const g = await h.page();
  await join(g, g1, 'map.html', KEYS.GM_KEY);
  await g.waitForSelector('[data-place]');
  const names = await g.$$eval('.loc h2', hs => hs.map(x => x.textContent));
  assert.deepEqual(names.sort(), ['Hidden Dock', 'Packet Reef', 'Scrap Town'], 'the GM sees every place');
  assert.match(await g.textContent('main'), /Sharks below/);
  const town = g.locator('.loc', { hasText: 'Scrap Town' });
  assert.equal(await town.locator('[data-place]').getAttribute('aria-pressed'), 'false');
  await town.locator('[data-place]').click();
  assert.ok(await until(async () => place(await h.tab(g1, 'Map'), 'Scrap Town')?.[6] === 'on'), 'the GM\'s choice is saved in the Shown column');
  await g.click('[data-show="on"]');
  assert.deepEqual((await g.$$eval('.loc h2', hs => hs.map(x => x.textContent))).sort(), ['Packet Reef', 'Scrap Town']);

  // The crew page picks it up, levels and all.
  await p.waitForSelector('.loc:has-text("Scrap Town")', { timeout: 8000 });
  const st = p.locator('.loc', { hasText: 'Scrap Town' });
  assert.match(await st.locator('.levels .rich').textContent(), /The docks/);
  await st.locator('[data-lv="1"]').click();
  await p.waitForSelector('.loc [data-lv="1"][aria-pressed="true"]');
  assert.match(await p.locator('.loc', { hasText: 'Scrap Town' }).locator('.levels .rich').textContent(), /The market/);
  const lv2 = p.locator('.loc', { hasText: 'Scrap Town' }).locator('.levels img');
  assert.ok(await until(() => lv2.evaluate(i => i.complete && i.naturalWidth === 32)), 'the level\'s picture loads');
  assert.equal(await p.locator('.loc', { hasText: 'Packet Reef' }).locator('.levels').count(), 0, 'a place with no levels is one picture');
  await p.fill('#q', 'market');
  assert.deepEqual(await settled(() => p.$$eval('.loc h2', hs => hs.map(x => x.textContent)), ['Scrap Town']), ['Scrap Town'], 'a level\'s text finds its place');

  // Off again: gone for the crew.
  await g.locator('.loc', { hasText: 'Scrap Town' }).locator('[data-place]').click();
  assert.ok(await until(async () => place(await h.tab(g1, 'Map'), 'Scrap Town')?.[6] === ''));
  await p.fill('#q', '');
  assert.ok(await until(async () => !(await p.$('.loc:has-text("Scrap Town")'))), 'the crew page drops it');
});

test('map page: a second visit shows the cached Map tab, not an empty map', async () => {
  const p = await h.page();
  await join(p, g1, 'map.html');
  await p.waitForSelector('.loc h2');
  await p.reload();
  await p.waitForSelector('.loc h2');
  assert.deepEqual(await p.$$eval('.loc h2', hs => hs.map(x => x.textContent)), ['Packet Reef']);
  assert.doesNotMatch(await p.textContent('main'), /Nothing on the map yet/);
});

test('map page: pictures are kept between visits, not fetched through the script again', async () => {
  const p = await h.page();
  const asks = [];
  p.on('request', r => { if (r.method() === 'POST' && /"op":"image"/.test(r.postData() || '')) asks.push(r.postData()); });
  await join(p, g1, 'map.html');
  assert.ok(await until(() => p.$eval('.worldmap img', i => i.complete && i.naturalWidth === 64)));
  assert.ok(asks.length >= 1);
  asks.length = 0;
  await p.reload();
  assert.ok(await until(() => p.$eval('.worldmap img', i => i.complete && i.naturalWidth === 64)), 'shows from the kept copy');
  await polls(p, 1);
  assert.deepEqual(asks, []);
});

test('map page: a kept picture over an hour old shows at once, then the script is asked behind it and a new one swaps in', async () => {
  const p = await h.page();
  await join(p, g1, 'map.html');
  assert.ok(await until(() => p.$eval('.worldmap img', i => i.complete && i.naturalWidth === 64)));
  // Age the kept copy and make it a different picture, as if the sheet's had been replaced since.
  await p.evaluate(async () => {
    const cache = await caches.open('cybersea-pictures');
    for (const req of await cache.keys()) {
      const old = await cache.match(req);
      const c = Object.assign(document.createElement('canvas'), { width: 10, height: 10 });
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const headers = new Headers(old.headers);
      headers.set('x-d', 'stale');
      headers.set('x-at', String(Date.now() - 2 * 60 * 60 * 1000));
      await cache.put(req, new Response(blob, { headers }));
    }
  });
  let release;
  const held = new Promise(r => { release = r; });
  const asks = [];
  await p.route('**/*', async route => {
    const body = route.request().postData() || '';
    if (route.request().method() === 'POST' && /"op":"image"/.test(body)) { asks.push(body); await held; }
    await route.continue();
  });
  await p.reload();
  assert.ok(await until(() => p.$eval('.worldmap img', i => i.complete && i.naturalWidth === 10)), 'the kept copy shows while the script is asked');
  assert.ok(await until(() => asks.length >= 1), 'the script is asked about the old copy');
  assert.match(asks[0], /"have":"stale"/);
  release();
  assert.ok(await until(() => p.$eval('.worldmap img', i => i.complete && i.naturalWidth === 64)), 'the new picture swaps in');
  assert.equal(await p.$eval('.worldmap img', i => i.closest('a')?.href === i.src), true, 'its full-size link follows');
});

test('polls that change nothing leave the page alone: focus in the search box and the nav stays', async () => {
  const p = await h.page();
  await join(p, g1, 'map.html');
  await p.waitForSelector('.loc h2');
  await p.click('#q');
  await p.keyboard.type('reef');
  await polls(p);
  assert.equal(await p.evaluate(() => document.activeElement?.id), 'q');
  assert.equal(await p.inputValue('#q'), 'reef');
  await p.focus('.gnav .glinks a');
  const link = await p.evaluate(() => document.activeElement.textContent);
  await polls(p);
  assert.equal(await p.evaluate(() => document.activeElement.closest('.gnav') && document.activeElement.textContent), link);
});

test('lore page: a picture placed in the Lore tab\'s Image cell shows with its entry', async () => {
  const p = await h.page();
  await join(p, g1, 'lore.html');
  await p.waitForSelector('.card:has-text("Gull Harbor") img');
  assert.ok(await until(() => p.$eval('.card:has-text("Gull Harbor") img', i => i.complete && i.naturalWidth === 32)));
});

test('map page: with no Map tab, the GM can start one', async () => {
  const g = await h.page();
  await join(g, g2, 'map.html', KEYS.GM_KEY);
  await g.waitForSelector('main .empty:has-text("No Map tab yet")');
  await g.click('[data-new="map"]');
  await g.fill('[role="dialog"] [data-f="region"]', 'Open Sea');
  await g.click('[role="dialog"] [data-save]');
  await g.waitForSelector('.mgroup h3:has-text("Open Sea")');
  assert.deepEqual((await h.tab(g2, 'Map')).slice(0, 2).map(r => r.slice(0, 7)), [
    ['Region', 'Location', 'Level', 'Image', 'Text', 'GM notes', 'Shown'],
    ['Open Sea', '', '', '', '', '', ''],
  ]);
});

test('map page: the GM adds, edits and removes places and levels, with pictures from the Images tab or uploaded', async () => {
  const g = await h.page();
  await join(g, g1, 'map.html', KEYS.GM_KEY);
  await g.waitForSelector('.loc:has-text("Hidden Dock") img');
  assert.ok(await until(() => g.$eval('.loc:has-text("Hidden Dock") img', i => i.complete && i.naturalWidth === 48)), 'a name in the Image cell shows the Images tab’s picture');
  const dlg = s => `[role="dialog"] ${s}`;

  // A new place, its picture uploaded.
  await g.click('[data-new="place"]');
  await g.fill(dlg('[data-f="region"]'), 'Far Away');
  await g.fill(dlg('[data-f="name"]'), 'Coral Gate');
  await g.fill(dlg('[data-f="text"]'), 'A gate of coral.');
  await g.selectOption(dlg('[data-f="pic"]'), 'upload');
  await g.setInputFiles(dlg('[data-f="file"]'), { name: 'gate.png', mimeType: 'image/png', buffer: Buffer.from(IMAGES.level1.bytes) });
  await g.waitForSelector(dlg('[data-preview] img'));
  await g.click(dlg('[data-save]'));
  await g.locator('.loc', { hasText: 'Coral Gate' }).scrollIntoViewIfNeeded(); // pictures load as they near the screen
  await g.waitForSelector('.loc:has-text("Coral Gate") img[src]');
  const images = await h.tab(g1, 'Images');
  assert.deepEqual(images.at(-1).slice(0, 2), ['Coral Gate', ''], 'the upload is a new row of the Images tab');
  assert.deepEqual(place(await h.tab(g1, 'Map'), 'Coral Gate').slice(0, 7), ['Far Away', 'Coral Gate', '', 'Coral Gate', 'A gate of coral.', '', '']);

  // A level, its picture picked from the Images tab.
  await g.locator('.loc', { hasText: 'Coral Gate' }).locator('[data-new="level"]').click();
  await g.fill(dlg('[data-f="name"]'), 'Deck 1');
  await g.waitForSelector(dlg('option[value="img:Dock picture"]'), { state: 'attached' });
  await g.selectOption(dlg('[data-f="pic"]'), 'img:Dock picture');
  await g.click(dlg('[data-save]'));
  await g.waitForSelector('.loc:has-text("Coral Gate") .levels [data-lv="0"]:has-text("Deck 1")');
  assert.ok((await h.tab(g1, 'Map')).some(r => r[1] === 'Coral Gate' && r[2] === 'Deck 1' && r[3] === 'Dock picture'));

  // Renamed: its level comes along.
  await g.locator('.loc', { hasText: 'Coral Gate' }).locator('.shead [data-edit]').first().click();
  await g.fill(dlg('[data-f="name"]'), 'Coral Arch');
  await g.click(dlg('[data-save]'));
  await g.waitForSelector('.loc:has-text("Coral Arch") .levels');
  assert.ok((await h.tab(g1, 'Map')).some(r => r[1] === 'Coral Arch' && r[2] === 'Deck 1'));

  // Deleted, levels and all; the picture stays in the Images tab.
  await g.locator('.loc', { hasText: 'Coral Arch' }).locator('.shead [data-edit]').first().click();
  await g.click(dlg('[data-del]'));
  await g.click(dlg('[data-del]'));
  await g.waitForSelector('.loc:has-text("Coral Arch")', { state: 'detached' });
  await g.click('.toast .tact'); // Undo, in time: it never leaves the sheet
  await g.waitForSelector('.loc:has-text("Coral Arch") .levels');
  await sleep(2000);
  assert.ok((await h.tab(g1, 'Map')).some(r => r[1] === 'Coral Arch'));
  await g.locator('.loc', { hasText: 'Coral Arch' }).locator('.shead [data-edit]').first().click();
  await g.click(dlg('[data-del]'));
  await g.click(dlg('[data-del]'));
  await g.waitForSelector('.loc:has-text("Coral Arch")', { state: 'detached' });
  assert.ok(await until(async () => !(await h.tab(g1, 'Map')).some(r => r[1] === 'Coral Arch')));
  assert.equal((await h.tab(g1, 'Images')).at(-1)[0], 'Coral Gate');
});

test('map page: a big uploaded picture is scaled down before it goes to the sheet', async () => {
  const g = await h.page();
  await join(g, g1, 'map.html', KEYS.GM_KEY);
  await g.waitForSelector('[data-new="place"]');
  await g.click('[data-new="place"]');
  await g.selectOption('[role="dialog"] [data-f="pic"]', 'upload');
  await g.setInputFiles('[role="dialog"] [data-f="file"]', { name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(png(3000, 300, [10, 20, 30])) });
  await g.waitForSelector('[role="dialog"] [data-preview] img');
  assert.ok(await until(() => g.$eval('[role="dialog"] [data-preview] img', i => i.complete && i.naturalWidth === 2048)));
  await g.keyboard.press('Escape');
});

test('two games stay separate, and the menu switches between them', async () => {
  const p = await h.page();
  await join(p, g1);
  await p.waitForSelector('.crewcard');
  await join(p, g2);
  await p.waitForSelector('.crewcard');
  assert.equal(await p.textContent('.gname'), 'Fixture Game 2');
  // change Testa in game 2 only
  await p.goto(p.url().replace('index.html', '').replace(/\/(\?|$)/, '/sheet.html$1') + '&c=Testa');
  await p.waitForSelector('h1.name');
  await signIn(p, 'Testa');
  await p.waitForSelector('[data-act="edit"]');
  await p.click('.luck .pip[data-j="7"]');
  await until(async () => row(await h.tab(g2, 'Testa'), 'track', 'Luck')[2].endsWith('●'));
  assert.ok(!row(await h.tab(g1, 'Testa'), 'track', 'Luck')[2].endsWith('●'), 'game 1 untouched');
  await p.click('[data-nav="menu"]');
  const games = await p.$$eval('.glist a', as => as.map(a => a.textContent));
  assert.deepEqual(games.sort(), ['Fixture Game', 'Fixture Game 2']);
  await p.click('.glist a:has-text("Fixture Game"):not(:has-text("2"))');
  await p.waitForSelector('.crewcard');
  assert.equal(await p.textContent('.gname'), 'Fixture Game');
});

const who = p => p.$eval('.gnav .who', b => b.textContent.trim());
const TESTA_IN = '.crewcard[href*="c=Testa"] .pill.in';
const signedIn = async (api, name) => row(await h.tab(api, name), 'signin', 'Signed in')?.[2];

test('players sign in as a character with a click, and out again; everyone sees it', async () => {
  const p = await h.page();
  await join(p, g1);
  await p.waitForSelector('.whoami');
  assert.equal(await who(p), 'Sign in');
  await p.click('.whoami [data-me="Testa"]');
  await p.waitForSelector('.crewcard .pill.me');
  assert.equal(await who(p), 'Testa');
  assert.equal(await p.$('.whoami'), null);
  assert.ok(await until(async () => (await signedIn(g1, 'Testa')) === 'yes'), 'marked in the sheet');
  await p.reload();
  await p.waitForSelector('.crewcard .pill.me');
  assert.equal(await who(p), 'Testa', 'remembered on this device');

  // another player sees Testa is taken
  const q = await h.page();
  await join(q, g1);
  await q.waitForSelector('.whoami .pick .sub');
  assert.equal(await q.textContent('.whoami [data-me="Testa"] .sub'), 'signed in');
  await q.waitForSelector(TESTA_IN);

  // clicking Testa again signs out
  await p.click('.gnav .who');
  await p.waitForSelector('[role="dialog"] [data-me="Testa"][aria-pressed="true"]');
  assert.ok(await p.$('[role="dialog"] a[href*="c=Testa"]'), 'links to my sheet');
  await p.click('[role="dialog"] [data-me="Testa"]');
  assert.ok(await until(async () => (await who(p)) === 'Sign in'));
  assert.ok(await until(async () => (await signedIn(g1, 'Testa')) === ''), 'cleared in the sheet');
  await p.keyboard.press('Escape');
  assert.equal(await p.$('.crewcard .pill.me'), null);
  assert.ok(await until(async () => !(await q.$(TESTA_IN))), 'the other player sees it too');

  // signed in by hand in the sheet shows up as well
  await h.setTab(g1, 'Testa', [...(await h.tab(g1, 'Testa'))].map(r => r.slice(0, 4)).filter(r => r[0] !== 'signin').concat([['signin', 'Signed in', 'yes', '']]));
  assert.ok(await until(() => q.$(TESTA_IN)));
  await h.setTab(g1, 'Testa', [...(await h.tab(g1, 'Testa'))].map(r => r.slice(0, 4)).filter(r => r[0] !== 'signin'));
});

test('the GM badge, and the crew invite needs no passphrase', async () => {
  const p = await h.page();
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: h.srv.site });
  await join(p, g1, '', KEYS.GM_KEY);
  assert.ok(await until(async () => (await who(p)) === 'GM'));
  assert.equal(await p.$('.whoami'), null, 'the GM isn\'t asked');
  await p.click('[data-nav="menu"]');
  await p.click('[data-m="invite"]');
  await p.waitForSelector('[data-msg]:has-text("Send it to the crew")');
  const url = await p.evaluate(() => navigator.clipboard.readText());
  const inv = JSON.parse(Buffer.from(url.split('#join=')[1], 'base64url').toString());
  assert.equal(inv.key, undefined, 'no passphrase in the crew invite');

  const q = await h.page();
  await q.goto(url);
  await q.waitForSelector('.whoami');
  assert.equal(await who(q), 'Sign in');
  assert.equal(await q.$$eval('.glinks a', as => as.some(a => a.textContent === 'GM')), false, 'crew access, not GM');
});

test('the GM link only shows with the GM passphrase', async () => {
  const p = await h.page();
  await join(p, g1, '', KEYS.GM_KEY);
  await p.waitForSelector('.crewcard');
  assert.ok(await until(async () => (await p.$$eval('.glinks a', as => as.map(a => a.textContent))).includes('GM')));
  assert.deepEqual(h.errors, []);
});

test('the menu button shows turning sync arrows while loading, then the dots', async () => {
  const slow = await harness({ latency: 800 });
  try {
    const p = await slow.page();
    await p.goto(`${slow.srv.site}/#join=${invite(slow.srv.apis[0].url)}`);
    await p.waitForSelector('.gnav [data-nav="menu"].syncing svg');
    assert.equal(await p.$eval('.gnav .syncing svg', el => getComputedStyle(el).animationName), 'spin');
    await p.waitForSelector('.gnav [data-nav="menu"]:not(.syncing)', { timeout: 8000 });
    assert.equal(await p.$$eval('.gnav [data-nav="menu"] circle', c => c.length), 3);
    assert.equal(await p.$('.sdot'), null);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.reload();
    await p.waitForSelector('.gnav [data-nav="menu"].syncing svg');
    assert.equal(await p.$eval('.gnav .syncing svg', el => getComputedStyle(el).animationName), 'none');
  } finally { await slow.close(); }
});
