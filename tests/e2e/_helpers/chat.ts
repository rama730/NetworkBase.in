import { expect, type Page } from "@playwright/test";

import { hasE2ECredentials } from "./auth";

/** Chat specs need an account and a database with 0180/0181 applied. */
export const chatV3Ready = hasE2ECredentials;
export const chatV3SkipReason = "Needs E2E credentials and a database with 0180/0181 applied.";

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
  return page.locator('[data-chat-pane="conversation"] [contenteditable="true"][role="textbox"]').last();
}
