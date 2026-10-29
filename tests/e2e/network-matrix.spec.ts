import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("People matrix @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("suggested/invitations/connections tabs and person cards render", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const monitor = attachPageMonitoring(page);

    await login(page);
    await page.goto("/network?tab=discover");

    await expect(page.getByRole("heading", { name: "Network" })).toBeVisible();
    await expect(page.getByText("People you've worked with, and people worth working with.")).toBeVisible();
    await expect(page.getByLabel("Search your network")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Suggested/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Invitations/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Connections/ })).toBeVisible();

    await page.getByRole("tab", { name: /Connections/ }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible({ timeout: 15000 });

    await page.getByRole("tab", { name: /Invitations/ }).click();
    await expect(page.getByText(/Invited you|Workspace invitation|No pending invitations/i).first()).toBeVisible({ timeout: 15000 });

    await monitor.assertNoViolations();
    monitor.detach();
    await context.close();
  });
});
