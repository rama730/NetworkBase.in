import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";

test.describe("Create workspace wizard", () => {
  test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

  test("phase 1 source selector stays visible while switching dedicated views", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);
    await page.goto("/workspaces/new", { waitUntil: "domcontentloaded" });

    // Full-page focus route: no app shell, no dialog; clicking the corner does not close it.
    await expect(page.getByRole("heading", { level: 1, name: "Create workspace" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.mouse.click(8, 8);
    await expect(page.getByRole("heading", { level: 1, name: "Create workspace" })).toBeVisible();

    await expect(page.getByTestId("create-project-phase1-source-grid")).toBeVisible();
    await expect(page.getByText("Create New Project")).toHaveCount(0);

    await page.getByRole("tab", { name: "Import from GitHub" }).click();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();
    await expect(page.getByTestId("create-project-phase1-source-grid")).toBeVisible();
    await expect(page.getByTestId("create-project-github-manual-url")).toBeVisible();
    await expect(page.getByTestId("create-project-connect-github")).toBeVisible();
    await page.getByTestId("create-project-github-manual-url").fill("networkbase/tools");
    await expect(page.getByTestId("create-project-github-manual-url")).toHaveValue("https://github.com/networkbase/tools");
    await page.waitForTimeout(1000);
    await expect(page.getByRole("heading", { level: 1, name: "Create workspace" })).toBeVisible();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();

    await page.getByRole("tab", { name: "Upload files" }).click();
    await expect(page.getByTestId("create-project-source-view-upload")).toBeVisible();
    await expect(page.getByTestId("create-project-upload-dropzone")).toBeVisible();
    await expect(page.getByTestId("create-project-source-view-github")).toHaveCount(0);

    await page.getByRole("tab", { name: "Start from scratch" }).click();
    await expect(page.getByTestId("create-project-source-view-scratch")).toBeVisible();
    await expect(page.getByTestId("create-project-phase1-source-grid")).toBeVisible();

    await context.close();
  });

  test("github connect button starts the live oauth browser flow", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);
    await page.goto("/discover", { waitUntil: "domcontentloaded" });

    await page.getByRole("link", { name: /new workspace/i }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);
    await page.getByRole("tab", { name: "Import from GitHub" }).click();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();

    await page.getByTestId("create-project-connect-github").click();

    await expect
      .poll(
        async () => {
          const currentUrl = page.url();
          if (
            /github\.com\/login\/oauth\/authorize/i.test(currentUrl) ||
            /github\.com\/login\?/i.test(currentUrl) ||
            /supabase\.co\/auth\/v1\/authorize/i.test(currentUrl) ||
            /\/auth\/v1\/authorize/i.test(currentUrl)
          ) {
            return "redirected";
          }
          return currentUrl;
        },
        { timeout: 30000 }
      )
      .toBe("redirected");

    await context.close();
  });

  test("oauth callback query lands on the create route and keeps the wizard after url cleanup", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);
    await page.goto("/workspaces/new?createProject=1&createProjectSource=github", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1, name: "Create workspace" })).toBeVisible();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();

    await expect
      .poll(async () => new URL(page.url()).searchParams.get("createProject"))
      .toBeNull();

    await page.waitForTimeout(1000);
    await expect(page.getByRole("heading", { level: 1, name: "Create workspace" })).toBeVisible();
    await expect(page.getByTestId("create-project-source-view-github")).toBeVisible();

    await context.close();
  });
});
