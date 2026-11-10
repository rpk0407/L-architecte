// Finding a regular at the desk (audit 02 · C7): first name or number, accents ignored, « +33 » and « 06 » alike,
// names that start with what was typed first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, nationalDigits, parseSearch, searchRank, searchClients } from '../../server/domain/client-search.js';

const C = [
  { id: 'zak', first: 'Zakaria', last: 'Haddad', phone: '+33611111111' },
  { id: 'karim', first: 'Karim', last: 'Benali', phone: '+33639224455' },
  { id: 'karl', first: 'Karl', last: 'Martin', phone: '+33722334455' },
  { id: 'okar', first: 'Omar', last: 'Karoui', phone: '+33644556677' },
  { id: 'gab', first: 'Gabriel', last: 'Belkacem', phone: '06 39 98 76 54' },
  { id: 'jr', first: 'Jean-René', last: 'D’Été', phone: '' },
  { id: 'seb', first: 'Sébastien', last: 'Noël', phone: '+33600000001' }
];
const ids = (q, then) => searchClients(C, q, then).map((c) => c.id);

test('« kar »: the first names that start with it, then a last name that does, then a name that contains it', () => {
  assert.deepEqual(ids('kar'), ['karim', 'karl', 'okar', 'zak']);
  assert.deepEqual(ids('KAR'), ['karim', 'karl', 'okar', 'zak'], 'case does not count');
});

test('among equals the list keeps its own order (most recent visit)', () => {
  const recent = { karl: 2, karim: 1 };
  assert.deepEqual(ids('kar', (a, b) => (recent[b.id] || 0) - (recent[a.id] || 0)).slice(0, 2), ['karl', 'karim']);
});

test('accents are ignored both ways', () => {
  assert.equal(fold('Sébastien NOËL'), 'sebastien noel');
  assert.deepEqual(ids('seb'), ['seb']);
  assert.deepEqual(ids('sébas'), ['seb']);
  assert.deepEqual(ids('noel'), ['seb']);
  assert.deepEqual(ids('ete'), ['jr'], 'D’Été is found by « ete »');
  assert.deepEqual(ids('rene'), ['jr'], 'the second half of a hyphenated first name counts as a word start');
});

test('words in any order: « belkacem gab » finds Gabriel Belkacem', () => {
  assert.deepEqual(ids('belkacem gab'), ['gab']);
  assert.deepEqual(ids('gab belk'), ['gab']);
  assert.deepEqual(ids('gab martin'), [], 'every word must be found');
});

test('a number is read the same with +33, 0033 or 06, with or without spaces', () => {
  assert.equal(nationalDigits('+33 6 39 22 44 55'), '0639224455');
  assert.equal(nationalDigits('0033639224455'), '0639224455');
  assert.equal(nationalDigits('06 39 22 44 55'), '0639224455');
  for (const q of ['+33 6 39 22', '+336 3922', '0033 6 39 22', '06 39 22', '063922', '06.39.22']) assert.deepEqual(ids(q), ['karim'], q);
  assert.deepEqual(ids('06 39').sort(), ['gab', 'karim'], 'a number stored as 06… answers like one stored as +33…');
  assert.deepEqual(ids('+33 6 39').sort(), ['gab', 'karim']);
});

test('digits from the middle of a number still find it, after the numbers that start with them', () => {
  assert.deepEqual(ids('2244'), ['karim']);
  assert.deepEqual(ids('0611'), ['zak']);
  // « 33 44 » without « + »: the country code or the middle of a number, both are tried
  assert.deepEqual(ids('3344'), ['karl']);
  assert.equal(searchRank(C[1], parseSearch('0639')), 0);
  assert.equal(searchRank(C[1], parseSearch('2244')), 1);
});

test('one letter or one digit is not a search; a name and digits together must both match', () => {
  assert.equal(searchRank(C[0], parseSearch('')), null);
  assert.equal(searchRank(C[0], parseSearch('6')), null);
  assert.deepEqual(ids('karim 0639'), ['karim']);
  assert.deepEqual(ids('karim 0722'), []);
});
