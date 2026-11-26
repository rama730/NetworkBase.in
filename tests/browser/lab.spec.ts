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
      readLabSettingsAction: async () => ({ success: true, owner: 'u1', pi: true, leads: [{ id: 'u1', name: 'Dr. Rao' }],
        settings: { positions: POSITIONS, officeHours: '', contactId: null, plans: { leaving: true }, about: { areas: true, people: true, alumni: true, publications: true, joinUs: true }, researchAreas: [], joinUs: '', protocolApprovers: 'pi', booking: { from: '08:00', to: '20:00', slotMinutes: 60, weeklyCapHours: 8 }, paperReview: true, themes: ['Low-light'] } }),
      readLibraryAction: async (_o: string, opts: { mine?: boolean }) => ({ success: true, admin, writer: true, themes: ['Low-light', '3D scenes'], total: 2, more: false,
        themeRows: [{ theme: 'Low-light', count: 4, thin: false, disagrees: 1 }, { theme: '3D scenes', count: 1, thin: true, disagrees: 0 }],
        rows: [{ id: 's1', title: 'NeRF in the Dark', authors: 'Mildenhall; Hedman', year: 2022, venue: 'CVPR', link: null, doi: '10.1/nerf', themes: [{ theme: 'Low-light', disagrees: true }], notesBy: ['Mei'], myState: 'read', iWroteNotes: true, code: true, data: false },
          ...(opts?.mine ? [] : [{ id: 's2', title: 'Zero-DCE', authors: 'Guo', year: 2020, venue: null, link: null, doi: null, themes: [], notesBy: [], myState: null, iWroteNotes: false, code: null, data: null }])] }),
      readSourceAction: async () => ({ success: true, admin, writer: true, canEdit: true, labThemes: ['Low-light', '3D scenes'], citedBy: [{ id: 'w', title: 'Thesis', slug: 'thesis' }],
        source: { id: 's1', title: 'NeRF in the Dark', authors: 'Mildenhall; Hedman', year: 2022, venue: 'CVPR', link: 'https://example.org/nerf', doi: '10.1/nerf', code: true, data: false, added_by: 'u1', added_by_name: 'Dr. Rao' },
        notes: [{ section: 'findings', body: 'Works at 0.1 lux.', author: 'Mei', at: '2026-11-20T10:00:00Z' }], mine: { state: 'read', note: 'my own thoughts' }, themes: [{ theme: 'Low-light', disagrees: true, why: 'Different sensor' }] }),
      addSourcesAction: async (_o: string, v: unknown) => { calls.push(['addSources', v]); return { success: true, added: 1, already: [] }; },
      setMyReadingAction: async (_o: string, id: string, v: unknown) => { calls.push(['reading', id, v]); return { success: true }; },
      saveLabNoteAction: async (_o: string, id: string, v: unknown) => { calls.push(['note', id, v]); return { success: true }; },
      setSourceThemeAction: async (_o: string, id: string, v: unknown) => { calls.push(['theme', id, v]); return { success: true }; },
      editSourceAction: async () => ({ success: true }),
      removeSourceAction: async () => ({ success: true }),
      readLibraryCardAction: async () => ({ success: true, admin, total: 2, toRead: 1, reading: 0 }),
      readProtocolsAction: async () => ({ success: true, slug: 'vision-lab', protocols: [{ id: 'p1', title: 'Capture rig setup', slug: 'rig', owner: 'Arjun', reviewBy: null, approved: 1, draft: 2, needsTraining: true, trained: false }] }),
      readProtocolAction: async () => ({ success: true, pageDraft: false, approver: admin, canTrain: admin, canEdit: admin, me: 'u1', needsTraining: true, trainers: ['u2'], trained: false,
        versions: [{ id: 'v2', version: 2, state: 'draft', by: null, at: null, created: '2026-11-20', content: admin ? '## Steps\n1. Power on' : '' }, { id: 'v1', version: 1, state: 'approved', by: 'Dr. Rao', at: '2026-10-02T10:00:00Z', created: '2026-10-01', content: '' }],
        people: [{ id: 'u1', name: 'Dr. Rao', trained: true, signedAt: null, trainer: null }, { id: 'u3', name: 'Mei', trained: false, signedAt: null, trainer: null }] }),
      askApproveProtocolAction: async () => { calls.push(['ask']); return { success: true, version: 2 }; },
      approveProtocolAction: async (_o: string, _d: string, v: number, seen: string) => { calls.push(['approve', v, seen]); return { success: true }; },
      retireProtocolAction: async () => ({ success: true }),
      saveProtocolSettingsAction: async () => ({ success: true }),
      signOffTrainingAction: async (_o: string, _d: string, id: string, on: boolean) => { calls.push(['signoff', id, on]); return { success: true }; },
      readNotebookAction: async () => ({ success: true, me: 'u1', writer: true, canAmend: true, tz: 'Asia/Calcutta',
        experiments: [{ id: 'x1', title: 'Depth at 0.1 lux', hypothesis: 'It works', status: 'running', conclusion: '', entries: 1 }],
        protocols: [{ id: 'p1', title: 'Capture rig setup', version: 1, needsTraining: true, trained: false }],
        entries: [{ id: 'e1', authorId: 'u1', author: 'Mei', day: '2026-11-25', title: 'Night run 7', body: { deviations: 'Exposure 1/30', steps: '1. Power on', links: [] },
          protocol: { title: 'Capture rig setup', version: 1, state: 'approved' }, experimentId: 'x1', experiment: 'Depth at 0.1 lux', untrained: true, writtenLater: false,
          locked: true, locksAt: '2026-11-25T18:30:00Z', amendments: [{ id: 'a1', body: 'Exposure was 1/30', at: '2026-11-26T03:42:00Z', by: 'Mei' }] }] }),
      readProtocolStepsAction: async () => ({ success: true, title: 'Capture rig setup', version: 1, steps: ['Power on', 'Calibrate'] }),
      saveEntryAction: async (_w: string, id: string | null, v: unknown) => { calls.push(['entry', id, v]); return { success: true, id: 'e2', untrained: true }; },
      amendEntryAction: async (_w: string, id: string, b: string) => { calls.push(['amend', id, b]); return { success: true }; },
      saveExperimentAction: async () => ({ success: true, id: 'x2' }),
      readEquipmentAction: async () => ({ success: true, me: 'u1', admin: false, tz: 'Asia/Calcutta', rules: { from: '08:00', to: '20:00', slotMinutes: 120, weeklyCapHours: 8 }, lab: 'Vision lab', people: [], protocols: [],
        equipment: [{ id: 'q1', name: 'Capture rig A', place: 'Lab 2', caretakerId: 'u2', caretaker: 'Arjun', trainingDocId: 'p1', training: 'Capture rig setup', status: 'available', since: '2026-11-01T00:00:00Z', bookable: true, notes: '', trained: true, canSetStatus: false,
          bookings: [{ id: 'b1', mine: true, name: 'Dr. Rao', start: new Date(Date.now() + 2 * 864e5).toISOString(), end: new Date(Date.now() + 2 * 864e5 + 72e5).toISOString() }] },
          { id: 'q2', name: 'GPU server', place: 'Online', caretakerId: 'u3', caretaker: 'Ravi', trainingDocId: null, training: null, status: 'out_of_order', since: '2026-11-24T00:00:00Z', bookable: true, notes: '', trained: true, canSetStatus: false, bookings: [] }] }),
      bookEquipmentAction: async (_o: string, id: string, start: string) => { calls.push(['book', id, start]); return { success: true, id: 'b2', start, end: start }; },
      cancelBookingAction: async () => ({ success: true }),
      reportEquipmentProblemAction: async (_o: string, id: string, body: string) => { calls.push(['report', id, body]); return { success: true }; },
      setEquipmentStatusAction: async () => ({ success: true }),
      saveEquipmentAction: async () => ({ success: true, id: 'q3' }),
      readPapersAction: async () => ({ success: true, me: 'u1', writer: true, people: [{ id: 'u1', name: 'Dr. Rao' }, { id: 'u2', name: 'Mei' }], docs: [{ id: 'd1', name: 'Paper draft' }, { id: 'd2', name: 'Reviews and response' }],
        papers: [{ id: 'pp1', title: 'Low-light depth from video', stage: 'drafting', kind: 'paper', venue: 'ICCV 2027', deadline: '2026-12-15', link: '', doi: '', private: false, preprintPublic: false,
          workspace: { id: 'w', title: 'Thesis', slug: 'thesis' }, draft: { id: 'd1', slug: 'paper-draft', name: 'Paper draft' }, frozen: { version: 3, at: '2026-11-21T10:00:00Z' }, authors: [{ userId: 'u1', name: 'Dr. Rao', confirmed: false }, { name: 'A. Collaborator' }, { userId: 'u2', name: 'Mei', confirmed: true }],
          mine: true, iConfirmed: false, reviewed: false, history: [{ stage: 'rejected', at: '2026-11-20T10:00:00Z', by: 'u2', venue: 'CVPR 2026', note: 'Needs a baseline' }], canReview: false, reviewOn: true },
          { id: 'pp4', title: 'Depth at dusk', stage: 'published', kind: 'paper', venue: 'ECCV 2024', deadline: null, link: '', doi: '', private: false, preprintPublic: false, workspace: { id: 'w', title: 'Thesis', slug: 'thesis' },
            draft: null, frozen: null, authors: [{ userId: 'u1', name: 'Dr. Rao', confirmed: true }], mine: true, iConfirmed: true, reviewed: false, history: [], canReview: false, reviewOn: true, canAddToProfile: true, onProfile: false }] }),
      confirmAuthorsAction: async (_w: string, id: string) => { calls.push(['confirm', id]); return { success: true }; },
      movePaperAction: async (_w: string, id: string, v: unknown) => { calls.push(['move', id, v]); return { success: true }; },
      reviewPaperAction: async (_w: string, id: string, v: unknown) => { calls.push(['review', id, v]); return { success: true }; },
      importPastPapersAction: async (_w: string, v: unknown) => { calls.push(['import', v]); return { success: true, added: 1, skipped: 1 }; },
      addPaperToProfileAction: async (_w: string, id: string) => { calls.push(['profile', id]); return { success: true }; },
      readFrozenDraftAction: async () => ({ success: true, content: '# Low-light depth\n\nAbstract as sent.', version: 3, at: '2026-11-21T10:00:00Z' }),
      readLabPapersAction: async () => ({ success: true, isPi: true, papers: [{ id: 'pp3', title: 'Event cameras at night', stage: 'internal_review', kind: 'paper', venue: 'CVPR 2027', deadline: null, link: '', doi: '',
        private: false, preprintPublic: false, workspace: { id: 'w', title: 'Thesis', slug: 'thesis' }, draft: { id: 'd1', slug: 'paper-draft', name: 'Paper draft' }, frozen: { version: 3, at: '2026-11-21T10:00:00Z' },
        authors: [{ userId: 'u2', name: 'Mei', confirmed: true }], mine: false, iConfirmed: false, reviewed: false, history: [], canReview: true, reviewOn: true }] }),
      savePaperAction: async (_w: string, id: string | null, v: unknown) => { calls.push(['savePaper', id, v]); return { success: true, id: 'pp2' }; },
      readMyTrainingsAction: async () => ({ success: true, trainings: [{ id: 'p1', title: 'Capture rig setup', trained: false }] }),
      saveLabSettingsAction: async (_o: string, v: unknown) => { calls.push(['settings', v]); return { success: true }; },
      startFinishAction: async (_o: string, id: string, v: unknown) => { calls.push(['finish', id, v]); return { success: true }; },
      cancelFinishAction: async () => ({ success: true }),
      readLabAlumniAction: async () => ({ success: true, alumni: [{ id: 'a1', name: 'Arjun', position: 'PhD student', startYear: 2019, endYear: 2025, nowAt: 'a robotics startup' }],
        publications: [{ id: 'pp1', title: 'Low-light depth from video', kind: 'paper', venue: 'ICCV 2026', year: '2026', link: null, doi: '10.1/xyz', authors: ['Mei', 'Dr. Rao'] }] }),
      readMyAlumniAction: async () => ({ success: true, entry: { listed: false, nowAt: '', position: 'PhD student', startYear: 2021, endYear: 2026 } }),
      saveMyAlumniAction: async (_o: string, v: unknown) => { calls.push(['alumni', v]); return { success: true }; },
      readLabAboutAction: async () => ({ success: true, signedIn: true, contactId: 'u1', isContact: false, areas: ['3D scenes', 'Video understanding'], joinUs: 'We take 1 to 2 PhD students a year.',
        people: [{ id: 'u1', name: 'Dr. Rao', position: 'pi', startYear: 2015 }, { id: 'u2', name: 'Mei', position: 'phd', startYear: 2023 }], positions: POSITIONS, showPeople: true, showAlumni: true,
        alumni: [{ id: 'a1', name: 'Arjun', position: 'PhD student', startYear: 2019, endYear: 2025, nowAt: 'a robotics startup' }],
        publications: [{ id: 'pp1', title: 'Low-light depth from video', kind: 'paper', venue: 'ICCV 2026', year: '2026', link: null, doi: '10.1/xyz', authors: ['Mei', 'Dr. Rao'] }] }),
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

test('Protocols: the card shows Approved and Draft versions and my training', async ({ page }) => {
  await open(page, false, 'protocols');
  const card = page.getByTestId('lab-protocols');
  await expect(card).toContainText('v1 Approved');
  await expect(card).toContainText('v2 Draft');
  await expect(card).toContainText('Needs training: not yet');
  expect(await axeViolations(page)).toEqual([]);
});

test('A protocol page: the PI approves v2 and signs Mei off; members only ask to approve', async ({ page }) => {
  await open(page, true, 'protocol');
  const panel = page.getByTestId('protocol-panel');
  await panel.getByRole('button', { name: 'Approve v2' }).click();
  await expect(panel.getByTestId('protocol-draft-text')).toBeVisible();
  await expect.poll(() => calls(page)).toContainEqual(['approve', 2, '2026-11-20']);
  await page.getByTestId('protocol-trainings').getByLabel('Mei').check();
  await expect.poll(() => calls(page)).toContainEqual(['signoff', 'u3', true]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
  await open(page, false, 'protocol');
  await expect(page.getByRole('button', { name: /Approve v/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Update the draft to approve' })).toBeVisible();
});

test('Notebook: a locked entry shows Locked, Amended and Not trained; amendments add below; Run this protocol fills the Steps', async ({ page }) => {
  await open(page, false, 'notebook');
  const entry = page.getByTestId('lab-entry');
  await expect(entry).toContainText('Locked');
  await expect(entry).toContainText('Not trained on this protocol');
  await expect(entry).toContainText('Amendment');
  await entry.getByRole('button', { name: 'Add an amendment' }).click();
  await entry.getByLabel('Amendment to Night run 7').fill('Sample 3 was mislabelled');
  await entry.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => calls(page)).toContainEqual(['amend', 'e1', 'Sample 3 was mislabelled']);
  await page.getByRole('button', { name: '+ Entry' }).click();
  const form = page.getByTestId('lab-entry-form');
  await form.getByLabel('Run this protocol (optional)').selectOption('p1');
  await expect(form.getByLabel('Steps done')).toHaveValue('1. Power on\n2. Calibrate');
  await expect(form).toContainText('not trained on this protocol yet');
  await form.getByRole('button', { name: 'Save entry' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"protocolDocId":"p1"');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Equipment: Out of order shows paused with no Book; Book picks a slot; Report a problem; my booking has .ics', async ({ page }) => {
  await open(page, false, 'equipment');
  const rows = page.getByTestId('lab-equipment-row');
  await expect(rows.nth(1)).toContainText('Booking is paused');
  await expect(rows.nth(1).getByRole('button', { name: /^Book/ })).toHaveCount(0);
  await expect(rows.nth(0).getByRole('button', { name: 'Add to calendar (.ics)' })).toBeVisible();
  await rows.nth(0).getByRole('button', { name: 'Book Capture rig A' }).click();
  const strip = page.getByTestId('lab-book-strip');
  await strip.getByRole('group', { name: 'Day' }).getByRole('button').nth(1).click();
  await strip.getByRole('button', { name: '08:00–10:00' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"book","q1"');
  await rows.nth(1).getByRole('button', { name: 'Report a problem with GPU server' }).click();
  await rows.nth(1).getByLabel('What’s wrong with GPU server').fill('Fan noise');
  await rows.nth(1).getByRole('button', { name: 'Report', exact: true }).click();
  await expect.poll(() => calls(page)).toContainEqual(['report', 'q2', 'Fan noise']);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('Papers: authors with confirmations, history with the rejection, Confirm and Ask for internal review; About lists publications', async ({ page }) => {
  await open(page, false, 'papers');
  const paper = page.getByTestId('lab-paper').first();
  await expect(paper).toContainText('Dr. Rao (not confirmed), A. Collaborator, Mei (confirmed)');
  await expect(paper).toContainText('Waiting for Dr. Rao to confirm');
  await paper.getByRole('button', { name: 'Confirm the author list' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['confirm', 'pp1']);
  await paper.getByRole('button', { name: 'Ask for internal review' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['move', 'pp1', { to: 'internal_review' }]);
  await page.getByRole('button', { name: '+ Paper' }).click();
  const form = page.getByTestId('lab-paper-form');
  await form.getByLabel('Title').fill('A dataset of night scenes');
  await form.getByLabel('Kind').selectOption('dataset');
  await form.getByLabel('Outside author name').fill('B. Partner');
  await form.getByRole('button', { name: 'Add name' }).click();
  await form.getByRole('button', { name: 'Save paper' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"name":"B. Partner"');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
  await open(page, false, 'about');
  await expect(page.getByTestId('lab-publications')).toContainText('Low-light depth from video');
});

test('B6.3b: a paper names its draft document; the draft as sent opens; the PI approves or returns it from the Review queue', async ({ page }) => {
  await open(page, false, 'papers');
  const paper = page.getByTestId('lab-paper').first();
  await expect(paper.getByRole('link', { name: 'Paper draft' })).toHaveAttribute('href', '/workspaces/thesis?tab=docs&doc=paper-draft');
  await paper.getByText('Draft sent for internal review (v3)').click();
  await expect(paper.getByTestId('lab-paper-frozen')).toContainText('Abstract as sent.');
  await page.getByRole('button', { name: '+ Paper' }).click();
  const form = page.getByTestId('lab-paper-form');
  await form.getByLabel('Title').fill('Draft-linked');
  await form.getByLabel('Draft document').selectOption({ label: 'Paper draft' });
  await form.getByRole('button', { name: 'Save paper' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"draftDocId":"d1"');
  await open(page, false, 'reviews');
  const review = page.getByTestId('lab-paper-review');
  await expect(page.getByTestId('lab-paper-reviews')).toContainText('Internal review · 1 paper');
  await review.getByText('Draft sent for internal review (v3)').click();
  await expect(review.getByTestId('lab-paper-frozen')).toContainText('Abstract as sent.');
  await review.getByRole('button', { name: 'Return with notes' }).click();
  await expect(review.getByRole('button', { name: 'Return', exact: true })).toBeDisabled();
  await review.getByLabel('What to change').fill('Add the 0.1 lux baseline');
  await review.getByRole('button', { name: 'Return', exact: true }).click();
  await expect.poll(() => calls(page)).toContainEqual(['review', 'pp3', { approve: false, note: 'Add the 0.1 lux baseline' }]);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('B6.3c: Add past papers reads BibTeX here, matches lab people, adds the ticked rows; a published author adds it to their profile', async ({ page }) => {
  await open(page, false, 'papers');
  await page.getByRole('button', { name: 'Add past papers' }).click();
  const box = page.getByTestId('lab-past-papers');
  await box.getByLabel('BibTeX').fill('@inproceedings{a, title={Night depth}, author={Mei and B. Partner}, booktitle={CVPR}, year={2021}}\n@article{b, title={Skip me}, author={Dr. Rao}, year={2020}}');
  await box.getByRole('button', { name: 'Read' }).click();
  await expect(box).toContainText('Night depth · 2021 · CVPR');
  await expect(box).toContainText('Mei (in the lab), B. Partner');
  await box.getByRole('checkbox').nth(1).uncheck();
  await box.getByRole('button', { name: 'Add 1 paper' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"title":"Night depth","venue":"CVPR","year":2021,"link":"","doi":"","authors":[{"userId":"u2"},{"name":"B. Partner"}],"kind":"paper"');
  await expect.poll(async () => JSON.stringify(await calls(page))).not.toContain('Skip me');
  await page.getByTestId('lab-paper').filter({ hasText: 'Depth at dusk' }).getByRole('button', { name: 'Add to my profile' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['profile', 'pp4']);
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});

test('B6.4a Library: All with themes, lab notes and my state; a source opens with signed notes and my private reading; RIS paste marks what the lab has; Themes show Thin', async ({ page }) => {
  await open(page, false, 'library');
  const lib = page.getByTestId('lab-library');
  await expect(lib).toContainText('Library 2 sources');
  const nerf = page.getByTestId('lab-source').filter({ hasText: 'NeRF in the Dark' });
  await expect(nerf).toContainText('Low-light · Disagrees');
  await expect(nerf).toContainText('Lab notes by Mei');
  await expect(nerf).toContainText('Extracted');
  await nerf.getByRole('button', { name: /NeRF in the Dark/ }).click();
  const panel = page.getByTestId('lab-source-panel');
  await expect(panel).toContainText('Code available');
  await expect(panel).toContainText('Data not available');
  await expect(panel.getByTestId('lab-note-findings')).toContainText('by Mei');
  await expect(panel.getByTestId('lab-my-reading')).toContainText('only you see this');
  await panel.getByLabel('My reading state').selectOption('reading');
  await panel.getByTestId('lab-my-reading').getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['reading', 's1', { state: 'reading', note: 'my own thoughts' }]);
  await panel.getByRole('button', { name: 'Write Method' }).click();
  await panel.getByLabel('Method', { exact: true }).fill('Event camera, 8 scenes.');
  await panel.getByTestId('lab-note-method').getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => calls(page)).toContainEqual(['note', 's1', { section: 'method', body: 'Event camera, 8 scenes.' }]);
  await page.getByRole('button', { name: 'Paste BibTeX or RIS' }).click();
  const paste = page.getByTestId('lab-library-paste');
  await paste.getByLabel('BibTeX or RIS').fill('TY  - JOUR\nTI  - Zero-DCE\nAU  - Guo\nPY  - 2020\nER  - \nTY  - JOUR\nTI  - Scene graphs survey\nAU  - Zhu\nPY  - 2022\nER  - ');
  await paste.getByRole('button', { name: 'Read' }).click();
  await expect(paste).toContainText('Zero-DCE · 2020 · Already in the library');
  await paste.getByRole('button', { name: 'Add 1 source' }).click();
  await expect.poll(async () => JSON.stringify(await calls(page))).toContain('"title":"Scene graphs survey"');
  await page.getByRole('button', { name: 'Themes' }).click();
  await expect(page.getByTestId('lab-themes')).toContainText('3D scenes1 sourceThin');
  await page.mouse.move(0, 0);
  expect(await axeViolations(page)).toEqual([]);
});
