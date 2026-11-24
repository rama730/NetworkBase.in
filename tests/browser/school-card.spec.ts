import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 29.2 (plan B0.1): a class joins or leaves a school; a school sees counts only and decides requests.
async function open(page: Page, view: 'class' | 'school', state: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readClassInstitutionAction: async () => ({ success: true, eligible: true, canBecomeSchool: s.canBecomeSchool ?? false, institution: s.institution ?? null, pending: s.pending ?? null,
        schools: [{ id: 'sch1', title: 'Northgate School', slug: 'northgate' }] }),
      joinInstitutionAction: async (c: string, i: string) => { calls.push(['join', i]); return { success: true, outcome: 'requested' }; },
      unlinkClassAction: async (c: string) => { calls.push(['unlink']); return { success: true }; },
      makeInstitutionAction: async () => { calls.push(['make']); return { success: true }; },
      readInstitutionClassesAction: async () => ({ success: true, isAdmin: true, requests: [{ id: 'c9', title: 'Physics 9B' }],
        classes: [{ id: 'c1', title: 'Maths 10A', slug: 'maths-10a', teacher: 'Asha', members: 31, openAssignments: 2, toReview: 5, lastActivity: '2026-11-22T10:00:00Z' }] }),
      decideClassRequestAction: async (_i: string, c: string, ok: boolean) => { calls.push(['decide', c, ok]); return { success: true }; },
    };
  }, state);
  await openApp(page, 'tests/browser/school-card.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('a class asks to join a school it belongs to', async ({ page }) => {
  await open(page, 'class');
  await expect(page.getByRole('heading', { name: 'School' })).toBeVisible();
  const join = page.getByRole('button', { name: 'Join', exact: true });
  await expect(join).toBeDisabled();
  await page.getByLabel('School').selectOption('sch1');
  await join.click();
  await expect(page.getByText('Request sent').first()).toBeVisible();
  expect(await calls(page)).toEqual([['join', 'sch1']]);
  expect(await axeViolations(page)).toEqual([]);
});

test('a class in a school links to it and can leave after confirming', async ({ page }) => {
  await open(page, 'class', { institution: { id: 'sch1', title: 'Northgate School', slug: 'northgate' } });
  await expect(page.getByRole('link', { name: 'Northgate School' })).toHaveAttribute('href', '/org/northgate');
  await page.getByRole('button', { name: 'Leave the school' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Leave the school' }).click();
  await expect.poll(() => calls(page)).toEqual([['unlink']]);
});

test('a pending request can be cancelled; an empty Education org can become a school', async ({ page }) => {
  await open(page, 'class', { pending: { id: 'sch1', title: 'Northgate School', slug: 'northgate' }, canBecomeSchool: true });
  await expect(page.getByText('Asked to join Northgate School')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make a school' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect.poll(() => calls(page)).toEqual([['unlink']]);
});

test('a school sees its classes as counts and approves a request', async ({ page }) => {
  await open(page, 'school');
  const row = page.getByTestId('school-classes');
  await expect(row).toContainText('Maths 10A');
  await expect(row).toContainText('31 members · 2 open assignments · 5 to review');
  await page.getByRole('button', { name: 'Approve Physics 9B' }).click();
  await expect.poll(() => calls(page)).toEqual([['decide', 'c9', true]]);
  expect(await axeViolations(page)).toEqual([]);
});
