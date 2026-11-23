import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.8 T5 W1–W4, W10, W11 (plan A2.7): setup, the Ideas rail, the Calendar, This week, Board, To schedule, phone.
const PROJECT = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
async function open(page: Page, opts: { width?: number; setUp?: boolean; canEdit?: boolean; panel?: string } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-25T06:00:00Z'));
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.addInitScript(({ setUp, canEdit }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const ch = (id: string, name: string, icon: string, updates = false) => ({ id, name, icon, audience: id === 'instagram' ? 1200 : null, updates, archived: false });
    const settings = { setups: ['blog', 'social'], defaultTime: '10:00',
      channels: [ch('blog', 'Blog', 'PenLine', true), ch('instagram', 'Instagram', 'Camera'), ch('linkedin', 'LinkedIn', 'Briefcase')],
      types: [{ id: 'reel', name: 'Reel', formats: ['9:16'], checklist: ['Hook', 'Captions', 'Cover image'], editorId: null }, { id: 'article', name: 'Article', formats: [], checklist: [], editorId: null }] };
    const piece = (id: string, n: number, title: string, stage: string, tf: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, taskNumber: n, title, stage,
      status: stage === 'idea' ? 'todo' : stage === 'scheduled' || stage === 'published' ? 'done' : 'in_progress', sprintId: null, dueDate: null, assigneeId: 'u1', assigneeName: 'Asha', createdAt: '2026-11-20T09:00:00.000Z', typeFields: tf, ...extra });
    const items = [
      piece('c1', 201, 'Morning routine reel', 'idea', { channels: ['instagram'] }, { assigneeId: null, assigneeName: null }),
      piece('c2', 202, 'Pricing guide', 'drafting', { channels: ['blog', 'linkedin'], publishAt: '2026-11-26T04:30:00.000Z' }, { dueDate: '2026-11-26' }),
      piece('c3', 203, 'Launch teaser', 'editing', { channels: ['instagram'], publishAt: '2026-11-27T12:30:00.000Z', editorId: 'u1' }, { dueDate: '2026-11-27' }),
      piece('c5', 205, 'Pricing post', 'scheduled', { channels: ['blog', 'linkedin'], publishAt: '2026-11-28T04:30:00.000Z', published: { linkedin: { link: 'https://www.linkedin.com/posts/p', at: '2026-11-28T05:00:00.000Z' } } }, { dueDate: '2026-11-28' }),
      piece('c4', 204, 'Customer story', 'drafting', { channels: ['blog'] }),
    ];
    (window as any).__actions = {
      readContentAction: async () => ({ success: true, projectKey: 'AC', settings: setUp ? settings : null, timeZone: 'Asia/Kolkata', items: setUp ? items : [], people: [{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Dev' }], canEdit, canManage: canEdit, viewerId: 'u1' }),
      readyForEditAction: async (input: unknown) => { calls.push(['edit', input]); return { success: true }; },
      approveContentAction: async (input: unknown) => { calls.push(['approve', input]); return { success: true }; },
      markPublishedAction: async (input: unknown) => { calls.push(['publish', input]); return { success: true, state: 'partial' }; },
      readRecentUpdatesAction: async () => ({ success: true, updates: [{ id: '9a9a9a9a-0000-4000-8000-000000000001', text: 'Our pricing guide is out', at: '2026-11-24T09:00:00.000Z' }] }),
      readCalendarAction: async () => ({ success: true, projectKey: 'AC', items: items.filter((i) => i.dueDate).map((i) => ({ ...i, itemType: 'content', priority: 'medium', dueDate: `${i.dueDate}T00:00:00.000Z` })), noDate: [], noDateCount: 0, canEdit }),
      starterContentSettingsAction: async (setups: string[]) => ({ success: true, settings: { ...settings, setups, channels: setups.includes('social') ? settings.channels : settings.channels.slice(0, 1) } }),
      saveContentSettingsAction: async (input: unknown) => { calls.push(['settings', input]); return { success: true }; },
      addIdeaAction: async (input: unknown) => { calls.push(['idea', input]); return { success: true, id: 'n' }; },
      planContentAction: async (input: unknown) => { calls.push(['plan', input]); return { success: true, publishAt: '2026-11-28T04:30:00.000Z' }; },
    };
  }, { setUp: opts.setUp ?? true, canEdit: opts.canEdit ?? true });
  await openApp(page, 'tests/browser/content-tab.fixture.tsx', opts.panel ? { path: `/?panel=${opts.panel}` } : undefined);
  if (!opts.panel) await expect(page.getByTestId('content-counts')).toBeVisible();
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W1: an owner sets up Blog and Social, picks channels with an audience, and saves', async ({ page }) => {
  await open(page, { setUp: false });
  await expect(page.getByTestId('content-setup')).toContainText('What do you publish?');
  await page.getByRole('button', { name: 'Blog' }).click();
  await page.getByRole('button', { name: 'Social' }).click();
  await expect(page.getByTestId('content-channel-row')).toHaveCount(3);
  await page.getByLabel('Instagram audience').fill('1200');
  await page.getByLabel('Add your own channel').fill('Podcast feed');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.screenshot({ path: 'test-results/content-tab/setup.png' });
  await page.getByRole('button', { name: 'Save channels' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)?.[0]).toBe('settings');
  const saved = (await calls(page)).at(-1)[1].settings;
  expect(saved.channels.map((c: { name: string }) => c.name)).toEqual(['Blog', 'Instagram', 'LinkedIn', 'Podcast feed']);
  expect(saved.channels.find((c: { id: string }) => c.id === 'instagram').audience).toBe(1200);
});

test('W2–W3 and S3: the Calendar has the Ideas rail; + Add idea; Plan… an idea asks the day and time', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('content-counts')).toHaveText('3 this week · 1 idea');
  await expect(page.getByTestId('content-quick-adds')).toContainText(/Blog.*Instagram.*LinkedIn.*Cross-channel/);
  await expect(page.getByTestId('idea-card')).toHaveText(/Morning routine reel/);
  await expect(page.getByTestId('calendar-item').filter({ hasText: 'Pricing guide' })).toBeVisible();
  await page.getByLabel('Add idea').fill('Behind the scenes');
  await page.keyboard.press('Enter');
  await expect.poll(() => calls(page)).toEqual([['idea', { projectId: PROJECT, title: 'Behind the scenes' }]]);
  await page.getByTestId('idea-card').getByRole('button', { name: 'Plan…' }).click();
  const dialog = page.getByTestId('plan-content-dialog');
  await expect(dialog.getByRole('heading', { name: 'Plan this idea' })).toBeVisible();
  await expect(dialog.getByLabel('Time (Asia/Kolkata)')).toHaveValue('10:00');
  await dialog.getByLabel('Publish date').fill('2026-11-28');
  await dialog.getByRole('button', { name: 'Plan' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['plan', { projectId: PROJECT, taskId: 'c1', day: '2026-11-28', time: '10:00', sprintId: null }]);
  await page.screenshot({ path: 'test-results/content-tab/calendar.png' });
});

test('W10 and S5–S6: This week by day with local times; Board has five stages; To schedule sets a date', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'This week' }).click();
  await expect(page.getByTestId('week-row')).toHaveCount(3);
  await expect(page.getByTestId('week-row').first()).toContainText(/10:00.*Pricing guide.*Drafting.*Asha/);
  await expect(page.getByTestId('week-row').nth(1)).toContainText(/18:00.*Launch teaser.*Editing/);
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByTestId('content-column')).toHaveCount(5);
  await expect(page.getByLabel('Drafting, 2')).toBeVisible();
  await page.getByRole('tab', { name: 'To schedule' }).click();
  await expect(page.getByTestId('schedule-row')).toHaveCount(1);
  await page.getByTestId('schedule-row').getByRole('button', { name: 'Set date' }).click();
  await expect(page.getByTestId('plan-content-dialog').getByRole('heading', { name: 'Set the publish date' })).toBeVisible();
});

test('W11 and viewers: a phone opens on This week with the Ideas section; viewers see no quick-adds; no axe violations', async ({ page }) => {
  await open(page, { width: 390, canEdit: false });
  await expect(page.getByRole('tab', { name: 'This week', selected: true })).toBeVisible();
  await expect(page.getByTestId('content-ideas')).toBeVisible();
  await expect(page.getByTestId('content-quick-adds')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New piece' })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/content-tab/phone.png' });
});

test('W4: a channel quick-add opens Content with that channel picked and says when it publishes', async ({ page }) => {
  await open(page);
  await page.getByTestId('content-quick-adds').getByRole('button', { name: 'Instagram' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Instagram', pressed: true })).toBeVisible();
  await expect(dialog.getByTestId('content-publishes')).toHaveText('No publish date yet: it waits in To schedule.');
  await dialog.getByLabel('Publish date').fill('2026-11-27');
  await dialog.getByLabel('Publish time (Asia/Kolkata)').fill('18:30');
  await expect(dialog.getByTestId('content-publishes')).toHaveText(/^Publishes .*27.* at 18:30 \(Asia\/Kolkata\)$/);
});

test('A2.8 W6: the editor sees Approve and Changes needed; a drafting piece goes for edit with an editor', async ({ page }) => {
  await open(page, { panel: 'c3' });
  const actions = page.getByTestId('content-panel-actions');
  await actions.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['approve', { projectId: PROJECT, taskId: 'c3' }]);
  await expect(actions.getByRole('button', { name: 'Changes needed…' })).toBeVisible();
});

test('A2.8 W5–W6: Write draft and Ready for edit in Drafting', async ({ page }) => {
  await open(page, { panel: 'c2' });
  const actions = page.getByTestId('content-panel-actions');
  await expect(actions.getByRole('button', { name: 'Write draft' })).toBeVisible();
  await actions.getByRole('button', { name: 'Ready for edit…' }).click();
  const dialog = page.getByTestId('ready-for-edit-dialog');
  await expect(dialog.getByRole('button', { name: 'Send for edit' })).toBeDisabled();
  await dialog.getByLabel('Editor').selectOption('u2');
  await dialog.getByLabel('Note (optional)').fill('Check the numbers');
  await dialog.getByRole('button', { name: 'Send for edit' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['edit', { projectId: PROJECT, taskId: 'c2', editorId: 'u2', note: 'Check the numbers' }]);
});

test('A2.8 W7: Mark published asks a link per channel and the Update for an Updates channel; the board says 1 of 2', async ({ page }) => {
  await open(page, { panel: 'c5' });
  await expect(page.getByTestId('content-published')).toContainText(/LinkedIn.*linkedin\.com/);
  await page.getByTestId('content-panel-actions').getByRole('button', { name: 'Mark published…' }).click();
  const dialog = page.getByTestId('mark-published-dialog');
  await expect(dialog.getByLabel('LinkedIn')).toBeDisabled();
  await dialog.getByLabel('Blog').selectOption({ label: 'Our pricing guide is out' });
  await page.screenshot({ path: 'test-results/content-tab/mark-published.png' });
  await dialog.getByRole('button', { name: 'Mark published' }).click();
  await expect.poll(async () => (await calls(page)).at(-1)).toEqual(['publish', { projectId: PROJECT, taskId: 'c5', links: { blog: { updateId: '9a9a9a9a-0000-4000-8000-000000000001' } } }]);
});

test('A2.8 W7.4: a board card says Published on 1 of 2', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByTestId('content-partial')).toHaveText('Published on 1 of 2');
});
