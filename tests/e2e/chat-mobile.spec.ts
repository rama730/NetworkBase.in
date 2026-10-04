import { expect, test } from "@playwright/test";

import { login } from "./_helpers/auth";
import { chatV3Ready, chatV3SkipReason } from "./_helpers/chat";

// Messages cases at 320 and 375px (report 7.12 B15). Moves into mobile.spec.ts at cutover.
for (const width of [320, 375]) {
  test.describe(`Chat mobile @${width}px`, () => {
    test.skip(!chatV3Ready, chatV3SkipReason);
    test.use({ viewport: { width, height: 740 }, hasTouch: true, isMobile: true });

    test("list fits, targets are 44px, Back restores, composer stays visible", async ({ page }) => {
      await login(page);
      await page.goto("/messages");
      const rows = page.locator("[data-testid^='chat-row-']");
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
      const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].some((el) => el.getBoundingClientRect().right > window.innerWidth + 1));
      expect(overflow, "nothing past innerWidth").toBe(false);
      const small = await page.evaluate(() => [...document.querySelectorAll(".nb-chat-list a, .nb-chat-list button")]
        .filter((el) => (el as HTMLElement).offsetParent)
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height < 44 && r.width > 0).length);
      expect(small, "no target under 44px").toBe(0);

      await page.locator(".nb-chat-list .app-scroll").evaluate((el) => el.scrollTo(0, 120));
      await rows.first().click();
      await expect(page.locator('[data-chat-pane="conversation"]')).toBeVisible();
      const textarea = page.locator('[data-chat-pane="conversation"] textarea').last();
      await page.setViewportSize({ width, height: 420 });
      await expect(textarea).toBeInViewport();
      await page.setViewportSize({ width, height: 740 });
      await page.getByRole("link", { name: "Back to conversations" }).click();
      await expect(rows.first()).toBeVisible();
    });

    test("thread and details are full-screen routes", async ({ page }) => {
      await login(page);
      await page.goto("/messages");
      const row = page.locator("[data-testid^='chat-row-']").first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();
      await page.getByRole("link", { name: "Details" }).click();
      const drawer = page.locator('[data-chat-pane="drawer"]');
      await expect(drawer).toBeVisible();
      const box = await drawer.boundingBox();
      expect(box?.width).toBe(width);
      await drawer.getByRole("button", { name: "Back" }).click();
      await expect(drawer).toHaveCount(0);
    });
  });
}
