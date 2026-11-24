import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.9 W8 (plan B1.3a).
const sec = (id: string, name: string, students: number, extra: Record<string, unknown> = {}) => ({ id, name, kind: 'lab', meets: [{ day: 3, start: '14:00', end: '16:00' }], room: 'Lab 3', officeHours: null,
  seatLimit: null, seatsLeft: null, tas: [{ id: 'ta1', name: 'Priya' }], students: Array.from({ length: students }, (_, i) => ({ id: `${id}${i}`, name: `Student ${id}${i}` })), mine: false, ...extra });
async function open(page: Page, view: string, state: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readSectionsAction: async () => ({ success: true, role: s.role ?? 'teacher', canWrite: true, settings: { word: 'Section', taOnlyOwn: true, selfPick: s.selfPick ?? false },
        sections: s.sections, unplaced: s.unplaced ?? [] }),
      splitStudentsAction: async (_o: string, input: { apply: boolean }) => { calls.push(['split', input]); return { success: true, preview: [{ id: 'A', name: 'A', students: ['Asha', 'Ben'] }, { id: 'B', name: 'B', students: ['Chitra'] }], unplaced: 0 }; },
      moveStudentAction: async (_o: string, u: string, sId: string) => { calls.push(['move', u, sId]); return { success: true }; },
      pickSectionAction: async (_o: string, sId: string) => { calls.push(['pick', sId]); return { success: true }; },
      saveSectionSettingsAction: async (_o: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
      readOrgMembersAction: async () => ({ success: true, rows: [{ userId: 'ta1', name: 'Priya', role: 'admin' }] }),
      readReviewLoadAction: async () => ({ success: true, load: [{ userId: 'ta1', name: 'Priya', toReview: 12, over: false }, { userId: 'ta2', name: 'Arjun', toReview: 3, over: false }, { userId: 'ta3', name: 'Meera', toReview: 20, over: true }] }),
      rebalanceReviewsAction: async (_o: string, apply: boolean) => { calls.push(['rebalance', apply]); return { success: true, moves: 8, summary: [{ from: 'Meera', to: 'Arjun', count: 8 }] }; },
    };
  }, state);
  await openApp(page, 'tests/browser/sections.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);
const two = [sec('A', 'Section A', 2), sec('B', 'Section B', 1, { tas: [] })];

test('no sections: the explainer', async ({ page }) => {
  await open(page, 'sections', { sections: [], unplaced: [{ id: 'u9', name: 'Late Joiner' }] });
  await expect(page.getByText('No sections yet')).toBeVisible();
});

test('Sections view: cards, move a student, split with preview', async ({ page }) => {
  await open(page, 'sections', { sections: two, unplaced: [{ id: 'u9', name: 'Late Joiner' }] });
  const cards = page.getByTestId('section-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Wed 2:00 PM–4:00 PM · Lab 3');
  await expect(cards.nth(1)).toContainText('No TA · reviews go to the teacher');
  await expect(page.getByTestId('sections-unplaced')).toContainText('Not in a section · 1');
  await cards.first().getByRole('button', { name: 'Open Section A' }).click();
  await page.getByLabel('Move Student A0 to').selectOption('B');
  await page.getByRole('button', { name: 'Split students…' }).first().click();
  await expect(page.getByTestId('split-dialog')).toContainText('Asha, Ben');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Apply' }).click();
  await expect.poll(async () => (await calls(page)).map((c: unknown[]) => c[0])).toEqual(['move', 'split', 'split']);
  expect((await calls(page))[2][1].apply).toBe(true);
});

test('a student sees Your section with the TA and Message; with self-pick, picks a section with seats', async ({ page }) => {
  await open(page, 'mine', { role: 'student', sections: [sec('B', 'Section B', 1, { mine: true, officeHours: { days: [1], start: '12:00', end: '13:00', place: null } })] });
  const card = page.getByTestId('your-section');
  await expect(card).toContainText('Section B · Lab · Wed 2:00 PM–4:00 PM · Lab 3');
  await expect(card.getByRole('link', { name: 'Message' })).toHaveAttribute('href', '/messages?userId=ta1');
  expect(await axeViolations(page)).toEqual([]);
});

test('self-pick: seats left, a full one is disabled', async ({ page }) => {
  await open(page, 'mine', { role: 'student', selfPick: true, sections: [sec('A', 'Section A', 0, { seatLimit: 1, seatsLeft: 0, students: [] }), sec('B', 'Section B', 0, { students: [] })] });
  await expect(page.getByRole('button', { name: 'Pick Section A' })).toBeDisabled();
  await page.getByRole('button', { name: 'Pick Section B' }).click();
  await expect.poll(() => calls(page)).toEqual([['pick', 'B']]);
});

test('Settings → Sections: the word and the switches save', async ({ page }) => {
  await open(page, 'settings', { sections: [] });
  await page.getByLabel('Call them').selectOption('Batch');
  await page.getByLabel(/Students pick their own section/).check();
  await page.getByRole('button', { name: 'Save section settings' }).click();
  await expect.poll(() => calls(page)).toEqual([['settings', { word: 'Batch', taOnlyOwn: true, selfPick: true }]]);
});

test('B1.3b: Review load flags the TA over 1.5× the average; Rebalance previews, then applies', async ({ page }) => {
  await open(page, 'sections', { sections: [sec('A', 'Section A', 2)] });
  const load = page.getByTestId('review-load');
  await expect(load).toContainText('Meera 20');
  await expect(load.getByText('Over')).toHaveCount(1);
  await load.getByRole('button', { name: 'Rebalance…' }).click();
  await expect(page.getByTestId('rebalance-preview')).toContainText('8 from Meera to Arjun');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Rebalance' }).click();
  await expect.poll(async () => (await calls(page)).some((c: unknown[]) => c[0] === 'rebalance' && c[1] === true)).toBe(true);
  expect((await calls(page))[0]).toEqual(['rebalance', false]);
});

test('B1.3c: the announcement audience lists the class sections', async ({ page }) => {
  await open(page, 'audience', { sections: [] });
  await page.getByRole('button', { name: 'Audience: Everyone' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Section B' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__audience)).toEqual({ audience: { sectionIds: ['sB'] }, isPublic: false });
});
