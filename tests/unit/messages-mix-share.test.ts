import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compactFeedback } from '../../src/lib/feedback';
import { inviteToast } from '../../src/lib/messaging/invite-result';

const read = (p: string) => readFileSync(p, 'utf8');

test('an invitation toast says where the note went', () => {
  assert.deepEqual(inviteToast({ messageDelivered: true, capacityWarning: false }), { kind: 'success', title: 'Invitation sent', action: 'View conversation' });
  assert.deepEqual(inviteToast({ messageDelivered: false, capacityWarning: false }), { kind: 'success', title: 'Invitation sent', description: 'Your note stays with the invitation.' });
  assert.deepEqual(inviteToast({ messageDelivered: true, capacityWarning: true }), { kind: 'warning', title: 'Invitation sent', description: 'mentor limit nearly full.', action: 'View conversation' });
});

test('a plain "Invitation sent" is a success, not the mentor-limit warning', () => {
  const out = compactFeedback('Invitation sent', 'success');
  assert.equal(out.type, 'success');
  assert.equal(out.options.description, undefined);
});

test('the invite action returns its conversation; the modal branches on it', () => {
  assert.match(read('src/app/actions/workspace/guidance.ts'), /channelId: chatChannelId \?\? null,/);
  const modal = read('src/components/workspaces/dashboard/InviteCollaboratorModal.tsx');
  assert.match(modal, /inviteToast\(result\)/);
  assert.match(modal, /openChatWindow\(channelId\); else router\.push\(conversationHref\(channelId\)\)/);
});

test('Send in NetworkBase: a missing conversation keeps the note; a block clears the pick; Sending… beats; the username counts', () => {
  const dialog = read('src/components/sharing/ShareDialog.tsx');
  assert.match(dialog, /This conversation isn’t available anymore\. Your note is kept\./);
  assert.match(dialog, /'chat_cannot_reply','chat_blocked'\]/);
  assert.match(dialog, /<PixelBeat \/>Sending…/);
  assert.match(dialog, /\{username\.length\}\/20/);
  assert.match(dialog, /sm:max-w-\[440px\]/);
  assert.match(dialog, /className="nb-seg" data-fill>[\s\S]{0,400}<TabMarker \/><\/div>/);
  assert.doesNotMatch(dialog, /rounded-md border border-border bg-muted p-3/, 'the receipt panel is a soft fill without an edge');
  const browser = read('src/components/sharing/ShareDestinationBrowser.tsx');
  assert.match(browser, /aria-label="Conversation type" className="nb-seg" data-fill>/);
  assert.doesNotMatch(browser, /rounded-md border px-2/);
  assert.match(read('src/components/sharing/SharePreviewCard.tsx'), /rounded-\[3px\] bg-muted p-3\.5/);
});

test('the status picker says mentions wait in your Inbox', () => {
  assert.match(read('src/components/presence/StatusPicker.tsx'), /Until the status clears\. Mentions wait in your Inbox\./);
});

test('#general takes only whole-organization posts: the toggle is off with its reason for a partial audience, and the server agrees', () => {
  const parts = read('src/components/organizations/OrgUpdateParts.tsx');
  assert.match(parts, /disabled=\{partialAudience\}/);
  assert.match(parts, /#general is for updates to the whole organization\./);
  const panel = read('src/components/organizations/AssignmentsPanel.tsx');
  assert.match(panel, /shareToGeneral: shareToGeneral && mode === 'everyone'/);
  assert.match(read('src/app/actions/assignments.ts'), /data\.shareToGeneral && data\.target\.mode === 'everyone'/);
});
