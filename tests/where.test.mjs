import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhere, formatWhere, moveWhere, inWhere, parseOn, parseDepth, mapKey } from '../assets/where.js';

test('Where: a placed picture, an area, a shape or the whole map; anything else is nowhere', () => {
  assert.deepEqual(parseWhere('68.8 29.2 30.5'), { x: 68.8, y: 29.2, w: 30.5 });
  assert.deepEqual(parseWhere(' 59.2  45.1 13.3 7.1 '), { x: 59.2, y: 45.1, w: 13.3, h: 7.1, area: true });
  assert.deepEqual(parseWhere('ALL'), { full: true, x: 50, y: 50, w: 100, h: 100 });
  const s = parseWhere('10,10 30,10 20,30');
  assert.deepEqual([s.x, s.y, s.w, s.h], [20, 20, 20, 20], 'with the box around it');
  for (const bad of ['', '  ', '1 2', '1 2 3 4 5', 'a b c', '1,2 3,4', '1,2 3 4,5'])assert.equal(parseWhere(bad), null, bad);
});

test('Where: written back as the GM would type it', () => {
  for (const t of ['68.8 29.2 30.5', '59.2 45.1 13.3 7.1', 'all', '10,10 30,10 20,30']) assert.equal(formatWhere(parseWhere(t)), t);
  assert.equal(formatWhere(moveWhere(parseWhere('10 10 5'), 2.04, -1)), '12 9 5');
  assert.equal(formatWhere(moveWhere(parseWhere('10,10 30,10 20,30'), 1, 1)), '11,11 31,11 21,31');
});

test('Where: what an area covers', () => {
  assert.equal(inWhere(parseWhere('50 50 10 4'), 54, 51), true);
  assert.equal(inWhere(parseWhere('50 50 10 4'), 54, 53), false);
  const tri = parseWhere('0,0 10,0 0,10');
  assert.equal(inWhere(tri, 2, 2), true);
  assert.equal(inWhere(tri, 8, 8), false);
});

test('On: a place, or a place and its level; Depth: 0 to 5', () => {
  assert.equal(parseOn(''), null);
  assert.deepEqual(parseOn("Hacker's Haven"), { place: "hacker's haven", level: '' });
  assert.deepEqual(parseOn('Hacker’s Haven · Level 1'), { place: "hacker's haven", level: 'level 1' });
  assert.deepEqual(parseOn('Haven / Lvl 2'), { place: 'haven', level: 'lvl 2' });
  assert.equal(mapKey('  The  OASIS '), 'the oasis');
  assert.deepEqual(['', '2', '9', '-1', 'x', '1.5'].map(parseDepth), [0, 2, 5, 0, 0, 1.5]);
});
