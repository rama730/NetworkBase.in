import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B4.2a–b (report 33.3).
const person = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, username: null, avatarUrl: null, title: null, teams: [], office: null, zone: null, hours: null,
  joined: '2025-03-01', reportsTo: null, askMeAbout: [], awayFrom: null, awayUntil: null, awayNow: false, ...extra });
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((people) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readDirectoryAction: async () => ({ success: true, me: 'dev', admin: true, limited: false, offices: ['London'], viewersAllowed: false, managerLeft: [], people }),
      saveMyDirectoryAction: async (_o: string, v: unknown) => { calls.push(['mine', v]); return { success: true }; },
      setReportsToAction: async (_o: string, p: string, m: string | null) => { calls.push(['reports', p, m]); return { success: true }; },
      readPeopleCountsAction: async () => ({ success: true, total: 4, teams: [{ name: 'Engineering', n: 2 }, { name: 'Sales', n: 1 }], offices: [{ name: 'London', n: 1 }, { name: 'No office', n: 3 }], joined: [{ month: '2026-11', n: 4 }] }),
      readCompanyAboutAction: async () => ({ success: true, admin: true, inside: true, values: [], offices: [], publicValues: false, publicOffices: false, teams: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Sales', slug: 'sales', line: null, manager: null, members: 1 }] }),
      inviteByEmailAction: async (_o: string, v: unknown) => { calls.push(['invite', v]); return { success: true, invited: 2, existing: 0, invalid: [] }; },
      saveDirectorySettingsAction: async (_o: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
    };
  }, [
    person('sam', 'Sam Lee', { title: 'CEO' }),
    person('ana', 'Ana Ruiz', { title: 'Head of Engineering', reportsTo: 'sam', teams: ['Engineering'] }),
    person('dev', 'Dev Khan', { title: 'Backend engineer', reportsTo: 'ana', teams: ['Engineering'] }),
    person('mei', 'Mei Lin', { title: 'Account executive', reportsTo: 'sam', teams: ['Sales'], office: 'London', zone: 'Europe/London', hours: { from: '09:00', to: '17:30' }, askMeAbout: ['APAC deals'], awayFrom: '2026-11-24', awayUntil: '2026-11-28', awayNow: true }),
  ]);
  await openApp(page, 'tests/browser/company-people.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Directory: my card first with "Add your time zone", cards with Away, Ask me about and Message; search by skill', async ({ page }) => {
  await open(page, 'people');
  const cards = page.getByTestId('person-card');
  await expect(cards.first()).toContainText('Dev Khan (you)');
  const mei = cards.filter({ hasText: 'Mei Lin' });
  await expect(mei).toContainText('Sales · London');
  await expect(mei).toContainText('Away until 2026-11-28');
  await expect(mei).toContainText('Ask me about: APAC deals');
  await expect(mei.getByRole('link', { name: 'Message Mei Lin' })).toHaveAttribute('href', '/messages?userId=mei');
  await page.getByLabel('Search people').fill('apac');
  await expect(cards).toHaveCount(1);
  await page.getByLabel('Search people').fill('');
  await page.getByLabel('Your time zone').fill('Europe/London');
  await page.getByLabel('Your office').selectOption('London');
  await page.getByTestId('my-directory-fields').getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await calls(page))[0]?.[1]).toEqual({ zone: 'Europe/London', hours: { from: '09:00', to: '17:30' }, office: 'London' });
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Org chart: a tree from Reports to with report counts; admins change who someone reports to; the roster stays for admins', async ({ page }) => {
  await open(page, 'admin');
  await page.getByRole('tab', { name: /Org chart/ }).click();
  const tree = page.getByRole('tree', { name: 'Org chart' });
  await expect(tree.getByRole('treeitem', { name: 'Sam Lee, CEO, 3 reports' })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'Dev Khan, Backend engineer' })).toBeVisible();
  await tree.getByLabel('Mei Lin reports to').selectOption({ label: 'Ana Ruiz' });
  await expect.poll(async () => (await calls(page))[0]).toEqual(['reports', 'mei', 'ana']);
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('tab', { name: /Counts/ }).click();
  await expect(page.getByTestId('people-counts')).toContainText('4 people');
  await expect(page.getByTestId('people-counts')).toContainText('Engineering2');
  await page.getByRole('tab', { name: /Roster/ }).click();
  await expect(page.getByText('Roster here')).toBeVisible();
});

test('Settings → Directory: Viewers see names and titles only when switched on', async ({ page }) => {
  await open(page, 'settings');
  await page.getByTestId('directory-settings').getByRole('checkbox').check();
  await expect.poll(async () => (await calls(page))[0]?.[1]).toEqual({ viewers: true });
});

test('Import people: a pasted CSV becomes email invites grouped by title and team', async ({ page }) => {
  await open(page, 'people');
  await page.getByTestId('import-people').locator('summary').click();
  await page.getByLabel('People to import').fill('email,title,team\nmei@acme.com,Account executive,Sales\nkai@acme.com,Account executive,Sales\nnope');
  await expect(page.getByTestId('import-people')).toContainText('1 line isn’t an email; skipped');
  await page.getByRole('button', { name: 'Send 2 invites' }).click();
  await expect.poll(async () => (await calls(page)).find((c: unknown[]) => c[0] === 'invite')?.[1]).toEqual({ emails: 'mei@acme.com\nkai@acme.com', role: 'member', title: 'Account executive', childProjectId: '11111111-1111-4111-8111-111111111111' });
});
