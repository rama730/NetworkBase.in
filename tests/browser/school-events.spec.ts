import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B3.1b (report 32.2 S1).
async function open(page: Page, view: string) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readEventsAction: async () => ({ success: true, canAdd: true, schoolTitle: 'Northgate', items: [
        { id: 'e1', day: '2027-02-08', title: 'Staff briefing', stage: 'confirmed', type: 'meeting', time: '08:15', place: '', owner: null, public: false, fromSchool: true, forMe: true, repeats: true },
        { id: 'e2', day: '2027-02-09', title: 'Leaders meeting', stage: 'planned', type: 'meeting', time: null, place: 'Room 4', owner: null, public: false, fromSchool: true, forMe: false, repeats: false },
        { id: 'e3', day: '2027-02-10', title: 'Science fair prep', stage: 'planned', type: 'deadline', time: null, place: '', owner: null, public: false, fromSchool: false, forMe: true, repeats: false }] }),
      createEventAction: async (_o: string, title: string, fields: unknown) => { calls.push(['create', title, fields]); return { success: true, id: 'e9' }; },
      setEventStatusAction: async (_o: string, id: string, s: string) => { calls.push(['status', id, s]); return { success: true }; },
      readPublicEventsAction: async () => ({ success: true, items: [{ day: '2027-02-12', title: 'Open evening', time: '18:00', place: 'Hall', type: 'event' }], holidays: [{ name: 'Half-term', start: '2027-02-15', end: '2027-02-19' }] }),
    };
  });
  await openApp(page, 'tests/browser/school-events.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Upcoming: school events Set by the school, repeats and For me in words; the filter; + Event with a weekly repeat', async ({ page }) => {
  await open(page, 'events');
  const rows = page.getByTestId('event-row');
  await expect(rows.first()).toContainText(/Mon, Feb 8 08:15\s*Staff briefing\s*· Set by Northgate\s*For me/);
  await page.getByRole('button', { name: 'For me' }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: '+ Event' }).click();
  const form = page.getByTestId('new-event');
  await form.getByLabel('Event name').fill('Parents’ evening');
  await form.getByLabel('Type').selectOption('parents');
  await form.getByLabel('Date').fill('2027-03-03');
  await form.getByLabel('Repeats weekly (skips holidays)').check();
  await form.getByLabel('Repeats until').fill('2027-03-24');
  await form.getByLabel('Show publicly').check();
  await form.getByRole('button', { name: 'Add event' }).click();
  await expect.poll(() => calls(page)).toEqual([['create', 'Parents’ evening', { type: 'parents', date: '2027-03-03', time: null, place: '', public: true, audience: { mode: 'everyone', classIds: [], roles: [] }, repeat: { every: 1, until: '2027-03-24' } }]]);
  expect(await axeViolations(page)).toEqual([]);
});

test('a class changes its own event’s status; the public calendar shows public events and holidays', async ({ page }) => {
  await open(page, 'events');
  await page.getByLabel('Status of Science fair prep on Wed, Feb 10').selectOption('confirmed');
  await expect.poll(() => calls(page)).toEqual([['status', 'e3', 'confirmed']]);
  await expect(page.getByLabel('Status of Staff briefing on Mon, Feb 8')).toHaveCount(0);
  await open(page, 'public');
  await expect(page.getByTestId('public-calendar')).toContainText(/Fri, Feb 12 18:00 · Open evening · Hall\s*Mon, Feb 15 – Fri, Feb 19 · Half-term/);
});
