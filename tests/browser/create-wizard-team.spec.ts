import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { ENTRY, fillInfo, heading, next } from './create-wizard-helpers';

// Create workspace v6, Task 5: Team — a role opens into Basics · Requirements · Offer (· People) with one action bar;
// Duplicate, reorder by the number box, 6 popular roles + more, a class hides pay, a club role has seats and people.
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1440, height: 900 } });

const ROSTER = [
    { userId: '00000000-0000-4000-8000-000000000001', name: 'Sam Rivera', title: 'Coordinator', role: 'admin', skills: ['React'] },
    { userId: '00000000-0000-4000-8000-000000000002', name: 'Priya Nair', title: 'Member', role: 'member', skills: ['Python'] },
];

async function openTeam(page: Page, query = '') {
    await openApp(page, ENTRY, {
        path: `/workspaces/new${query}`,
        beforeGoto: async (p) => {
            await p.addInitScript((roster) => {
                (window as any).__extraActions = {
                    previewWorkspaceSlugAction: () => Promise.resolve(null),
                    childTitleTakenAction: () => Promise.resolve(false),
                    listOrgRosterAction: () => Promise.resolve(roster),
                    listOutsidePeopleAction: () => Promise.resolve([]),
                };
            }, ROSTER);
        },
    });
    await expect(heading(page, 'What are you starting from?')).toBeVisible();
    await next(page);
    await fillInfo(page);
    await next(page);
    await expect(heading(page, 'Who’s building it?')).toBeVisible();
}

const editor = (page: Page) => page.locator('[data-role-editor]');
const rows = (page: Page) => page.locator('[data-role-row]');

test('Add role opens the editor with Basics, Requirements, Offer and Done bar', async ({ page }) => {
    await openTeam(page);
    await page.getByRole('button', { name: 'Add role', exact: true }).click();
    await expect(editor(page)).toHaveCount(1);
    for (const group of ['Basics', 'Requirements', 'Offer']) await expect(editor(page).getByText(group, { exact: true })).toBeVisible();
    await expect(editor(page).getByRole('textbox', { name: /Role title/ })).toBeFocused();
    await expect(editor(page).getByText('a title is required')).toBeVisible();
    await editor(page).getByRole('textbox', { name: /Role title/ }).fill('Frontend developer');
    await expect(editor(page).getByText('saved as you type')).toBeVisible();
    await editor(page).getByRole('button', { name: 'More openings' }).click();
    await editor(page).getByRole('radio', { name: 'Senior' }).click();
    await editor(page).getByRole('radio', { name: 'Paid', exact: true }).click();
    await expect(editor(page).getByLabel('Compensation details')).toBeVisible();
    await editor(page).getByRole('button', { name: 'Done' }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(rows(page).first()).toContainText('Frontend developer');
    await expect(rows(page).first()).toContainText('2 openings');
    await expect(rows(page).first()).toContainText('Senior');
    await expect(rows(page).first()).toContainText('Paid');
});

test('Duplicate adds "(copy)" below', async ({ page }) => {
    await openTeam(page);
    await page.getByRole('button', { name: '+ Frontend developer' }).click();
    await editor(page).getByRole('button', { name: 'Duplicate' }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(editor(page)).toHaveCount(1);
    await expect(editor(page).getByRole('textbox', { name: /Role title/ })).toHaveValue('Frontend developer (copy)');
    await expect(rows(page).nth(1).locator('[data-role-editor]')).toHaveCount(1);
});

test('ArrowDown on the number box reorders', async ({ page }) => {
    await openTeam(page);
    await page.getByRole('button', { name: '+ Frontend developer' }).click();
    await page.locator('[data-popular-roles]').getByRole('button', { name: '+ Backend developer' }).click();
    await editor(page).getByRole('button', { name: 'Done' }).click();
    await expect(rows(page).nth(0)).toContainText('Frontend developer');
    await rows(page).nth(0).locator('[data-role-grip]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows(page).nth(0)).toContainText('Backend developer');
    await expect(rows(page).nth(1)).toContainText('Frontend developer');
    await expect(rows(page).nth(1).locator('[data-role-grip]')).toBeFocused();
});

test('6 popular then more', async ({ page }) => {
    await openTeam(page);
    const popular = page.locator('[data-popular-roles] .nb-tag-add:not([data-more])');
    await expect(popular).toHaveCount(6);
    await page.getByRole('button', { name: /6 more/ }).click();
    await expect(popular).toHaveCount(12);
});

test('class hides Offer', async ({ page }) => {
    await openTeam(page, '?org=class&locked=1');
    await page.getByRole('button', { name: '+ Frontend developer' }).click();
    await expect(editor(page).getByText('No compensation')).toBeVisible();
    await expect(editor(page).getByText('CSE-3A is a class, so its roles don’t show pay.')).toBeVisible();
    await expect(editor(page).getByRole('radio', { name: 'Paid', exact: true })).toHaveCount(0);
});

test('club role shows seats and Add people opens the picker', async ({ page }) => {
    await openTeam(page, '?org=1&locked=1');
    await page.getByRole('button', { name: '+ Frontend developer' }).click();
    await expect(editor(page).getByText('People in this team')).toBeVisible();
    await expect(editor(page).getByText('00 of 10 seats')).toBeVisible();
    await editor(page).getByRole('button', { name: 'Add people' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add people to Frontend developer' })).toBeVisible();
    await dialog.getByText('Priya Nair').click();
    await dialog.getByRole('button', { name: 'Add 1 to Frontend developer' }).click();
    await expect(editor(page).locator('[data-key="pp-00000000-0000-4000-8000-000000000002"]')).toContainText('will be added');
    await editor(page).getByRole('button', { name: 'Done' }).click();
    await expect(rows(page).first()).toContainText('1 / 10 seats');
    await expect(page.locator('#child-unassigned-heading')).toContainText('Not in a team');
    await expect(page.getByText('Admins from Riverside Robotics Club')).toBeVisible();
});
