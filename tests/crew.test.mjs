import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheet, serializeSheet, parseCrew, formatCrew } from '../assets/codec.js';
import { indexRules } from '../assets/rules.js';
import { systemOf } from '../assets/system.js';
import { people, whoIs, bondTarget, tagDef, splitTags, crewSystem, newCrew } from '../assets/crew.js';
import { rules, system, sampleShip, sampleCharacter } from './fixtures/game.mjs';

globalThis.location ??= { href: 'http://site.test/sheet.html' };

test('crew rows: harm pips in Value, Type/Serves/Tags lines then notes, round trip', () => {
  const c = parseCrew('Bo Brine', '●○', 'Type: Deckhand\nserves:  Testa \nTags: 1-harm, jumpy\n\nFound asleep.\nTags: not a field here');
  assert.deepEqual(c, { name: 'Bo Brine', pips: [1, 0], type: 'Deckhand', serves: 'Testa', tags: '1-harm, jumpy', note: 'Found asleep.\nTags: not a field here' });
  assert.equal(formatCrew(c), 'Type: Deckhand\nServes: Testa\nTags: 1-harm, jumpy\n\nFound asleep.\nTags: not a field here');
  assert.equal(formatCrew({ ...c, type: '', serves: '', note: '' }), 'Tags: 1-harm, jumpy');
  assert.deepEqual(parseCrew('X', '', 'Just a note: with a colon'), { name: 'X', pips: [], type: '', serves: '', tags: '', note: 'Just a note: with a colon' });

  const st = parseSheet(sampleShip);
  assert.equal(st.crew.length, 1);
  assert.deepEqual(serializeSheet(st).filter(r => r[0] === 'crew'), sampleShip.filter(r => r[0] === 'crew'));
});

test('a bond keeps who it links to in its Notes', () => {
  const st = parseSheet([['bond', 'Demon', '●··', 'Bo Brine'], ['bond', 'Ship', '●··', '']]);
  assert.deepEqual(st.bonds.map(b => b.to), ['Bo Brine', '']);
  assert.deepEqual(serializeSheet(st).map(r => r[3]), ['Bo Brine', '']);
});

// A page's client, as far as people() needs it.
const client = tabs => ({
  game: { id: 'g1' },
  list: Object.keys(tabs).map(name => ({ name, kind: name === 'Ship' ? 'ship' : 'character' })),
  tab: name => ({ loaded: !!tabs[name], missing: false, rows: tabs[name] || [] }),
});

test('a name means a character, the ship or a crew member: whole names first, then a whole word', () => {
  const all = people(client({
    Testa: sampleCharacter,
    Rook: [['info', 'Name', 'Rook Vane', '']],
    Ship: [...sampleShip, ['crew', 'Bo Brine Jr', '', ''], ['crew', 'Gil Moss', '', '']],
  }));
  const who = n => whoIs(n, all)?.key || null;
  assert.equal(who('Testa'), 'c:testa');
  assert.equal(who('rook'), 'c:rook');
  assert.equal(who('Rook Vane'), 'c:rook');
  assert.equal(who('Vane'), 'c:rook');
  assert.equal(who('Ship'), 'ship');
  assert.equal(who('The Gull'), 'ship');
  assert.equal(who('Gil'), 'crew:gil moss');
  assert.equal(who('Gil (friend)'), 'crew:gil moss', 'a note in brackets is ignored');
  assert.equal(who('Bo Brine'), 'crew:bo brine', 'a whole name beats a word of a longer one');
  assert.equal(who('Bo'), null, 'two people have it as a word: no guess');
  assert.equal(who('Demon'), null);
  assert.equal(whoIs('Rook', all).href, 'sheet.html?g=g1&c=Rook');
  assert.equal(whoIs('Gil', all).href, 'ship.html?g=g1&crew=Gil+Moss');

  assert.equal(bondTarget({ name: 'Demon', to: 'Gil Moss' }, all).key, 'crew:gil moss', 'Notes pick who it links to');
  assert.equal(bondTarget({ name: 'Rook', to: '-' }, all), null, '"-" links it to no one');
});

test('tags: comma lists keep brackets whole; a tag row explains its kind of tag', () => {
  assert.deepEqual(splitTags('2-harm, good at sums (and knots, sometimes), wild,'), ['2-harm', 'good at sums (and knots, sometimes)', 'wild']);
  const R = indexRules(rules, system);
  assert.equal(tagDef(R, 'Jumpy', 'npc').name, 'jumpy');
  assert.equal(tagDef(R, 'good at knots', 'npc').name, 'Good at [something]');
  assert.equal(tagDef(R, 'armor-2', 'npc').name, 'Armor-x');
  assert.equal(tagDef(R, 'armor', 'npc'), null);
  assert.equal(tagDef(R, '1-harm', 'npc'), null);
  assert.equal(tagDef(R, 'loud', 'npc'), null, 'only the crew type’s tags');
  assert.equal(tagDef(R, 'loud').name, 'loud', 'or any, without a group');
  assert.equal(tagDef(R, 'loud', ['item', 'weapon']).name, 'loud', 'or any of several groups');
  assert.equal(tagDef(R, 'jumpy', ['item', 'weapon']), null);
  assert.deepEqual(systemOf(R, 'ship').section('kit').tags, ['item', 'weapon'], 'the kit section’s tags= names them');
  assert.deepEqual(systemOf(R, 'ship').section('cargo').tags, []);
  const stub = names => ({ by: () => names.map(name => ({ name })) });
  assert.equal(tagDef(stub(['x-harm']), '2-harm').name, 'x-harm');
  assert.equal(tagDef(stub(['harm-x [something]']), 'harm-2 cutlasses and hooks').name, 'harm-x [something]');
  assert.equal(tagDef(stub(['x-harm', 'harm-x [something]']), 'harmless'), null, 'x stands for a number only');
});

test('the crew section says what crew members have; a new one takes a free sample name, its tags and harm', () => {
  const R = indexRules(rules, system);
  const cs = crewSystem(R, systemOf(R, 'ship'));
  assert.equal(cs.def.title, 'Crew');
  assert.equal(cs.def.serves, 'Hand of');
  assert.equal(cs.harm.name, 'Harm');
  assert.deepEqual(cs.kinds.map(k => k.name), ['Deckhand', 'Cook']);
  assert.deepEqual(newCrew(cs, 'Deckhand', ['bo brine']), { name: 'Ada Keel', pips: [0, 0], type: 'Deckhand', serves: '', tags: '1-harm, good at knots, jumpy', note: 'One gold tooth.' });
  assert.equal(newCrew(cs, 'Cook', ['Pip Ladle']).name, '', 'no free sample name');
  assert.deepEqual(newCrew(cs, '', []), { name: '', pips: [], type: '', serves: '', tags: '', note: '' });
  assert.equal(crewSystem(R, systemOf(R, 'pirate')), null, 'characters have no crew');
});

test('adding and taking off tags', async () => {
  const { addTag, removeTag } = await import('../assets/crew.js');
  assert.equal(addTag('loud, wild', 'jumpy'), 'loud, wild, jumpy');
  assert.equal(addTag('loud', ' Loud '), 'loud', 'once');
  assert.equal(addTag('', 'sings, badly'), 'sings badly', 'a comma would split it');
  assert.equal(addTag('loud', '  '), 'loud');
  assert.equal(removeTag('loud, good at (knots, sums), wild', 1), 'loud, wild');
});
