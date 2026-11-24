import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.5 W4 (plan B1.6a).
test('before: format, time, room, What’s in it, Rules, the paper opens later, results held', async ({ page }) => {
  await openApp(page, 'tests/browser/exam-card.fixture.tsx', { path: '/?phase=before' });
  const card = page.getByTestId('exam-card');
  await expect(card).toContainText('Timed online ·');
  await expect(card).toContainText('LH-2 · 204');
  await expect(page.getByTestId('exam-state')).toContainText('Paper opens');
  await expect(card).toContainText('Unit 1 Arrays · Unit 2 Trees');
  await expect(card).toContainText('Late work not accepted');
  await expect(card).toContainText('Results show when your teacher releases them.');
  expect(await axeViolations(page)).toEqual([]);
});

test('during: Closes in N min', async ({ page }) => {
  await openApp(page, 'tests/browser/exam-card.fixture.tsx', { path: '/?phase=open' });
  await expect(page.getByTestId('exam-state')).toHaveText(/Closes in 4[12] min/);
});
