import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test } from '@playwright/test';
import { axeViolations } from './axe';

// The settings controls in a real browser against the real stylesheet: keyboard behaviour, and focus that is
// still visible after the app's global rules remove outlines and shadows.
const origin = 'https://settings-controls.test';
let script: string;
let css: string;
test.beforeAll(async () => {
  const bundle = await build({ entryPoints: [path.resolve('tests/browser/settings-controls.fixture.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"test"' } });
  script = bundle.outputFiles![0]!.text;
  css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
});
test.beforeEach(async ({ page }) => {
  await page.route(origin + '/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: pathname === '/app.js' ? 'application/javascript' : pathname === '/app.css' ? 'text/css' : 'text/html',
      body: pathname === '/app.js' ? script : pathname === '/app.css' ? css : '<html lang="en"><head><title>Settings</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    });
  });
  await page.goto(origin + '/');
  await expect(page.getByRole('radiogroup', { name: 'Pick one' })).toBeVisible();
});

test('Tab lands on the selected radio once; arrows move focus without picking; Space picks', async ({ page }) => {
  await page.getByRole('button', { name: 'toggle busy' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('pick-a')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('pick-b')).toBeFocused();
  await expect(page.getByTestId('changes')).toHaveText('');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('changes')).toHaveText('b');
  await expect(page.getByTestId('pick-b')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pick-a')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('pick-a')).not.toBeFocused();
});

test('while busy the options stay focusable and ignore picks', async ({ page }) => {
  await page.getByRole('button', { name: 'toggle busy' }).click();
  await page.getByTestId('pick-c').focus();
  await expect(page.getByTestId('pick-c')).toBeFocused();
  await page.keyboard.press('Space');
  // aria-disabled reads as "not enabled" to Playwright; the click is real and must change nothing.
  await page.getByTestId('pick-c').click({ force: true });
  await expect(page.getByTestId('changes')).toHaveText('');
  await expect(page.getByTestId('pick-c')).toBeFocused();
});

test('a keyboard-focused radio and switch look different from unfocused ones', async ({ page }) => {
  const border = (locator: ReturnType<typeof page.getByTestId>) => locator.evaluate((el) => getComputedStyle(el).borderTopColor);
  // A segmented cell shows focus with a tint; the switch with its border.
  const tint = (locator: ReturnType<typeof page.getByTestId>) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  // Colours ease in over a moment, so the change is waited for rather than read at once.
  const radio = page.getByTestId('pick-b');
  const radioBefore = await tint(radio);
  await page.getByRole('button', { name: 'toggle busy' }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await expect(radio).toBeFocused();
  await expect.poll(() => tint(radio)).not.toBe(radioBefore);

  const toggle = page.getByRole('switch', { name: 'Email' });
  const toggleBefore = await border(toggle);
  // A key press first, so the focus that follows counts as keyboard focus in every engine (WebKit's Tab skips some buttons).
  await page.keyboard.press('Shift');
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await expect.poll(() => border(toggle)).not.toBe(toggleBefore);
});

test('the switch toggles with Space, and ignores taps while its save is pending', async ({ page }) => {
  const toggle = page.getByRole('switch', { name: 'Email' });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'toggle pending' }).click();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-busy', 'true');
});

test('radio group and switch have no WCAG A or AA violations in light and dark', async ({ page }) => {
  for (const dark of [false, true]) {
    await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);
    // Colours ease between themes; scanning mid-transition reads blended colours.
    await page.waitForTimeout(500);
    expect(await axeViolations(page), dark ? 'dark' : 'light').toEqual([]);
  }
});
