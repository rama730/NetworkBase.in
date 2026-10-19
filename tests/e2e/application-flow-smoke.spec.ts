import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";
import { PerfTracker, markNavigationMetrics, measure } from "./_helpers/perf";

test.describe("Application flow smoke", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("an application thread opens with its live card", async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page);
        const perf = new PerfTracker();
        await login(page);

        // The seeded application lives under Home → My applications.
        await measure(perf, "route.interactive.core", () =>
            page.goto("/messages", { waitUntil: "domcontentloaded" })
        );
        await markNavigationMetrics(perf, page, "/messages");
        const section = page.getByRole("button", { name: /My applications|Applications/ }).first();
        test.skip(!(await section.isVisible({ timeout: 15000 }).catch(() => false)), "No application threads in the test account.");

        const row = page.locator("section", { has: section }).locator("[data-testid^='chat-row-']").first();
        await row.click();
        await expect(page.locator('[data-chat-pane="conversation"]')).toBeVisible();
        await expect(page.getByText("Application", { exact: true }).first()).toBeVisible({ timeout: 15000 });
        // The status bar under the header names the status and carries the controls.
        await expect(page.getByRole("group", { name: /Application status/ })).toBeVisible();
        await expect(page.getByRole("button", { name: /Withdraw|Accept|Decline|Reopen/ }).first().or(page.getByText(/pending|accepted|declined|withdrawn/i).first())).toBeVisible();

        await monitor.assertNoViolations();
        monitor.detach();
        await context.close();
    });
});
