import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Plan B7.1a (report 36.2 calls 3, 4, 7).
test('Club recruiting: the banner while it lasts, the officers card with drive counts, the join poster with link and code (no QR)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readRecruitingAction: async () => ({ success: true, officer: true, recruiting: true, line: 'Taster night Thursday', to: '2026-09-14', firstEvent: { title: 'Taster night', at: null },
        settings: { from: '2026-09-01', to: '2026-09-14', line: 'Taster night Thursday', firstEventId: 'e1' }, poster: { title: 'WT Robotics Club', slug: 'wt-robotics', code: 'RBT123' } }),
      readDriveCountsAction: async () => ({ success: true, counts: { joined: 12, came: 7, from: '2026-09-01', to: '2026-09-14' } }),
      readCommunityEventsAction: async () => ({ success: true, member: true, canCreate: true, events: [{ id: 'e1', title: 'Taster night', state: 'upcoming' }] }),
      saveRecruitingAction: async (_o: string, v: unknown) => { calls.push(['save', v]); return { success: true }; },
      readRenewalAction: async () => ({ success: true, on: true, officer: true, season: '2026-09-01', ask: 'Staying this Season?', days: 30, closed: true, mine: 'not_answered',
        people: [{ id: 'u1', name: 'Asha', officer: true, state: 'staying' }, { id: 'u2', name: 'Ben', officer: false, state: 'leaving' }, { id: 'u3', name: 'Cal', officer: false, state: 'not_answered' }, { id: 'u4', name: 'Dev', officer: false, state: 'not_asked' }] }),
      answerRenewalAction: async (_o: string, a: string) => { calls.push(['answer', a]); return { success: true }; },
      endNotRenewedAction: async () => { calls.push(['end']); return { success: true, ended: 2 }; },
      saveRenewalAction: async () => ({ success: true }),
      readCommitteeAction: async () => ({ success: true, season: '2026–27', president: true, officer: true, me: 'u1', people: [{ id: 'u2', name: 'Mia' }, { id: 'u3', name: 'Raj' }], docs: [{ id: 'd1', name: 'Secretary role page' }],
        positions: [
          { id: 'president', label: 'President', filled: 'election', gives: 'president', docId: null, docSlug: null, holder: { termId: 't0', userId: 'u1', name: 'Asha', avatar: null, username: 'asha', state: 'holding', how: 'election' } },
          { id: 'secretary', label: 'Secretary', filled: 'election', gives: 'coordinator', docId: 'd1', docSlug: 'secretary-role', holder: { termId: 't1', userId: 'u2', name: 'Mia', avatar: null, username: 'mia', state: 'offered', how: 'appointment' } },
          { id: 'treasurer', label: 'Treasurer', filled: 'election', gives: 'coordinator', docId: null, docSlug: null, holder: null }],
        history: [{ season: '2025–26', position: 'Secretary', name: 'Old Sam' }] }),
      appointAction: async (_o: string, p: string, u: string) => { (window as any).__calls.push(['appoint', p, u]); return { success: true }; },
      answerAppointmentAction: async () => ({ success: true }),
      endTermAction: async () => ({ success: true }),
      savePositionsAction: async () => ({ success: true }),
      readElectionAction: async () => ({ success: true, election: null, president: false, positions: [] }),
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  await expect(page.getByTestId('club-recruiting-banner')).toContainText('Recruiting now');
  await expect(page.getByTestId('club-recruiting-banner')).toContainText('until 14 September 2026');
  await expect(page.getByTestId('club-drive-counts')).toHaveText('During the drive (1 September 2026 to 14 September 2026): 12 joined, 7 of them came to an event.');
  const card = page.getByTestId('club-recruiting');
  await card.getByLabel('Banner line').fill('Build a robot this term');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['save', { from: '2026-09-01', to: '2026-09-14', line: 'Build a robot this term', firstEventId: 'e1' }]);
  await page.evaluate(() => { (window as any).print = () => { (window as any).__printed = document.getElementById('nb-join-poster')?.innerText ?? ''; }; });
  await card.getByRole('button', { name: 'Print the join poster' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toContain('networkbase.in/org/wt-robotics');
  expect(await page.evaluate(() => (window as any).__printed)).toContain('RBT123');
  expect(await page.locator('#nb-join-poster img, #nb-join-poster canvas, #nb-join-poster svg').count()).toBe(0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Season renewal: the member ask, officers see counts and end only after a confirm, never officers', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readRecruitingAction: async () => ({ success: true, officer: false, recruiting: false, line: null, to: null, firstEvent: null, settings: null, poster: null }),
      readRenewalAction: async () => ({ success: true, on: true, officer: true, season: '2026-09-01', ask: 'Staying this Season?', days: 30, closed: true, mine: 'not_answered',
        people: [{ id: 'u1', name: 'Asha', officer: true, state: 'staying' }, { id: 'u2', name: 'Ben', officer: false, state: 'leaving' }, { id: 'u3', name: 'Cal', officer: false, state: 'not_answered' }, { id: 'u4', name: 'Dev', officer: false, state: 'not_asked' }] }),
      answerRenewalAction: async (_o: string, a: string) => { calls.push(['answer', a]); return { success: true }; },
      endNotRenewedAction: async () => { calls.push(['end']); return { success: true, ended: 2 }; },
      saveRenewalAction: async () => ({ success: true }),
      readCommitteeAction: async () => ({ success: true, season: '2026–27', president: true, officer: true, me: 'u1', people: [{ id: 'u2', name: 'Mia' }, { id: 'u3', name: 'Raj' }], docs: [{ id: 'd1', name: 'Secretary role page' }],
        positions: [
          { id: 'president', label: 'President', filled: 'election', gives: 'president', docId: null, docSlug: null, holder: { termId: 't0', userId: 'u1', name: 'Asha', avatar: null, username: 'asha', state: 'holding', how: 'election' } },
          { id: 'secretary', label: 'Secretary', filled: 'election', gives: 'coordinator', docId: 'd1', docSlug: 'secretary-role', holder: { termId: 't1', userId: 'u2', name: 'Mia', avatar: null, username: 'mia', state: 'offered', how: 'appointment' } },
          { id: 'treasurer', label: 'Treasurer', filled: 'election', gives: 'coordinator', docId: null, docSlug: null, holder: null }],
        history: [{ season: '2025–26', position: 'Secretary', name: 'Old Sam' }] }),
      appointAction: async (_o: string, p: string, u: string) => { (window as any).__calls.push(['appoint', p, u]); return { success: true }; },
      answerAppointmentAction: async () => ({ success: true }),
      endTermAction: async () => ({ success: true }),
      savePositionsAction: async () => ({ success: true }),
      readElectionAction: async () => ({ success: true, election: null, president: false, positions: [] }),
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  const card = page.getByTestId('club-renewal');
  await expect(page.getByTestId('club-renewal-ask')).toContainText('Staying this Season?');
  await page.getByTestId('club-renewal-ask').getByRole('button', { name: 'Staying' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['answer', 'staying']);
  await expect(page.getByTestId('club-renewal-counts')).toHaveText('Season from 1 September 2026: 1 Staying, 1 Not answered, 1 Leaving, 1 joined this Season.');
  await card.getByRole('button', { name: 'End memberships not renewed' }).click();
  await expect(card).toContainText('End 2 memberships as Season ended? Officers are never included.');
  await card.getByRole('button', { name: 'End 2' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['end']);
  expect(await axeViolations(page)).toEqual([]);
});

test('B7.2a This Season’s committee: holders, Asked, role page, appoint by the President, the presidency via transfer, past Seasons; About shows only holders', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readRecruitingAction: async () => ({ success: true, officer: false, recruiting: false, line: null, to: null, firstEvent: null, settings: null, poster: null }),
      readRenewalAction: async () => ({ success: true, on: false, officer: false }),

      readCommitteeAction: async () => ({ success: true, season: '2026–27', president: true, officer: true, me: 'u1', people: [{ id: 'u2', name: 'Mia' }, { id: 'u3', name: 'Raj' }], docs: [{ id: 'd1', name: 'Secretary role page' }],
        positions: [
          { id: 'president', label: 'President', filled: 'election', gives: 'president', docId: null, docSlug: null, holder: { termId: 't0', userId: 'u1', name: 'Asha', avatar: null, username: 'asha', state: 'holding', how: 'election' } },
          { id: 'secretary', label: 'Secretary', filled: 'election', gives: 'coordinator', docId: 'd1', docSlug: 'secretary-role', holder: { termId: 't1', userId: 'u2', name: 'Mia', avatar: null, username: 'mia', state: 'offered', how: 'appointment' } },
          { id: 'treasurer', label: 'Treasurer', filled: 'election', gives: 'coordinator', docId: null, docSlug: null, holder: null }],
        history: [{ season: '2025–26', position: 'Secretary', name: 'Old Sam' }] }),
      appointAction: async (_o: string, p: string, u: string) => { (window as any).__calls.push(['appoint', p, u]); return { success: true }; },
      answerAppointmentAction: async () => ({ success: true }),
      endTermAction: async () => ({ success: true }),
      savePositionsAction: async () => ({ success: true }),
      readElectionAction: async () => ({ success: true, election: null, president: false, positions: [] }),
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  const card = page.getByTestId('club-committee');
  await expect(card).toContainText('This Season’s committee · 2026–27');
  const sec = card.getByTestId('club-position').filter({ hasText: 'Secretary' });
  await expect(sec).toContainText('Asked');
  await expect(sec.getByRole('link', { name: 'Role page for Secretary' })).toHaveAttribute('href', '?tab=docs&doc=secretary-role');
  await expect(card.getByTestId('club-position').filter({ hasText: 'President' })).not.toContainText('Appoint');
  await card.getByLabel('Appoint Treasurer').selectOption({ label: 'Raj' });
  await card.getByTestId('club-position').filter({ hasText: 'Treasurer' }).getByRole('button', { name: 'Ask' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['appoint', 'treasurer', 'u3']);
  await card.getByText('Past Seasons').click();
  await expect(card).toContainText('2025–26 · Secretary: Old Sam');
  const strip = page.getByTestId('club-committee-strip');
  await expect(strip).toContainText('Asha');
  await expect(strip).not.toContainText('Mia');
  expect(await axeViolations(page)).toEqual([]);
});

test('B7.2b Election: a secret ballot with Abstain, You voted (never the choice), turnout as a count, the returning officer closes, results', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let voted = false;
    (window as any).__actions = {
      readRecruitingAction: async () => ({ success: true, officer: false, recruiting: false, line: null, to: null, firstEvent: null, settings: null, poster: null }),
      readRenewalAction: async () => ({ success: true, on: false, officer: false }),
      readCommitteeAction: async () => ({ success: true, season: '2026–27', president: false, officer: false, me: 'u1', people: [], docs: [], positions: [], history: [] }),
      readElectionAction: async () => ({ success: true, president: true, me: 'u1', eligible: 40, people: [{ id: 'u2', name: 'Ann' }, { id: 'u3', name: 'Bob' }],
        election: { id: 'e1', season: '2027–28', phase: 'voting', ro: { id: 'u1', name: 'Rita' }, isRo: true, showCounts: false },
        positions: [{ id: 'secretary', label: 'Secretary', round: 1, runoff: false, candidates: [{ id: 'u2', name: 'Ann', statement: 'Minutes within a day.' }, { id: 'u3', name: 'Bob', statement: '' }],
          pending: [], mine: null, voted, turnout: voted ? 13 : 12, result: null }] }),
      voteAction: async (_o: string, p: string, c: string | null) => { calls.push(['vote', p, c]); voted = true; return { success: true }; },
      closeVotingAction: async () => { calls.push(['close']); return { success: true, runoffs: 0 }; },
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  const card = page.getByTestId('club-election');
  await expect(card).toContainText('Ballots are secret');
  const pos = card.getByTestId('club-election-position');
  await expect(pos).toContainText('12 of 40 voted');
  await expect(pos).toContainText('Minutes within a day.');
  await pos.getByLabel('Abstain').check();
  await pos.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['vote', 'secretary', null]);
  await expect(pos.getByTestId('club-voted')).toHaveText('You voted');
  await expect(pos).not.toContainText('Abstain');
  await card.getByRole('button', { name: 'Close voting and count' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['close']);
  expect(await axeViolations(page)).toEqual([]);
});
