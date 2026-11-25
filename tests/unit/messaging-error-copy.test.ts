import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { chatErrorMessage, CHAT_ERROR_MESSAGES } from '../../src/lib/messaging/errors';
import { scheduleWindow, SCHEDULE_MAX_AHEAD_MS } from '../../src/lib/messaging/schedule-window';

const WORDS: Record<string, string> = {
  chat_general_admins_only: 'Only admins post in #general.',
  chat_org_read_only: 'This workspace is read-only. You can still read and search.',
  chat_org_channels_admins_only: 'Only admins create channels here.',
  chat_channel_not_found: 'That conversation isn’t available anymore.',
  chat_application_not_found: 'That application isn’t available anymore.',
  chat_project_not_found: 'That workspace isn’t available anymore.',
  chat_invalid_thread_root: 'That thread isn’t available anymore. Post in the channel instead.',
  chat_invalid_broadcast: '@channel and @here work only in a channel’s main conversation.',
  chat_dm_requires_two_users: 'Pick someone to message.',
  chat_tab_limit: 'A conversation can have up to 20 tabs.',
  chat_tab_duplicate: 'That tab is already here.',
  chat_scheduled_limit: 'You have 100 scheduled messages. Send or cancel one first.',
  chat_schedule_too_far: 'Pick a time within the next 120 days.',
  account_limited: 'Your account is limited. For now you can’t reach people outside your workspaces and connections. See Settings → Account standing.',
  chat_canvas_not_installed: 'Notes aren’t available here yet.',
};

test('every code the SQL and the actions raise has its own words', () => {
  for (const [code, words] of Object.entries(WORDS)) assert.equal(chatErrorMessage(code), words, code);
  assert.equal(CHAT_ERROR_MESSAGES.chat_rate_limited, 'You’re going a bit fast. Try again in a moment.');
  assert.equal(chatErrorMessage('something_else'), 'Something went wrong. Try again.');
});

test('scheduleWindow tells past from too far', () => {
  const now = Date.parse('2026-11-25T10:00:00Z');
  assert.deepEqual(scheduleWindow('nope', now), { ok: false, reason: 'invalid' });
  assert.deepEqual(scheduleWindow(new Date(now - 1000).toISOString(), now), { ok: false, reason: 'past' });
  assert.deepEqual(scheduleWindow(new Date(now + SCHEDULE_MAX_AHEAD_MS + 60_000).toISOString(), now), { ok: false, reason: 'too_far' });
  const inHour = new Date(now + 3_600_000).toISOString();
  assert.deepEqual(scheduleWindow(inHour, now), { ok: true, at: inHour });
  assert.equal(SCHEDULE_MAX_AHEAD_MS, 120 * 24 * 60 * 60 * 1000);
});

test('the three wrong-words cases return their own codes', () => {
  const channels = readFileSync('src/app/actions/chat/channels.ts', 'utf8');
  const tab = channels.slice(channels.indexOf('export async function addChannelTab'), channels.indexOf('export async function', channels.indexOf('export async function addChannelTab') + 10));
  assert.match(tab, /chat_tab_limit/);
  assert.match(tab, /chat_tab_duplicate/);
  assert.doesNotMatch(tab, /chat_duplicate"/);
  // Someone outside the channel must not learn its tab count: membership comes first.
  assert.match(tab, /chat_is_member[\s\S]*chat_not_member[\s\S]*chat_tab_limit/);
  const later = readFileSync('src/app/actions/chat/later.ts', 'utf8');
  assert.match(later, /scheduleWindow/);
  assert.match(later, /chat_schedule_too_far/);
  assert.match(later, /chat_scheduled_limit/);
});
