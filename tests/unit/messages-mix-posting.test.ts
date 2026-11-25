import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { postingFooter } from '../../src/lib/messaging/posting';

test('read-only workspaces: the tag, the line and the reason sentence', () => {
  assert.deepEqual(postingFooter({ generalAdminsOnly: false, orgAdmin: false, readOnly: { reason: 'suspended', title: 'Acme School' } }), {
    kind: 'blocked', cause: 'read-only', tag: 'Suspended', line: 'This workspace is read-only.', reason: 'Acme School is suspended. You can still read and search.',
  });
  assert.equal(postingFooter({ generalAdminsOnly: false, orgAdmin: false, readOnly: { reason: 'archived', title: 'Year 7 Science' } })!.reason, 'Year 7 Science was archived. You can still read and search.');
  assert.equal(postingFooter({ generalAdminsOnly: true, orgAdmin: true, readOnly: { reason: 'deleting', title: 'Acme' } })!.reason, 'Acme is scheduled for deletion. You can still read and search.');
});

test('admins-only #general: members get the footer (threads stay open); admins get a quiet hint', () => {
  assert.deepEqual(postingFooter({ generalAdminsOnly: true, orgAdmin: false, readOnly: null }), { kind: 'blocked', cause: 'admins-only', tag: 'Admins only', line: 'Only admins post in #general. Reply in a thread.', reason: null });
  assert.deepEqual(postingFooter({ generalAdminsOnly: true, orgAdmin: true, readOnly: null }), { kind: 'hint', hint: 'Only admins post here · everyone replies in threads' });
  assert.equal(postingFooter({ generalAdminsOnly: false, orgAdmin: false, readOnly: null }), null);
  assert.equal(postingFooter(undefined), null);
});

const channels = readFileSync('src/app/actions/chat/channels.ts', 'utf8');
const view = readFileSync('src/components/messages/ConversationView.tsx', 'utf8');
const thread = readFileSync('src/components/messages/ThreadPane.tsx', 'utf8');
const dialog = readFileSync('src/components/messages/CreateChannelDialog.tsx', 'utf8');

test('getChannel computes posting with the guards’ own conditions', () => {
  assert.match(channels, /'generalAdminsOnly', \(c\.is_default AND p\.kind = 'organization' AND coalesce\(\(p\.org_settings->>'generalAdminsOnly'\)::boolean, false\)\)/);
  assert.match(channels, /LEFT JOIN workspaces o ON o\.id = p\.parent_id AND o\.kind = 'organization'/);
  assert.match(channels, /'reason', 'deleting'/);
});

test('the conversation and the thread use the footer; Also send to #general hides for members', () => {
  assert.match(view, /const posting = postingFooter\(channel\.posting\)/);
  assert.match(thread, /postingFooter\(details\.data\?\.posting\)/);
  assert.match(thread, /posting\?\.kind === "blocked" && posting\.cause === "admins-only" \? null/);
});

test('admins-only channel creation names the organization', () => {
  assert.match(dialog, /result\.error === "chat_org_channels_admins_only" && projectTitle \? `Only admins create channels in \$\{projectTitle\}\.`/);
});

test('the migration lets thread replies through in an admins-only #general', () => {
  const file = readFileSync(process.env.NBM_GENERAL_MIGRATION ?? 'drizzle/0148_general_thread_replies.sql', 'utf8');
  assert.match(file, /CREATE OR REPLACE FUNCTION app_private\.chat_org_general_post_guard\(\)/);
  // A member's thread reply goes through, unless it carries @channel / @here (that would notify the whole org).
  assert.match(file, /AND \(NEW\.thread_root_seq IS NULL OR NEW\.body ~ '<!\(channel\|here\)>'\) AND EXISTS/);
});

test('the named-organization error reaches people in its own words', async () => {
  const { feedbackError } = await import('../../src/lib/feedback');
  assert.equal(feedbackError('Only admins create channels in Acme School.'), 'Only admins create channels in Acme School.');
});
