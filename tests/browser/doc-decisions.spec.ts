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
      recordDecisionAction: async (_p: string, input: { docSlug: string; fromDocSlug?: string; supersedesSlug?: string }) => {
        calls.push(['record', input.docSlug, input.fromDocSlug ?? null, ...(input.supersedesSlug ? [input.supersedesSlug] : [])]);
        const made = docs.find((d) => d.slug === input.docSlug);
        Object.assign(made, { section: 'decisions', decisionNumber: 3, decisionStatus: 'decided', date: '2026-11-19', ...(input.fromDocSlug ? { fromDocId: 'w-id' } : {}) });
        if (input.supersedesSlug) {
          const old = docs.find((d) => d.slug === input.supersedesSlug);
          Object.assign(old, { decisionStatus: 'superseded', supersededBy: made.id });
          made.supersedes = old.id;
        }
        return { success: true, number: 3, label: 'D-003' };
      },
      setDecisionStatusAction: async (_p: string, input: { docSlug: string; status: string }) => {
        calls.push(['status', input.docSlug, input.status]);
        docs.find((d) => d.slug === input.docSlug).decisionStatus = input.status;
        return { success: true };
      },
      reverseDecisionAction: async (_p: string, input: { docSlug: string; reason: string }) => {
        calls.push(['reverse', input.docSlug, input.reason]);
        Object.assign(docs.find((d) => d.slug === input.docSlug), { decisionStatus: 'reversed', reverseReason: input.reason });
        return { success: true };
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
  const bodies: string[] = [];
  await page.route('https://upload.test/**', (route) => { bodies.push(route.request().postData() ?? ''); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"k"}' }); });
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
  // A4.2, call 2: the ADR shape.
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain('# Ship Friday\n\n## Context\n\nThe launch window closes Monday.\n\n## Decision\n\nShip Friday\n\n## Consequences\n\n');
});

// Plan A4.2 (report 38.11 W4, W7).
test('W4: the status select moves the decision between Proposed and Decided', async ({ page }) => {
  await open(page);
  const meta = page.getByTestId('decision-meta');
  await meta.getByLabel('Status').selectOption('proposed');
  await expect(meta.getByLabel('Status')).toHaveValue('proposed');
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['status', 'use-postgres', 'proposed']]);
});

test('W7: Supersede records D-003 in its place; D-002 then says Superseded by D-003, keeps its badge and loses Supersede and Reverse', async ({ page }) => {
  await open(page);
  const meta = page.getByTestId('decision-meta');
  await meta.getByRole('button', { name: 'Supersede' }).click();
  const dialog = page.getByRole('dialog', { name: 'Supersede D-002' });
  await expect(dialog).toContainText('It replaces D-002');
  await dialog.getByLabel('Decision').fill('Ship Friday');
  await page.screenshot({ path: 'test-results/doc-decisions/supersede-light.png' });
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(meta.getByTestId('decision-superseded-by')).toHaveText('Superseded by D-003');
  await expect(meta).toContainText('Superseded');
  await expect(meta.getByLabel('Status')).toHaveCount(0);
  await expect(meta.getByRole('button', { name: 'Supersede' })).toHaveCount(0);
  await expect(meta.getByRole('button', { name: 'Reverse' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['record', 'ship-friday', null, 'use-postgres']]);
  await meta.getByRole('button', { name: 'D-003' }).click();
  expect(await page.evaluate(() => (window as any).__pushed)).toContain('doc=ship-friday');
});

test('W7: Reverse asks a reason, then the decision shows Reversed with it', async ({ page }) => {
  await open(page);
  const meta = page.getByTestId('decision-meta');
  await meta.getByRole('button', { name: 'Reverse' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reverse D-002' });
  await dialog.getByRole('button', { name: 'Reverse' }).click();
  await expect(dialog).toContainText("Say why it's reversed");
  await dialog.getByLabel('Reason').fill('Search moved to Typesense');
  await dialog.getByRole('button', { name: 'Reverse' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(meta.getByTestId('decision-reverse-reason')).toHaveText('Reversed: Search moved to Typesense');
  await expect(meta.getByLabel('Status')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__calls)).toEqual([['reverse', 'use-postgres', 'Search moved to Typesense']]);
});

test('W4: people who can only read see the status as a badge, without Supersede or Reverse', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__canEdit = false; });
  await open(page);
  const meta = page.getByTestId('decision-meta');
  await expect(meta).toContainText(/D-002\s*Decided\s*Nov 12/);
  await expect(meta.getByRole('button', { name: 'Supersede' })).toHaveCount(0);
});

test('W6, S5: a decision\'s page says D-002 · status · date · From: the meeting, which opens it', async ({ page }) => {
  await open(page);
  const meta = page.getByTestId('decision-meta');
  await expect(meta.getByLabel('Status')).toHaveValue('decided');
  await expect(meta).toContainText(/D-002.*Nov 12\s*From: Weekly/);
  await meta.getByRole('button', { name: 'Weekly' }).click();
  expect(await page.evaluate(() => (window as any).__pushed)).toContain('doc=weekly');
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

// Plan A6.1 (report 38.15 W1): New document → NetworkBase templates → the title names the document, the text is the template's.
test('A6.1 W1: Add document offers NetworkBase templates by group; picking one makes “Assumptions check – Pricing” with its text', async ({ page }) => {
  await open(page);
  const bodies: string[] = [];
  await page.route('https://upload.test/**', (route) => { bodies.push(route.request().postData() ?? ''); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"k"}' }); });
  await page.evaluate(() => { (window as any).__actions.getWorkspaceNodes = async () => ({ nodes: [], nextCursor: null }); (window as any).__actions.readOrgDocsAction = async () => ({ success: true, mode: 'none' }); });
  await rail(page).getByRole('button', { name: 'Add to Pages' }).click();
  const d = page.getByRole('dialog', { name: 'Add document' });
  await d.getByLabel('Document title').fill('Pricing');
  await d.getByText('NetworkBase templates').click();
  await expect(d.getByRole('list', { name: 'Startup and business' })).toContainText('Assumptions checkWhat has to be true, what it depends on, and the cheapest test.');
  await page.screenshot({ path: 'test-results/doc-decisions/templates.png' });
  await d.getByRole('listitem').filter({ hasText: 'Assumptions check' }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toContain('# Assumptions check – Pricing\n\n_What has to be true for this to work?');
  expect(bodies[0]).toContain('| Assumption | Depends on | Evidence |');
});
