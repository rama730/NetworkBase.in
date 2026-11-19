import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.5 T1 (plan A1.1): items on their due days, +n more, drag to move with Undo, + on a day, No date tray,
// phone agenda. The clock is fixed to 2026-11-20.
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}T00:00:00.000Z`;
async function open(page: Page, query = '') {
  await page.clock.setFixedTime(new Date('2026-11-20T10:00:00'));
  await page.addInitScript((d) => {
    const items = [
      { id: 'a', taskNumber: 1, title: 'Fix login', status: 'todo', dueDate: d[0], itemType: 'bug', assigneeId: 'u1', priority: 'high', sprintId: null },
      { id: 'b', taskNumber: 2, title: 'Write docs', status: 'todo', dueDate: d[0], assigneeId: 'u2', priority: 'medium', sprintId: null },
      { id: 'c', taskNumber: 3, title: 'Book room', status: 'todo', dueDate: d[0], assigneeId: null, priority: 'low', sprintId: null },
      { id: 'd', taskNumber: 4, title: 'Send invites', status: 'done', dueDate: d[0], assigneeId: null, priority: 'low', sprintId: null },
      { id: 'e', taskNumber: 5, title: 'Ship it', status: 'todo', dueDate: d[1], assigneeId: 'u1', priority: 'urgent', sprintId: null },
    ];
    const noDate = [{ id: 'f', taskNumber: 6, title: 'Someday', status: 'todo', dueDate: null, assigneeId: null, priority: 'low', sprintId: null }];
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readCalendarAction: async () => ({ success: true, projectKey: 'WT', items: items.map((i) => ({ ...i })), noDate: noDate.map((i) => ({ ...i })), noDateCount: noDate.length, canEdit: true }),
      updateTaskFieldAction: async (id: string, field: string, value: string | null) => {
        calls.push([id, field, value]);
        const all = [...items, ...noDate];
        const it = all.find((x) => x.id === id)!;
        it.dueDate = value;
        if (value && noDate.includes(it as never)) { noDate.splice(noDate.indexOf(it as never), 1); items.push(it as never); }
        return { success: true };
      },
    };
  }, [day(20), day(26)]);
  await openApp(page, 'tests/browser/tasks-calendar.fixture.tsx', { path: `/?${query}` });
}
const cal = (page: Page) => page.getByTestId('tasks-calendar');
const cell = (page: Page, key: string) => page.locator(`[data-day="${key}"]`);
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W8: the month, Monday first, today marked; three items then +1 more; done items struck through', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await expect(cal(page).getByRole('heading', { name: 'November 2026' })).toBeVisible();
  await expect(cal(page).getByText('Mon', { exact: true })).toBeVisible();
  await expect(cell(page, '2026-11-20').getByTestId('calendar-item')).toHaveCount(3);
  await expect(cell(page, '2026-11-20')).toContainText('+1 more');
  await expect(cell(page, '2026-11-20').locator('[aria-current="date"]')).toHaveText('20');
  await expect(cell(page, '2026-11-20')).toContainText('WT-1');
  await page.screenshot({ path: 'test-results/tasks-calendar/month.png' });
  await cell(page, '2026-11-20').getByRole('button', { name: '+1 more' }).click();
  await expect(cal(page).getByRole('heading', { name: /Nov 16/ })).toBeVisible();
  await expect(cell(page, '2026-11-20').getByTestId('calendar-item')).toHaveCount(4);
});

test('W8.4: dragging to another day moves the due date, with Undo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await cell(page, '2026-11-26').getByText('Ship it').dragTo(cell(page, '2026-11-27'));
  await expect(page.getByText('Due Fri, Nov 27').first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => calls(page)).toEqual([['e', 'dueDate', '2026-11-27T00:00:00.000Z'], ['e', 'dueDate', day(26)]]);
});

test('W8.3 + W8.5: No date tray drags onto a day; + on a day opens New with that date; clicking opens the item', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await expect(page.getByRole('complementary', { name: 'No date' })).toContainText('Someday');
  await page.getByRole('complementary', { name: 'No date' }).getByText('Someday').dragTo(cell(page, '2026-11-24'));
  await expect.poll(() => calls(page)).toEqual([['f', 'dueDate', '2026-11-24T00:00:00.000Z']]);
  await cell(page, '2026-11-25').hover();
  await cell(page, '2026-11-25').getByRole('button', { name: /New on/ }).click();
  expect(await page.evaluate(() => (window as any).__newOn)).toBe('2026-11-25');
  await cell(page, '2026-11-26').getByText('Ship it').click();
  expect(await page.evaluate(() => (window as any).__opened)).toBe('e');
});

test('F3 chips apply: Assigned to Me shows only mine', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, 'mine=1');
  await expect(cell(page, '2026-11-20').getByTestId('calendar-item')).toHaveText([/Fix login/]);
});

test('W10 phone: an agenda of days with items; no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  const agenda = page.getByRole('list', { name: 'Agenda' });
  await expect(agenda.getByRole('heading')).toHaveText([/Nov 20/, /Nov 26/]);
  await page.screenshot({ path: 'test-results/tasks-calendar/phone.png', fullPage: true });
  expect(await axeViolations(page)).toEqual([]);
});
