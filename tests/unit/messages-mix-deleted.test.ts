import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DELETED_USER, unknownMentionIds } from '../../src/lib/messaging/deleted-user';
import { tokensToMarkdown } from '../../src/components/messages/MessageBody';
import { tokensToPlainText } from '../../src/lib/messaging/tokens';
import { systemLine } from '../../src/lib/messaging/system-line';

const read = (p: string) => readFileSync(p, 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const nameOf = (id: string) => (id === A ? DELETED_USER : undefined);

test('a deleted account reads "@deleted user", gone-styled; an unknown one stays "@someone"', () => {
  assert.equal(DELETED_USER, 'deleted user');
  assert.equal(tokensToMarkdown(`hi <@${A}> and <@${B}>`, nameOf, () => undefined), 'hi [@deleted user](mention-gone:) and [@someone](mention-gone:)');
  assert.equal(tokensToPlainText(`hi <@${A}>`, nameOf), 'hi @deleted user');
  assert.equal(systemLine(`added <@${A}>`, ['Ana'], nameOf).text, 'added deleted user');
});

test('unknownMentionIds: ids mentioned in loaded messages that no one has named yet, at most 50', () => {
  const messages = [{ body: `<@${A}> <@${B}> <@${A}>` }, { body: 'no mentions' }];
  assert.deepEqual(unknownMentionIds(messages, (id) => (id === B ? 'Ben' : undefined)), [A]);
  const many = Array.from({ length: 60 }, (_, i) => `<@${String(i).padStart(8, '0')}-1111-4111-8111-111111111111>`).join(' ');
  assert.equal(unknownMentionIds([{ body: many }], () => undefined).length, 50);
});

test('members carry deleted; the server says which mentioned ids are deleted accounts (members of the conversation only, no names)', () => {
  const channels = read('src/app/actions/chat/channels.ts');
  assert.match(channels, /pr\.deleted_at IS NOT NULL AS deleted/);
  assert.match(channels, /export async function findDeletedPeople\(input: \{ channelId: string; userIds: string\[\] \}\)/);
  assert.match(channels, /app_private\.chat_is_member\(\$\{input\.channelId\}::uuid, \$\{user\.id\}::uuid\)/);
  const view = read('src/components/messages/ConversationView.tsx');
  assert.match(view, /p\.deleted \? DELETED_USER : personName\(p\)/);
  assert.match(view, /findDeletedPeople\(/);
});
