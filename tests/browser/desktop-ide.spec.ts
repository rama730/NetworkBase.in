import path from "node:path";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { test, expect, type Page } from "@playwright/test";

const origin = "https://desktop-ide.test";
let script: string, css: string, sans: Buffer, mono: Buffer;
test.use({ reducedMotion: "reduce" });
test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    "next/link": `import React from 'react';export default ({href,children,...p})=>React.createElement('a',{href,...p},children);`,
    "next/image": `import React from 'react';export default ({unoptimized,priority,...p})=>React.createElement('img',p);`,
    "@/hooks/use-auth": `export const useAuth=()=>({user:{id:'viewer-1'}});`,
    "@/hooks/useSettingsQueries": `import {useQuery} from '@tanstack/react-query';export const useExtensionSessionsData=()=>useQuery({queryKey:['fixture-sessions'],queryFn:async()=>{const p=new URLSearchParams(location.search);if(p.has('sessions-loading'))return new Promise(()=>{});if(window.ideFixture.failSessions)throw new Error('Unavailable');const editors=p.get('connected')?.split(',')||[];return {sessions:[...editors.map(editor=>({editorName:editor,editorPlatform:'darwin',clientVersion:'1.2.0'})),{editorName:'Windsurf',editorPlatform:'darwin',clientVersion:'pending'}]};}});`,
    "@/hooks/useLaptopInstalledIdes": `import {SUPPORTED_IDES} from '@/lib/extension/ide-protocol';export const useLaptopInstalledIdes=()=>({installedList:new URLSearchParams(location.search).has('installed')?[SUPPORTED_IDES.cursor]:[],platform:'darwin',isLoading:false});`,
    "@/app/actions/my-work": `export const getMyWorkSummaryAction=async()=>({success:true,taskCount:2,requestCount:0});`,
    "@/app/actions/my-week": `export const readMyWeekAction=async()=>({success:true,inClass:false,items:[],missing:[],exams:[],pins:[],timeZone:'UTC',today:''});export const setDayPinAction=async()=>({success:true});`,
    "@/hooks/useNetworkNotifications": `export const useNetworkNotifications=()=>({pendingConnections:0});`,
    "./MyWorkTasksTab": `import React from 'react';export default ()=>React.createElement('p',{},'Review workspace security controls');`,
    "./MyWorkRequestsTab": `import React from 'react';export default ()=>React.createElement('p',{},'No invitations');`,
  };
  const result = await build({
    entryPoints: [path.resolve("tests/browser/desktop-ide.fixture.tsx")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "desktop-ide-fixture",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            args.path in mocks
              ? { path: args.path, namespace: "fixture" }
              : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mocks[args.path],
            resolveDir: process.cwd(),
            loader: "js",
          }));
        },
      },
    ],
  });
  script = result.outputFiles![0]!.text;
  const styles = await postcss([tailwind()]).process(
    await readFile("src/app/globals.css", "utf8"),
    { from: path.resolve("src/app/globals.css") },
  );
  [sans, mono] = await Promise.all([
    readFile("src/app/fonts/InstrumentSans.woff2"),
    readFile("src/app/fonts/JetBrainsMono.woff2"),
  ]);
  css =
    `@font-face{font-family:'Instrument Sans';src:url('/sans.ttf');font-weight:100 900;}@font-face{font-family:'JetBrains Mono';src:url('/mono.ttf');font-weight:100 900;}:root{--font-instrument-sans:'Instrument Sans';--font-jetbrains-mono:'JetBrains Mono';}` +
    styles.css;
});
test.beforeEach(async ({ page }) => {
  await page.route(origin + "/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/sans.ttf" || url.pathname === "/mono.ttf")
      return route.fulfill({
        contentType: "font/ttf",
        body: url.pathname === "/sans.ttf" ? sans : mono,
      });
    if (/^\/ide-icons\/[a-z0-9.-]+\.(svg|png)$/.test(url.pathname))
      return route.fulfill({
        body: await readFile(path.join("public", url.pathname)),
        contentType: url.pathname.endsWith(".svg")
          ? "image/svg+xml"
          : "image/png",
      });
    return route.fulfill({
      contentType:
        url.pathname === "/app.js"
          ? "application/javascript"
          : url.pathname === "/app.css"
            ? "text/css"
            : "text/html",
      body:
        url.pathname === "/app.js"
          ? script
          : url.pathname === "/app.css"
            ? css
            : '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    });
  });
});
async function open(page: Page, query = "surface=files") {
  await page.goto(origin + "/?" + query);
  await expect(page.locator("h1").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
const picker = (page: Page) =>
  page.getByRole("dialog", { name: "Desktop editor picker", exact: true });
async function onTop(page: Page) {
  return picker(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + 24, r.y + 24));
  });
}
async function lastUri(page: Page) {
  return page.evaluate(() => (window as any).ideFixture.uris.at(-1) as string);
}

test("disconnected control matches app sizing and supports search, empty results, keyboard and dismissal", async ({
  page,
}) => {
  await open(page);
  expect(
    (await page.getByTestId("open-in-ide-tool").boundingBox())!.height,
  ).toBe(34);
  const trigger = page.getByRole("button", {
    name: "Connect your code editor",
    exact: true,
  });
  await trigger.click();
  await expect(picker(page)).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search editors" });
  await expect(search).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Setup help", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await search.fill("no-such-editor");
  await expect(
    page.getByText("No matching editors. Try another name."),
  ).toBeVisible();
  await search.fill("Visual Studio");
  await expect(
    picker(page).getByRole("button", {
      name: "VS Code Visual Studio Code",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(
    picker(page).getByRole("button", {
      name: "VS Code Visual Studio Code",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("task drawer picker stays above the overlay, preserves task/file context and never lists pending sessions", async ({
  page,
}) => {
  await open(page, "surface=task&connected=Cursor,Cursor");
  await page.getByRole("button", { name: "Choose desktop editor" }).click();
  expect(await onTop(page)).toBe(true);
  await expect(picker(page).locator("[data-editor-option]")).toHaveCount(2); // Cursor plus connect another.
  await expect(
    picker(page).getByRole("button", { name: /Windsurf/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Open in Cursor", exact: true })
    .click();
  await expect.poll(() => lastUri(page)).toContain("cursor://");
  const uri = new URL(await lastUri(page));
  expect(Object.fromEntries(uri.searchParams)).toMatchObject({
    projectId: "project-1",
    slug: "deepscope-ai",
    taskId: "task-42",
    fileId: "file-1",
    filePath: "/SECURITY.md",
  });
  await page.getByRole("button", { name: "Choose desktop editor" }).click();
  await page
    .getByRole("button", { name: "Connect another editor", exact: true })
    .click();
  await expect(
    picker(page).getByRole("button", {
      name: "VS Code Visual Studio Code",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search editors" })
    .fill("Windsurf");
  await page
    .getByRole("button", { name: "Windsurf Codeium Windsurf IDE", exact: true })
    .click();
  await expect.poll(() => lastUri(page)).toContain("windsurf:extension/");
});

test("multiple connected editors launch the selected editor and persist the preference", async ({
  page,
}) => {
  await open(page, "surface=files&connected=Cursor,VS%20Code");
  await page.getByRole("button", { name: "Choose desktop editor" }).click();
  await picker(page)
    .getByRole("button", {
      name: "VS Code Connected to NetworkBase",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Open in VS Code", exact: true }),
  ).toBeVisible();
  await expect.poll(() => lastUri(page)).toContain("vscode://");
  expect(
    await page.evaluate(() => localStorage.getItem("nb:preferred-ide")),
  ).toBe("vscode");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open in VS Code", exact: true }),
  ).toBeVisible();
});

test("installed editor grouping and setup help work above a task drawer", async ({
  page,
}) => {
  await open(page, "surface=task&installed");
  await page
    .getByRole("button", { name: "Connect your code editor", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Installed on your Mac" }),
  ).toBeVisible();
  expect(await onTop(page)).toBe(true);
  await page.getByRole("button", { name: "Setup help", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Connect Cursor",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + 24, r.y + 24));
    }),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "DSAI-42", exact: true }),
  ).toBeVisible();
});

test("native handoff failure offers setup and retry without losing task context", async ({
  page,
}) => {
  await open(page, "surface=task&connected=Cursor&fallback");
  await page
    .getByRole("button", { name: "Open in Cursor", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Connect Cursor", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Try opening Cursor", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).ideFixture.uris.length))
    .toBe(2);
  expect(new URL(await lastUri(page)).searchParams.get("taskId")).toBe(
    "task-42",
  );
});

test("connection loading and failed lookup expose recovery", async ({
  page,
}) => {
  await open(page, "surface=files&sessions-loading");
  await page
    .getByRole("button", { name: "Connect your code editor", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Loading editor connections" }),
  ).toBeVisible();
  await open(page, "surface=files&sessions-error");
  await page
    .getByRole("button", { name: "Connect your code editor", exact: true })
    .click();
  await expect(
    page.getByText("Couldn’t load editor connections."),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).ideFixture.failSessions = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Couldn't load editor connections.")).toHaveCount(
    0,
  );
});

test("My Work header opens a chosen project, supports project paging and retries", async ({
  page,
}) => {
  let failed = true;
  const requests: string[] = [];
  await page.route(origin + "/api/v1/extension/workspace?**", async (route) => {
    requests.push(route.request().url());
    if (failed) return route.fulfill({ status: 503, json: { success: false } });
    const next = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({
      json: {
        success: true,
        data: {
          projects: next
            ? [{ id: "project-2", name: "Ponytail", slug: "ponytail" }]
            : [{ id: "project-1", name: "DeepScope AI", slug: "deepscope-ai" }],
          projectPage: {
            hasMore: !next,
            nextCursor: next ? null : "project-1",
          },
        },
      },
    });
  });
  await open(page, "surface=work&connected=Cursor");
  expect(requests).toHaveLength(0);
  await expect(
    page.getByRole("heading", { name: "My work", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open in Cursor", exact: true })
    .click();
  const projects = page.getByRole("dialog", {
    name: "Choose a workspace",
    exact: true,
  });
  await expect(projects.getByRole("alert")).toBeVisible();
  failed = false;
  await projects.getByRole("button", { name: "Retry", exact: true }).click();
  await projects
    .getByRole("button", { name: "Load more workspaces", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "Search workspaces" }).fill("pony");
  await projects.getByRole("button", { name: "Ponytail", exact: true }).click();
  const uri = new URL(await lastUri(page));
  expect(uri.searchParams.get("projectId")).toBe("project-2");
  expect(uri.searchParams.get("slug")).toBe("ponytail");
  await expect(projects).toHaveCount(0);
  await expect(page.getByTestId("my-work-drawer")).toBeVisible();
});

test("mobile sheet and dark My Work header fit the viewport and keep the picker reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "surface=task&mobile&dark");
  await page
    .getByRole("button", { name: "Desktop IDE options", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect your code editor", exact: true })
    .click();
  expect(await onTop(page)).toBe(true);
  const box = (await picker(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await open(page, "surface=work&dark");
  await expect(
    page.getByRole("button", { name: "Connect your code editor", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  // My work's editor is footer cells (shell redesign v3): full footer height, 44px.
  expect(
    (await page.getByTestId("open-in-ide-tool").boundingBox())!.height,
  ).toBe(44);
  await page.screenshot({ path: "test-results/desktop-ide-mobile.png" });
});

test("an empty My Work project list never dispatches an empty workspace", async ({
  page,
}) => {
  await page.route(origin + "/api/v1/extension/workspace?**", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          projects: [],
          projectPage: { hasMore: false, nextCursor: null },
        },
      },
    }),
  );
  await open(page, "surface=work&connected=Cursor");
  await page
    .getByRole("button", { name: "Open in Cursor", exact: true })
    .click();
  await expect(
    page.getByText("Join or create a workspace to open it in your editor."),
  ).toBeVisible();
  expect(await lastUri(page)).toBeUndefined();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("my-work-drawer")).toBeVisible();
});

test.describe("touch controls", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test("My Work uses touch sizing and opens a usable picker", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await open(page, "surface=work&connected=VS%20Code%20Insiders&dark");
    await expect.poll(async () => (await page.getByTestId("my-work-drawer").boundingBox())!.x).toBeCloseTo(0, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const close = await page.getByRole("button", { name: "Close My work", exact: true }).boundingBox();
    expect(close!.x + close!.width).toBeLessThanOrEqual(320);
    expect(
      (await page.getByTestId("open-in-ide-tool").boundingBox())!.height,
    ).toBe(44);
    const trigger = page.getByRole("button", {
      name: "Choose desktop editor",
      exact: true,
    });
    expect((await trigger.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await trigger.tap();
    expect(await onTop(page)).toBe(true);
    await page
      .getByRole("button", { name: "Connect another editor", exact: true })
      .tap();
    await page.getByRole("searchbox", { name: "Search editors" }).fill("zed");
    await expect(
      picker(page).getByRole("button", {
        name: "Zed High-performance code editor",
        exact: true,
      }),
    ).toBeVisible();
  });
});

test("CLI Copy copies even when the browser refuses the clipboard, and says so when it can't", async ({ page, context }) => {
  // Root cause (2026-11-09): writeText was refused (here: no clipboard-write permission) and the rejection was dropped.
  await context.grantPermissions(["clipboard-read"]);
  await open(page);
  await page.getByRole("button", { name: "Connect your code editor", exact: true }).click();
  const copy = picker(page).getByRole("button", { name: "Copy" });
  await copy.click();
  await expect(picker(page).getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npx @networkbase/cli init --workspace=project-1 --task=task-42");
  await expect(picker(page)).toBeVisible();
  // Both ways fail: the command is selected for ⌘C, and the toast says so.
  await page.evaluate(() => { document.execCommand = () => false; });
  await page.waitForTimeout(2100);
  await picker(page).getByRole("button", { name: "Copy" }).click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("npx @networkbase/cli init --workspace=project-1 --task=task-42");
});
