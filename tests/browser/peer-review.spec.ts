import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.8 call (plan B1.5c).
const RUBRIC = { id: 'r1', name: 'Essay', criteria: [{ id: 'c1', name: 'Argument', levels: [{ label: 'Good', points: 10, text: '' }, { label: 'Weak', points: 0, text: '' }] }] };
async function open(page: Page, state: 'start' | 'todo') {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let drawn = s.state === 'todo';
    let sent = false;
    (window as any).__actions = {
      readPeerReviewAction: async () => ({ success: true, on: true, rubric: s.rubric, handedIn: true, peers: 2,
        todo: drawn ? [{ id: 'p1', label: 'Hand-in A', text: 'Cats are better than dogs because…', link: null, levels: sent ? { c1: 1 } : {}, comment: sent ? 'Add evidence' : null, submitted: sent }] : [],
        feedback: [{ label: 'Reviewer 1', levels: { c1: 0 }, comment: 'Clear thesis' }] }),
      startPeerReviewsAction: async () => { calls.push(['start']); drawn = true; return { success: true, drawn: 1 }; },
      savePeerReviewAction: async (id: string, d: { submit?: boolean }) => { calls.push(['save', id, d]); if (d.submit) sent = true; return { success: true }; },
    };
  }, { state, rubric: RUBRIC });
  await openApp(page, 'tests/browser/peer-review.fixture.tsx');
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('feedback from classmates shows as Reviewer 1; Start draws the hand-ins to review', async ({ page }) => {
  await open(page, 'start');
  await expect(page.getByRole('list', { name: 'Feedback from classmates' })).toContainText('Reviewer 1 · Argument Good');
  await expect(page.getByRole('list', { name: 'Feedback from classmates' })).toContainText('Clear thesis');
  await page.getByRole('button', { name: 'Start peer review' }).click();
  await expect(page.getByTestId('peer-review-item')).toContainText('Hand-in A');
  expect(await axeViolations(page)).toEqual([]);
});

test('a review: levels as radios, feedback, Send', async ({ page }) => {
  await open(page, 'todo');
  await page.getByRole('radiogroup', { name: 'Hand-in A: Argument' }).getByRole('radio', { name: 'Weak' }).click();
  await page.getByLabel('Hand-in A: feedback').fill('Add evidence');
  await page.getByRole('button', { name: 'Send review' }).click();
  expect((await calls(page)).at(-1)).toEqual(['save', 'p1', { levels: { c1: 1 }, comment: 'Add evidence', submit: true }]);
  await expect(page.getByTestId('peer-review-item')).toContainText('Hand-in A · Sent');
  expect(await axeViolations(page)).toEqual([]);
});
