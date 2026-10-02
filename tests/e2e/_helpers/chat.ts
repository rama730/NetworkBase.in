import { expect, type Page } from "@playwright/test";

import { hasE2ECredentials } from "./auth";

/** Chat v3 specs run only with the flag on and an account (report 4.8). */
export const chatV3Ready = hasE2ECredentials && process.env.NEXT_PUBLIC_CHAT_V3 === "1";
export const chatV3SkipReason = "Needs NEXT_PUBLIC_CHAT_V3=1, E2E credentials, and a database with 0180 applied.";

/** Open /messages and the first conversation row; returns its id. */
export async function openFirstConversation(page: Page) {
  await page.goto("/messages");
  const rows = page.locator("[data-testid^='chat-row-']");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const id = (await rows.first().getAttribute("data-testid"))!.replace("chat-row-", "");
  await page.goto(`/messages/${id}`);
  await expect(page.locator('[data-chat-pane="conversation"]')).toBeVisible();
  return id;
}

export function composer(page: Page) {
  return page.locator('[data-chat-pane="conversation"] textarea').last();
}
