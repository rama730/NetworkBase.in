import { expect, test } from "@playwright/test";

// The redesigned home page (docs/superpowers/plans/2026-11-18-marketing-redesign-concept.md). Signed out, no data needed.
test.describe("home page", () => {
    test("opens with the hero and real links, and every section is reachable", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1, name: "Find your people. Build something together." })).toBeVisible();
        await expect(page.locator("#nbh-hero-ctas a.btn.primary")).toHaveAttribute("href", "/signup");
        await expect(page.locator(".nav-right a.signin")).toHaveAttribute("href", "/login");
        for (const id of ["start", "how", "people", "workspace", "classes", "terminal", "get-going", "join"]) {
            await expect(page.locator(`#${id}`)).toHaveCount(1);
        }
        // Share image for link previews
        await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og\/home-card\.png$/);
        const image = await page.request.get("/og/home-card.png");
        expect(image.ok()).toBe(true);
        // The grid engine attached a canvas to each grid
        await expect(page.locator(".nb-grid-canvas")).toHaveCount(7);
    });

    test("workspace tour works with keys and deep links", async ({ page }) => {
        await page.goto("/#workspace-files");
        await expect(page.locator("#nbh-tab-files")).toHaveAttribute("aria-selected", "true");
        await expect(page.locator('[data-mock="files"]')).toBeVisible();
        await page.locator("#nbh-tab-files").focus();
        await page.keyboard.press("End");
        await expect(page.locator("#nbh-tab-editor")).toHaveAttribute("aria-selected", "true");
        await expect(page.locator("#nbh-tab-editor")).toBeFocused();
        await page.keyboard.press("Home");
        await expect(page.locator("#nbh-tab-tasks")).toHaveAttribute("aria-selected", "true");
        await expect(page).toHaveURL(/#workspace-tasks$/);
    });

    test("reduced motion shows the final state", async ({ browser }) => {
        const context = await browser.newContext({ reducedMotion: "reduce" });
        const page = await context.newPage();
        await page.goto("/");
        await expect(page.locator("#nbh")).not.toHaveClass(/\bmotion\b/);
        await expect(page.locator(".wm-letter").first()).toHaveCSS("opacity", "1");
        await page.locator("#terminal").scrollIntoViewIfNeeded();
        await expect(page.locator("#nbh-term")).toContainText("Review the week 12 hand-ins");
        await context.close();
    });

    test("fits a phone without sideways scroll", async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
        const page = await context.newPage();
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await context.close();
    });
});
