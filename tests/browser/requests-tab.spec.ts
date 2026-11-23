import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.7 T4 W1, W4, W8, W9, W12 (plan A2.4): the Inbox with Accept and Decline, the Board, My asks, the type
// editor, and the phone.
const GENERAL = '11111111-1111-4111-8111-111111111111';
const DESIGN = '22222222-2222-4222-8222-222222222222';
async function open(page: Page, opts: { width?: number; canTriage?: boolean; empty?: boolean } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-23T10:00:00Z'));
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.addInitScript(({ canTriage, empty }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const types = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'General request', icon: 'Inbox', triagerIds: [], firstReplyMinutes: 240, deliverMinutes: null, archivedAt: null,
        questions: [{ id: 'need', label: 'What do you need?', kind: 'text', required: true }, { id: 'why', label: 'Why now?', kind: 'text', required: false }] },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Design request', icon: 'Palette', triagerIds: [], firstReplyMinutes: 480, deliverMinutes: 2400, archivedAt: null,
        questions: [{ id: 'what', label: 'What’s needed', kind: 'choice', options: ['Banner', 'Deck'], required: true }, { id: 'brief', label: 'Brief', kind: 'long_text', required: true }] },
    ];
    const req = (id: string, n: number, title: string, stage: string, typeId: string, extra: Record<string, unknown> = {}) => ({
      id, taskNumber: n, title, stage, status: stage === 'delivered' || stage === 'declined' ? 'done' : stage === 'new' || stage === 'accepted' ? 'todo' : 'in_progress',
      sprintId: null, dueDate: null, assigneeId: null, assigneeName: null, creatorId: 'u2', creatorName: 'Dev', createdAt: '2026-11-20T09:00:00.000Z',
      typeFields: { requestTypeId: typeId }, ...extra });
    const requests = empty ? [] : [
      req('r1', 180, 'Banner for the launch', 'new', '22222222-2222-4222-8222-222222222222', { createdAt: '2026-11-21T09:00:00.000Z', dueDate: '2026-12-01' }),
      req('r2', 181, 'Access to analytics', 'new', '11111111-1111-4111-8111-111111111111', { createdAt: '2026-11-19T09:00:00.000Z' }),
      req('r3', 182, 'Pitch deck refresh', 'in_progress', '22222222-2222-4222-8222-222222222222', { assigneeId: 'u1', assigneeName: 'Asha' }),
      req('r4', 183, 'New laptop', 'declined', '11111111-1111-4111-8111-111111111111', { creatorId: 'u1', creatorName: 'Asha', typeFields: { requestTypeId: '11111111-1111-4111-8111-111111111111', declineReason: 'Budget is spent' } }),
    ];
    (window as any).__actions = {
      readRequestsAction: async () => ({ success: true, projectKey: 'AC', requests, types, canTriage, canManage: canTriage, viewerId: 'u1' }),
      readRequestTypesAction: async () => ({ success: true, types, active: types, canManage: canTriage }),
      acceptRequestAction: async (input: unknown) => { calls.push(['accept', input]); return { success: true }; },
      declineRequestAction: async (input: unknown) => { calls.push(['decline', input]); return { success: true }; },
      saveRequestTypeAction: async (input: unknown) => { calls.push(['saveType', input]); return { success: true, id: 'x' }; },
      archiveRequestTypeAction: async (input: unknown) => { calls.push(['archiveType', input]); return { success: true }; },
      createTaskAction: async (input: unknown) => { calls.push(['create', input]); return { success: true, task: { id: 'n' } }; },
    };
  }, { canTriage: opts.canTriage ?? true, empty: opts.empty ?? false });
  await openApp(page, 'tests/browser/requests-tab.fixture.tsx');
  await expect(page.getByTestId('requests-counts')).toBeVisible();
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W1: an empty Requests opens on the Inbox with the empty line and New request', async ({ page }) => {
  await open(page, { empty: true });
  await expect(page.getByTestId('requests-empty')).toContainText('No requests yet. People in the workspace ask here; you choose what to take on.');
  await expect(page.getByTestId('requests-counts')).toHaveText('0 new · 0 open');
});

test('W4: the Inbox lists New oldest first; Accept needs who handles it; Decline needs a reason', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('requests-counts')).toHaveText('2 new · 1 open');
  await expect(page.getByTestId('inbox-row')).toHaveCount(2);
  await expect(page.getByTestId('inbox-row').first()).toContainText('Access to analytics');
  await expect(page.getByTestId('inbox-row').nth(1)).toContainText(/Design request.*Banner for the launch.*Need by/);
  await page.getByTestId('inbox-row').first().getByRole('button', { name: 'Accept' }).click();
  const accept = page.getByTestId('accept-request-dialog');
  await expect(accept.getByRole('button', { name: 'Accept' })).toBeDisabled();
  await accept.getByLabel('Assigned to').selectOption('u2');
  await accept.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => calls(page)).toEqual([['accept', { projectId: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', taskId: 'r2', assigneeId: 'u2', sprintId: null }]]);
  await page.getByTestId('inbox-row').nth(1).focus();
  await page.keyboard.press('d');
  const decline = page.getByTestId('decline-request-dialog');
  await expect(decline.getByRole('button', { name: 'Decline' })).toBeDisabled();
  await decline.getByLabel(/Why\?/).fill('Not this month');
  await decline.getByRole('button', { name: 'Decline' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['decline', { projectId: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', taskId: 'r1', reason: 'Not this month' }]);
  await page.screenshot({ path: 'test-results/requests-tab/inbox.png' });
});

test('S3 and W8: Board has five stages; Mine shows my open ones; My asks shows the decline reason', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByTestId('request-column')).toHaveCount(5);
  await expect(page.getByLabel('New, 2')).toBeVisible();
  await expect(page.getByLabel('In progress, 1')).toContainText('Pitch deck refresh');
  await page.screenshot({ path: 'test-results/requests-tab/board.png' });
  await page.getByRole('tab', { name: 'Mine' }).click();
  await expect(page.getByTestId('requests-mine').getByTestId('request-card')).toHaveCount(1);
  await page.getByRole('tab', { name: 'My asks' }).click();
  await expect(page.getByTestId('requests-asks')).toContainText('Declined · Budget is spent');
});

test('W9: owners edit types: a new type with a choice question and times is saved', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Requests actions' }).click();
  await page.getByRole('menuitem', { name: 'Request types' }).click();
  const dialog = page.getByTestId('request-types-dialog');
  await expect(dialog.getByTestId('request-type-row')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'New type' }).click();
  await dialog.getByLabel('Name').fill('Copy review');
  await dialog.getByLabel('Question 1', { exact: true }).fill('Which page?');
  await dialog.getByRole('button', { name: 'Add a question' }).click();
  await dialog.getByLabel('Question 2', { exact: true }).fill('Tone');
  await dialog.getByLabel('Question 2 kind').selectOption('choice');
  await dialog.getByLabel('Question 2 options, comma-separated').fill('Formal, Friendly');
  await dialog.getByLabel('Deliver within, unit').selectOption('days');
  await page.screenshot({ path: 'test-results/requests-tab/type-editor.png' });
  await dialog.getByRole('button', { name: 'Save type' }).click();
  await expect.poll(() => calls(page)).toEqual([['saveType', { projectId: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', type: {
    name: 'Copy review', icon: 'Inbox', triagerIds: [], firstReplyMinutes: 240, deliverMinutes: 480,
    questions: [{ id: 'q1', label: 'Which page?', kind: 'text', required: true }, expect.objectContaining({ label: 'Tone', kind: 'choice', options: ['Formal', 'Friendly'], required: false })] } }]]);
});

test('W12 and viewers: a phone shows the Inbox; viewers see no Accept, Decline or ⋯; no axe violations', async ({ page }) => {
  await open(page, { width: 390, canTriage: false });
  await expect(page.getByTestId('inbox-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Requests actions' })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/requests-tab/phone.png' });
});
