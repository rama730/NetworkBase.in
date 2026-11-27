import { expect, test } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Toasts fade in; axe reads contrast mid-fade otherwise (a flake seen on the gate).
test.use({ reducedMotion: 'reduce' });

// Plan B7.1a (report 36.2 calls 3, 4, 7).
test('Club recruiting: the banner while it lasts, the officers card with drive counts, the join poster with link and code (no QR)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readConstitutionAction: async () => ({ success: true, title: 'WT Club', president: false, public: false, version: null, articles: [], history: [] }),
      readDecisionsAction: async () => ({ success: true, current: '2026–27', seasons: [] }),
      readClubMeetingAction: async () => ({ success: true, officer: false, president: false, settings: { agendaDays: 3, propose: true, quorumShare: 0.25 }, quorum: { staying: 0, needed: 1 }, meeting: null, requests: [] }),
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
      readHandoverAction: async () => ({ success: true, handover: null, president: false, season: '2026–27', last: null }),
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
      readConstitutionAction: async () => ({ success: true, title: 'WT Club', president: false, public: false, version: null, articles: [], history: [] }),
      readDecisionsAction: async () => ({ success: true, current: '2026–27', seasons: [] }),
      readClubMeetingAction: async () => ({ success: true, officer: false, president: false, settings: { agendaDays: 3, propose: true, quorumShare: 0.25 }, quorum: { staying: 0, needed: 1 }, meeting: null, requests: [] }),
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
      readHandoverAction: async () => ({ success: true, handover: null, president: false, season: '2026–27', last: null }),
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
      readConstitutionAction: async () => ({ success: true, title: 'WT Club', president: false, public: false, version: null, articles: [], history: [] }),
      readDecisionsAction: async () => ({ success: true, current: '2026–27', seasons: [] }),
      readClubMeetingAction: async () => ({ success: true, officer: false, president: false, settings: { agendaDays: 3, propose: true, quorumShare: 0.25 }, quorum: { staying: 0, needed: 1 }, meeting: null, requests: [] }),
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
      readHandoverAction: async () => ({ success: true, handover: null, president: false, season: '2026–27', last: null }),
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
      readConstitutionAction: async () => ({ success: true, title: 'WT Club', president: false, public: false, version: null, articles: [], history: [] }),
      readDecisionsAction: async () => ({ success: true, current: '2026–27', seasons: [] }),
      readClubMeetingAction: async () => ({ success: true, officer: false, president: false, settings: { agendaDays: 3, propose: true, quorumShare: 0.25 }, quorum: { staying: 0, needed: 1 }, meeting: null, requests: [] }),
      readHandoverAction: async () => ({ success: true, handover: null, president: false, season: '2026–27', last: null }),
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
  await expect(page.getByTestId('toast')).toContainText('Counted');
  await page.mouse.move(0, 0); // the hovered primary button is checked at its hover colour otherwise
  expect(await axeViolations(page)).toEqual([]);
});

test('B7.2c Handover: progress of 5, ticks, Move open work to the incoming officer, the presidency by ownership transfer', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let moved = false;
    (window as any).__actions = {
      readConstitutionAction: async () => ({ success: true, title: 'WT Club', president: false, public: false, version: null, articles: [], history: [] }),
      readDecisionsAction: async () => ({ success: true, current: '2026–27', seasons: [] }),
      readClubMeetingAction: async () => ({ success: true, officer: false, president: false, settings: { agendaDays: 3, propose: true, quorumShare: 0.25 }, quorum: { staying: 0, needed: 1 }, meeting: null, requests: [] }),
      readRecruitingAction: async () => ({ success: true, officer: false, recruiting: false, line: null, to: null, firstEvent: null, settings: null, poster: null }),
      readRenewalAction: async () => ({ success: true, on: false, officer: false }),
      readCommitteeAction: async () => ({ success: true, season: '2026–27', president: false, officer: false, me: 'u1', people: [], docs: [], positions: [], history: [] }),
      readElectionAction: async () => ({ success: true, election: null, president: false, positions: [] }),
      readHandoverAction: async () => ({ success: true, president: false, me: 'u1', season: '2026–27', people: [], last: null,
        handover: { season: '2027–28', date: '2027-04-01', open: true },
        rows: [
          { id: 'president', label: 'President', president: true, filled: 'election', outgoing: null, incoming: { termId: 't9', userId: 'u9', name: 'Pat', state: 'holding' }, ticks: {}, done: 0, canTick: false, work: { tasks: 0, docs: 0 } },
          { id: 'secretary', label: 'Secretary', president: false, filled: 'election', outgoing: { termId: 't1', userId: 'u1', name: 'Sam' }, incoming: { termId: 't2', userId: 'u2', name: 'Ann', state: 'holding' },
            ticks: moved ? { role_page: true, tasks: true, docs: true } : { role_page: true }, done: moved ? 3 : 1, canTick: true, work: { tasks: moved ? 0 : 2, docs: moved ? 0 : 1 } }] }),
      tickHandoverAction: async (_o: string, t: string, i: string, on: boolean) => { calls.push(['tick', t, i, on]); return { success: true }; },
      moveWorkAction: async (_o: string, t: string) => { calls.push(['move', t]); moved = true; return { success: true, tasks: 2, docs: 1 }; },
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  const card = page.getByTestId('club-handover');
  await expect(card).toContainText('Roles switch on 1 April 2027');
  await expect(card).toContainText('In progress');
  await expect(card).toContainText('transfer ownership in Settings to Pat');
  const sec = card.getByTestId('club-handover-position').filter({ hasText: 'Secretary' });
  await expect(sec).toContainText('Outgoing: Sam · Incoming: Ann');
  await expect(sec).toContainText('1 of 5');
  await expect(sec.getByLabel('Open tasks moved')).toBeDisabled();
  await sec.getByLabel('Accounts listed (names only)').click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['tick', 't1', 'accounts', true]);
  await sec.getByRole('button', { name: 'Move 2 open tasks and 1 document to Ann' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['move', 't1']);
  await expect(sec).toContainText('3 of 5');
  await expect(sec.getByRole('button', { name: /Move/ })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test('B7.3a Next general meeting: quorum from members staying, Add to the agenda, officers Accept or Hold', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let decided = false;
    (window as any).__actions = {
      readConstitutionAction: async () => ({ success: true, title: 'WT Club', president: false, public: false, version: null, articles: [], history: [] }),
      readDecisionsAction: async () => ({ success: true, current: '2026–27', seasons: [] }),
      readRecruitingAction: async () => ({ success: true, officer: false, recruiting: false, line: null, to: null, firstEvent: null, settings: null, poster: null }),
      readRenewalAction: async () => ({ success: true, on: false, officer: false }),
      readCommitteeAction: async () => ({ success: true, season: '2026–27', president: false, officer: false, me: 'u1', people: [], docs: [], positions: [], history: [] }),
      readElectionAction: async () => ({ success: true, election: null, president: false, positions: [] }),
      readHandoverAction: async () => ({ success: true, handover: null, president: false, season: '2026–27', last: null }),
      readClubMeetingAction: async () => ({ success: true, officer: true, president: false, settings: { agendaDays: 3, propose: true, quorumShare: 0.25 }, quorum: { staying: 100, needed: 25 },
        meeting: { id: 'd1', title: 'General · Oct 2', startsAt: '2099-10-02T12:30:00Z', kind: 'general', canPropose: true },
        requests: [{ id: 'r1', title: 'Weekend lab hours', state: decided ? 'accepted' : 'proposed', mine: false, name: 'Karan' }] }),
      proposeAgendaItemAction: async (_o: string, doc: string, title: string) => { calls.push(['propose', doc, title]); return { success: true }; },
      decideAgendaItemAction: async (_o: string, id: string, accept: boolean) => { calls.push(['decide', id, accept]); decided = true; return { success: true }; },
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  const card = page.getByTestId('club-meeting');
  await expect(card).toContainText('Next general meeting');
  await expect(card).toContainText('General · Oct 2');
  await expect(card.getByTestId('club-meeting-quorum')).toHaveText('Quorum: 25 needed, of 100 members staying this Season.');
  await card.getByLabel('Add to the agenda').fill('Robocon budget');
  await card.getByRole('button', { name: 'Add to the agenda' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['propose', 'd1', 'Robocon budget']);
  const req = card.getByTestId('club-agenda-request');
  await expect(req).toContainText('Weekend lab hours · Karan');
  await req.getByRole('button', { name: 'Accept Weekend lab hours' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['decide', 'r1', true]);
  await expect(req).toContainText('Accepted');
  await expect(card.getByRole('button', { name: 'Plan a meeting' })).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('B7.3b Constitution: numbered articles, version and what changed; Decisions by Season with the failed attempt', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readRecruitingAction: async () => ({ success: true, officer: false, recruiting: false, line: null, to: null, firstEvent: null, settings: null, poster: null }),
      readRenewalAction: async () => ({ success: true, on: false, officer: false }),
      readCommitteeAction: async () => ({ success: true, season: '2026–27', president: false, officer: false, me: 'u1', people: [], docs: [], positions: [], history: [] }),
      readElectionAction: async () => ({ success: true, election: null, president: false, positions: [] }),
      readHandoverAction: async () => ({ success: true, handover: null, president: false, season: '2026–27', last: null }),
      readClubMeetingAction: async () => ({ success: true, officer: false, president: false, settings: { agendaDays: 3, propose: true, quorumShare: 0.25, amendThreshold: 2 / 3 }, quorum: { staying: 0, needed: 1 }, meeting: null, requests: [] }),
      readConstitutionAction: async () => ({ success: true, title: 'WT Club', president: true, public: false, version: 5,
        articles: [{ n: '1', title: 'Name', text: 'The club is called WT Club.' }, { n: '6.4', title: 'Tech officer', text: "A Tech officer looks after the club's tools." }],
        history: [{ version: 5, changed: 'Article 6.4 added', season: '2026–27', at: '2026-10-02T13:00:00.000Z', meeting: 'General · Oct 2', docSlug: 'general-oct-2' }, { version: 1, changed: 'First version', season: '2025–26', at: '2025-09-01T10:00:00.000Z', meeting: null, docSlug: null }] }),
      setConstitutionPublicAction: async (_o: string, on: boolean) => { calls.push(['public', on]); return { success: true }; },
      readDecisionsAction: async () => ({ success: true, current: '2026–27', seasons: [
        { season: '2026–27', entries: [{ kind: 'constitution', title: 'Constitution version 5: Article 6.4 added', date: '2026-10-02', detail: null, docSlug: null }, { kind: 'decision', title: 'D-004 Two competitions this year', date: '2026-09-04', detail: 'decided', docSlug: 'two-competitions' }] },
        { season: 'Earlier', entries: [{ kind: 'attempt', title: 'Not changed: Article 3 (Open membership)', date: '2026-05-01', detail: 'General · May 1', docSlug: 'general-may-1' }] }] }),
    };
  });
  await openApp(page, 'tests/browser/club.fixture.tsx');
  const c = page.getByTestId('club-constitution');
  await expect(c).toContainText('Constitution · version 5');
  await expect(c.getByRole('heading', { name: 'Article 6.4 · Tech officer' })).toBeVisible();
  await c.getByText('Versions').click();
  await expect(c).toContainText('Version 5 · Article 6.4 added · 2 October 2026 · General · Oct 2');
  await c.getByLabel('Public').click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls)).toContainEqual(['public', true]);
  const dec = page.getByTestId('club-decisions');
  await expect(dec.getByRole('region', { name: 'Season 2026–27' })).toContainText('Constitution version 5: Article 6.4 added');
  await expect(dec.getByRole('link', { name: 'D-004 Two competitions this year' })).toBeVisible();
  await expect(dec).toContainText('Not passed');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

