import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B5.3a (report 34.4).
async function open(page: Page, opts: { full: boolean; mine: string | null }) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript((opts) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000 + 7_200_000).toISOString();
    const ev = { id: 'e1', title: 'Hack night', description: 'Bring a laptop', state: opts.full ? 'full' : 'published', start, end, format: 'hybrid', place: 'HSR Layout', who: 'members', hosts: [],
      runOfShow: [{ time: '19:00', title: 'Hello' }], after: [], going: opts.full ? 2 : 1, waitlisted: opts.full ? 1 : 0, placesLeft: opts.full ? 0 : 1, link: opts.mine === 'going' ? 'https://meet.example/x' : null, hasLink: true,
      mine: opts.mine, minePrivate: false, position: opts.mine === 'waitlisted' ? 1 : null, canEdit: true, placeLimit: 2 };
    (window as any).__actions = {
      readCommunityEventsAction: async (_o: string, when: string) => ({ success: true, member: true, canCreate: true, events: when === 'upcoming' ? [ev] : [] }),
      readCommunityEventAction: async () => ({ success: true, event: ev, hostView: true, people: [{ id: 'p', name: 'Priya', avatarUrl: null, private: false, checkedIn: false }], waitlist: opts.full ? [{ id: 'q', name: 'Mei', avatarUrl: null, private: false, checkedIn: false }] : [] }),
      rsvpCommunityEventAction: async (_o: string, id: string, v: { choice: string }) => { calls.push(['rsvp', id, v]); return { success: true, state: v.choice === 'going' ? (opts.full ? 'waitlisted' : 'going') : 'cant_go' }; },
      saveCommunityEventAction: async (_o: string, id: string | null, v: unknown) => { calls.push(['save', id, v]); return { success: true, id: 'e2' }; },
      cancelCommunityEventAction: async () => ({ success: true }),
    };
  }, opts);
  await openApp(page, 'tests/browser/community-events.fixture.tsx', { path: '/' });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('Upcoming lists the event with going and places left; the page shows When and Where, the run of show and Going', async ({ page }) => {
  await open(page, { full: false, mine: null });
  const row = page.getByTestId('event-row');
  await expect(row).toContainText('Hack night');
  await expect(row).toContainText('1 going · 1 place left');
  await row.click();
  const p = page.getByTestId('event-page');
  await expect(p).toContainText('Open in maps');
  await expect(p).toContainText('The online link shows when you’re going.');
  await expect(p).toContainText('19:00 Hello');
  await page.getByRole('group', { name: 'RSVP' }).getByRole('button', { name: 'Going' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['rsvp', 'e1', { choice: 'going', private: false }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Full: Join the waitlist; Going shows the online link; hosts see the waitlist', async ({ page }) => {
  await open(page, { full: true, mine: null });
  await page.getByTestId('event-row').click();
  await expect(page.getByRole('button', { name: 'Join the waitlist' })).toBeVisible();
  await expect(page.getByTestId('event-page')).toContainText('Mei');
  await open(page, { full: false, mine: 'going' });
  await page.getByTestId('event-row').click();
  await expect(page.getByRole('link', { name: 'Join online' })).toHaveAttribute('href', 'https://meet.example/x');
});

test('+ Event: title, times, format, place, who can come, a place limit and the run of show', async ({ page }) => {
  await open(page, { full: false, mine: null });
  await page.getByRole('button', { name: '+ Event' }).click();
  const f = page.getByTestId('event-form');
  await f.getByLabel('Title').fill('Rust 101');
  await f.getByLabel('Where (an address people can find)').fill('HSR Layout');
  await f.getByLabel('Members and the public page').check();
  await f.getByLabel(/Place limit/).fill('20');
  await f.getByLabel(/Run of show/).fill('18:30 Doors\n19:00 Talk');
  await page.getByRole('button', { name: 'Add event' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"placeLimit":20');
  const save = (await calls(page)).find((c: unknown[]) => c[0] === 'save') as [string, null, { fields: { who: string; runOfShow: unknown[] } }];
  expect(save[2].fields.who).toBe('public');
  expect(save[2].fields.runOfShow).toEqual([{ time: '18:30', title: 'Doors' }, { time: '19:00', title: 'Talk' }]);
});
