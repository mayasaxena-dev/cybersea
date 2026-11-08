// Browser tests for the Session page, the GM's Share buttons and the crew's NPCs page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn, until } from './harness.mjs';
import { KEYS } from '../fixtures/game.mjs';

const low = s => String(s ?? '').toLowerCase();
const rowsOf = (rows, kind) => rows.filter(r => low(r[0]) === kind);

let h;
let api;
test.before(async () => { h = await harness(); [api] = h.srv.apis; });
test.after(async () => { await h.close(); });

async function gm(page) {
  const p = await h.page({ width: 1300 });
  await p.goto(`${h.srv.site}/${page}#join=${invite(api.url, KEYS.GM_KEY)}`);
  return p;
}
async function player(page = 'session.html', as = 'Testa') {
  const p = await h.page({ width: 1300 });
  await p.goto(`${h.srv.site}/${page}#join=${invite(api.url)}`);
  if (as) await signIn(p, as);
  return p;
}
const sessionRows = () => h.tab(api, 'Session');

// Shares with the dialog a Share button opens, into a folder.
async function shareTo(p, button, folder) {
  await p.click(button);
  await p.waitForSelector('[role="dialog"] [data-go]');
  const has = await p.$eval('[role="dialog"] [data-folder]', (s, f) => [...s.options].some(o => o.value === f), folder);
  if (has) await p.selectOption('[role="dialog"] [data-folder]', folder);
  else {
    await p.selectOption('[role="dialog"] [data-folder]', '');
    await p.fill('[role="dialog"] [data-newfolder]', folder);
  }
  await p.click('[role="dialog"] [data-go]');
  await p.waitForSelector('[role="dialog"]', { state: 'detached' });
}

test('the Session page has no way to the GM page, even for the GM', async () => {
  for (const p of [await gm('session.html'), await player()]) {
    await p.waitForSelector('.sbanner');
    assert.equal(await p.$('.gnav a[href*="gm.html"]'), null, 'no GM link');
    assert.equal(await p.$('text=Copy GM link'), null);
    assert.match(await p.textContent('.sbanner'), /No session running/);
    await p.close();
  }
});

test('starting a session: the folder, the lit Session link, the prompt, one tap, undo, and the GM’s ticks', async () => {
  const g = await gm('gm.html');
  await g.click('[data-tab="session"]');
  await g.fill('#ses-title', 'Session 1: Rain');
  await g.click('[data-act="ses-start"]');
  await g.waitForSelector('[data-act="ses-end"]');
  assert.ok((await sessionRows()).some(r => r[0] === 'session' && r[1] === 'Session 1: Rain' && r[2] && !r[3]));
  assert.ok(await until(() => g.$('.gnav a.live[href*="session.html"]')), 'the Session link is lit');

  const p = await player();
  await p.waitForSelector('.prompt');
  assert.match(await p.textContent('.sbanner'), /Session 1: Rain · running/);
  assert.match(await p.textContent('.explorer .addr'), /Session 1: Rain/, 'the explorer opens on the running session');
  assert.match(await p.title(), /^● Session/);
  await p.click('.prompt [data-run]');
  await p.waitForSelector('[role="dialog"] [data-run]');
  await p.click('[role="dialog"] [data-run]');
  await p.waitForSelector('.prompt', { state: 'detached' });
  assert.ok(await until(async () => (await sessionRows()).some(r => r[0] === 'done' && r[1] === 'session-begin:Testa')), 'a done row');
  assert.ok(await until(async () => (await h.tab(api, 'Testa')).some(r => r.join(' ').includes('Session Begins'))), 'it ran on the sheet');

  await g.click('[data-tab="session"]');
  assert.ok(await until(async () => /✓ Testa/.test(await g.textContent('.gmview'))), 'the GM sees Testa has done it');

  // Undo puts it back.
  await p.click('.toast button:has-text("Undo")');
  await p.waitForSelector('.prompt');
  assert.ok(await until(async () => !(await sessionRows()).some(r => r[0] === 'done')));
  assert.ok(await until(async () => !(await h.tab(api, 'Testa')).some(r => r.join(' ').includes('Session Begins'))));
  await p.close();
  await g.close();
});

test('the GM shares a place into the session folder: it’s on the crew’s map, and the GM opens it for everyone', async () => {
  const g = await gm('map.html');
  await g.waitForSelector('[data-share*="Scrap Town"]');
  await shareTo(g, '[data-share*="\\"place\\""][data-share*="Scrap Town"]', 'Session 1: Rain');
  assert.ok(await until(async () => (await h.tab(api, 'Map')).find(r => r[1] === 'Scrap Town' && !r[2])?.[6] === 'on'), 'Scrap Town is shown');
  const share = await until(async () => rowsOf(await sessionRows(), 'share').find(r => r[3] === 'place: Scrap Town'));
  assert.equal(share?.[2], 'Session 1: Rain');

  const p = await player();
  const s = await gm('session.html');
  await s.waitForSelector('.file:has-text("Scrap Town")');
  await p.waitForSelector('.file:has-text("Scrap Town")');
  assert.equal(await p.$('[data-open]'), null);
  await s.click('.file:has-text("Scrap Town")');
  await s.click('[data-open]');
  await s.waitForSelector('.desktop .win:has-text("Scrap Town")');
  await p.waitForSelector('.desktop .win:has-text("Scrap Town")');
  assert.match(await p.textContent('.desktop .win'), /A town of scrap\.[\s\S]*Level 1[\s\S]*Level 2/, 'the place with its levels');
  assert.ok(await until(() => p.$('.desktop .win .strips span')), 'its pictures glitch now and then');
  assert.equal(await p.$('.desktop [data-wclose]'), null, 'players can’t close it');
  assert.equal(await p.$('.desktop [data-drag]'), null, 'or move it');

  // The GM moves it; everyone's follows.
  const bar = await s.$('.desktop .win .wbar');
  const b = await bar.boundingBox();
  await s.mouse.move(b.x + 40, b.y + 8);
  await s.mouse.down();
  await s.mouse.move(b.x + 140, b.y + 108, { steps: 5 });
  await s.mouse.up();
  const box = async q => q.$eval('.desktop .win', w => w.style.left);
  assert.match(await box(p), /%$/, 'windows sit where the GM put them');
  const moved = await until(async () => { const x = rowsOf(await sessionRows(), 'window')[0]?.[2].split(' ')[0]; return x !== '4' && x; });
  assert.ok(moved, 'the move is kept');
  assert.ok(await until(async () => (await box(p)) === `${moved}%`), 'the player’s window moved too');

  await s.click('.desktop [data-wclose]');
  await p.waitForSelector('.desktop .win', { state: 'detached' });
  assert.equal(rowsOf(await sessionRows(), 'window').length, 0);
  await p.close();
  await s.close();
  await g.close();
});

test('shared lore is new while the session runs; a shared secret goes on the Lore page', async () => {
  const g = await gm('lore.html');
  await g.waitForSelector('[data-share*="Gull Harbor"]');
  await shareTo(g, '[data-share*="Gull Harbor"]:not(:has-text("picture"))', 'Session 1: Rain');
  const p = await player('lore.html');
  await p.waitForSelector('text=Gull Harbor');
  assert.ok(await until(() => p.$(':has-text("Gull Harbor") >> .pill:has-text("New")')), 'marked new');

  const gp = await gm('gm.html');
  await gp.click('[data-tab="notes"]');
  await gp.waitForSelector('[data-share*="secret"]');
  await shareTo(gp, '[data-share*="secret"]', 'Session 1: Rain');
  assert.ok(await until(async () => (await h.tab(api, 'Lore')).some(r => r[0] === 'Revealed' && r[1] === 'Twist' && r[2] === 'The map is fake.')));
  assert.ok(await until(async () => rowsOf(await sessionRows(), 'share').some(r => r[3] === 'lore: Revealed / Twist')));
  await p.reload();
  await p.waitForSelector('text=The map is fake.');
  for (const x of [p, g, gp]) await x.close();
});

test('NPCs: the GM shares ticked parts, re-sharing merges, and the crew keep notes on them', async () => {
  const g = await gm('gm.html');
  await g.click('[data-tab="npcs"]');
  await g.waitForSelector('[data-share*="Captain Vex"]');
  // Tags only, first.
  await g.click('[data-share*="Captain Vex"]');
  await g.uncheck('[role="dialog"] [data-part="notes"]');
  await g.selectOption('[role="dialog"] [data-folder]', 'Session 1: Rain');
  await g.click('[role="dialog"] [data-go]');
  await g.waitForSelector('[role="dialog"]', { state: 'detached' });
  let npcs = await until(async () => { const t = await h.tab(api, 'NPCs'); return t.length && t; });
  assert.deepEqual(npcs.find(r => r[0] === 'npc').slice(1, 4), ['Captain Vex', 'jumpy, loud', '']);

  const p = await player('npcs.html');
  await p.waitForSelector('.card:has-text("Captain Vex")');
  assert.doesNotMatch(await p.textContent('.card'), /Owes the crew money/);
  await p.fill('textarea[data-crew="Captain Vex"]', 'Do not trust.');
  assert.ok(await until(async () => (await h.tab(api, 'NPCs')).some(r => r[0] === 'crew' && r[2] === 'Do not trust.')));

  // Then the notes: the tags and the crew's notes stay.
  await g.click('[data-share*="Captain Vex"]');
  await g.uncheck('[role="dialog"] [data-part="tags"]');
  await g.click('[role="dialog"] [data-go]');
  await g.waitForSelector('[role="dialog"]', { state: 'detached' });
  npcs = await until(async () => { const t = await h.tab(api, 'NPCs'); return t.find(r => r[0] === 'npc')?.[3] && t; });
  assert.deepEqual(npcs.find(r => r[0] === 'npc').slice(1, 4), ['Captain Vex', 'jumpy, loud', 'Owes the crew money.']);
  assert.ok(npcs.some(r => r[0] === 'crew' && r[2] === 'Do not trust.'));
  await p.click('h2:has-text("Captain Vex")'); // done typing: the page catches up
  assert.ok(await until(async () => /Owes the crew money/.test(await p.textContent('.card'))));
  await p.close();
  await g.close();
});

test('notes: players add, edit and delete their own; only the GM puts them on the desktop', async () => {
  const p = await player();
  await p.waitForSelector('[data-act="note"]');
  await p.click('[data-act="note"]');
  await p.fill('[role="dialog"] [data-text]', 'Ask about the limes.');
  await p.click('[role="dialog"] [data-save]');
  await p.waitForSelector('.preview:has-text("Ask about the limes.")');
  assert.ok(await until(async () => rowsOf(await sessionRows(), 'note').some(r => r[3] === 'note: Testa\nAsk about the limes.')));
  await p.click('[data-edit]');
  await p.fill('[role="dialog"] [data-text]', 'Ask about the crates.');
  await p.click('[role="dialog"] [data-save]');
  assert.ok(await until(async () => rowsOf(await sessionRows(), 'note').some(r => r[3] === 'note: Testa\nAsk about the crates.')));
  assert.equal(rowsOf(await sessionRows(), 'note').length, 1);
  assert.equal(await p.$('.desktop .win'), null, 'not on the desktop yet');

  // Anyone else can read it, but not change it.
  const q = await player('session.html', null);
  await q.click('.file:has-text("Note from Testa")');
  await q.waitForSelector('.preview:has-text("Ask about the crates.")');
  assert.equal(await q.$('.preview [data-edit]'), null);
  assert.equal(await q.$('.preview [data-del]'), null);

  await p.click('.preview [data-del]');
  await p.click('[role="dialog"] [data-here]');
  assert.ok(await until(async () => !rowsOf(await sessionRows(), 'note').length));
  await p.close();
  await q.close();
});

test('the GM deletes a share from its folder only, or everywhere', async () => {
  const s = await gm('session.html');
  await s.waitForSelector('.file:has-text("Gull Harbor")');
  await s.click('.file:has-text("Gull Harbor")');
  await s.click('.preview [data-del]');
  await s.click('[role="dialog"] [data-here]');
  assert.ok(await until(async () => !rowsOf(await sessionRows(), 'share').some(r => r[3] === 'lore: Place / Gull Harbor' || r[3].endsWith('/ Gull Harbor'))));
  assert.ok((await h.tab(api, 'Lore')).some(r => r[1] === 'Gull Harbor'), 'still on the Lore page');

  await s.click('.file:has-text("Scrap Town")');
  await s.click('.preview [data-del]');
  await s.click('[role="dialog"] [data-all]');
  assert.ok(await until(async () => !rowsOf(await sessionRows(), 'share').some(r => r[3] === 'place: Scrap Town')));
  assert.ok(await until(async () => (await h.tab(api, 'Map')).find(r => r[1] === 'Scrap Town' && !r[2])?.[6] !== 'on'), 'off the crew’s map');
  await s.close();
});

test('folders, scene cards, a live clock, and the rolls a session keeps when it ends', async () => {
  const s = await gm('session.html');
  await s.waitForSelector('[data-act="scene"]');
  await s.click('[data-act="scene"]');
  await s.fill('[role="dialog"] [data-title]', 'Three days later');
  await s.fill('[role="dialog"] [data-text]', 'The storm has passed.');
  await s.click('[role="dialog"] [data-save]');
  const p = await player();
  await p.waitForSelector('.desktop .win:has-text("Three days later")');

  await s.click('.file.up');
  await s.click('[data-act="mkdir"]');
  await s.fill('[role="dialog"] [data-name]', 'Vega Station');
  await s.click('[role="dialog"] [data-save]');
  await s.waitForSelector('.addr:has-text("Vega Station")');
  assert.ok(await until(async () => (await sessionRows()).some(r => r[0] === 'folder' && r[1] === 'Vega Station')));

  // A clock shared from the GM page follows it.
  const gmTab = await h.tab(api, 'GM');
  await h.setTab(api, 'GM', [...gmTab.map(r => r.slice(0, 4)), ['clock', 'Storm', '○○○○', '']]);
  const g = await gm('gm.html');
  await g.click('[data-tab="notes"]');
  await g.waitForSelector('[data-share*="Storm"]');
  await shareTo(g, '[data-share*="Storm"]', 'Vega Station');
  assert.ok(await until(async () => rowsOf(await sessionRows(), 'share').some(r => r[3] === 'clock: Storm\n○○○○')));
  await g.click('.card:has-text("Storm") [data-gpip][data-j="0"]');
  assert.ok(await until(async () => rowsOf(await sessionRows(), 'share').some(r => r[3] === 'clock: Storm\n●○○○')), 'the shared clock ticked too');

  // A roll shows in the session's rolls; when the session ends, its folder keeps them.
  const r = await player('sheet.html?c=Testa');
  await r.click('[data-act="roll-stat"][data-i="3"]');
  await r.click('#toast .roll-go');
  await p.waitForSelector('.drolls li');
  await g.click('[data-tab="session"]');
  await g.click('[data-act="ses-end"]');
  await g.click('[data-act="ses-end"]');
  assert.ok(await until(async () => rowsOf(await sessionRows(), 'rolls').some(x => x[1] === 'Session 1: Rain' && x[2])));
  await p.waitForSelector('.prompt:has-text("Session Ends")');
  assert.match(await p.textContent('.sbanner'), /No session running/);
  assert.match(await p.textContent('.explorer .addr'), /Session 1: Rain\s*ended/);
  await p.waitForSelector('.drolls .klist li:has-text("Spitfire")');
  for (const x of [p, r, s, g]) await x.close();
  assert.deepEqual(h.errors, []);
});
