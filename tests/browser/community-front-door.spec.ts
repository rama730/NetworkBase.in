import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B5.1a (report 34.2).
const rules = [{ n: 1, text: 'Be kind and assume good intent.' }, { n: 2, text: 'No harassment, hate or personal attacks.' }];
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((rules) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readCommunityRulesAction: async () => ({ success: true, rules, slug: 'code-of-conduct', agreeRequired: true, questions: [] }),
      readMyCommunityAction: async () => ({ success: true, agree: { version: 1, rules, slug: 'code-of-conduct', again: true },
        gettingStarted: { items: [{ id: 'rules', label: 'Read the Code of conduct', href: '?tab=docs', done: true }, { id: 'hello', label: 'Say hi in introductions', href: '/messages', done: false }] }, questions: [], answers: {}, showAnswer: false }),
      agreeToCodeAction: async () => { calls.push(['agree']); return { success: true }; },
      tickGettingStartedAction: async (_o: string, id: string) => { calls.push(['tick', id]); return { success: true }; },
      readJoiningSettingsAction: async () => ({ success: true, settings: { agreeRequired: true, questions: [], gettingStarted: [], welcomePost: false, firstDayLimit: true } }),
      saveJoiningSettingsAction: async (_o: string, v: unknown) => { calls.push(['save', v]); return { success: true }; },
    };
  }, rules);
  await openApp(page, 'tests/browser/community-front-door.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('About shows the numbered rules; a changed Code of conduct asks to agree again (reading goes on); Getting started', async ({ page }) => {
  await open(page, 'home');
  await expect(page.getByTestId('rules-summary').getByRole('listitem')).toHaveCount(2);
  const card = page.getByTestId('agree-card');
  await expect(card).toContainText('The Code of conduct changed');
  await expect(card).toContainText('Keep reading as usual; agree to post again.');
  await expect(card.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await card.getByLabel('I agree to the Code of conduct').check();
  expect(await axeViolations(page)).toEqual([]);
  await card.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(async () => (await calls(page))[0]).toEqual(['agree']);
  const gs = page.getByTestId('getting-started');
  await expect(gs).toContainText('Getting started · 1 of 2');
  await gs.getByLabel('Done: Say hi in introductions').check();
  await expect.poll(async () => (await calls(page)).find((c: unknown[]) => c[0] === 'tick')).toEqual(['tick', 'hello']);
});

test('Settings → Joining: a join question and Getting started items', async ({ page }) => {
  await open(page, 'settings');
  const s = page.getByTestId('joining-settings');
  await s.getByRole('button', { name: 'Add a question' }).click();
  await s.getByLabel('Join question 1').fill('What brings you here?');
  await s.getByRole('button', { name: 'Add an item' }).click();
  await s.getByLabel('Getting started item 1').fill('Read the rules');
  expect(await axeViolations(page)).toEqual([]);
  await s.getByRole('button', { name: 'Save joining' }).click();
  await expect.poll(async () => ((await calls(page))[0]?.[1] as { questions: unknown[] })?.questions).toEqual([{ id: 'what-brings-you-here-0', label: 'What brings you here?' }]);
});
