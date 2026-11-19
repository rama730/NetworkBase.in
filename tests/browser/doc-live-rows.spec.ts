import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.3 F2 (plan A0.5): rows are tasks; ticking changes the task, never the text; editors add, move and detach;
// readers without Tasks see the frame only; the Insert menu writes one block line with a fresh key.
async function open(page: Page, { canAdd = true, canSeeTasks = true, member = true, width = 1280, theme = 'light' } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ canAdd, canSeeTasks, member }) => {
    const row = (id: string, title: string, position: number, extra = {}) => ({ id, number: position + 10, title, status: 'todo', reviewStatus: 'none', dueDate: null, completedAt: null, position, itemType: 'task', assignee: null, canTick: true, ...extra });
    const rows = [row('a', 'Send the deck', 0, { assignee: { id: 'u1', name: 'Asha', avatarUrl: null }, dueDate: '2026-11-26T00:00:00.000Z' }), row('b', 'Book the room', 1)];
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      listWorkspaceDocsAction: async () => ({ success: true, docs: [{ id: 'd1', slug: 'weekly', filename: 'Weekly.md', linkedNodeId: 'n1' }] }),
      getWorkspaceMembersAction: async () => ({ success: true, members: [{ id: 'u1', fullName: 'Asha', membershipRole: 'member' }, { id: 'u2', fullName: 'Vic', membershipRole: 'viewer' }], hasMore: false }),
      readDocRowsAction: async () => ({ success: true, hidden: canSeeTasks ? 0 : rows.length, canAdd, canSeeTasks, member, projectKey: 'WT', rows: canSeeTasks ? rows.map((r) => ({ ...r })) : [] }),
      readDocRowKeysAction: async () => ({ success: true, keys: [{ key: 'k7f3', count: 2 }, { key: 'old1', count: 1 }] }),
      updateTaskStatusAction: async (id: string, status: string) => {
        calls.push(['status', id, status]);
        Object.assign(rows.find((r) => r.id === id)!, { status, completedAt: status === 'done' ? new Date().toISOString() : null });
        return { success: true, outcome: 'updated' };
      },
      addDocRowAction: async (_p: string, input: { title: string; assigneeId: string | null; dueDate: string | null }) => {
        calls.push(['add', input.title, input.assigneeId]);
        rows.push(row(`n${rows.length}`, input.title, rows.length));
        return { success: true, id: 'x', number: 99 };
      },
      moveDocRowAction: async (_p: string, input: { taskId: string; direction: string }) => {
        calls.push(['move', input.taskId, input.direction]);
        const i = rows.findIndex((r) => r.id === input.taskId);
        const j = input.direction === 'up' ? i - 1 : i + 1;
        [rows[i].position, rows[j].position] = [rows[j].position, rows[i].position];
        return { success: true };
      },
      detachDocRowAction: async (_p: string, input: { taskId: string }) => {
        calls.push(['detach', input.taskId]);
        rows.splice(rows.findIndex((r) => r.id === input.taskId), 1);
        return { success: true };
      },
    };
  }, { canAdd, canSeeTasks, member });
  await openApp(page, 'tests/browser/doc-live-rows.fixture.tsx', { head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}
const block = (page: Page) => page.getByRole('region', { name: 'Action items' });
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('S3 + W4: rows show who and when; ticking completes the task with Undo, the text is untouched', async ({ page }) => {
  await open(page);
  await expect(block(page)).toContainText('2 open · 0 completed');
  await expect(block(page)).toContainText('Asha');
  await expect(block(page)).toContainText('Nov 26');
  await expect(block(page)).toContainText('WT-10');
  await page.screenshot({ path: 'test-results/doc-live-rows/block-light.png' });
  await block(page).getByRole('checkbox', { name: 'Complete: Send the deck' }).click();
  await expect(block(page).getByRole('checkbox', { name: 'Mark as not done: Send the deck' })).toBeChecked();
  await expect(block(page)).toContainText('1 open · 1 completed');
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(block(page)).toContainText('2 open · 0 completed');
  expect(await calls(page)).toEqual([['status', 'a', 'done'], ['status', 'a', 'todo']]);
  expect(await page.evaluate(() => (window as any).__view.state.doc.toString())).toBe('# Weekly\n\nNotes here');
});

test('W3: Add action item with an assignee (viewers not offered); Enter adds, the form stays for the next one', async ({ page }) => {
  await open(page);
  await block(page).getByRole('button', { name: 'Add action item' }).click();
  const assignee = block(page).getByLabel('Assigned to');
  await expect(assignee.locator('option')).toHaveText(['Not assigned', 'Asha']);
  await block(page).getByRole('button', { name: 'Add' }).click();
  await expect(block(page)).toContainText('Add a title');
  await block(page).getByLabel('New action item').fill('Write the notes');
  await assignee.selectOption('u1');
  await block(page).getByLabel('New action item').press('Enter');
  await expect(block(page).getByRole('link', { name: 'Write the notes' })).toBeVisible();
  await expect(block(page).getByLabel('New action item')).toHaveValue('');
  expect(await calls(page)).toEqual([['add', 'Write the notes', 'u1']]);
});

test('W5: Move down and Remove from this list from the row menu', async ({ page }) => {
  await open(page);
  await block(page).getByRole('button', { name: 'Options for Send the deck' }).click();
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect(block(page).getByRole('link').first()).toHaveText('Book the room');
  await block(page).getByRole('button', { name: 'Options for Send the deck' }).click();
  await page.getByRole('menuitem', { name: 'Remove from this list' }).click();
  await expect(block(page).getByRole('link', { name: 'Send the deck' })).toHaveCount(0);
  expect(await calls(page)).toEqual([['move', 'a', 'down'], ['detach', 'a']]);
});

test('B9 + W12: a reader who can’t edit gets no Add; Tasks private shows the frame only', async ({ page }) => {
  await open(page, { canAdd: false });
  await expect(block(page)).toContainText('Only people who can edit this document add items here.');
  await expect(block(page).getByRole('button', { name: /Options for/ })).toHaveCount(0);
  await open(page, { canSeeTasks: false });
  await expect(block(page)).toContainText('Items in this list are visible to members.');
  await expect(block(page).getByRole('checkbox')).toHaveCount(0);
  await open(page, { canAdd: false, member: false });
  await expect(block(page)).toContainText('Send the deck');
  await expect(block(page).getByText(/Only people who can edit/)).toHaveCount(0);
});

test('S5: Insert → Action items writes one block line with a fresh 4–6 character key', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { const v = (window as any).__view; v.dispatch({ selection: { anchor: v.state.doc.length } }); });
  await page.getByTestId('doc-insert-menu').click();
  await page.getByRole('menuitem', { name: /Action items/ }).click();
  const text: string = await page.evaluate(() => (window as any).__view.state.doc.toString());
  expect(text).toMatch(/^# Weekly\n\nNotes here\n\{% project\.task_rows key="[a-z0-9]{4,6}" label="Action items" %\}\n$/);
});

test('W10 + phone dark: removed-list note shows the orphaned rows; no accessibility violations', async ({ page }) => {
  await open(page, { width: 375, theme: 'dark' });
  const note = page.getByTestId('removed-lists-note');
  await expect(note).toContainText('1 item from a removed list');
  await note.getByRole('button', { name: 'Show' }).click();
  await expect(note.getByRole('region', { name: 'Items from a removed list' })).toBeVisible();
  await expect(note.getByRole('button', { name: /^Add/ })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/doc-live-rows/phone-dark.png', fullPage: true });
  expect(await axeViolations(page)).toEqual([]);
});
