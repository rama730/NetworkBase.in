import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report H5 (M8, phase H-4): the Protect main card. Turning it on asks for an approval; loosening asks "Verify it's
// you" first (the action answers STEP_UP_REQUIRED); in a team workspace agents stay on branches.
async function open(page: Page, { theme = 'light', locked = false, width = 1280 }: { theme?: string; locked?: boolean; width?: number } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ locked }) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    let rules = { requireMergeRequest: false, approvals: 0, reapproveOnNewSaves: false, requiredChecks: [] as string[], mergeBy: 'writers', agentsOnBranches: true, allowGithubSync: true };
    (window as any).__actions = {
      branchesSettingAction: async () => ({ success: true, data: { enabled: true, canChange: true } }),
      getProtectionAction: async () => ({ success: true, data: { rules, canChange: true, agentsLocked: locked } }),
      setProtectionAction: async (_p: string, patch: Record<string, unknown>) => {
        calls.push(['set', patch]);
        if (patch.requireMergeRequest === false && !(window as any).__verified) return { success: false, error: 'Loosening main’s protection needs you to verify it’s you', code: 'STEP_UP_REQUIRED', stepUp: { methods: ['password'] } };
        rules = { ...rules, ...patch } as typeof rules;
        return { success: true, data: { rules } };
      },
    };
  }, { locked });
  await openApp(page, 'tests/browser/protect-main.fixture.tsx', { path: '/', head: theme === 'dark' ? "document.documentElement.classList.add('dark')" : '' });
}

test('turning protection on shows the rules with 1 approval; checks save on blur; loosening asks to verify', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Protect main' })).toBeVisible();
  await page.getByLabel('Change main only through merge requests').click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls))[0]).toEqual(['set', { requireMergeRequest: true, approvals: 1 }]);
  await expect(page.getByLabel('Approvals needed')).toHaveValue('1');
  await page.getByLabel('Checks that must pass').fill('build, lint');
  await page.getByLabel('Approvals needed').focus();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__calls)).at(-1)).toEqual(['set', { requiredChecks: ['build', 'lint'] }]);
  await page.getByLabel('Change main only through merge requests').click();
  await expect(page.getByRole('dialog', { name: 'Verify it’s you' }).or(page.getByRole('alertdialog', { name: 'Verify it’s you' }))).toBeVisible();
});

test('a team workspace: agents stay on branches (the switch is locked on)', async ({ page }) => {
  await open(page, { locked: true });
  await expect(page.getByLabel('Agents work on a branch')).toBeDisabled();
  await expect(page.getByText('Always on in a team workspace')).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`no accessibility problems, ${theme}`, async ({ page }) => {
    await open(page, { theme });
    await page.getByLabel('Change main only through merge requests').click();
    await expect(page.getByLabel('Approvals needed')).toBeVisible();
    await page.screenshot({ path: `test-results/audit-shots/protect-main-${theme}.png`, fullPage: true });
    expect(await axeViolations(page)).toEqual([]);
  });
}
