import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

// One signed-in pass over the whole Settings document. Nothing here changes the account: it opens, reads and
// cancels. (The deletion wizard is opened and closed without confirming.)
test.describe("Settings document @critical", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("every section is on the page, reachable from the nav, and the address follows", async ({ page }) => {
    const monitor = attachPageMonitoring(page);
    await login(page);
    await page.goto("/settings");

    const nav = page.getByRole("navigation", { name: "Settings sections" });
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    for (const [name, hash] of [
      ["Account", "settings-account"], ["Security", "settings-security"], ["Privacy", "settings-privacy"],
      ["Notifications", "settings-notifications"], ["Appearance", "settings-appearance"], ["Integrations", "settings-integrations"],
      ["Legal and data", "settings-privacy-policies"], ["Delete account", "settings-delete-account"],
    ] as const) {
      await nav.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${hash}$`));
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "location");
      await expect(page.locator(`#${hash}`)).toBeInViewport();
    }
    monitor.detach();
  });

  test("old addresses land on their section", async ({ page }) => {
    await login(page);
    await page.goto("/settings?tab=notifications");
    await expect(page).toHaveURL(/#settings-notifications$/);
    await page.goto("/settings/notifications");
    await expect(page).toHaveURL(/#settings-notifications$/);
  });

  test("Security shows its summary and sections; Privacy offers radio choices", async ({ page }) => {
    await login(page);
    await page.goto("/settings#settings-security");
    const security = page.locator("#settings-security");
    await expect(security.getByRole("list", { name: "Security summary" })).toBeVisible();
    await expect(security.getByText("Two-step verification")).toBeVisible();
    await expect(security.getByText("Signed-in devices")).toBeVisible();

    await page.goto("/settings#settings-privacy");
    const visibility = page.getByRole("radiogroup", { name: "Profile visibility" });
    await expect(visibility.getByRole("radio")).toHaveCount(3);
    await expect(visibility.getByRole("radio", { checked: true })).toHaveCount(1);
  });

  test("the deletion wizard opens, asks for the email, and cancels without deleting", async ({ page }) => {
    await login(page);
    await page.goto("/settings#settings-delete-account");
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("What happens to your data")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete account" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("Appearance changes apply at once and can be reset", async ({ page }) => {
    await login(page);
    await page.goto("/settings#settings-appearance");
    await page.getByTestId("appearance-theme-dark").click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByTestId("appearance-density-compact").click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "default");
  });
});
