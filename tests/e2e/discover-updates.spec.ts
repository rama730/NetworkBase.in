import { expect, test } from '@playwright/test';
import { hasE2ECredentials, login } from './_helpers/auth';
import { attachPageMonitoring } from './_helpers/monitoring';

// Needs a signed-in fixture user and at least one public project update to show in the feed.
test.describe('Discover update cards', () => {
    test.skip(!hasE2ECredentials, 'E2E_USER_EMAIL and E2E_USER_PASSWORD are required.');

    test('opens an update thread in place, keeps a like, and Back closes the thread', async ({ page }) => {
        const monitor = attachPageMonitoring(page);
        await login(page);
        await page.goto('/discover');

        const card = page.locator("[data-testid^='discover-update-']").first();
        await expect(card).toBeVisible({ timeout: 20_000 });

        const like = card.getByRole('button', { name: /^(Like|Unlike) this update/ });
        const pressedBefore = await like.getAttribute('aria-pressed');
        await like.click();
        await expect(like).toHaveAttribute('aria-pressed', pressedBefore === 'true' ? 'false' : 'true');
        // Put it back so the fixture stays as it was (a second tap is ignored while the first is in flight).
        await page.waitForLoadState('networkidle');
        await like.click();
        await expect(like).toHaveAttribute('aria-pressed', pressedBefore ?? 'false');

        await card.getByRole('button', { name: /^Open (update|thread)/ }).first().click();
        await expect(page).toHaveURL(/[?&]updateId=/);
        await expect(page.getByRole('complementary', { name: 'Update thread' }).or(page.getByRole('dialog', { name: 'Update thread' }))).toBeVisible();

        await page.goBack();
        await expect(page).not.toHaveURL(/[?&]updateId=/);
        await expect(page.getByRole('dialog', { name: 'Update thread' })).toHaveCount(0);

        await monitor.assertNoViolations();
        monitor.detach();
    });

    test('a link to an update that is not available says so and drops the parameter', async ({ page }) => {
        await login(page);
        await page.goto('/discover?updateId=00000000-0000-4000-8000-000000000000');
        await expect(page.getByText("That update isn't available")).toBeVisible({ timeout: 15_000 });
        await expect(page).not.toHaveURL(/[?&]updateId=/);
    });
});
