import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { expect, test, type Locator, type Page } from "@playwright/test";

const background = "rgb(247, 223, 213)";
const foreground = "rgb(20, 26, 30)";
const accents = ["default", "orchid", "forest", "ember", "rose", "lagoon"];
const fileText = "First selectable line\nSecond selectable line\nThird selectable line";
let css: string;
let script: string;

// Render the production components. Only framework loading and backend data
// are substituted; no app server, credentials, storage, or database are used.
test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    "next/dynamic": `import React from 'react'; export default (load, options) => {
      const Component = React.lazy(async () => { const value = await load(); return {default: value.default || value}; });
      return props => React.createElement(React.Suspense, {fallback: options.loading ? React.createElement(options.loading) : null}, React.createElement(Component, props));
    };`,
    "@/components/providers/theme-provider": `import {useSyncExternalStore} from 'react';
      export function useTheme() { return {resolvedTheme: useSyncExternalStore(
        callback => {window.addEventListener('fixture-theme', callback); return () => window.removeEventListener('fixture-theme', callback);},
        () => document.documentElement.classList.contains('dark') ? 'dark' : 'light'
      )}; }`,
    "@/stores/filesStore": "const state = {upsertNodes() {}}; export const useFilesStore = selector => selector(state);",
    "@/hooks/useFileVersions": "export async function saveFileRevision() {throw new Error('Fixture cannot save');}",
    "@/app/actions/files/content": `export async function getWorkspaceFileContent() {return ${JSON.stringify(fileText)};}`,
    "@/app/actions/files/versions": "export async function listFileVersions() {return [];}",
    "@/components/ui/RevisionControlModal": "export const RevisionControlModal = () => null;",
    // H-4 (protected main): the editor asks the server about protection; the fixture has none.
    "@/hooks/use-auth": "export const useAuth = () => ({ user: null, profile: null });",
    "@/app/actions/files/branches": "export async function createBranchAction() {throw new Error('Fixture cannot make branches');}",
    "@/app/actions/files/merge-requests": "export async function getProtectionAction() {return {success: true, data: {rules: {requireMergeRequest: false}}};} export async function saveToNewBranchAction() {throw new Error('Fixture cannot save');}",
  };
  const stylesheet = path.resolve("src/app/globals.css");
  const [styles, bundle] = await Promise.all([
    postcss([tailwind()]).process(await readFile(stylesheet, "utf8"), { from: stylesheet }),
    build({
      entryPoints: [path.resolve("tests/browser/text-selection.fixture.tsx")],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      define: { "process.env.NODE_ENV": '"test"' },
      plugins: [{
        name: "isolated-file-data",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], resolveDir: process.cwd(), loader: "js" }));
        },
      }],
    }),
  ]);
  css = styles.css;
  script = bundle.outputFiles![0]!.text;
});

async function mountFixture(page: Page) {
  await page.route("https://selection.test/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: pathname === "/app.js" ? "application/javascript" : pathname === "/app.css" ? "text/css" : "text/html",
      body: pathname === "/app.js" ? script : pathname === "/app.css" ? css : '<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    });
  });
  await page.goto("https://selection.test/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).selectionFixture))).toBe(true);
}

test.beforeEach(async ({ page }) => mountFixture(page));

async function appearance(page: Page, theme: string, accent = "default", density = "default") {
  await page.evaluate(({ theme, accent, density }) => (window as any).selectionFixture.appearance(theme, accent, density), { theme, accent, density });
  await expect.poll(() => page.evaluate(() => (window as any).selectionFixture.darkTheme())).toBe(theme === "dark");
  await page.getByTestId("primary").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
}

async function selectionColors(locator: Locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element, "::selection");
    return { background: style.backgroundColor, foreground: style.color };
  });
}

async function selectText(locator: Locator) {
  await locator.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function selectEditor(page: Page, ranges = [[0, 5], [22, 28]]) {
  await page.evaluate(ranges => (window as any).selectionFixture.select(ranges), ranges);
}

async function expectEditorColors(page: Page) {
  const marks = page.locator(".cm-editor .nb-selected-text");
  await expect(marks.first()).toBeVisible();
  for (const mark of await marks.all()) await expect(mark).toHaveCSS("color", foreground);
  const layers = page.locator(".cm-selectionBackground");
  await expect(layers.first()).toBeVisible();
  for (const layer of await layers.all()) await expect(layer).toHaveCSS("background-color", background);
}

test("capture selection appearance in both themes", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await appearance(page, theme);
    await selectText(page.getByTestId("heading"));
    await page.screenshot({ path: test.info().outputPath(`discover-${theme}.png`) });
    await page.getByLabel("Shared input").focus();
    await page.getByLabel("Shared input").press("ControlOrMeta+a");
    await page.screenshot({ path: test.info().outputPath(`input-${theme}.png`) });
    await selectEditor(page);
    await expect(page.locator(".cm-selectionBackground").first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`editor-${theme}.png`) });
  }
});

test("exact native colors in every theme, accent, and density", async ({ page }) => {
  const locators = [
    page.getByTestId("heading"), page.getByTestId("paragraph"), page.getByTestId("nested"),
    page.getByTestId("link"), page.getByLabel("Shared input"), page.getByLabel("Textarea"),
    page.locator(".tiptap p"), page.locator(".tiptap strong"),
  ];
  for (const theme of ["light", "dark"]) for (const accent of accents) {
    await appearance(page, theme, accent);
    const before = await page.getByTestId("primary").evaluate(el => getComputedStyle(el).backgroundColor);
    for (const locator of locators) expect(await selectionColors(locator)).toEqual({ background, foreground });
    await selectText(page.getByTestId("paragraph"));
    await expect(page.getByTestId("primary")).toHaveCSS("background-color", before);
    await expect(page.getByTestId("paragraph")).not.toHaveCSS("color", foreground);
  }
  for (const density of ["compact", "default", "comfortable"]) {
    await appearance(page, "light", "default", density);
    expect(await selectionColors(page.getByLabel("Shared input"))).toEqual({ background, foreground });
  }
  await appearance(page, "light");
  await selectText(page.getByTestId("heading"));
  await page.screenshot({ path: test.info().outputPath("discover-selection-light.png") });
  await appearance(page, "dark");
  await page.screenshot({ path: test.info().outputPath("discover-selection-dark.png") });
});

test("pointer and keyboard selection, copy, and replacement keep working", async ({ page }) => {
  const heading = page.getByTestId("heading");
  const box = (await heading.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("Discover");
  expect(await selectionColors(heading)).toEqual({ background, foreground });

  const input = page.getByLabel("Shared input");
  await input.focus();
  await input.press("End");
  await input.press("Shift+ArrowLeft");
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(1);
  await input.press("ControlOrMeta+a");
  await expect.poll(() => input.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toBe("Selectable input text");
  await input.evaluate(el => el.addEventListener("copy", () => el.setAttribute("data-copied", "true")));
  await input.press("ControlOrMeta+c");
  await expect(input).toHaveAttribute("data-copied", "true");
  await page.screenshot({ path: test.info().outputPath("input-selection.png") });
  await input.press("x");
  await expect(input).toHaveValue("x");
  const textarea = page.getByLabel("Textarea");
  await textarea.focus();
  await textarea.press("ControlOrMeta+a");
  await textarea.press("x");
  await expect(textarea).toHaveValue("x");
  const richText = page.locator(".tiptap");
  await richText.focus();
  await richText.press("ControlOrMeta+a");
  await richText.press("x");
  await expect(richText).toHaveText("x");
});

test("touch-enabled controls retain the same selection colors", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await mountFixture(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    for (const theme of ["light", "dark"]) {
      await appearance(page, theme);
      const input = page.getByLabel("Shared input");
      await input.tap();
      await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, el.value.length));
      expect(await selectionColors(input)).toEqual({ background, foreground });
      await selectText(page.locator(".tiptap strong"));
      expect(await selectionColors(page.locator(".tiptap strong"))).toEqual({ background, foreground });
    }
    await page.screenshot({ path: test.info().outputPath("touch-selection-dark.png") });
  } finally {
    await context.close();
  }
});

test("Files Raw, View, and Edit colors survive theme/accent changes and multiple ranges", async ({ page }) => {
  for (const mode of ["view", "edit"]) {
    await page.evaluate(mode => (window as any).selectionFixture.mode(mode), mode);
    await expect(page.getByTestId(`files-tab-text-viewer-${mode}`)).toBeVisible();
    for (const theme of ["light", "dark"]) for (const accent of accents) {
      await appearance(page, theme, accent);
      const editor = page.locator(".cm-editor");
      const before = await editor.evaluate(el => getComputedStyle(el).backgroundColor);
      await selectEditor(page);
      await expect(page.locator(".nb-selected-text")).toHaveCount(2);
      await expectEditorColors(page);
      await expect(editor).toHaveCSS("background-color", before);
      await page.getByLabel("Shared input").focus();
      await expectEditorColors(page);
    }
    await appearance(page, "light");
    await selectEditor(page, [[0, 5], [22, 28], [45, 50]]);
    await expect(page.locator(".nb-selected-text")).toHaveCount(3);
    await appearance(page, "dark");
    await expectEditorColors(page);
    const first = (await page.locator(".cm-line").first().boundingBox())!;
    const last = (await page.locator(".cm-line").last().boundingBox())!;
    await page.keyboard.down("Alt");
    await page.mouse.move(first.x + 10, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + 55, last.y + last.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => page.evaluate(() => (window as any).selectionFixture.ranges())).toBe(3);
    await expectEditorColors(page);
    await page.screenshot({ path: test.info().outputPath(`files-${mode}-selection-dark.png`) });
    if (mode === "view") {
      await page.locator(".cm-content").press("x");
      await expect(page.locator(".cm-content")).toHaveText(fileText, { useInnerText: true });
    }
  }

  await selectEditor(page, [[0, fileText.length]]);
  await page.locator(".cm-content").press("x");
  await expect(page.locator(".cm-content")).toHaveText("x");
  await expect(page.getByTestId("files-tab-text-viewer-dirty")).toBeVisible();
  await expect(page.locator(".nb-selected-text")).toHaveCount(0);
  await page.evaluate(() => (window as any).selectionFixture.mode("raw"));
  const raw = page.getByTestId("files-tab-text-viewer-raw");
  await expect(raw).toHaveText(fileText);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => (window as any).selectionFixture.appearance(theme), theme);
    await selectText(raw);
    expect(await selectionColors(raw)).toEqual({ background, foreground });
  }
});

test("selection colors retain normal-text contrast", () => {
  const luminance = (channels: number[]) => channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  expect((luminance([247, 223, 213]) + 0.05) / (luminance([20, 26, 30]) + 0.05)).toBeGreaterThanOrEqual(4.5);
});

test("0.8 #4: an unsaved edit survives leaving the page and comes back in Edit; leaving Edit drops it", async ({ page }) => {
  const editMode = async () => {
    await page.evaluate(() => (window as any).selectionFixture.mode("edit"));
    await expect(page.getByTestId("files-tab-text-viewer-edit")).toBeVisible();
  };
  await editMode();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" plus a draft");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await editMode();
  await expect(page.locator(".cm-content")).toContainText("Third selectable line plus a draft");
  await page.evaluate(() => (window as any).selectionFixture.mode("view"));
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await editMode();
  await expect(page.locator(".cm-content")).not.toContainText("plus a draft");
});
