import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrack, formatTrack, parseBond, formatBond, parseStat, formatStat, parseSheet, serializeSheet, diffRows, applyPending, parseLog, formatLog, isSignedIn, signinRow } from '../assets/codec.js';
import { sampleCharacter } from './fixtures/game.mjs';

test('pip symbols, including hand-typed ones', () => {
  assert.deepEqual(parseTrack('●○○○○○'), [1, 0, 0, 0, 0, 0]);
  assert.deepEqual(parseTrack('x o * 0 1 X'), [0, 0, 1, 0, 1, 0]); // tracks have no crossed-out boxes
  assert.equal(formatTrack([1, 0, 0]), '●○○');
  assert.deepEqual(parseBond('●○·'), [1, 2, 0]);
  assert.deepEqual(parseBond('110'), [1, 1, 0]);
  assert.equal(formatBond([1, 2, 0]), '●○·');
  assert.equal(parseStat('+2'), 2);
  assert.equal(parseStat('−1'), -1);
  assert.equal(parseStat('2'), 2);
  assert.equal(parseStat('junk'), 0);
  assert.equal(formatStat(2), '+2');
  assert.equal(formatStat(-1), '-1');
});

test('log rows round-trip', () => {
  const e = parseLog('2026-10-16T03:00:00.000Z~ab12', 'Chapter’s End', '- +1 experience\n- Healed 1 harm\n\nA note\nwith lines');
  assert.deepEqual(e.items, ['+1 experience', 'Healed 1 harm']);
  assert.equal(e.note, 'A note\nwith lines');
  assert.equal(e.at, Date.parse('2026-10-16T03:00:00.000Z'));
  assert.equal(formatLog(e), '- +1 experience\n- Healed 1 harm\n\nA note\nwith lines');
  assert.equal(parseLog('x', 't', 'just a note').note, 'just a note');
});

test('a sheet survives parse → serialize unchanged', () => {
  const st = parseSheet(sampleCharacter);
  const norm = rs => rs.map(r => r.join('|')).sort();
  assert.deepEqual(norm(serializeSheet(st)), norm(sampleCharacter));
});

test('the sign-in row: read loosely, and left alone by the sheet', () => {
  assert.equal(isSignedIn([['info', 'Name', 'Testa', '']]), false);
  assert.equal(isSignedIn([signinRow(true)]), true);
  assert.equal(isSignedIn([signinRow(false)]), false);
  assert.equal(isSignedIn([['SignIn', 'Signed in', ' Yes ', '']]), true, 'typed by hand');
  assert.equal(isSignedIn([['signin', 'Signed in', 'no', '']]), false);
  const rows = [...sampleCharacter, signinRow(true)];
  assert.equal(serializeSheet(parseSheet(rows)).some(r => r[0] === 'signin'), false);
  // so the sheet page's diffs never touch it
  const st = parseSheet(rows);
  assert.deepEqual(diffRows(serializeSheet(st), serializeSheet(st)), { set: [], del: [], ren: [] });
});

test('diffs: only changed rows, deletes, and renames', () => {
  const prev = [['info', 'Name', 'Nexa', ''], ['track', 'Harm', '●○○', ''], ['sheet', 'Troubles', '- one', ''], ['sheet', 'Kit', '', '']];
  const next = [['info', 'Name', 'Nexa', ''], ['track', 'Harm', '●●○', ''], ['sheet', 'Problems', '- one', ''], ['bond', 'Ship', '●··', '']];
  const d = diffRows(prev, next);
  assert.deepEqual(d.set, [['track', 'Harm', '●●○', ''], ['sheet', 'Problems', '- one', ''], ['bond', 'Ship', '●··', '']]);
  assert.deepEqual(d.ren, [['sheet', 'Troubles', 'Problems']]);
  assert.deepEqual(d.del, [['sheet', 'Kit']]);
  assert.deepEqual(diffRows(prev, prev), { set: [], del: [], ren: [] });
});

test('pending changes apply on top of server rows in order', () => {
  const server = [['info', 'Name', 'Nexa', ''], ['sheet', 'Troubles', 'a', ''], ['sheet', 'Kit', 'b', ''], ['track', 'Harm', '○', '']];
  const out = applyPending(server, [
    { row: ['sheet', 'Problems', 'a2', ''], seq: 2 },
    { ren: ['sheet', 'Troubles', 'Problems'], row: ['sheet', 'Troubles'], seq: 1 },
    { row: ['sheet', 'Kit', '', ''], del: true, seq: 3 },
    { row: ['sheet', 'Story', 'c', ''], seq: 4 },
  ]);
  assert.deepEqual(out, [['info', 'Name', 'Nexa', ''], ['sheet', 'Problems', 'a2', ''], ['sheet', 'Story', 'c', ''], ['track', 'Harm', '○', '']]);
});

test('items keep a count (blank when not counted) and notes', () => {
  const st = parseSheet([['item', 'Medkit', '3', 'From the clinic.'], ['item', 'Rope', '', ''], ['item', 'Flare', 'lots', '']]);
  assert.deepEqual(st.items, [{ name: 'Medkit', count: 3, tags: '', note: 'From the clinic.' }, { name: 'Rope', count: null, tags: '', note: '' }, { name: 'Flare', count: null, tags: '', note: '' }]);
  assert.deepEqual(serializeSheet(st).filter(r => r[0] === 'item'), [['item', 'Medkit', '3', 'From the clinic.'], ['item', 'Rope', '', ''], ['item', 'Flare', '', '']]);
});

test('an item’s tags are a Tags: line at the top of its notes', () => {
  const rows = [['item', 'Cutlass', '', 'Tags: 2-harm, loud\n\nFrom the clinic.'], ['cargo', 'Disc', '1', 'Tags: shiny'], ['item', 'Rope', '', 'Tagged: no']];
  const st = parseSheet(rows);
  assert.deepEqual(st.items[0], { name: 'Cutlass', count: null, tags: '2-harm, loud', note: 'From the clinic.' });
  assert.deepEqual(st.cargo[0], { name: 'Disc', count: 1, tags: 'shiny', note: '' });
  assert.deepEqual([st.items[1].tags, st.items[1].note], ['', 'Tagged: no']);
  assert.deepEqual(serializeSheet(st).filter(r => r[0] === 'item' || r[0] === 'cargo'), [rows[0], rows[2], rows[1]]);
  st.items[1].tags = 'heavy';
  assert.deepEqual(diffRows(serializeSheet(parseSheet(rows)), serializeSheet(st)).set, [['item', 'Rope', '', 'Tags: heavy\n\nTagged: no']]);
});

test('the scratchpad is one jot row, there only while it has something in it', () => {
  const st = parseSheet([['info', 'Name', 'Ann', ''], ['jot', 'Notes', 'ask the GM\nabout the map', '']]);
  assert.equal(st.jot, 'ask the GM\nabout the map');
  const rows = serializeSheet(st);
  assert.deepEqual(rows.find(r => r[0] === 'jot'), ['jot', 'Notes', 'ask the GM\nabout the map', '']);
  st.jot = '';
  assert.deepEqual(diffRows(rows, serializeSheet(st)).del, [['jot', 'Notes']]);
  assert.equal(parseSheet([['info', 'Name', 'Ann', '']]).jot, '');
});
