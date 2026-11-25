import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { messageGate } from '../../src/lib/messaging/can-message';

const read = (p: string) => readFileSync(p, 'utf8');

test('messageGate: open, privacy (tag + reason), they blocked you (tag only), you blocked them (Unblock)', () => {
  assert.deepEqual(messageGate({ canMessage: true, blocked: false, blockedByMe: false }), { state: 'open' });
  assert.deepEqual(messageGate({ canMessage: undefined, blocked: false, blockedByMe: false }), { state: 'open' }, 'unknown: the server decides on click');
  assert.deepEqual(messageGate({ canMessage: false, blocked: false, blockedByMe: false }), { state: 'off', tag: 'Can’t message', reason: 'Only accepts messages from connections' });
  assert.deepEqual(messageGate({ canMessage: false, blocked: true, blockedByMe: false }), { state: 'off', tag: 'Can’t message', reason: null });
  assert.deepEqual(messageGate({ canMessage: false, blocked: true, blockedByMe: true }), { state: 'unblock' });
});

test('the server says who you can message: in the person context, and for a list (capped at 100)', () => {
  const members = read('src/app/actions/chat/members.ts');
  assert.match(members, /canMessage: boolean;/);
  assert.match(members, /export async function canMessageMany\(input: \{ userIds: string\[\] \}\)/);
  assert.match(members, /\.slice\(0, 100\)/);
  assert.match(members, /app_private\.chat_can_dm\(\$\{user\.id\}::uuid, id\)/);
});

test('the hover card gates Message: off with the tag and reason, Unblock filled when you blocked them; no gridded band', () => {
  const card = read('src/components/presence/PersonHoverCard.tsx');
  assert.match(card, /messageGate\(/);
  assert.match(card, /className="nb-state-tag">\{gate\.tag\}/);
  assert.match(card, /gate\.reason \? <p className="nb-hcard-reason">/);
  assert.match(card, /blocked \? "default" : "ghost"/);
  assert.doesNotMatch(card, /nb-hcard-band/);
  assert.doesNotMatch(read('src/app/globals.css'), /\.nb-hcard-band/);
});
