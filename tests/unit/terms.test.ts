import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCESS_LEVEL_LABELS, accessLevelLabel, BANNED_TERMS, DELIVERY_LEVEL_LABELS, NOTIFICATION_CATEGORIES,
  SPRINT_STATUS_LABELS, TASK_STATUS_LABELS, WORKSPACE_STATUS_LABELS,
} from '../../src/lib/copy/terms';

test('one access-level ladder (decision 1)', () => {
  assert.deepEqual(Object.values(ACCESS_LEVEL_LABELS), ['Owner', 'Admin', 'Member', 'Viewer']);
  assert.equal(accessLevelLabel('admin'), 'Admin');
  assert.equal(accessLevelLabel('admin', 'TA'), 'TA · Admin');
  assert.equal(accessLevelLabel('owner', 'Owner'), 'Owner');
});

test('status lists (decisions 11, 17, 21)', () => {
  assert.deepEqual(Object.values(TASK_STATUS_LABELS), ['To do', 'In progress', 'In review', 'Blocked', 'Completed']);
  assert.equal(SPRINT_STATUS_LABELS.planning, 'Upcoming');
  assert.equal(SPRINT_STATUS_LABELS.cancelled, 'Canceled');
  assert.deepEqual(Object.values(WORKSPACE_STATUS_LABELS), ['Draft', 'Active', 'Completed', 'Archived']);
});

test('notification vocabulary (decisions 22, 38)', () => {
  assert.equal(NOTIFICATION_CATEGORIES.length, 10);
  assert.deepEqual(Object.values(DELIVERY_LEVEL_LABELS), ['Required', 'Important', 'Normal', 'Summary', 'Instant']);
});

test('banned terms catch the old words and spare the kept ones', () => {
  const hit = (text: string) => BANNED_TERMS.some((t) => t.pattern.test(text));
  for (const bad of ['Co-leader', 'Project lead', 'Danger Zone', 'Invite Collaborator', 'Lead']) assert.ok(hit(bad), bad);
  for (const ok of ['Team lead', 'Add external project', 'Leading the charge', 'Owner']) assert.ok(!hit(ok), ok);
});
