import { expect, test } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";
import { attachPageMonitoring } from "./_helpers/monitoring";

function parseCount(text: string | null): number {
    if (!text) return 0;
    const value = Number(text.replace(/[^\d]/g, ""));
    return Number.isNaN(value) ? 0 : value;
}

test.describe("Project views and followers flow", () => {
    test.skip(!hasE2ECredentials, "E2E_USER_EMAIL and E2E_USER_PASSWORD are required.");

    test("open detail, new tab, follow/unfollow from hub and detail", async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const monitor = attachPageMonitoring(page);

        await login(page);

        await page.goto("/discover");
        const firstCard = page.locator("[data-testid^='project-card-']").first();
        await expect(firstCard).toBeVisible();
        const projectId = (await firstCard.getAttribute("data-project-id")) || "";

        const followButton = page.locator(`[data-testid="project-card-follow-${projectId}"]`);
        await firstCard.hover();
        await expect(followButton).toBeVisible();

        const followersBadge = page.locator(`[data-testid="project-card-followers-${projectId}"]`);
        const hubFollowersBefore = parseCount(await followersBadge.textContent());
        await followButton.click();
        await firstCard.hover();
        await expect.poll(async () => parseCount(await followersBadge.textContent())).not.toBe(hubFollowersBefore);
        const hubFollowersAfter = parseCount(await followersBadge.textContent());

        const projectLink = firstCard.locator("a[href^='/workspaces/']").first();
        await projectLink.click();
        await page.waitForURL(/\/workspaces\//);

        const detailFollowers = page.locator("[data-testid='project-follower-count'] span");
        const detailViewCount = page.locator("[data-testid='project-view-count'] span");
        await expect(detailFollowers).toBeVisible();
        await expect(detailViewCount).toBeVisible();

        const detailFollowersValue = parseCount(await detailFollowers.textContent());
        expect(Math.abs(detailFollowersValue - hubFollowersAfter)).toBeLessThanOrEqual(1);

        // One anonymous visitor counts once after 3 visible seconds. Headless browsers are filtered as bots, so this
        // run presents a browser identity of its own (fresh each run, as a visitor counts once a day).
        const viewCountBefore = parseCount(await detailViewCount.textContent());
        const visitor = await browser.newContext({ userAgent: `Mozilla/5.0 Chrome/130.0 Safari/537.36 e2e/${Date.now()}` });
        const visitorPage = await visitor.newPage();
        const visitorMonitor = attachPageMonitoring(visitorPage);
        const counted = visitorPage.waitForResponse((response) => /\/api\/v1\/workspaces\/[^/]+\/view$/.test(response.url()) && response.request().method() === "POST");
        await visitorPage.goto(page.url());
        expect((await counted).status()).toBe(204);
        await page.reload();
        await expect.poll(async () => parseCount(await detailViewCount.textContent())).toBeGreaterThanOrEqual(viewCountBefore + 1);

        const detailFollowToggle = page.locator("[data-testid='project-follow-toggle']");
        const detailFollowersBeforeToggle = parseCount(await detailFollowers.textContent());
        await detailFollowToggle.click();
        await expect.poll(async () => parseCount(await detailFollowers.textContent())).not.toBe(detailFollowersBeforeToggle);
        const detailFollowersAfterToggle = parseCount(await detailFollowers.textContent());

        await page.goto("/discover");
        await expect(firstCard).toBeVisible();
        const hubFollowersFinalBadge = page.locator(`[data-testid="project-card-followers-${projectId}"]`);
        await firstCard.hover();
        await expect(hubFollowersFinalBadge).toBeVisible();
        const hubFollowersFinal = parseCount(await hubFollowersFinalBadge.textContent());
        expect(Math.abs(hubFollowersFinal - detailFollowersAfterToggle)).toBeLessThanOrEqual(1);

        await monitor.assertNoViolations();
        monitor.detach();
        await visitorMonitor.assertNoViolations();
        visitorMonitor.detach();
        await context.close();
        await visitor.close();
    });
});
