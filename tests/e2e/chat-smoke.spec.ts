import { expect, test } from "@playwright/test";

import { login } from "./_helpers/auth";
import { chatV3Ready, chatV3SkipReason, composer, openFirstConversation } from "./_helpers/chat";
import { scopedName } from "./_helpers/fixtures";
import { attachPageMonitoring } from "./_helpers/monitoring";

test.describe("Chat smoke", () => {
  test.skip(!chatV3Ready, chatV3SkipReason);

  test("send, reply in a thread, react", async ({ page }) => {
    const monitor = attachPageMonitoring(page);
    await login(page);
    const channelId = await openFirstConversation(page);

    const text = `hello ${scopedName("chat")}`;
    await composer(page).fill(text);
    await composer(page).press("Enter");
    const row = page.locator("[data-testid^='chat-message-']", { hasText: text }).last();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(composer(page)).toHaveText("");

    await row.hover();
    await row.getByRole("button", { name: "Reply in thread" }).click();
    await expect(page).toHaveURL(new RegExp(`/messages/${channelId}\\?thread=\\d+`));
    const drawer = page.locator('[data-chat-pane="drawer"]');
    await drawer.locator('[contenteditable="true"][role="textbox"]').fill(`reply ${text}`);
    await drawer.locator('[contenteditable="true"][role="textbox"]').press("Enter");
    await expect(drawer.getByText(`reply ${text}`)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(row.getByRole("button", { name: /1 reply/ })).toBeVisible({ timeout: 10_000 });

    await row.hover();
    await row.getByRole("button", { name: "React 👍" }).click();
    await expect(row.getByRole("button", { name: /👍 1/ })).toBeVisible();
    await monitor.assertNoViolations();
  });

  test("an unread conversation clears after opening it", async ({ page }) => {
    await login(page);
    await page.goto("/messages");
    const unread = page.locator("[data-testid^='chat-row-'][data-unread='true']").first();
    test.skip(!(await unread.count()), "No unread conversation in the test account.");
    const id = (await unread.getAttribute("data-testid"))!.replace("chat-row-", "");
    await unread.click();
    await expect(page).toHaveURL(new RegExp(`/messages/${id}`));
    await expect(page.locator(`[data-testid='chat-row-${id}']`)).not.toHaveAttribute("data-unread", "true", { timeout: 10_000 });
  });
});
