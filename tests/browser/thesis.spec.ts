import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.6 W5 (plan B1.8a).
const thesis = (chapters: unknown[]) => ({ canEdit: true, questions: ['Can GNNs beat ARIMA on city traffic?'], chapters, words: 11300, target: 12000,
  nextMilestone: { title: 'Draft', due: '2027-03-30T23:59:00Z', href: '/workspaces/gnn?x' }, supervisor: 'Dr Iyer', coSupervisor: null, staff: [], supervisorId: 'u9', coSupervisorId: null, lastSupervision: { date: '2027-03-02', slug: 'sup-1', openItems: 2 }, outputs: [{ title: 'IEEE ITS paper', kind: 'Publication', state: 'In review' }] });

test('Writing progress per chapter (over 110% marked), questions, next milestone and supervisor', async ({ page }) => {
  await page.addInitScript((t) => {
    (window as any).__actions = { readThesisAction: async () => ({ success: true, thesis: t }) };
  }, thesis([{ slug: 'intro', title: 'Introduction', number: 1, target: 4000, status: 'completed', words: 3100 }, { slug: 'lit', title: 'Literature review', number: 2, target: 8000, status: 'drafted', words: 9000 }]));
  await openApp(page, 'tests/browser/thesis.fixture.tsx');
  const card = page.getByTestId('thesis-card');
  await expect(card).toContainText('Can GNNs beat ARIMA on city traffic?');
  await expect(card).toContainText('11,300 / 12,000');
  await expect(card.getByRole('list', { name: 'Chapters' })).toContainText('1 IntroductionCompleted · 3,100 of 4,000 words');
  await expect(card.locator('.bg-destructive')).toHaveCount(1);
  await expect(card).toContainText('Draft · due Mar 3');
  await expect(card).toContainText('Dr Iyer');
  await expect(card).toContainText('Mar 2 · 2 action items');
  await expect(card).toContainText('IEEE ITS paper · In review');
  expect(await axeViolations(page)).toEqual([]);
});

test('no chapters yet: Add your chapters; research questions can be written', async ({ page }) => {
  await page.addInitScript((t) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readThesisAction: async () => ({ success: true, thesis: { ...t, questions: [] } }),
      saveThesisAction: async (_p: string, input: unknown) => { calls.push(input); return { success: true }; },
    };
  }, thesis([]));
  await openApp(page, 'tests/browser/thesis.fixture.tsx');
  await expect(page.getByRole('button', { name: 'Add your chapters' })).toBeVisible();
  await page.getByRole('button', { name: 'Add your research questions' }).click();
  await page.getByLabel('Research questions, one a line').fill('Q1\nQ2');
  await page.getByRole('button', { name: 'Save questions' }).click();
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([{ questions: ['Q1', 'Q2'] }]);
});

test('the student picks a Supervisor from the staff', async ({ page }) => {
  await page.addInitScript((t) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readThesisAction: async () => ({ success: true, thesis: { ...t, supervisorId: null, supervisor: null, staff: [{ id: 'u9', name: 'Dr Iyer' }] } }),
      saveThesisAction: async (_p: string, input: unknown) => { calls.push(input); return { success: true }; },
    };
  }, thesis([]));
  await openApp(page, 'tests/browser/thesis.fixture.tsx');
  await page.getByLabel('Supervisor', { exact: true }).selectOption('u9');
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([{ supervisorId: 'u9' }]);
  expect(await axeViolations(page)).toEqual([]);
});
