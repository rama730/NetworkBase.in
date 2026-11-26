import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B6.1a (report 35.2).
const POSITIONS = [{ id: 'pi', label: 'PI' }, { id: 'postdoc', label: 'Postdoc' }, { id: 'phd', label: 'PhD student' }];
async function open(page: Page, admin: boolean, view = 'people') {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(({ admin, POSITIONS }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const person = (id: string, name: string, position: string | null, startYear: number | null, role = 'member') => ({ id, name, username: id, avatarUrl: null, role, position, startYear, interests: ['3D scenes'], workspaces: [] });
    (window as any).__actions = {
      readLabPeopleAction: async () => ({ success: true, admin, me: 'u1', positions: POSITIONS,
        people: [person('u1', 'Dr. Rao', 'pi', 2015, 'pi'), person('u2', 'Mei', 'phd', 2023), person('u3', 'Arjun', 'phd', 2024), person('u4', 'Sam', null, null)] }),
      setLabPositionAction: async (_o: string, id: string, v: unknown) => { calls.push(['position', id, v]); return { success: true }; },
      readLabHomeAction: async () => ({ success: true, admin, welcome: 'We study how machines see.', officeHours: 'Thursdays 15:00, room 204', contact: { id: 'u1', name: 'Dr. Rao' }, people: 9, projects: 14 }),
      readLabSettingsAction: async () => ({ success: true, owner: 'u1', leads: [{ id: 'u1', name: 'Dr. Rao' }],
        settings: { positions: POSITIONS, officeHours: '', contactId: null, plans: { leaving: true }, about: { areas: true, people: true, alumni: true, publications: true, joinUs: true }, researchAreas: [], joinUs: '' } }),
      saveLabSettingsAction: async (_o: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
    };
  }, { admin, POSITIONS });
  await openApp(page, 'tests/browser/lab.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('People are grouped under headings by position; the PI sets a position and start year', async ({ page }) => {
  await open(page, true);
  await expect(page.getByRole('heading', { name: /^PhD student/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Members/ })).toBeVisible();
  await expect(page.getByTestId('lab-person').filter({ hasText: 'Mei' })).toContainText('PhD student · since 2023');
  await page.getByRole('button', { name: 'Set position for Sam' }).click();
  await page.getByLabel('Position for Sam').selectOption('postdoc');
  await page.getByLabel('Start year for Sam').fill('2025');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => calls(page)).toContainEqual(['position', 'u4', { position: 'postdoc', startYear: 2025 }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Members see People without Set position', async ({ page }) => {
  await open(page, false);
  await expect(page.getByTestId('lab-person').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Set position/ })).toHaveCount(0);
});

test('The lab home: Reach the PI is a Message and office hours, never an email', async ({ page }) => {
  await open(page, false, 'home');
  const reach = page.getByTestId('reach-the-pi');
  await expect(reach.getByRole('link', { name: 'Message Dr. Rao' })).toHaveAttribute('href', '/messages?userId=u1');
  await expect(reach).toContainText('Office hours: Thursdays 15:00, room 204');
  await expect(page.getByTestId('lab-home')).not.toContainText('@');
  expect(await axeViolations(page)).toEqual([]);
});

test('Settings → Lab renames positions and turns About sections off', async ({ page }) => {
  await open(page, true, 'settings');
  await page.getByLabel('Position 3').fill('Doctoral student');
  await page.getByLabel('Alumni').uncheck();
  await page.getByRole('button', { name: 'Save lab settings' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('Doctoral student');
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"alumni":false');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
