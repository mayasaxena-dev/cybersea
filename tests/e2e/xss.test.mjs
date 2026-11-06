// Browser tests: text from the sheet never becomes markup. Anyone who can edit the sheet can type
// anything into it, so each place that writes sheet text into the page must escape it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn } from './harness.mjs';
import { gameTabs, sampleCharacter, HEADER } from '../fixtures/game.mjs';

const BAD = '"><i class="pwn"></i><b data-pwn="';
const TAG = '<i class=pwn></i>'; // for a quoted meta value, which can't hold a "
let h;
let api;
test.before(async () => {
  const tabs = gameTabs({ withCharacter: false });
  tabs.Rules.push(
    ['move', `basic${BAD}`, 'EVIL MOVE', 'Made-up text.', '', 'crew'],
    ['playbook', 'Evil', 'Evil', 'Made-up text.', `type=pirate harm="${TAG}"`, 'crew'],
  );
  tabs.System.push(['track', 'pirate', `Grit${BAD}`, '', 'role=grit size=3 refill=Spitfire']);
  tabs.Testa = [HEADER, ...sampleCharacter,
    ['state', 'downtime', JSON.stringify({ at: 1, where: 'In port', slots: BAD, harm: [], moves: [] }), '']];
  h = await harness({ gameOptions: [{ tabs }] });
  [api] = h.srv.apis;
});
test.after(async () => { await h.close(); });

const injected = p => p.evaluate(() => document.querySelectorAll('.pwn, [data-pwn]').length);

test('rules page: a playbook meta value stays text', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/rules.html#join=${invite(api.url)}`);
  await p.waitForSelector('#ref .mgroup');
  await p.click('.cats button:has-text("Playbooks")');
  await p.waitForSelector('#ref .move.pbook .mn:has-text("Evil")');
  assert.equal(await injected(p), 0);
  assert.match(await p.textContent('#ref .move.pbook:has-text("Evil") .cnt'), /class=pwn/);
});

test('character sheet: a move group, a track name and the downtime count stay text', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url)}`);
  await p.waitForSelector('[data-act="tab"][data-tab="moves"]');
  await p.click('[data-act="tab"][data-tab="moves"]');
  await p.waitForSelector('[data-cat]');
  assert.equal(await injected(p), 0, 'move group');
  await p.click('[data-act="tab"][data-tab="log"]');
  await p.waitForSelector('.dtbar');
  assert.equal(await injected(p), 0, 'downtime count');
  assert.match(await p.textContent('.dtbar'), /class="pwn"/);
  await signIn(p, 'Testa');
  await p.click('[data-kind="session-begin"]');
  await p.waitForSelector('[role="dialog"] .eff');
  assert.equal(await injected(p), 0, 'track name');
  await p.click('[data-run]');
  await p.waitForSelector('[role="dialog"]', { state: 'detached' });
  assert.deepEqual(h.errors, []);
});
