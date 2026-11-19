import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.3 F2 (plan A0.6): decisions recorded from a meeting get the next D-number, show in its Decisions block and
// in the rail's Decisions newest first; the rail's + records one too; Insert adds the Decisions block.
async function open(page: Page, { width = 1440, theme = 'light' } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('https://upload.test/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"k"}' }));
  await page.addInitScript(() => {
    const docs: any[] = [
      { id: 'w-id', slug: 'weekly', filename: 'Weekly.md', linkedNodeId: 'n1', section: 'meetings', date: '2026-11-19' },
      { id: 'd2', slug: 'use-postgres', filename: 'Use Postgres.md', linkedNodeId: 'n2', section: 'decisions', date: '2026-11-12', decisionNumber: 2, decisionStatus: 'decided', fromDocId: 'w-id' },
    ];
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      listWorkspaceDocsAction: async () => ({ success: true, docs: docs.map((d) => ({ ...d })) }),
      ensureDocsFolderAction: async () => ({ success: true, folderId: 'f1' }),
      getUploadPresignedUrl: async () => ({ url: 'https://upload.test/put', storageKey: 'k', token: 't', uploadIntentId: 'u' }),
      createFileNode: async (_p: string, _f: string, file: { name: string }) => ({ id: 'n9', name: file.name, path: `/Docs/${file.name}` }),
      linkWorkspaceDocAction: async () => { docs.push({ id: 'd9', slug: 'ship-friday', filename: 'Ship Friday.md', linkedNodeId: 'n9' }); return { success: true, slug: 'ship-friday', id: 'd9' }; },
      recordDecisionAction: async (_p: string, input: { docSlug: string; fromDocSlug?: string }) => {
        calls.push(['record', input.docSlug, input.fromDocSlug ?? null]);
        Object.assign(docs.find((d) => d.slug === input.docSlug), { section: 'decisions', decisionNumber: 3, decisionStatus: 'decided', date: '2026-11-19', ...(input.fromDocSlug ? { fromDocId: 'w-id' } : {}) });
        return { success: true, number: 3, label: 'D-003' };
      },
    };
  });
  await openApp(page, 'tests/browser/doc-decisions.fixture.tsx', { head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}
const block = (page: Page) => page.getByTestId('decisions-block');
const rail = (page: Page) => page.getByRole('complementary', { name: 'Workspace documents' });

test('S4 + S1: the block lists D-002 · title · Decided · date; the rail shows Decisions with D-numbers', async ({ page }) => {
  await open(page);
  await expect(block(page)).toContainText(/D-002\s*Use Postgres\s*Decided\s*Nov 12/);
  await expect(rail(page)).toContainText('D-002 · Use Postgres');
  await page.screenshot({ path: 'test-results/doc-decisions/block-light.png' });
  await block(page).getByRole('button', { name: /Use Postgres/ }).click();
  expect(await page.evaluate(() => (window as any).__pushed)).toContain('doc=use-postgres');
});

test('W6: Record a decision asks for one line, makes the document and files it as D-003 from this meeting', async ({ page }) => {
  await open(page);
  await block(page).getByRole('button', { name: 'Record a decision' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record a decision' });
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(dialog).toContainText('Write the decision in one line');
  await dialog.getByLabel('Decision').fill('Ship Friday');
  await dialog.getByLabel('Context').fill('The launch window closes Monday.');
  await page.screenshot({ path: 'test-results/doc-decisions/record-light.png' });
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Recorded D-003').first()).toBeVisible();
  await expect(block(page).getByRole('button').first()).toContainText('D-003');
  await expect(rail(page)).toContainText('D-003 · Ship Friday');
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['record', 'ship-friday', 'weekly']]);
});

test("the rail's Decisions + records a decision (not an unnumbered page)", async ({ page }) => {
  await open(page);
  await rail(page).getByRole('button', { name: 'Add to Decisions' }).click();
  await expect(page.getByRole('dialog', { name: 'Record a decision' })).toBeVisible();
});

test('W7: Insert offers Decisions with Meetings & decisions and writes the block line', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { const v = (window as any).__view; v.dispatch({ selection: { anchor: v.state.doc.length } }); });
  await page.getByTestId('doc-insert-menu').click();
  await page.getByRole('menuitem', { name: /Decisions/ }).click();
  expect(await page.evaluate(() => (window as any).__view.state.doc.toString())).toBe('# Weekly\n{% project.decisions %}\n');
});

test('phone and dark: no accessibility violations', async ({ page }) => {
  await open(page, { width: 375, theme: 'dark' });
  await expect(block(page)).toContainText('D-002');
  await block(page).getByRole('button', { name: 'Record a decision' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/doc-decisions/record-phone-dark.png' });
  expect(await axeViolations(page)).toEqual([]);
});
