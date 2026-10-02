import { expect, test } from "@playwright/test";

import { login } from "./_helpers/auth";
import { chatV3Ready, chatV3SkipReason } from "./_helpers/chat";

test.describe("Chat shell", () => {
  test.skip(!chatV3Ready, chatV3SkipReason);
  test.use({ viewport: { width: 1280, height: 800 } });

  test("rail + sidebar replace the global sidebar; project switch makes no request", async ({ page }) => {
    await login(page);
    await page.goto("/messages");
    const aside = page.getByRole("complementary", { name: "Messages navigation" });
    await expect(aside).toBeVisible();
    await expect(aside.getByRole("navigation", { name: "Projects" })).toBeVisible();
    const tiles = aside.getByRole("navigation", { name: "Projects" }).locator(".nb-chat-tile");
    test.skip((await tiles.count()) < 2, "Needs at least one project.");

    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") requests.push(request.url());
    });
    await tiles.nth(1).click();
    await page.waitForTimeout(500);
    expect(requests, "switching projects is in memory").toEqual([]);
    await expect(aside.getByRole("button", { name: "Channels" })).toBeVisible();
  });

  test("quick switcher opens with Cmd/Ctrl+K and filters", async ({ page }) => {
    await login(page);
    await page.goto("/messages");
    await page.locator("[data-messages-surface]").first().click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox")).toBeVisible();
    await dialog.getByRole("combobox").fill("zzzz-no-match");
    await expect(dialog.getByText("No matches")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("browse, create and join a channel", async ({ page }) => {
    await login(page);
    await page.goto("/messages");
    const browse = page.getByRole("link", { name: "Browse channels" }).first();
    test.skip(!(await browse.count()), "Select a project with channels first.");
    await browse.click();
    await expect(page.getByRole("heading", { name: /Browse channels/ })).toBeVisible();
    await page.getByRole("button", { name: "Create channel" }).first().click();
    const name = `pw-${Date.now().toString(36)}`;
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 10_000 });
  });

  test("start a DM from New message", async ({ page }) => {
    await login(page);
    await page.goto("/messages/new");
    await expect(page.getByLabel("Recipients")).toBeVisible();
  });
});
