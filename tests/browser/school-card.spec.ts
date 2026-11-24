import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 29.2 (plan B0.1): a class joins or leaves a school; a school sees counts only and decides requests.
async function open(page: Page, view: 'class' | 'school' | 'classes' | 'attention', state: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.addInitScript((s) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    (window as any).__actions = {
      readClassInstitutionAction: async () => ({ success: true, eligible: true, canBecomeSchool: s.canBecomeSchool ?? false, institution: s.institution ?? null, pending: s.pending ?? null,
        schools: [{ id: 'sch1', title: 'Northgate School', slug: 'northgate' }] }),
      joinInstitutionAction: async (c: string, i: string) => { calls.push(['join', i]); return { success: true, outcome: 'requested' }; },
      unlinkClassAction: async (c: string) => { calls.push(['unlink']); return { success: true }; },
      makeInstitutionAction: async () => { calls.push(['make']); return { success: true }; },
      readInstitutionClassesAction: async () => ({ success: true, isAdmin: s.isAdmin ?? true, headOf: s.headOf ?? [], requests: [{ id: 'c9', title: 'Physics 9B' }], examWeeks: [{ name: 'Midterms', start: '2027-03-01', end: '2027-03-05' }],
        departments: [{ id: 'd1', name: 'Science', heads: [] }, { id: 'd2', name: 'Arts', heads: [] }],
        classes: [
          { id: 'c1', title: 'Maths 10A', slug: 'maths-10a', teacher: 'Asha', department: 'd1', termStart: '2026-08-01', termEnd: '2026-12-15', counted: true, members: 31, openAssignments: 2, toReview: 5, lastActivity: new Date().toISOString() },
          { id: 'c2', title: 'History 8', slug: null, teacher: 'Dev', department: 'd2', termStart: null, termEnd: null, counted: true, members: 20, openAssignments: 1, toReview: 12, lastActivity: new Date().toISOString() },
          { id: 'c3', title: 'Art club', slug: null, teacher: 'Asha', department: null, termStart: null, termEnd: null, counted: false, members: 0, openAssignments: 0, toReview: 0, lastActivity: null },
        ] }),
      setClassDepartmentAction: async (_s: string, c: string, d: string | null) => { calls.push(['dept', c, d]); return { success: true }; },
      saveDepartmentsAction: async (_s: string, rows: unknown) => { calls.push(['depts', rows]); return { success: true, departments: rows }; },
      readOrgMembersAction: async () => ({ success: true, rows: [{ userId: 'u1', name: 'Asha' }] }),
      readSchoolExamsAction: async () => ({ success: true, exams: [{ id: 'm1', title: 'Midterm', classTitle: 'Maths 10A', format: 'in_person', opensAt: '2027-03-02T10:00:00Z', closesAt: '2027-03-02T12:00:00Z', room: 'LH-2', students: 31, clashes: 3 }] }),
      saveSchoolExamWeeksAction: async (_s: string, rows: unknown) => { calls.push(['weeks', rows]); return { success: true }; },
      decideClassRequestAction: async (_i: string, c: string, ok: boolean) => { calls.push(['decide', c, ok]); return { success: true }; },
    };
  }, state);
  await openApp(page, 'tests/browser/school-card.fixture.tsx', { path: `/?view=${view}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('a class asks to join a school it belongs to', async ({ page }) => {
  await open(page, 'class');
  await expect(page.getByRole('heading', { name: 'School' })).toBeVisible();
  const join = page.getByRole('button', { name: 'Join', exact: true });
  await expect(join).toBeDisabled();
  await page.getByLabel('School').selectOption('sch1');
  await join.click();
  await expect(page.getByText('Request sent').first()).toBeVisible();
  expect(await calls(page)).toEqual([['join', 'sch1']]);
  expect(await axeViolations(page)).toEqual([]);
});

test('a class in a school links to it and can leave after confirming', async ({ page }) => {
  await open(page, 'class', { institution: { id: 'sch1', title: 'Northgate School', slug: 'northgate' } });
  await expect(page.getByRole('link', { name: 'Northgate School' })).toHaveAttribute('href', '/org/northgate');
  await page.getByRole('button', { name: 'Leave the school' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Leave the school' }).click();
  await expect.poll(() => calls(page)).toEqual([['unlink']]);
});

test('a pending request can be cancelled; an empty Education org can become a school', async ({ page }) => {
  await open(page, 'class', { pending: { id: 'sch1', title: 'Northgate School', slug: 'northgate' }, canBecomeSchool: true });
  await expect(page.getByText('Asked to join Northgate School')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make a school' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect.poll(() => calls(page)).toEqual([['unlink']]);
});

test('a school sees its classes as counts and approves a request', async ({ page }) => {
  await open(page, 'school');
  const row = page.getByTestId('school-classes');
  await expect(row).toContainText('Maths 10A');
  await expect(row).toContainText('31 members · 2 open assignments · 5 to review');
  await page.getByLabel('Department of Maths 10A').selectOption('d2');
  await expect.poll(() => calls(page)).toEqual([['dept', 'c1', 'd2']]);
  await page.evaluate(() => ((window as any).__calls.length = 0));
  await page.getByRole('button', { name: 'Approve Physics 9B' }).click();
  await expect.poll(() => calls(page)).toEqual([['decide', 'c9', true]]);
  expect(await axeViolations(page)).toEqual([]);
});

test('B0.2: departments are named with a head and saved together', async ({ page }) => {
  await open(page, 'school');
  const box = page.getByTestId('school-departments');
  await expect(box.getByLabel('Department 1 name')).toHaveValue('Science');
  await box.getByRole('button', { name: 'Add department' }).click();
  await box.getByLabel('Department 3 name').fill('Maths');
  await box.getByLabel('Head of Maths').selectOption('u1');
  await box.getByRole('button', { name: 'Save departments' }).click();
  await expect.poll(() => calls(page)).toEqual([['depts', [{ id: 'd1', name: 'Science', heads: [] }, { id: 'd2', name: 'Arts', heads: [] }, { id: '', name: 'Maths', heads: ['u1'] }]]]);
});

test('B0.2: the Classes tab groups by department, teacher or term; uncounted classes show no counts', async ({ page }) => {
  await open(page, 'classes');
  const tab = page.getByTestId('school-classes-tab');
  await expect(tab.getByRole('region', { name: 'Science' })).toContainText('Maths 10A');
  await expect(tab.getByRole('region', { name: 'No department' })).toContainText('Art club');
  await expect(tab.getByRole('region', { name: 'No department' })).not.toContainText('members');
  await page.getByRole('tab', { name: 'Teacher' }).click();
  await expect(tab.getByRole('region', { name: 'Asha' }).getByTestId('school-class-row')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Term' }).click();
  await expect(tab.getByRole('region', { name: 'Aug 2026 – Dec 2026' })).toContainText('Maths 10A');
  expect(await axeViolations(page)).toEqual([]);
});

test('B0.2: Overview lists classes needing attention for admins and heads, nobody else', async ({ page }) => {
  await open(page, 'attention');
  const card = page.getByTestId('school-attention');
  await expect(card).toContainText('History 8');
  await expect(card).toContainText('12 hand-ins waiting for review');
  await expect(card).not.toContainText('Maths 10A');
  await expect(card).toContainText('17 to review across classes');
});

test('B0.2: a plain member of the school gets no attention card', async ({ page }) => {
  await open(page, 'attention', { isAdmin: false });
  await expect(page.getByTestId('school-attention')).toHaveCount(0);
});

test('B1.6d: the school sets exam weeks, and its Classes tab lists exams by day with room and clashes', async ({ page }) => {
  await open(page, 'school');
  const weeks = page.getByTestId('school-exam-weeks');
  await expect(weeks.getByLabel('Exam week 1 name')).toHaveValue('Midterms');
  await weeks.getByRole('button', { name: 'Add exam week' }).click();
  await weeks.getByLabel('Exam week 2 name').fill('Finals');
  await weeks.getByLabel('Exam week 2 starts').fill('2027-05-10');
  await weeks.getByLabel('Exam week 2 ends').fill('2027-05-14');
  await weeks.getByRole('button', { name: 'Save exam weeks' }).click();
  expect((await calls(page)).at(-1)).toEqual(['weeks', [{ name: 'Midterms', start: '2027-03-01', end: '2027-03-05' }, { name: 'Finals', start: '2027-05-10', end: '2027-05-14' }]]);
  await open(page, 'classes');
  await expect(page.getByTestId('school-exams')).toContainText('Midterm · Maths 10A');
  await expect(page.getByTestId('school-exams')).toContainText('LH-2 · 31 students · 3 with a clash');
  expect(await axeViolations(page)).toEqual([]);
});
