import { expect, test } from "@playwright/test";

import { login } from "./_helpers/auth";
import { chatV3Ready, chatV3SkipReason } from "./_helpers/chat";

test.describe("Chat shell", () => {
  test.skip(!chatV3Ready, chatV3SkipReason);
  test.use({ viewport: { width: 1280, height: 800 } });

  test("projects list opens in place, shows channels, switches from the name dropdown, without a request", async ({ page }) => {
    await login(page);
    await page.goto("/messages");
    await expect(page.locator("#application-sidebar")).toBeVisible();
    const aside = page.getByRole("complementary", { name: "Conversations" });
    const projects = aside.locator("[data-testid^='chat-project-']");
    test.skip((await projects.count()) < 1, "Needs at least one project.");

    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") requests.push(request.url());
    });
    const id = (await projects.first().getAttribute("data-testid"))!.replace("chat-project-", "");
    await projects.first().click();
    const open = aside.getByTestId(`chat-project-open-${id}`);
    await expect(open).toBeVisible();
    await expect(open.locator("[data-testid^='chat-row-']").first()).toBeVisible();
    await expect(aside.locator("[data-testid^='chat-project-']").filter({ hasNot: open })).toHaveCount(0);
    expect(requests, "opening a workspace is in memory").toEqual([]);

    await open.getByRole("button", { name: /switch project/ }).click();
    await page.getByRole("menuitem", { name: "Show all projects" }).click();
    await expect(aside.locator("[data-testid^='chat-project-']").first()).toBeVisible();
  });

  test("quick switcher opens with Cmd/Ctrl+J and filters", async ({ page }) => {
    await login(page);
    await page.goto("/messages");
    await page.locator("[data-messages-surface]").first().click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+J" : "Control+J");
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
