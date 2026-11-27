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

test('bell row (notifications mix): square unread mark, the body as a muted snippet, context and time in mono', () => {
  const row = read('src/components/notifications/NotificationRow.tsx');
  const css = read('src/components/notifications/notifications.css');
  assert.match(row, /<span className="nb-nt-mark" aria-hidden="true" \/>/);
  assert.match(css, /\.nb-nt-mark \{ width: 6px; height: 6px; border-radius: 1px; background: var\(--primary\);/);
  assert.match(row, /<span className="nb-nt-snip">\{snippet\}<\/span>/);
  assert.match(row, /<span className="nb-nt-meta nb-meta">/);
  assert.match(row, /className="nb-nt-when nb-meta"/);
  assert.doesNotMatch(row, /rounded-full/);
});
