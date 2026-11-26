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
    const person = (id: string, name: string, position: string | null, startYear: number | null, role = 'member') => ({ id, name, username: id, avatarUrl: null, role, position, startYear, interests: ['3D scenes'], workspaces: [], supervisor: null, leavingOn: null });
    (window as any).__actions = {
      readLabPeopleAction: async () => ({ success: true, admin, pi: admin, me: 'u1', positions: POSITIONS,
        people: [person('u1', 'Dr. Rao', 'pi', 2015, 'pi'), person('u2', 'Mei', 'phd', 2023), person('u3', 'Arjun', 'phd', 2024), person('u4', 'Sam', null, null)] }),
      setLabPositionAction: async (_o: string, id: string, v: unknown) => { calls.push(['position', id, v]); return { success: true }; },
      readLabHomeAction: async () => ({ success: true, admin, welcome: 'We study how machines see.', officeHours: 'Thursdays 15:00, room 204', contact: { id: 'u1', name: 'Dr. Rao' }, people: 9, projects: 14 }),
      readLabSettingsAction: async () => ({ success: true, owner: 'u1', leads: [{ id: 'u1', name: 'Dr. Rao' }],
        settings: { positions: POSITIONS, officeHours: '', contactId: null, plans: { leaving: true }, about: { areas: true, people: true, alumni: true, publications: true, joinUs: true }, researchAreas: [], joinUs: '' } }),
      saveLabSettingsAction: async (_o: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
      startFinishAction: async (_o: string, id: string, v: unknown) => { calls.push(['finish', id, v]); return { success: true }; },
      cancelFinishAction: async () => ({ success: true }),
      readLabAlumniAction: async () => ({ success: true, alumni: [{ id: 'a1', name: 'Arjun', position: 'PhD student', startYear: 2019, endYear: 2025, nowAt: 'a robotics startup' }] }),
      readMyAlumniAction: async () => ({ success: true, entry: { listed: false, nowAt: '', position: 'PhD student', startYear: 2021, endYear: 2026 } }),
      saveMyAlumniAction: async (_o: string, v: unknown) => { calls.push(['alumni', v]); return { success: true }; },
      readLabAboutAction: async () => ({ success: true, signedIn: true, contactId: 'u1', isContact: false, areas: ['3D scenes', 'Video understanding'], joinUs: 'We take 1 to 2 PhD students a year.',
        people: [{ id: 'u1', name: 'Dr. Rao', position: 'pi', startYear: 2015 }, { id: 'u2', name: 'Mei', position: 'phd', startYear: 2023 }], positions: POSITIONS, showPeople: true, showAlumni: true,
        alumni: [{ id: 'a1', name: 'Arjun', position: 'PhD student', startYear: 2019, endYear: 2025, nowAt: 'a robotics startup' }] }),
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

test('Finish in the lab: the PI picks the last day and can keep someone as a Viewer', async ({ page }) => {
  await open(page, true);
  await page.getByRole('button', { name: 'Finish in the lab for Mei' }).click();
  const f = page.getByTestId('finish-form');
  await f.getByLabel('Last day').fill('2026-12-31');
  await f.getByLabel(/Keep as Viewer/).check();
  await f.getByRole('button', { name: 'Start the Leaving plan' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['finish', 'u2', { end: '2026-12-31', keepAsViewer: true }]);
});

test('Alumni: the list shows Now at; your own entry asks List me as alumni', async ({ page }) => {
  await open(page, false);
  await page.getByRole('tab', { name: 'Alumni' }).click();
  await expect(page.getByTestId('lab-alumni')).toContainText('Now at a robotics startup');
  await open(page, false, 'alumni-card');
  await page.getByLabel('List me as alumni').check();
  await page.getByLabel(/Now at/).fill('a lab in Pune');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['alumni', { listed: true, nowAt: 'a lab in Pune' }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('The public lab page: research areas, people under positions, alumni, Join us with Message the PI', async ({ page }) => {
  await open(page, false, 'about');
  const about = page.getByTestId('lab-about');
  await expect(about).toContainText('3D scenes · Video understanding');
  await expect(about).toContainText('PhD student: Mei');
  await expect(about.getByRole('link', { name: 'Message the PI' })).toHaveAttribute('href', '/messages?userId=u1');
  await expect(about).not.toContainText('@');
  expect(await axeViolations(page)).toEqual([]);
});
