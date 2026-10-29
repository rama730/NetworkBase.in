import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Connections smoke matrix", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("suggested/invitations/connections tabs load and actions are stable", async ({ page }) => {
        const monitor = attachPageMonitoring(page);

        await login(page);

        await page.goto("/network?tab=discover");
        await expect(page.getByRole("tab", { name: /Suggested/ })).toBeVisible();
        await expect(page.getByRole("tab", { name: /Invitations/ })).toBeVisible();
        await expect(page.getByRole("tab", { name: /Connections/ })).toBeVisible();

        const connectButton = page.getByRole("button", { name: /^Connect$/i }).first();
        if (await connectButton.isVisible().catch(() => false)) {
            await connectButton.click();
            await expect(page.getByText(/^Sent$/).first()).toBeVisible();
        }

        await page.getByRole("tab", { name: /Connections/ }).click();
        await expect(page.getByLabel("Search your network")).toBeVisible();
        const connectedMenuTrigger = page.getByRole("button", { name: /Connection actions for/i }).first();
        if (await connectedMenuTrigger.isVisible().catch(() => false)) {
            await connectedMenuTrigger.click();
            await expect(page.getByRole("menuitem", { name: /Disconnect/i }).first()).toBeVisible();
            await expect(page.getByRole("menuitem", { name: /Block profile/i }).first()).toBeVisible();
        }

        await page.getByRole("tab", { name: /Invitations/ }).click();
        await expect(
            page.getByText(/No pending invitations|Invited you|Workspace invitation/i).first(),
        ).toBeVisible();
        const acceptButton = page.getByRole("button", { name: /^Accept$/i }).first();
        if (await acceptButton.isVisible().catch(() => false)) {
            await expect(page.getByRole("button", { name: /^Decline$/i }).first()).toBeVisible();
        }

        await monitor.assertNoViolations();
        monitor.detach();
    });
});
