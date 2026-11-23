import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.6 T3 W1–W4, W8, W12, W13 (plan A2.1): the strip, Board, Triage with Confirm, reporting with Similar open
// bugs and That's my bug, a move to Fixed asking Fixed in, Mine and Fixed, and the phone.
async function open(page: Page, opts: { width?: number; canTriage?: boolean } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-23T10:00:00Z'));
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.addInitScript((canTriage) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const bug = (id: string, n: number, title: string, stage: string, tf: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      id, taskNumber: n, title, stage, status: stage === 'fixed' || stage === 'verified' ? 'done' : stage === 'fixing' ? 'in_progress' : 'todo', priority: 'medium', sprintId: null,
      assigneeId: null, assigneeName: null, creatorId: 'u2', creatorName: 'Dev', createdAt: '2026-11-20T09:00:00.000Z', updatedAt: '2026-11-21T09:00:00.000Z', typeFields: tf, pr: null, ...extra });
    const bugs = [
      bug('b1', 142, 'Payment gateway is down', 'new', { severity: 'urgent', where: { kind: 'web', browser: 'Chrome', version: '131' }, alsoSeen: ['u3', 'u4'] }, { createdAt: '2026-11-19T09:00:00.000Z' }),
      bug('b2', 143, 'Logo is blurry', 'new', {}),
      bug('b3', 144, 'Export crashes', 'confirmed', { severity: 'major' }, { assigneeId: 'u1', assigneeName: 'Asha', pr: { url: 'https://github.com/acme/app/pull/42', title: 'acme/app#42' } }),
      bug('b4', 145, 'Wrong total', 'fixed', { severity: 'minor', fixedIn: 'v2.4' }, { updatedAt: '2026-11-22T09:00:00.000Z' }),
      bug('b5', 146, 'Old crash', 'verified', { severity: 'major', fixedIn: 'v2.3' }),
    ];
    (window as any).__actions = {
      readBugsAction: async () => ({ success: true, projectKey: 'AC', bugs, canTriage, viewerId: 'u1' }),
      confirmBugAction: async (input: unknown) => { calls.push(['confirm', input]); return { success: true }; },
      setTaskStageAction: async (input: { taskId: string; stage: string }) => { calls.push(['stage', input.taskId, input.stage]); return { success: true, status: 'done' }; },
      setBugFieldsAction: async (input: { taskId: string; fields: unknown }) => { calls.push(['fields', input.taskId, input.fields]); return { success: true }; },
      similarBugsAction: async (input: { title: string }) => ({ success: true, bugs: /pay/i.test(input.title) ? [{ id: 'b1', taskNumber: 142, title: 'Payment gateway is down', stage: 'new', seen: 2, mine: false }] : [] }),
      seeTooAction: async (input: { taskId: string; on: boolean }) => { calls.push(['seeToo', input.taskId, input.on]); return { success: true, taskNumber: 142 }; },
      closeBugAction: async (input: unknown) => { calls.push(['close', input]); return { success: true, duplicateOf: (input as { duplicateOfId?: string }).duplicateOfId ? { id: 'b1', taskNumber: 142, title: 'Payment gateway is down' } : null }; },
      createTaskAction: async (input: { title: string; itemType: string; stage: string; typeFields?: unknown }) => { calls.push(['create', input.title, input.itemType, input.stage, input.typeFields]); return { success: true, task: { id: 'n' } }; },
    };
  }, opts.canTriage ?? true);
  await openApp(page, 'tests/browser/bugs-tab.fixture.tsx');
  await expect(page.getByTestId('bugs-counts')).toBeVisible();
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W1/S1–S3: counts, the severity strip filters, five stage columns with cards', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('bugs-counts')).toHaveText('1 urgent · 2 to triage');
  await expect(page.getByTestId('bugs-strip')).toContainText(/Urgent\s*1.*Major\s*1.*Minor\s*0.*Not sure\s*1/);
  await expect(page.getByTestId('bug-column')).toHaveCount(5);
  await expect(page.getByLabel('New, 2')).toContainText('Payment gateway is down');
  await expect(page.getByRole('link', { name: 'Bug AC-142, Payment gateway is down, Urgent, New' })).toBeVisible();
  await page.getByRole('button', { name: /^Urgent/ }).click();
  await expect(page.getByLabel('New, 1')).toBeVisible();
  await page.screenshot({ path: 'test-results/bugs-tab/board.png' });
});

test('W4: Triage lists New oldest first; Confirm needs a severity and sends it with Assigned to', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Triage' }).click();
  await expect(page.getByTestId('triage-row')).toHaveCount(2);
  await expect(page.getByTestId('triage-row').first()).toContainText(/Payment gateway is down.*Web · Chrome 131.*Dev.*4d/);
  await page.getByTestId('triage-row').nth(1).getByRole('button', { name: 'Confirm' }).click();
  const dialog = page.getByRole('dialog', { name: /Confirm AC-143/ });
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Major' }).click();
  await dialog.getByLabel('Assigned to').selectOption({ label: 'Dev' });
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual([['confirm', { projectId: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', taskId: 'b2', severity: 'major', assigneeId: 'u2' }]]);
});

test("W2–W3: Report a bug shows Similar open bugs; That's my bug adds you and closes; a report sends its fields", async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Report a bug' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Bug title/).fill('Payment fails');
  await expect(dialog.getByTestId('similar-bugs')).toContainText('AC-142');
  await dialog.getByRole('button', { name: 'That’s my bug' }).click();
  await expect.poll(() => calls(page)).toEqual([['seeToo', 'b1', true]]);
  await expect(page.getByTestId('toast')).toContainText('Added you to AC-142');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Report a bug' }).click();
  await dialog.getByLabel(/Bug title/).fill('Export is slow');
  await dialog.getByLabel('What happened?').fill('Open a file\nExport');
  await dialog.getByLabel('Version').fill('132');
  await dialog.getByLabel('Browser').selectOption('Firefox');
  await dialog.getByRole('radio', { name: 'Major' }).click();
  await expect(dialog).toContainText('Shows in Bugs');
  await dialog.getByRole('button', { name: /Create bug/ }).click();
  await expect.poll(() => calls(page)).toContainEqual(['create', 'Export is slow', 'bug', 'new', { severity: 'major', steps: 'Open a file\nExport', where: { kind: 'web', browser: 'Firefox', version: '132' } }]);
});

test('W8: dropping on Fixed moves the stage and asks Fixed in', async ({ page }) => {
  await open(page);
  await page.getByText('Export crashes').dragTo(page.getByLabel('Fixed, 1'));
  // Confirmed → Fixed puts it on the board, so the Join-board sheet asks first (F1).
  await page.getByRole('dialog', { name: /Bug joins Tasks at Fixed/ }).getByRole('button', { name: 'Move' }).click();
  await expect.poll(() => calls(page)).toEqual([['stage', 'b3', 'fixed']]);
  const dialog = page.getByRole('dialog', { name: /AC-144 is Fixed/ });
  await dialog.getByLabel('Fixed in').fill('v2.5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['fields', 'b3', { fixedIn: 'v2.5' }]);
});

test('W12: Mine by severity; Fixed by version, newest first', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Mine' }).click();
  await expect(page.getByRole('group', { name: 'Major, 1' })).toContainText('Export crashes');
  await page.getByRole('tab', { name: 'Fixed' }).click();
  await expect(page.getByTestId('bugs-fixed').getByRole('group')).toHaveText([/v2\.4\s*1/, /v2\.3\s*1/]);
});

test('W13 and viewers: a phone opens on Triage without Confirm for viewers; no axe violations', async ({ page }) => {
  await open(page, { width: 375, canTriage: false });
  await expect(page.getByRole('tab', { name: 'Triage' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('triage-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Report a bug' })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test('A2.2: Close… as Duplicate picks an open bug; the keys J/K move, X closes, C confirms', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Triage' }).click();
  await page.getByTestId('triage-row').nth(1).getByRole('button', { name: 'Close…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close AC-143' });
  await expect(dialog.getByRole('button', { name: 'Close bug' })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Duplicate of…' }).click();
  await dialog.getByLabel('Duplicate of').selectOption({ label: 'AC-142 · Payment gateway is down' });
  await dialog.getByRole('button', { name: 'Close bug' }).click();
  await expect.poll(() => calls(page)).toEqual([['close', { projectId: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', taskId: 'b2', reason: 'duplicate', duplicateOfId: 'b1' }]]);
  await expect(page.getByTestId('toast')).toContainText('AC-143 closed as a duplicate of AC-142');

  await page.getByTestId('triage-row').first().focus();
  await page.keyboard.press('j');
  await expect(page.getByTestId('triage-row').nth(1)).toBeFocused();
  await page.keyboard.press('x');
  await expect(page.getByRole('dialog', { name: 'Close AC-143' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('triage-row').nth(1).focus();
  await page.keyboard.press('k');
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog', { name: /Confirm AC-142/ })).toBeVisible();
});

test("A2.2: the card's Stage menu sends Won't fix and Can't reproduce through Close…", async ({ page }) => {
  await open(page);
  await page.getByLabel('Confirmed, 1').getByRole('button', { name: /Stage: Confirmed/ }).click();
  await page.getByRole('menuitem', { name: 'Can’t reproduce' }).click();
  const dialog = page.getByRole('dialog', { name: /Close “Export crashes”/ });
  await expect(dialog.getByRole('radio', { name: 'Can’t reproduce' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('button', { name: 'Close bug' })).toBeDisabled();
  await dialog.getByLabel('What do you need from the reporter?').fill('Which file?');
  await dialog.getByRole('button', { name: 'Close bug' }).click();
  await expect.poll(() => calls(page)).toEqual([['close', { projectId: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', taskId: 'b3', reason: 'cant_reproduce', message: 'Which file?' }]]);
});

test('A2.3: search by words or AC-n, Assigned to, Export CSV of what shows, and the PR chip', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('bug-pr')).toHaveText('acme/app#42');
  await expect(page.getByTestId('bug-pr')).toHaveAttribute('href', 'https://github.com/acme/app/pull/42');
  await page.getByLabel('Search bugs').fill('crash');
  await expect(page.getByTestId('bug-card')).toHaveCount(2);
  await page.getByLabel('Search bugs').fill('AC-142');
  await expect(page.getByTestId('bug-card')).toHaveCount(1);
  await page.getByLabel('Search bugs').fill('');
  await page.getByRole('button', { name: /Assigned to/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Me' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bug-card')).toHaveCount(1);
  await expect(page.getByTestId('bug-card')).toContainText('Export crashes');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('bugs-2026-11-23.csv');
  const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
  expect(text.split('\n').filter(Boolean)).toHaveLength(2);
  expect(text).toContain('AC-144');
  await page.screenshot({ path: 'test-results/bugs-tab/filters.png' });
});
