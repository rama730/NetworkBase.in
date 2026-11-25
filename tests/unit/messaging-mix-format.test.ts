import assert from 'node:assert/strict';
import test from 'node:test';
import { padCount, capCount, middleCut, joinPeople } from '../../src/lib/messaging/mix-format';

test('padCount: empty at zero, two digits, 99+ above', () => {
  assert.equal(padCount(0), '');
  assert.equal(padCount(4), '04');
  assert.equal(padCount(12), '12');
  assert.equal(padCount(140), '99+');
});

test('capCount caps at the given limit', () => {
  assert.equal(capCount(1284, 999), '999+');
  assert.equal(capCount(128, 99), '99+');
  assert.equal(capCount(12, 999), '12');
});

test('middleCut keeps the version and the extension', () => {
  const name = 'North-Ridge-Site-Visit-Photos-and-Survey-Notes-for-the-Q3-Launch-Retrospective-Final-Revised-Version-With-Notes-v12a.pdf';
  const cut = middleCut(name);
  assert.ok(cut.length <= 48, cut);
  assert.ok(cut.endsWith('Notes-v12a.pdf'), cut);
  assert.ok(cut.includes('…'));
  assert.equal(middleCut('short.pdf'), 'short.pdf');
});

test('joinPeople names two, then counts the rest', () => {
  assert.equal(joinPeople([]), '');
  assert.equal(joinPeople(['Ana']), 'Ana');
  assert.equal(joinPeople(['Ana', 'Ben']), 'Ana and Ben');
  assert.equal(joinPeople(['Ana', 'Ben', 'Chen']), 'Ana, Ben and 1 other');
  assert.equal(joinPeople(['Ana', 'Ben', ...Array<string>(497).fill('x')]), 'Ana, Ben and 497 others');
});
