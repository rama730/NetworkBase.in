import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { messageGate } from '../../src/lib/messaging/can-message';

const read = (p: string) => readFileSync(p, 'utf8');

test('messageGate: open, privacy (tag + reason), any other no (tag only), you blocked them (Unblock)', () => {
  assert.deepEqual(messageGate({ canMessage: true, reason: null, blockedByMe: false }), { state: 'open' });
  assert.deepEqual(messageGate({ canMessage: undefined, reason: undefined, blockedByMe: false }), { state: 'open' }, 'unknown: the server decides on click');
  assert.deepEqual(messageGate({ canMessage: false, reason: 'connections', blockedByMe: false }), { state: 'off', tag: 'Can’t message', reason: 'Only accepts messages from connections' });
  assert.deepEqual(messageGate({ canMessage: false, reason: null, blockedByMe: false }), { state: 'off', tag: 'Can’t message', reason: null });
  assert.deepEqual(messageGate({ canMessage: false, reason: null, blockedByMe: true }), { state: 'unblock' });
});

test('the server says who you can message: in the person context, and for a list (capped at 100)', () => {
  const members = read('src/app/actions/chat/members.ts');
  assert.match(members, /canMessage: boolean;/);
  assert.match(members, /export async function canMessageMany\(input: \{ userIds: string\[\] \}\)/);
  assert.match(members, /\.slice\(0, 100\)/);
  assert.match(members, /app_private\.chat_can_dm\(\$\{me\}::uuid, t\.id\)/);
  assert.match(members, /rateLimit\(`chat:can-message:/);
  assert.doesNotMatch(members, /blocked: Boolean\(row\.blocked\)|blocked: true \}/, 'a block is never returned as its own fact');
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

test('Message opens once: a second click while the first is resolving reuses it', () => {
  const src = read('src/components/messages/message-user.ts');
  assert.match(src, /const pending = new Map<string, Promise<void>>\(\)/);
  assert.match(src, /pending\.get\(userId\) \?\?/);
});

test('MessageUserLink: gated per person in one batched read, "Opening…" with the pixel beat while it resolves, nothing when you blocked them', () => {
  const link = read('src/components/messages/MessageUserLink.tsx');
  assert.match(link, /useMessageGate\(userId\)/);
  assert.match(link, /<PixelBeat \/>Opening…/);
  assert.match(link, /aria-busy=\{opening \|\| undefined\}/);
  assert.match(link, /gate\.state === "unblock"\) return null/);
  assert.match(link, /className="nb-state-tag"/);
  const gates = read('src/components/messages/message-gates.ts');
  assert.match(gates, /canMessageMany\(\{ userIds: ids\.slice\(i, i \+ 100\) \}\)/);
  assert.match(gates, /setTimeout\(flush, 0\)/);
});

test('every organization Message link goes through MessageUserLink', () => {
  for (const file of ['OrgAboutTab', 'OrgMembersTab', 'OrgMemberDialogs', 'OrgWorkspacesTab', 'ClassHomeParts', 'Sections', 'CreateLocation']) {
    const src = read(`src/components/organizations/${file}.tsx`);
    assert.match(src, /<MessageUserLink /, file);
    assert.doesNotMatch(src, /messageUserInWindow/, file);
  }
});

test('network and profile: Message shows off with the tag instead of disappearing; profile shows it beside Connect for anyone who takes messages', () => {
  for (const file of ['src/components/network/PersonCard.tsx', 'src/components/network/ConnectionsClient.tsx']) {
    assert.match(read(file), /<MessageOffMenuItem( reason=\{false\})? \/>/, file);
  }
  assert.match(read('src/components/messages/MessageUserLink.tsx'), /<DropdownMenuItem disabled[^>]*>[\s\S]{0,300}Can’t message[\s\S]{0,200}Only accepts messages from connections/);
  const band = read('src/components/profile/v2/ProfileBand.tsx');
  assert.doesNotMatch(band, /connectionState === 'accepted' && showMessageAction/);
  assert.match(band, /messageOff \?/);
  assert.match(band, /Only accepts messages from connections/);
});
