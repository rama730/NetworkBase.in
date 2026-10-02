import { expect, test } from "@playwright/test";

import { login } from "./_helpers/auth";
import { chatV3Ready, chatV3SkipReason } from "./_helpers/chat";

test.describe("Chat across tabs", () => {
  test.skip(!chatV3Ready, chatV3SkipReason);

  test("reading in one tab clears the badge in the other", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const first = await context.newPage();
    await login(first);
    const second = await context.newPage();
    await second.goto("/discover");
    await first.goto("/messages");
    const unread = first.locator("[data-testid^='chat-row-'][data-unread='true']").first();
    test.skip(!(await unread.count()), "No unread conversation in the test account.");
    const before = await second.getByTestId("chat-launcher").getAttribute("aria-label");
    await unread.click();
    // read.moved on chat:user:<id>, or the 90 s poll when Realtime is off.
    await expect.poll(async () => second.getByTestId("chat-launcher").getAttribute("aria-label"), { timeout: 130_000 }).not.toBe(before);
    await context.close();
  });
});
