import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reminderPlace } from '../../src/lib/messaging/reminder-place';

const read = (p: string) => readFileSync(p, 'utf8');

test('a DM reminder says "in Messages", not the partner twice', () => {
  assert.equal(reminderPlace({ channel_name: null, channel_title: null, partner: 'Dara Kim' }), 'Messages');
  assert.equal(reminderPlace({ channel_name: 'design', channel_title: null, partner: null }), '#design');
  assert.equal(reminderPlace({ channel_name: null, channel_title: 'Launch crew', partner: null }), 'Launch crew');
});

test('reported content is a filled cell, never a left bar', () => {
  assert.doesNotMatch(read('src/components/organizations/OrgReportsSection.tsx'), /border-l-2/);
  assert.doesNotMatch(read('src/components/trust/Evidence.tsx'), /border-l-2/);
});

test('bell row: square unread mark, the body as a paper cell, context as a square tag, mono time', () => {
  const row = read('src/components/notifications/NotificationRow.tsx');
  assert.doesNotMatch(row, /size-2 rounded-full ring-2/);
  assert.match(row, /size-2 rounded-\[2px\] ring-2/);
  assert.doesNotMatch(row, /font-mono text-\[11px\] text-foreground\/80/);
  assert.match(row, /className="nb-notif-body"/);
  assert.match(row, /value === preview\?\.contextLabel \? <span className="nb-state-tag">/);
  assert.match(row, /nb-notif-time/);
});
