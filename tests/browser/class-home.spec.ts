import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 30.2 W1 (plan B1.1).
const details = { courseCode: 'CS 301', meets: [{ day: 2, start: '10:30', end: '12:00' }, { day: 4, start: '10:30', end: '12:00' }], room: 'LH-2 · 204', onlineLink: null,
  officeHours: { days: [3], start: '15:00', end: '16:00', place: 'Room 12' }, credits: 4, breaks: [], show: { courseCode: true, meets: true, term: true, room: false, officeHours: false } };
async function open(page: Page, view: string, state: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readClassHomeAction: async () => ({ success: true, zone: 'Asia/Kolkata', role: s.role ?? 'member', canEditDetails: s.role === 'teacher', canChangeSessions: s.role === 'teacher' || s.role === 'ta',
        details: s.details === undefined ? s.base : s.details, term: { start: '2027-01-11', end: '2027-04-25' }, ended: false, teacher: { id: 'u1', name: 'Dr Rao' },
        next: s.next ?? { key: '2027-01-14T10:30', start: '2027-01-14T10:30', end: '2027-01-14T12:00', status: 'on' }, upcoming: [], officeHoursToday: s.oh ?? null,
        syllabus: s.syllabus ?? null, units: [{ id: 's1', name: 'Unit 1 Arrays', start: '2027-01-11T00:00:00Z', end: '2027-01-24T00:00:00Z', status: 'completed' }, { id: 's2', name: 'Unit 2 Trees', start: '2027-01-27T00:00:00Z', end: '2027-02-21T00:00:00Z', status: 'active' }] }),
      changeSessionAction: async (_o: string, input: unknown) => { calls.push(['session', input]); return { success: true }; },
      saveClassDetailsAction: async (_o: string, input: unknown, tell: boolean) => { calls.push(['save', input, tell]); return { success: true }; },
    };
  }, { ...state, base: details });
  await openApp(page, 'tests/browser/class-home.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('About: class details as a list with Message, syllabus card, This term with done and now', async ({ page }) => {
  await open(page, 'about', { syllabus: { slug: 'syllabus', title: 'Syllabus', firstParagraph: 'Trees and graphs in ten weeks.', published: true } });
  const dl = page.getByTestId('class-details');
  await expect(dl).toContainText('CS 301');
  await expect(dl).toContainText('Tue Thu 10:30 AM–12:00 PM');
  await expect(dl.getByRole('link', { name: 'Message' })).toHaveAttribute('href', '/messages?userId=u1');
  await expect(page.getByTestId('class-syllabus')).toContainText('Trees and graphs in ten weeks.');
  await expect(page.getByTestId('class-syllabus')).toContainText('2 units');
  await expect(page.getByTestId('class-this-term')).toContainText(/Unit 1 Arrays.*Done/);
  await expect(page.getByTestId('class-this-term')).toContainText(/Unit 2 Trees.*Now/);
  expect(await axeViolations(page)).toEqual([]);
});

test('About: a teacher with nothing yet sees Add class details and Add a syllabus; students see neither', async ({ page }) => {
  await open(page, 'about', { role: 'teacher', details: null });
  await expect(page.getByRole('link', { name: 'Add class details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a syllabus' })).toBeVisible();
});

test('Overview: Next class line; a TA cancels it after confirming', async ({ page }) => {
  await open(page, 'overview', { role: 'ta', oh: { days: [3], start: '15:00', end: '16:00', place: 'Room 12' } });
  const line = page.getByTestId('class-next');
  await expect(line).toContainText(/Next class\s*Thu 14 Jan, 10:30 AM/);
  await expect(line).toContainText('Office hours today · 3:00 PM–4:00 PM · Room 12');
  await page.getByRole('button', { name: 'Cancel this class' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel the class' }).click();
  await expect.poll(() => calls(page)).toEqual([['session', { key: '2027-01-14T10:30', change: 'cancel' }]]);
});

test('Overview: a cancelled class says Cancelled in words; students get no buttons', async ({ page }) => {
  await open(page, 'overview', { next: { key: '2027-01-14T10:30', start: '2027-01-14T10:30', end: '2027-01-14T12:00', status: 'cancelled' } });
  await expect(page.getByTestId('class-next')).toContainText('Cancelled');
  await expect(page.getByRole('button', { name: /Cancel this class|Restore/ })).toHaveCount(0);
});

test('Settings: the teacher adds a class time and saves with Tell the class', async ({ page }) => {
  await open(page, 'settings', { role: 'teacher' });
  const form = page.getByTestId('class-details-form');
  await expect(form.getByLabel('Course code').first()).toHaveValue('CS 301');
  await form.getByRole('button', { name: 'Add a class time' }).click();
  await form.getByLabel('Class 3 day').selectOption('5');
  await form.getByLabel('Tell the class').check();
  await form.getByRole('button', { name: 'Save class details' }).click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  const [[, input, tell]] = await calls(page);
  expect(tell).toBe(true);
  expect(input.meets).toEqual([...details.meets, { day: 5, start: '10:30', end: '12:00' }]);
  expect(await axeViolations(page)).toEqual([]);
});
