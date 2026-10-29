import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLongDate, formatShortDate } from '../../src/lib/utils/date';

// Decision 31: one short and one long date format everywhere.
test('one short and one long date format', () => {
  const when = new Date('2026-10-29T15:40:00Z');
  assert.equal(formatShortDate(when, 'UTC'), 'Oct 29');
  assert.equal(formatLongDate(when, 'UTC'), 'Oct 29, 2026, 3:40 PM');
});
