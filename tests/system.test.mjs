// The site's mechanics come from the Rules tab: a made-up game with other stats and tracks works too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexRules } from '../assets/rules.js';
import { systemOf, typeOf, characterTypes, sum, fillIn, effects, rollOf, atSession, floorOf } from '../assets/system.js';
import { characterRows, shipRows } from '../assets/build.js';
import { rules, system } from './fixtures/game.mjs';

const R0 = indexRules(rules, system);

test('sums: numbers, stats and the level', () => {
  const ctx = { stats: [{ k: 'Steadfast', v: 2 }, { k: 'Fortune', v: -1 }], level: 3 };
  assert.equal(sum('6', ctx), 6);
  assert.equal(sum('Steadfast+3', ctx), 5);
  assert.equal(sum('level + 6', ctx), 9);
  assert.equal(sum('fortune', ctx), -1);
  assert.equal(sum('Fortune−1', ctx), -2);
  assert.equal(sum('', ctx), 0);
  assert.equal(fillIn('({Fortune+5} cargo space)', ctx), '(4 cargo space)');
});

test('effects, rolls and session timing come from meta, not rule text', () => {
  assert.deepEqual(effects('luck:1,xp:2'), [{ role: 'luck', n: 1 }, { role: 'xp', n: 2 }]);
  assert.deepEqual(effects('luck:unrest'), [{ role: 'luck', from: 'unrest' }]);
  assert.deepEqual(effects('luck:x'), [{ role: 'luck', n: null }]);
  assert.deepEqual(effects(undefined), []);
  const stats = [{ k: 'Vinegar', v: -1 }];
  assert.deepEqual(rollOf({ roll: 'VINEGAR' }, stats), { label: 'Vinegar', mod: -1, dice: 2, stat: true });
  assert.equal(rollOf({ roll: 'Steadfast' }, stats), null, 'a stat this sheet doesn’t have');
  assert.deepEqual(rollOf({ roll: '2d6', per: '-1 per scar' }, stats), { label: '2d6', mod: 0, dice: 2, per: '-1 per scar' });
  assert.deepEqual(rollOf({ roll: '1d6' }, stats), { label: '1d6', mod: 0, dice: 1 });
  assert.deepEqual(rollOf({ roll: '+bonds spent' }, stats), { label: '+bonds spent', mod: 0, dice: 2, ask: 'Bonds spent' });
  assert.equal(rollOf({ roll: '2d6', adj: true }, stats).adj, 'Modifier');
  assert.equal(rollOf({}, stats), null, 'no roll= is no roll, whatever the text says');
  assert.ok(atSession('end', { session: 'start,end' }) && atSession('start', { session: 'start' }));
  assert.ok(!atSession('start', {}));
  assert.equal(floorOf(R0, 'luck'), 1);
  assert.equal(floorOf(R0, 'harm'), 0);
});

test('the fixture game: stats, tracks and cards a new character starts with', () => {
  const rows = characterRows(R0, { name: 'Ann', playbook: 'Trickster', oddity: 'CARD SHARP', kit: 'Kit 2' });
  const of = kind => rows.filter(r => r[0] === kind).map(r => [r[1], r[2]]);
  assert.deepEqual(of('stat'), [['Blood', '-2'], ['Vinegar', '+1'], ['Polish', '+1'], ['Spitfire', '+1']]);
  assert.deepEqual(of('track'), [['Harm', '○○○○○○'], ['Luck', '●○○○○○○○'], ['Vice', '○'], ['Experience', '○○○○○○'], ['Treasure', '●○○○○'], ['Hoard', '●○○○○']]);
  assert.deepEqual(rows.filter(r => ['sheet', 'notes', 'kit'].includes(r[0])).map(r => `${r[0]}:${r[1]}`),
    ['sheet:Vice', 'sheet:Oddity', 'sheet:Bonds', 'sheet:Troubles', 'sheet:Experience', 'kit:Items', 'notes:Questions', 'notes:Last Words', 'kit:Treasure']);
  assert.deepEqual(of('move').map(m => m[0]), ['SUMMON', 'HAGGLE']);
  assert.deepEqual(characterTypes(R0), ['pirate']);
  assert.equal(typeOf(R0, 'Trickster'), 'pirate');
});

test('the fixture game: a new ship', () => {
  const rows = shipRows(R0, { name: 'Gull', playbook: 'Skiff' });
  assert.deepEqual(rows.filter(r => r[0] === 'track').map(r => [r[1], r[2]]), [['Wreck', '○○○'], ['Renown', '○○○○○']]);
  assert.deepEqual(rows.find(r => r[1] === 'Cargo'), ['sheet', 'Cargo', '', '(6 cargo space)']);
  assert.deepEqual(rows.find(r => r[1] === 'Kit'), ['sheet', 'Kit', '', ''], 'the kit card lists items, not the kit’s text');
  assert.deepEqual(rows.filter(r => r[0] === 'item').map(r => r[1]), ['Two oars', 'A lantern']);
  assert.ok(!rows.some(r => r[0] === 'info' && r[1] === 'Player'));
});

test('another game: its own stats, tracks and sizes, nothing from Rapscallion', () => {
  const R = indexRules([
    ['playbook', 'Pilot', 'Pilot', 'Flies things.', 'type=spacer stress=4', 'crew'],
    ['oddity', 'Pilot', 'Steady hands', '', 'traits=+1,+2', 'crew'],
    ['kit', 'Pilot', 'Kit', 'Blaster, 3-credits', '', 'crew'],
    ['pmove', 'Pilot', 'EVADE', 'Dodge.', 'start roll=Nerve', 'crew'],
    ['stat', 'spacer', 'Grit', '', '', 'crew'],
    ['stat', 'spacer', 'Nerve', '', '', 'crew'],
    ['track', 'spacer', 'Stress', '', 'role=harm size=9', 'crew'],
    ['track', 'spacer', 'Edge', '', 'role=luck size=3 start=Nerve+1', 'crew'],
    ['track', 'spacer', 'Credits', '', 'role=treasure size=10', 'crew'],
    ['track', 'spacer', 'Stash', '', 'role=hoard size=1', 'crew'],
    ['section', 'spacer', 'Wallet', '(10 credits = 1 stash)', 'role=treasure tab=kit', 'crew'],
    ['section', 'spacer', 'Background', '', 'fill=oddity', 'crew'],
  ]);
  assert.deepEqual(systemOf(R, 'spacer').stats, ['Grit', 'Nerve']);
  const rows = characterRows(R, { name: 'Jo', playbook: 'Pilot', kit: 'Kit' });
  assert.deepEqual(rows.filter(r => r[0] === 'stat').map(r => r[2]), ['+1', '+2']);
  assert.deepEqual(rows.filter(r => r[0] === 'track').map(r => [r[1], r[2]]),
    [['Stress', '○○○○'], ['Edge', '●●●'], ['Credits', '●●●○○○○○○○'], ['Stash', '○']], 'the playbook’s stress=4 wins over size=9; Edge starts at Nerve+1, capped at 3');
  assert.deepEqual(rows.find(r => r[1] === 'Wallet'), ['kit', 'Wallet', '- Starting kit: 3-credits', '(10 credits = 1 stash)']);
  assert.ok(rows.some(r => r[0] === 'item' && r[1] === 'Blaster'));
  assert.equal(rows.find(r => r[1] === 'Background')[2].split('\n')[0], '**Steady hands** (+1,+2)');
  assert.equal(rollOf(R.playbook('Pilot').moves[0].meta, [{ k: 'Nerve', v: 2 }]).mod, 2);
});

test('a stat row’s Text is what the stat is for', () => {
  const pirate = systemOf(R0, 'pirate');
  assert.equal(pirate.statText('BLOOD'), 'grit/nerve');
  assert.equal(pirate.statText('Vinegar'), '');
  assert.equal(pirate.statText('Steadfast'), '', 'another type’s stat');
});
