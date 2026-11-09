// The Session and NPCs tabs as the site reads and writes them (assets/session-model.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSession, parseSpec, formatSpec, itemsIn, subfolders, sessionOf, owedPrompt, hasDone, isNewLore, shareRow, noteRow, windowRow, mergeNpc, parseNpcs, parseBox, clampBox, idTime } from '../assets/session-model.js';

const id = (iso, tag = 'aaaa') => `${iso}~${tag}`;
const rows = [
  ['folder', 'Vega Station/NPCs', '', ''],
  ['session', 'Session 1: Docks', '2026-11-01T18:00:00.000Z', '2026-11-01T22:00:00.000Z'],
  ['session', 'Session 2: Vega', '2026-11-08T18:00:00.000Z', ''],
  shareRow(id('2026-11-01T19:00:00.000Z'), 'Session 1: Docks', { type: 'lore', ref: 'Rumor / The map' }),
  shareRow(id('2026-11-08T19:00:00.000Z'), 'Session 2: Vega', { type: 'lore', ref: 'Rumor / The tide' }),
  shareRow(id('2026-11-08T19:05:00.000Z'), 'Vega Station', { type: 'scene', ref: 'Three days later', body: 'Rain on the hull.\nSecond line.' }),
  noteRow(id('2026-11-08T19:10:00.000Z', 'bbbb'), 'Vega Station', 'Testa', 'Watch the door.'),
  windowRow(id('2026-11-08T19:05:00.000Z'), { x: 10, y: 5, w: 40, h: 50 }, 2),
  ['window', 'gone~zzzz', '0 0 50 50', '1'],
  ['prompt', 'session-begin', 's2', 'Session 2: Vega'],
  ['done', 'session-begin:Testa', 's2', ''],
  ['done', 'session-begin:Bo', 's1', ''],
];

test('a share keeps its type, what it points at, and any text of its own', () => {
  assert.deepEqual(parseSpec('scene: Three days later\nRain.\nMore.'), { type: 'scene', ref: 'Three days later', body: 'Rain.\nMore.' });
  assert.deepEqual(parseSpec('Ship:'), { type: 'ship', ref: '', body: '' });
  assert.equal(formatSpec({ type: 'ship' }), 'ship:');
  assert.equal(formatSpec({ type: 'clock', ref: 'Doom', body: '●●○○' }), 'clock: Doom\n●●○○');
});

test('the Session tab: folders (made, implied by sessions and shares), sessions, the running one, and what is in each folder', () => {
  const s = parseSession(rows);
  assert.deepEqual(s.folders, ['Session 1: Docks', 'Session 2: Vega', 'Vega Station', 'Vega Station/NPCs']);
  assert.equal(s.current.title, 'Session 2: Vega');
  assert.deepEqual(subfolders(s, 'Vega Station'), ['Vega Station/NPCs']);
  assert.deepEqual(itemsIn(s, 'Vega Station').map(i => [i.kind, i.type, i.ref || i.author]), [['share', 'scene', 'Three days later'], ['note', 'note', 'Testa']]);
  assert.equal(itemsIn(s, 'Vega Station')[1].body, 'Watch the door.');
  assert.equal(sessionOf(s, 'session 1: docks').end, '2026-11-01T22:00:00.000Z');
  assert.equal(idTime(itemsIn(s, 'Vega Station')[0].id), Date.parse('2026-11-08T19:05:00.000Z'));
});

test('windows: only those whose share is still there, lowest first, kept on the desktop', () => {
  const s = parseSession(rows);
  assert.deepEqual(s.windows.map(w => [w.id.slice(11, 16), w.x, w.w, w.z]), [['19:05', 10, 40, 2]]);
  assert.deepEqual(parseBox('1 2 x 4'), null);
  assert.deepEqual(clampBox({ x: 90, y: -5, w: 30, h: 200 }), { x: 70, y: 0, w: 30, h: 100 });
});

test('prompts: who still owes the latest action the GM ran', () => {
  const s = parseSession(rows);
  assert.equal(hasDone(s, 'session-begin', 'testa'), true);
  assert.equal(hasDone(s, 'session-begin', 'Bo'), false, 'done for an older prompt');
  assert.equal(owedPrompt(s, 'Testa'), null);
  assert.deepEqual(owedPrompt(s, 'Bo'), { action: 'session-begin', stamp: 's2', title: 'Session 2: Vega' });
  assert.equal(owedPrompt(s, ''), null, 'nobody signed in owes nothing');
});

test('lore shared during the running session is new; lore from earlier sessions is not', () => {
  const s = parseSession(rows);
  assert.equal(isNewLore(s, 'Rumor', 'The tide'), true);
  assert.equal(isNewLore(s, 'rumor', 'the map'), false);
  assert.equal(isNewLore(parseSession(rows.map(r => (r[1] === 'Session 2: Vega' ? [...r.slice(0, 3), '2026-11-08T23:00:00.000Z'] : r))), 'Rumor', 'The tide'), false, 'ended: nothing is new');
});

test('sharing an NPC again adds the parts ticked and keeps the rest', () => {
  let npcs = mergeNpc([], 'Captain Vex', { tags: 'loud' });
  assert.deepEqual(npcs, [['npc', 'Captain Vex', 'loud', '']]);
  npcs = mergeNpc([...npcs, ['crew', 'Captain Vex', 'Owes us.', '']], 'captain vex', { harm: '●○○', notes: 'Runs the docks.' });
  assert.deepEqual(npcs, [['npc', 'Captain Vex', 'loud', 'Runs the docks.'], ['crew', 'Captain Vex', 'Owes us.', ''], ['harm', 'captain vex', '●○○', '']]);
  assert.deepEqual(parseNpcs(npcs), [{ name: 'Captain Vex', tags: 'loud', notes: 'Runs the docks.', harm: '●○○', crew: 'Owes us.' }]);
  assert.deepEqual(parseNpcs([['crew', 'Ghost', 'no npc row', '']]), [], 'only NPCs the GM shared');
});
