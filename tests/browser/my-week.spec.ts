import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.4 W3 (plan B1.7a).
test('Week: the exam strip, Pinned for today, Today and Tomorrow, the rest folded, Missing; pin from a row', async ({ page }) => {
  await page.addInitScript(() => {
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let pins = ['t1'];
    (window as any).__actions = {
      readMyWeekAction: async () => ({ success: true, timeZone: 'UTC', today: at(0).slice(0, 10), inClass: true, pins,
        items: [
          { id: 's1', kind: 'session', at: at(1), title: 'CS 301 · Arrays', context: 'LH-2', href: '/org/cs', status: null },
          { id: 'p1', kind: 'prep', at: at(1), title: 'Read ch. 7', context: 'CS 301', href: '/org/cs', status: 'Before class' },
          { id: 'c1', kind: 'copy', at: at(2), title: 'Lab 3', context: 'CS 301', href: '/org/cs?x', status: 'Not started', taskId: 'c1' },
          { id: 't1', kind: 'task', at: at(3), title: 'Read ch. 7', context: 'My notes', href: '/workspaces/n', status: null, taskId: 't1' },
          { id: 's2', kind: 'session', at: at(25), title: 'MA 210', context: null, href: '/org/ma', status: 'Cancelled' },
          { id: 'c9', kind: 'copy', at: at(80), title: 'Essay', context: 'EN 101', href: '/org/en', status: 'Not started', taskId: 'c9' },
        ],
        missing: [{ id: 'm1', kind: 'copy', at: at(-72), title: 'Lab 1', context: 'CS 301', href: '/org/cs?y', status: 'Late work accepted', taskId: 'm1' }],
        exams: [{ id: 'e1', title: 'Midterm', context: 'CS 301', opensAt: at(9 * 24), href: '/org/cs?e' }] }),
      setDayPinAction: async (id: string, on: boolean) => { calls.push([id, on]); pins = on ? [...pins, id] : pins.filter((p) => p !== id); return { success: true }; },
    };
  });
  await page.setViewportSize({ width: 480, height: 900 });
  await openApp(page, 'tests/browser/my-week.fixture.tsx');
  const week = page.getByTestId('my-week');
  await expect(page.getByTestId('exam-strip')).toContainText(/Midterm.*In 9 days/);
  await expect(page.getByRole('region', { name: 'Pinned for today' })).toContainText('Read ch. 7');
  await expect(week.getByRole('region', { name: /^Today/ })).toContainText('Lab 3');
  await expect(week.getByRole('region', { name: /^Today/ })).toContainText('CS 301 · Arrays');
  await expect(week.getByRole('region', { name: /^Today/ })).toContainText('Read ch. 7CS 301 · Before class');
  await expect(week.getByRole('region', { name: /^Tomorrow/ })).toContainText('MA 210');
  await expect(week).not.toContainText('Essay');
  await week.getByRole('button', { name: /more$/ }).click();
  await expect(week).toContainText('Essay');
  await expect(page.getByRole('region', { name: 'Missing, 1' })).toContainText('Late work accepted');
  await page.getByRole('button', { name: 'Pin for today: Lab 3' }).click();
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['c1', true]]);
  expect(await axeViolations(page)).toEqual([]);
});
