import { devices, expect, test, type Page } from "@playwright/test";
import { hasE2ECredentials, login } from "./_helpers/auth";

// Mobile redesign contract (docs/audits/mobile-redesign-report-2026-09-29.md §10, §13.7).
// ponytail: device options via test.use instead of a config project; add a `mobile` project if more specs need it.
const { defaultBrowserType: _browser, ...iPhone } = devices["iPhone 13"];

const INTERACTIVE = 'a[href],button,[role="button"],[role="tab"],[role="switch"],input:not([type="hidden"]),select,textarea,summary';

async function firstProjectHref(page: Page) {
  const fromEnv = process.env.E2E_MOBILE_PROJECT_SLUG;
  if (fromEnv) return `/projects/${fromEnv}`;
  await page.goto("/discover");
  const href = await page.locator('#application-sidebar a[href^="/projects/"]').first().getAttribute("href", { timeout: 15_000 });
  expect(href, "E2E user needs at least one workspace project").toBeTruthy();
  return href!;
}

// Elements poking past the viewport, ignoring content inside a local horizontal scroller.
function overflowing(page: Page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const scrollsX = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX);
    return [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || r.right <= W + 1) return false;
        for (let p = el.parentElement; p; p = p.parentElement) if (scrollsX(p)) return false;
        return true;
      })
      .slice(0, 10)
      .map((el) => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)}`);
  });
}

// Interactive elements under 44px within the first two screens; inline prose links are exempt.
function smallTargets(page: Page) {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.top > window.innerHeight * 2) return false;
        if (getComputedStyle(el).visibility === "hidden" || el.closest(".sr-only,.nb-skip-link,nextjs-portal")) return false;
        if (el.tagName === "A" && el.closest("p,li")) return false;
        return r.width < 44 || r.height < 44;
      })
      .slice(0, 15)
      .map((el) => `${(el.getAttribute("aria-label") || el.innerText || el.tagName).trim().slice(0, 24)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
  }, INTERACTIVE);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(500);
}

test.describe("mobile 375px", () => {
  test.skip(!hasE2ECredentials, "E2E credentials required");
  test.use(iPhone);

  test("shell routes: no overflow, 44px targets", async ({ page }) => {
    await login(page);
    const project = await firstProjectHref(page);
    const routes = ["/discover", "/network", "/messages", "/my-profile", "/settings",
      ...["dashboard", "readme", "updates", "sprints", "tasks", "files", "settings"].map((tab) => `${project}?tab=${tab}`)];
    for (const route of routes) {
      await page.goto(route);
      await settle(page);
      expect(await overflowing(page), `${route} overflow`).toEqual([]);
      expect(await smallTargets(page), `${route} targets`).toEqual([]);
    }
  });

  test("quick nav drawer follows the sidebar rule", async ({ page }) => {
    await login(page);
    await page.goto("/discover");
    await page.getByRole("button", { name: "Open mobile menu" }).click();
    const drawer = page.locator("#mobile-menu");
    await expect(drawer.getByRole("button", { name: "New project" })).toBeVisible();
    const labels = await drawer.locator(".nb-nav-link").allInnerTexts();
    const names = labels.map((label) => label.replace(/\s+\d+\+?$/, "").trim());
    const order = ["Discover", "Network", "Messages", "My profile", "My work"].map((name) => names.findIndex((n) => n.startsWith(name)));
    expect(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]))).toBe(true);
    expect(names.at(-1)).toBe("Settings");
  });

  test("messages thread has a Back control", async ({ page }) => {
    await login(page);
    await page.goto("/messages");
    const row = page.locator('[data-testid^="chat-row-"]').first();
    test.skip(!(await row.isVisible().catch(() => false)), "no conversations");
    await row.click();
    await expect(page.locator('[data-chat-pane="conversation"]').getByRole("link", { name: "Back to conversations" })).toBeVisible();
  });

  test("project header, tabs, files toolbar, task detail", async ({ page }) => {
    await login(page);
    const project = await firstProjectHref(page);
    await page.goto(`${project}?tab=dashboard`);
    await settle(page);
    const headerOverlap = await page.evaluate(() => {
      const id = document.querySelector(".nb-project-identity");
      const h1 = id?.querySelector("h1")?.getBoundingClientRect();
      if (!id || !h1) return "missing";
      const hit = [...id.querySelectorAll("button,a")].find((el) => {
        const r = el.getBoundingClientRect();
        return r.width && !el.contains(id.querySelector("h1")) && r.left < h1.right && r.right > h1.left && r.top < h1.bottom && r.bottom > h1.top;
      });
      return hit ? (hit.getAttribute("aria-label") || (hit as HTMLElement).innerText) : null;
    });
    expect(headerOverlap).toBeNull();
    const tabsOverlap = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tab"][id^="project-tab-"]')].map((t) => t.getBoundingClientRect());
      return tabs.some((r, i) => i > 0 && r.left < tabs[i - 1].right - 1) || tabs.some((t, i) => (document.querySelectorAll('[role="tab"][id^="project-tab-"]')[i] as HTMLElement).scrollWidth > t.width + 1);
    });
    expect(tabsOverlap).toBe(false);

    await page.goto(`${project}?tab=files`);
    await settle(page);
    const offscreen = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="files-header"] button')]
        .filter((b) => b.getBoundingClientRect().width && b.getBoundingClientRect().right > window.innerWidth + 1).length);
    expect(offscreen).toBe(0);

    await page.goto(`${project}?tab=tasks`);
    await settle(page);
    const card = page.locator('[data-testid="task-card"]').first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      const panel = page.locator('[data-testid="task-detail-panel"]');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("button", { name: "Delete task" })).toBeHidden();
    }
  });

  test("profile header text column is full width", async ({ page }) => {
    await login(page);
    await page.goto("/my-profile");
    await settle(page);
    const width = await page.evaluate(() => {
      const headline = document.querySelector('[data-testid="profile-summary-header"] [data-profile-details]');
      return headline ? Math.round(headline.getBoundingClientRect().width) : 0;
    });
    expect(width).toBeGreaterThanOrEqual(300);
  });
});

test.describe("desktop freeze 1280px", () => {
  test.skip(!hasE2ECredentials, "E2E credentials required");
  test.use({ viewport: { width: 1280, height: 800 } });

  test("desktop screens are unchanged", async ({ page }) => {
    await login(page);
    const project = await firstProjectHref(page);
    const routes = ["/discover", "/messages", "/settings", "/my-profile",
      ...["dashboard", "readme", "updates", "sprints", "tasks", "files", "settings"].map((tab) => `${project}?tab=${tab}`)];
    for (const route of routes) {
      await page.goto(route);
      await settle(page);
      await expect(page).toHaveScreenshot(`${route.replace(/[^a-z0-9]+/gi, "-")}.png`, {
        animations: "disabled",
        mask: [page.locator("time"), page.locator(".nb-feedback-system")],
        maxDiffPixelRatio: 0.002,
      });
    }
  });
});
