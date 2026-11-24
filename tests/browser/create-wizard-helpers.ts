import { expect, type Page } from '@playwright/test';
import { openApp } from './app-bundle';

// Shared steps for the create wizard v6 specs (one fixture, real components).
export const ENTRY = 'tests/browser/create-wizard.fixture.tsx';

export async function openWizard(page: Page, path = '/workspaces/new') {
    await openApp(page, ENTRY, { path });
    await expect(page.getByRole('heading', { name: 'What are you starting from?' })).toBeVisible();
}

export const next = (page: Page) => page.getByRole('button', { name: /^Continue/ }).click();

/** Fills Info's required fields by their stable ids: name, category (choice cell or select), description. */
export async function fillInfo(page: Page, title = 'Garden Map') {
    await page.locator('#create-project-title').fill(title);
    const cell = page.getByRole('radio', { name: /Side project/ });
    if (await cell.count()) await cell.first().click();
    else {
        await page.locator('#create-project-category').click();
        await page.getByRole('option', { name: 'Side project' }).click();
    }
    await page.locator('#create-project-description').fill('A shared map of community gardens with plots and volunteer days.');
}

export const heading = (page: Page, name: string | RegExp) => page.getByRole('heading', { name });
