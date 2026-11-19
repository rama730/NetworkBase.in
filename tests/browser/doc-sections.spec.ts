import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.3 F2 (plan A0.4): sections appear only with a document workflow; Meetings newest first with dates; a
// section's + and empty line; Move to section; collapsing is remembered; phones get a Section menu.
async function open(page: Page, { added = 'meetings', width = 1440, theme = 'light' }: { added?: string; width?: number; theme?: string } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    const docs = [
      { id: '1', slug: 'plan', filename: 'Plan.md', linkedNodeId: 'n1' },
      { id: '2', slug: 'weekly', filename: 'Weekly.md', linkedNodeId: 'n2', section: 'meetings', date: '2026-11-12' },
      { id: '3', slug: 'kickoff', filename: 'Kickoff.md', linkedNodeId: 'n3', section: 'meetings', date: '2026-11-19' },
    ];
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      listWorkspaceDocsAction: async () => ({ success: true, docs: docs.map((d) => ({ ...d })) }),
      moveDocToSectionAction: async (_p: string, input: { docSlug: string; section: string; date?: string }) => {
        calls.push(['move', input.docSlug, input.section, input.date ?? null]);
        const doc = docs.find((d) => d.slug === input.docSlug)!;
        Object.assign(doc, { section: input.section, date: input.date ?? '2026-11-01' });
        return { success: true, section: input.section, date: doc.date };
      },
    };
  });
  await openApp(page, 'tests/browser/doc-sections.fixture.tsx', { path: `/?added=${added}`, head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}

test('W1: without a document workflow the rail stays flat and there is no Move to section', async ({ page }) => {
  await open(page, { added: 'bugs' });
  await expect(page.getByRole('button', { name: /Weekly/ }).first()).toBeVisible();
  await expect(page.getByTestId('doc-section-pages')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Document actions' })).toHaveCount(0);
});

test('W1 + S1: Pages, Meetings (newest first, dated) and an empty Decisions with its + line; collapsing is remembered', async ({ page }) => {
  await open(page);
  const rail = page.getByRole('complementary', { name: 'Workspace documents' });
  await expect(rail.getByTestId('doc-section-pages')).toContainText('Pages');
  const text = (await rail.innerText()).replace(/\s+/g, ' ');
  expect(text).toMatch(/Meetings 2 .*Nov 19 · Kickoff.*Nov 12 · Weekly.*Decisions 0/);
  await expect(rail.getByRole('button', { name: '+ Record a decision' })).toBeVisible();
  await page.screenshot({ path: 'test-results/doc-sections/rail-light.png' });
  await rail.getByTestId('doc-section-meetings').locator('button[aria-expanded]').click();
  await expect(rail.getByRole('button', { name: /Kickoff/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Workspace documents' }).getByRole('button', { name: /Kickoff/ })).toHaveCount(0);
});

test('W2 + S2: Move to section shows the sections with the current one, asks a date for Meetings, and moves', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Document actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to section…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move to section' });
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await expect(dialog).toContainText('Current');
  await dialog.getByRole('radio', { name: 'Meetings' }).check();
  await dialog.locator('input[type=date]').fill('2026-11-26');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/doc-sections/move-light.png' });
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['move', 'plan', 'meetings', '2026-11-26']]);
  await expect(page.getByRole('complementary', { name: 'Workspace documents' }).getByRole('button', { name: /Nov 26 · Plan/ })).toBeVisible();
});

test('W11 phone and dark: a Section menu picks which chips show; no accessibility violations', async ({ page }) => {
  await open(page, { width: 375, theme: 'dark' });
  const menu = page.getByTestId('doc-section-menu');
  await expect(menu).toHaveValue('pages');
  await menu.selectOption('meetings');
  await expect(page.getByRole('button', { name: /Kickoff/ }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/doc-sections/phone-dark.png' });
  expect(await axeViolations(page)).toEqual([]);
});
