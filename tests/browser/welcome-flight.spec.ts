import { expect, test, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';

// The welcome flight in a real browser: the real finish screen, the real overlay and the real app shell, with the
// router slowed down so the page arrives while the flight plays.
const ENTRY = 'tests/browser/welcome-flight.fixture.tsx';
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1280, height: 800 } });

type Sample = { t: number; captions: string[]; avatar: number[] | null; slot: number[] | null; attr: string | null; sidebar: number | null; tip: string | null; route: string; badge: boolean; hint: boolean };

async function start(page: Page, options: { visibility?: string; navDelay?: number } = {}) {
  await openApp(page, ENTRY);
  await page.evaluate(({ visibility, navDelay }) => { (window as any).__visibility = visibility ?? 'public'; (window as any).__navDelay = navDelay ?? 300; }, options);
  // The fixture renders after the overlay is preloaded: wait for the button, not for a timer.
  await expect(page.getByRole('button', { name: 'Go to Discover' })).toBeVisible();
  await page.evaluate(() => {
    const w = window as any; w.__trace = [] as Sample[]; const t0 = performance.now();
    const rect = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
    w.__sampler = setInterval(() => {
      const shown = [...document.querySelectorAll('[data-welcome-caption]')].filter((el) => Number(getComputedStyle(el).opacity) > 0.5).map((el) => (el.textContent ?? '').trim());
      const sidebar = document.querySelector('.nb-sidebar');
      const tip = [...document.querySelectorAll('[data-welcome-flight] [role="status"]')].map((el) => el.textContent ?? '').find((text) => text.includes('active now')) ?? null;
      const avatar = document.querySelector('[data-welcome-avatar]');
      w.__trace.push({ t: Math.round(performance.now() - t0), captions: shown, avatar: rect(avatar), slot: rect([...document.querySelectorAll('[data-welcome-slot], [data-welcome-slot-mobile]')].find((el) => el.getBoundingClientRect().width > 0) ?? null), attr: document.documentElement.getAttribute('data-welcome-flight'), sidebar: sidebar ? Number(getComputedStyle(sidebar).opacity) : null, tip, route: (w.__router.get() as string), badge: !!avatar?.querySelector('.nb-presence'), hint: [...document.querySelectorAll('[data-welcome-flight] p')].some((p) => p.textContent?.includes('to skip') && Number(getComputedStyle(p).opacity) > 0.5) });
    }, 30);
  });
}
const trace = (page: Page) => page.evaluate(() => (window as any).__trace as Sample[]);
const finished = (page: Page, ms = 14000) => expect(page.locator('[data-welcome-flight]')).toHaveCount(0, { timeout: ms });
const calls = (page: Page) => page.evaluate(() => ((window as any).__flightCalls as Array<{ event: string }>).map((c) => c.event));

test('public profile: photo steps forward, presence activates, welcome shows, photo lands exactly on the top-bar avatar', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await finished(page);
  const samples = await trace(page);
  const lines = samples.flatMap((s) => s.captions);
  expect(lines).toContain('Your presence is activated');
  expect(lines.some((line) => line.startsWith('Welcome to NetworkBase, Ada Lovelace!'))).toBe(true);
  // The lines take turns: never both at once.
  expect(samples.every((s) => s.captions.length <= 1)).toBe(true);
  // The lines come in order: presence first, then the welcome.
  expect(samples.findIndex((s) => s.captions.includes('Your presence is activated'))).toBeLessThan(samples.findIndex((s) => s.captions.some((c) => c.startsWith('Welcome'))));
  // The next page was started by the flight itself, and arrived while it played.
  expect(await page.evaluate(() => (window as any).__pushed)).toEqual(['/discover']);
  expect(samples.some((s) => s.route === '/discover' && s.avatar)).toBe(true);
  // The photo's last position is the slot, to the pixel.
  const last = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal');
  expect(last, 'a sample of the photo over the slot').toBeTruthy();
  for (let i = 0; i < 4; i += 1) expect(Math.abs(last!.avatar![i]! - last!.slot![i]!)).toBeLessThanOrEqual(1.5);
  // The shell waited behind the photo, and the real avatar is there at the end.
  expect(samples.some((s) => s.attr === 'hold' && s.sidebar === 0)).toBe(true);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-welcome-flight'))).toBe(false);
  expect(await calls(page)).toEqual(['welcome_flight_started', 'welcome_flight_completed']);
  // The whole thing takes about five seconds plus the tooltip.
  const landedAt = samples.find((s) => s.attr === 'reveal')!.t;
  expect(landedAt).toBeLessThan(6500);
});

test('the tooltip says what the badge means, then goes', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await finished(page);
  const samples = await trace(page);
  expect(samples.some((s) => s.tip?.includes('You’re active now'))).toBe(true);
});

test('private profile: no presence step, no badge, the privacy note is shown, no tooltip', async ({ page }) => {
  await start(page, { visibility: 'private' });
  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await finished(page);
  const samples = await trace(page);
  const lines = samples.flatMap((s) => s.captions);
  expect(lines.some((line) => line.includes('Your presence is activated'))).toBe(false);
  expect(lines.some((line) => line.includes('hidden from Discovery'))).toBe(true);
  // No badge while the lines are read; the photo brings one to the landing, because the top bar always shows your own.
  expect(samples.some((s) => s.badge && s.attr === 'hold')).toBe(false);
  expect(samples.some((s) => s.badge && s.attr === 'reveal')).toBe(true);
  expect(samples.some((s) => s.tip)).toBe(false);
  expect(await calls(page)).toEqual(['welcome_flight_started', 'welcome_flight_completed']);
});

test('the button cannot start a second flight', async ({ page }) => {
  await start(page);
  const button = page.getByRole('button', { name: 'Go to Discover' });
  await button.click();
  await expect(button).toBeDisabled().catch(() => undefined);
  await button.click({ force: true, timeout: 500 }).catch(() => undefined);
  await finished(page);
  expect(await page.evaluate(() => (window as any).__pushed)).toEqual(['/discover']);
  expect((await calls(page)).filter((e) => e === 'welcome_flight_started')).toHaveLength(1);
});

test('a click skips: the overlay is gone in about a second and the app is ready', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await page.waitForTimeout(1400);
  await expect(page.getByText('Click or press Esc to skip')).toBeVisible();
  const before = Date.now();
  await page.mouse.click(640, 700);
  await finished(page, 4000);
  expect(Date.now() - before).toBeLessThan(2500);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-welcome-flight'))).toBe(false);
  expect(await calls(page)).toEqual(['welcome_flight_started', 'welcome_flight_skipped']);
});

test('Escape skips too', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await finished(page, 4000);
  expect(await calls(page)).toContain('welcome_flight_skipped');
});

test('a slow page: the photo waits for the top bar instead of landing on nothing', async ({ page }) => {
  await start(page, { navDelay: 5500 });
  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await finished(page, 15000);
  const samples = await trace(page);
  const reveal = samples.find((s) => s.attr === 'reveal')!;
  expect(reveal.route).toBe('/discover');
  expect(reveal.t).toBeGreaterThan(5000);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
});

test('reduced motion: shorter, no flight, still ends on the avatar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await start(page);
  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await finished(page, 8000);
  const samples = await trace(page);
  // Never in between: the photo is at the finish screen, in the middle, or at the slot, never travelling.
  const travelling = samples.filter((s) => s.avatar && s.slot && s.attr === 'reveal' && Math.abs(s.avatar[0]! - s.slot[0]!) > 3 && Math.abs(s.avatar[0]! - s.slot[0]!) < 400);
  expect(travelling.length).toBeLessThanOrEqual(3);
  expect(samples.some((s) => s.captions.includes('Your presence is activated'))).toBe(true);
  expect(samples.find((s) => s.attr === 'reveal')!.t).toBeLessThan(3800);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
  await context.close();
});

test('phone: the photo tucks into the menu button', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await start(page);
  await page.getByRole('button', { name: 'Go to Discover' }).tap();
  await finished(page);
  const samples = await trace(page);
  const reveal = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal')!;
  // Centred on the 44px menu button, 28px wide.
  const cx = reveal.slot![0]! + reveal.slot![2]! / 2, cy = reveal.slot![1]! + reveal.slot![3]! / 2;
  expect(Math.abs(reveal.avatar![0]! + reveal.avatar![2]! / 2 - cx)).toBeLessThanOrEqual(2);
  expect(Math.abs(reveal.avatar![1]! + reveal.avatar![3]! / 2 - cy)).toBeLessThanOrEqual(2);
  expect(reveal.avatar![2]).toBeLessThanOrEqual(30);
  expect(samples.some((s) => s.captions.includes('Your presence is activated'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-welcome-flight'))).toBe(false);
  await context.close();
});

test('screen readers hear the two lines, once each', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const heard: string[] = [];
    (window as any).__heard = heard;
    new MutationObserver(() => { const el = document.querySelector('[data-welcome-flight] [aria-live="polite"]'); const text = el?.textContent?.trim(); if (text && heard[heard.length - 1] !== text) heard.push(text); }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await finished(page);
  expect(await page.evaluate(() => (window as any).__heard)).toEqual(['Your presence is activated', 'Welcome to NetworkBase, Ada Lovelace!']);
});
