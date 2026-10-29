import { expect, test } from "@playwright/test";

import { login } from "./_helpers/auth";
import { chatV3Ready, chatV3SkipReason } from "./_helpers/chat";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Chat launcher (report 7.13)", () => {
  test.skip(!chatV3Ready, chatV3SkipReason);

  test("absent below 768px and on /messages and /workspaces/new", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 767, height: 800 });
    await page.goto("/discover");
    await expect(page.getByTestId("chat-launcher")).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("chat-launcher")).toBeVisible();
    await page.goto("/messages");
    await expect(page.getByTestId("chat-launcher")).toHaveCount(0);
    await page.goto("/workspaces/new");
    await expect(page.getByTestId("chat-launcher")).toHaveCount(0);
  });

  test("opens, Esc minimizes and returns focus, badge caps at 99+", async ({ page }) => {
    const monitor = attachPageMonitoring(page);
    await login(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/discover");
    const launcher = page.getByTestId("chat-launcher");
    await launcher.click();
    await expect(page.getByTestId("chat-window")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chat-window")).toHaveCount(0);
    await expect(launcher).toBeFocused();
    const label = await launcher.getAttribute("aria-label");
    const badge = launcher.locator(".nb-chat-count");
    if (await badge.count()) expect((await badge.textContent())!.length).toBeLessThanOrEqual(3);
    expect(label).toMatch(/^Messages/);
    await monitor.assertNoViolations();
  });

  test("open full page navigates; a draft survives close and reopen", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/discover");
    await page.getByTestId("chat-launcher").click();
    const window = page.getByTestId("chat-window");
    const row = window.locator("[data-testid^='chat-row-']").first();
    test.skip(!(await row.count()), "No conversations in the test account.");
    await row.click();
    await window.locator("[contenteditable='true']").fill("draft from the launcher");
    await window.getByRole("button", { name: "Close" }).click();
    await page.getByTestId("chat-launcher").click();
    await window.locator("[data-testid^='chat-row-']").first().click();
    await expect(window.locator("[contenteditable='true']")).toHaveText("draft from the launcher");
    await window.locator("[contenteditable='true']").fill("");
    await window.getByRole("button", { name: "More options" }).click();
    await page.getByRole("menuitem", { name: "Open in Messages" }).click();
    await expect(page).toHaveURL(/\/messages\//);
  });
});
