import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { buildApp, openApp } from './app-bundle';
import { buildSignInCurtainScript } from '../../src/lib/auth/signin-flight';

// The sign-in welcome flight in a real browser: the real sign-in form, the real overlay and host, and the real app
// shell, with the router slowed down so the next page arrives while the flight plays. Nothing here touches
// onboarding's flight; its own spec (welcome-flight.spec.ts) is the guard for that.
const ENTRY = 'tests/browser/signin-flight.fixture.tsx';
test.beforeAll(async () => { await buildApp(ENTRY); });
test.use({ viewport: { width: 1280, height: 800 } });

type Sample = {
  t: number; captions: string[]; avatar: number[] | null; slot: number[] | null; attr: string | null; kind: boolean; curtain: boolean; overlay: boolean;
  sidebar: number | null; route: string; badge: boolean; hint: boolean; tip: boolean; pointer: string | null; active: string; words: number[];
  header: number | null; main: number | null; imgDone: boolean | null; avatarOpacity: number | null; sr: string | null; skeleton: boolean;
};

const MARKER = 'nb:signin-flight';
const SAMPLER = () => {
  const w = window as any; w.__trace = [] as Sample[]; const t0 = performance.now();
  const rect = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
  const lift = (el: Element | null) => { if (!el) return null; const m = new DOMMatrix(getComputedStyle(el).transform); return Math.round(m.f * 10) / 10; };
  w.__sampler = setInterval(() => {
    const root = document.documentElement;
    const overlay = document.querySelector('[data-signin-overlay]');
    const captions = [...document.querySelectorAll('[data-signin-caption]')].filter((el) => Number(getComputedStyle(el).opacity) > 0.5).map((el) => (el.textContent ?? '').trim());
    const second = document.querySelector('[data-signin-caption="second"]');
    const sidebar = document.querySelector('.nb-sidebar');
    const avatar = document.querySelector('[data-signin-avatar]');
    const img = avatar?.querySelector('img') as HTMLImageElement | null;
    w.__trace.push({
      t: Math.round(performance.now() - t0), captions, avatar: rect(avatar),
      slot: rect([...document.querySelectorAll('[data-welcome-slot], [data-welcome-slot-mobile]')].find((el) => el.getBoundingClientRect().width > 0) ?? null),
      attr: root.getAttribute('data-welcome-flight'), kind: root.hasAttribute('data-signin-flight'), curtain: root.hasAttribute('data-signin-curtain'), overlay: !!overlay,
      sidebar: sidebar ? Number(getComputedStyle(sidebar).opacity) : null, route: w.__router.get() as string, badge: !!avatar?.querySelector('.nb-presence'),
      hint: [...document.querySelectorAll('[data-signin-overlay] p')].some((p) => p.textContent?.includes('to skip') && Number(getComputedStyle(p).opacity) > 0.5),
      tip: document.body.textContent?.includes('active now') ?? false, pointer: overlay ? getComputedStyle(overlay).pointerEvents : null,
      active: document.activeElement?.tagName ?? '', words: second ? [...second.querySelectorAll('span')].map((s) => Number(getComputedStyle(s).opacity)) : [],
      header: lift(document.querySelector('.nb-main-frame > header')), main: lift(document.querySelector('.nb-main-frame > main')),
      imgDone: img ? img.complete && img.naturalWidth > 0 : null, avatarOpacity: avatar ? Number(getComputedStyle(avatar).opacity) : null,
      sr: overlay?.querySelector('[aria-live]')?.textContent ?? null, skeleton: !!document.querySelector('main .nb-skeleton'),
    });
  }, 25);
};

async function signIn(page: Page, options: { visibility?: string; navDelay?: number; contentDelay?: number; redirect?: string; played?: number; off?: boolean; status?: unknown; avatar?: boolean } = {}) {
  await page.addInitScript(({ played, off }) => {
    try {
      if (played) localStorage.setItem('nb:signin-flight-played', String(played));
      if (off) localStorage.setItem('app-welcome-animation', 'false');
    } catch { /* blocked */ }
  }, { played: options.played, off: options.off });
  await openApp(page, ENTRY, { path: '/login' + (options.redirect ? `?redirect=${encodeURIComponent(options.redirect)}` : '') });
  await page.evaluate(({ visibility, navDelay, contentDelay, status, avatar }) => {
    const w = window as any; w.__visibility = visibility ?? 'public'; w.__navDelay = navDelay ?? 300; w.__contentDelay = contentDelay ?? 0; w.__status = status ?? null;
    if (avatar) w.__avatarUrl = 'https://app-bundle.test/img/ada.png';
  }, options);
  if (options.avatar) {
    await page.route('**/img/ada.png', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    });
  }
  await expect(page.locator('#email')).toBeVisible();
  await page.evaluate(SAMPLER);
  await page.locator('#email').fill('ada@example.com');
  await page.locator('#password').fill('correct horse');
}
const submit = (page: Page) => page.locator('[data-signin-submit]').click();
const trace = (page: Page) => page.evaluate(() => (window as any).__trace as Sample[]);
// Wait for the overlay to come, then for it to go: a bare "is gone" is true before the flight has even started.
const finished = async (page: Page, ms = 14000) => {
  await expect(page.locator('[data-signin-overlay]')).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator('[data-signin-overlay]')).toHaveCount(0, { timeout: ms });
};
const calls = (page: Page) => page.evaluate(() => ((window as any).__flightCalls as Array<{ event: string }>).map((c) => c.event));
const meta = (page: Page) => page.evaluate(() => (window as any).__flightCalls as Array<{ event: string; version: string; from: string; reduced: boolean }>);
const FRAME_ROOT = '[data-signin-overlay]';
const near = (a: number[], b: number[], tolerance = 1.5) => { for (let i = 0; i < 4; i += 1) expect(Math.abs(a[i]! - b[i]!), `value ${i}`).toBeLessThanOrEqual(tolerance); };

/** A fresh page that starts on the destination, as after a two-step code, Google or GitHub: the marker is already in this tab. */
async function arrive(context: BrowserContext, options: { visibility?: string; contentDelay?: number; hidden?: boolean; off?: boolean; marker?: boolean; path?: string; played?: number; curtain?: boolean } = {}) {
  const page = await context.newPage();
  await page.addInitScript(({ marker, hidden, off, path, played }) => {
    const w = window as any;
    try {
      if (marker !== false) sessionStorage.setItem('nb:signin-flight', JSON.stringify({ t: Date.now(), next: path ?? '/discover' }));
      if (off) localStorage.setItem('app-welcome-animation', 'false');
      if (played) localStorage.setItem('nb:signin-flight-played', String(played));
    } catch { /* blocked */ }
    if (hidden) Object.defineProperty(document, 'hidden', { get: () => true });
    w.__noCurtain = true;
    w.__earlyTrace = [] as unknown[]; const t0 = performance.now();
    w.__early = setInterval(() => {
      const root = document.documentElement; const sidebar = document.querySelector('.nb-sidebar');
      w.__earlyTrace.push({ t: Math.round(performance.now() - t0), curtain: root.hasAttribute('data-signin-curtain'), overlay: !!document.querySelector('[data-signin-overlay]'), sidebar: sidebar ? Number(getComputedStyle(sidebar).opacity) : null, main: !!document.querySelector('.nb-main-frame'), covers: (() => { const c = getComputedStyle(document.documentElement, '::before'); return root.hasAttribute('data-signin-curtain') && c.content !== 'none' && c.position === 'fixed' && c.zIndex === '999' && c.backgroundColor !== 'rgba(0, 0, 0, 0)'; })() });
    }, 10);
  }, options);
  // The curtain script sits in the page's head, as it does in the real document.
  await openApp(page, ENTRY, { path: options.path ?? '/discover', head: options.curtain === false ? undefined : buildSignInCurtainScript() });
  await page.evaluate(({ visibility, contentDelay }) => { const w = window as any; w.__visibility = visibility ?? 'public'; w.__contentDelay = contentDelay ?? 0; }, options);
  return page;
}

test('password sign-in, full version: the button turns to a check, the photo leaves it, two lines, and it lands exactly on the avatar', async ({ page }) => {
  await signIn(page);
  const button = await page.locator('[data-signin-submit]').boundingBox();
  await submit(page);
  await finished(page);
  const samples = await trace(page);
  // The check, said once to screen readers.
  expect(samples.some((s) => s.overlay)).toBe(true);
  const lines = samples.flatMap((s) => s.captions);
  expect(lines).toContain('Welcome back');
  expect(lines).toContain('Good to see you again, Ada');
  expect(lines.some((line) => line.includes('!'))).toBe(false);
  expect(samples.every((s) => s.captions.length <= 1)).toBe(true);
  expect(samples.findIndex((s) => s.captions.includes('Welcome back'))).toBeLessThan(samples.findIndex((s) => s.captions.includes('Good to see you again, Ada')));
  // It began at the button, not in the middle.
  const first = samples.find((s) => s.avatar && (s.avatarOpacity ?? 0) > 0.05)!;
  expect(Math.abs(first.avatar![0]! + first.avatar![2]! / 2 - (button!.x + button!.width / 2))).toBeLessThan(60);
  expect(Math.abs(first.avatar![1]! + first.avatar![3]! / 2 - (button!.y + button!.height / 2))).toBeLessThan(60);
  // It travelled through the middle and landed on the slot, to the pixel.
  expect(samples.some((s) => s.avatar && Math.abs(s.avatar[0]! - 576) < 3 && Math.abs(s.avatar[1]! - 262) < 3 && s.avatar[2]! > 120)).toBe(true);
  const last = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal')!;
  near(last.avatar!, last.slot!);
  // No tooltip, the hint came late, and the next page was started by the flight and arrived while it played.
  expect(samples.some((s) => s.tip)).toBe(false);
  expect(await page.evaluate(() => (window as any).__pushed)).toEqual(['/discover']);
  expect(samples.some((s) => s.route === '/discover' && s.avatar)).toBe(true);
  // Cleaned up: attributes gone, the real avatar there, marker consumed, played-at written, focus on the main content.
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-welcome-flight') || document.documentElement.hasAttribute('data-signin-flight') || document.documentElement.hasAttribute('data-signin-curtain'))).toBe(false);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), MARKER)).toBeNull();
  expect(await page.evaluate(() => Number(localStorage.getItem('nb:signin-flight-played')) > 0)).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
  const events = await meta(page);
  expect(events.map((e) => e.event)).toEqual(['signin_flight_started', 'signin_flight_completed']);
  expect(events[0]).toMatchObject({ version: 'full', from: 'button', reduced: false });
  // The same pace as onboarding's flight (about 4.4 s), plus the beat for the check.
  const landed = samples.find((s) => s.attr === 'reveal')!.t;
  expect(landed).toBeLessThan(5600);
});

test('the button shows a check once the sign-in is accepted, and cannot be pressed again', async ({ page }) => {
  await signIn(page);
  await submit(page);
  await expect(page.locator('[data-signin-submit]')).toBeDisabled();
  await expect(page.locator('[data-signin-submit] svg')).toBeVisible();
  await expect(page.locator('[data-signin-submit]')).toContainText('Signed in');
  await finished(page);
  expect((await calls(page)).filter((e) => e === 'signin_flight_started')).toHaveLength(1);
});

test('the second sign-in of the day is the light version: no stop in the middle, no second line, clickable before it lands', async ({ page }) => {
  await signIn(page, { played: Date.now() - 60_000 });
  await submit(page);
  await finished(page);
  const samples = await trace(page);
  const lines = samples.flatMap((s) => s.captions);
  expect(lines).toContain('Welcome back');
  expect(lines.some((line) => line.startsWith('Good to see you again'))).toBe(false);
  // It never rested in the middle: the photo is never within a few pixels of the resting place for long.
  const resting = samples.filter((s) => s.avatar && Math.abs(s.avatar[0]! - 576) < 3 && Math.abs(s.avatar[1]! - 262) < 3 && s.avatar[2]! > 120);
  expect(resting.length).toBeLessThanOrEqual(2);
  // The page takes clicks about half a second in, before the photo has landed.
  const clickable = samples.find((s) => s.pointer === 'none')!;
  const landedAt = samples.find((s) => s.attr === 'reveal' && s.avatar && s.slot && Math.abs(s.avatar[0]! - s.slot[0]!) < 1.5 && Math.abs(s.avatar[1]! - s.slot[1]!) < 1.5)!;
  expect(clickable, 'a sample with the overlay out of the way').toBeTruthy();
  expect(clickable.t).toBeLessThan(landedAt.t - 300);
  const last = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal')!;
  near(last.avatar!, last.slot!);
  expect(samples.some((s) => s.hint)).toBe(false);
  expect(samples.some((s) => s.tip)).toBe(false);
  expect((await meta(page))[0]).toMatchObject({ version: 'light', from: 'button' });
  expect(samples.find((s) => s.attr === 'reveal')!.t).toBeLessThan(3200);
  // The photo is on screen long enough to be seen: at rest with the greeting first, then the move.
  const span = (hits: Sample[]) => (hits.length ? hits[hits.length - 1]!.t - hits[0]!.t : 0);
  expect(span(samples.filter((s) => (s.avatarOpacity ?? 0) > 0.5))).toBeGreaterThan(1500);
  expect(span(samples.filter((s) => s.captions.includes('Welcome back')))).toBeGreaterThan(800);
});

test('going somewhere in particular is light too', async ({ page }) => {
  await signIn(page, { redirect: '/projects/abc' });
  await submit(page);
  await finished(page);
  expect((await meta(page))[0]).toMatchObject({ version: 'light' });
  expect(await page.evaluate(() => (window as any).__pushed)).toEqual(['/projects/abc']);
});

test('with the setting off there is no animation: straight to the next page, marker gone', async ({ page }) => {
  await signIn(page, { off: true });
  await submit(page);
  await expect.poll(() => page.evaluate(() => (window as any).__router.get())).toBe('/discover');
  expect((await trace(page)).some((s) => s.overlay)).toBe(false);
  expect(await calls(page)).toEqual([]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), MARKER)).toBeNull();
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
});

test('the account\'s own setting is respected on a device that has never seen it', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/v1/appearance', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { userId: 'u1', snapshot: { version: 1, theme: 'system', accentColor: 'default', density: 'default', reduceMotion: false, welcomeAnimation: false, updatedAt: '2026-11-09T00:00:00.000Z' } } }) }));
  await submit(page);
  await expect.poll(() => page.evaluate(() => (window as any).__router.get())).toBe('/discover');
  expect((await trace(page)).some((s) => s.overlay)).toBe(false);
  expect(await calls(page)).toEqual([]);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
});

test('after a full page load the curtain covers the page from the first paint, and the flight starts from the middle', async ({ context }) => {
  const page = await arrive(context);
  await finished(page);
  const early = await page.evaluate(() => (window as any).__earlyTrace as Array<{ t: number; curtain: boolean; overlay: boolean; sidebar: number | null; main: boolean; covers: boolean }>);
  const firstOverlay = early.findIndex((s) => s.overlay);
  expect(firstOverlay).toBeGreaterThan(0);
  // From the first sample until the overlay is up, the curtain is down or the app is not showing: never a flash of the page.
  for (const s of early.slice(0, firstOverlay)) expect(s.curtain || s.sidebar === null || s.sidebar === 0, `no flash at ${s.t}ms`).toBe(true);
  expect(early.slice(0, firstOverlay).some((s) => s.curtain), 'the curtain was down before the flight').toBe(true);
  // And it really covers: while it is up, the page is under a fixed, opaque layer in the app's background colour.
  expect(early.slice(0, firstOverlay).some((s) => s.covers), 'a layer covered the page').toBe(true);
  // The curtain is lifted by the flight, and the app is shown at the end.
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-signin-curtain'))).toBe(false);
  expect(await page.evaluate(() => (window as any).__pushed)).toEqual([]);
  const events = await meta(page);
  expect(events[0]).toMatchObject({ version: 'full', from: 'center' });
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), MARKER)).toBeNull();
});

test('a page that is already showing is never played over: no curtain, no animation, marker gone', async ({ context }) => {
  const page = await arrive(context, { curtain: false });
  await page.waitForTimeout(1800);
  await expect(page.locator(FRAME_ROOT)).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), MARKER)).toBeNull();
  expect(await calls(page)).toEqual([]);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
});

test('when the flight cannot start from the sign-in page it is the plain move, with no late animation after the page shows', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { (window as any).__signedOut = true; });
  await submit(page);
  await expect.poll(() => page.evaluate(() => (window as any).__router.get())).toBe('/discover');
  await page.waitForTimeout(2000);
  expect((await trace(page)).some((s) => s.overlay)).toBe(false);
  expect(await calls(page)).toEqual([]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), MARKER)).toBeNull();
});

test('a refresh while it plays does not play it again', async ({ context }) => {
  const page = await arrive(context);
  await expect(page.locator(FRAME_ROOT)).toHaveCount(1);
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.locator(FRAME_ROOT)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-signin-curtain'))).toBe(false);
});

test('only the tab that signed in plays it', async ({ context }) => {
  const signedIn = await arrive(context);
  const other = await arrive(context, { marker: false });
  await other.waitForTimeout(1500);
  await expect(other.locator(FRAME_ROOT)).toHaveCount(0);
  await expect(other.locator('[data-welcome-slot]')).toBeVisible();
  await expect(signedIn.locator(FRAME_ROOT)).toHaveCount(1);
});

test('a hidden tab skips straight to the page and does not replay later', async ({ context }) => {
  const page = await arrive(context, { hidden: true });
  await page.waitForTimeout(1200);
  await expect(page.locator(FRAME_ROOT)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-signin-curtain'))).toBe(false);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), MARKER)).toBeNull();
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
});

test('a new person is not sent through this: onboarding drops the marker', async ({ context }) => {
  const page = await arrive(context, { path: '/onboarding' });
  await page.waitForTimeout(1200);
  await expect(page.locator(FRAME_ROOT)).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), MARKER)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-signin-curtain'))).toBe(false);
});

test('a page still on the way in keeps the marker for later', async ({ context }) => {
  const page = await arrive(context, { path: '/legal/accept' });
  await page.waitForTimeout(1000);
  await expect(page.locator(FRAME_ROOT)).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key) !== null, MARKER)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-signin-curtain'))).toBe(false);
});

test('private profile: both lines, but no badge while they are read; the photo brings one to the landing', async ({ page }) => {
  await signIn(page, { visibility: 'private' });
  await submit(page);
  await finished(page);
  const samples = await trace(page);
  expect(samples.flatMap((s) => s.captions)).toContain('Good to see you again, Ada');
  expect(samples.some((s) => s.badge && s.attr === 'hold')).toBe(false);
  expect(samples.some((s) => s.badge && s.attr === 'reveal')).toBe(true);
});

test('the app rises as it fades in, and ends in place', async ({ page }) => {
  await signIn(page);
  await submit(page);
  await finished(page);
  const samples = await trace(page);
  expect(samples.some((s) => s.attr === 'reveal' && (s.main ?? 0) > 1)).toBe(true);
  expect(samples.some((s) => s.attr === 'reveal' && (s.header ?? 0) > 1)).toBe(true);
  expect(await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.nb-main-frame > main')!).transform).f)).toBe(0);
});

test('the profile picture is in place before anything flies', async ({ page }) => {
  await signIn(page, { avatar: true });
  await submit(page);
  await finished(page);
  const samples = await trace(page);
  const visible = samples.filter((s) => (s.avatarOpacity ?? 0) > 0.05 && s.avatar);
  expect(visible.length).toBeGreaterThan(10);
  expect(visible.every((s) => s.imgDone === true), 'the picture is loaded whenever the photo can be seen').toBe(true);
});

test('screen readers hear one sentence, once', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => {
    const heard: string[] = []; (window as any).__heard = heard;
    new MutationObserver(() => { const text = document.querySelector('[data-signin-overlay] [aria-live="polite"]')?.textContent?.trim(); if (text && heard[heard.length - 1] !== text) heard.push(text); }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await submit(page);
  await finished(page);
  expect(await page.evaluate(() => (window as any).__heard)).toEqual(['Welcome back, Ada.']);
});

test('the skip hint shows after about a second, in the full version only; a click skips', async ({ page }) => {
  await signIn(page);
  await submit(page);
  await page.waitForTimeout(1900);
  await expect(page.getByText('Click or press Esc to skip')).toBeVisible();
  const before = Date.now();
  await page.mouse.click(640, 700);
  await finished(page, 4000);
  expect(Date.now() - before).toBeLessThan(2500);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-welcome-flight'))).toBe(false);
  expect(await calls(page)).toEqual(['signin_flight_started', 'signin_flight_skipped']);
});

test('Escape skips', async ({ page }) => {
  await signIn(page);
  await submit(page);
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await finished(page, 4000);
  expect(await calls(page)).toContain('signin_flight_skipped');
});

test('a slow page: the photo waits where it is, then lands once something real is there', async ({ page }) => {
  await signIn(page, { navDelay: 1500, contentDelay: 1200 });
  await submit(page);
  await finished(page, 15000);
  const samples = await trace(page);
  const reveal = samples.find((s) => s.attr === 'reveal')!;
  expect(reveal.route).toBe('/discover');
  expect(reveal.skeleton, 'nothing but placeholders when the page is shown').toBe(false);
  const last = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal')!;
  near(last.avatar!, last.slot!);
});

test('the landing place is followed if the page moves it mid-flight', async ({ page }) => {
  await signIn(page);
  await submit(page);
  // Waits inside the page (every frame), not by polling from outside: the flight is only about a second long.
  await page.waitForFunction(() => document.documentElement.getAttribute('data-welcome-flight') === 'reveal', undefined, { timeout: 15000, polling: 'raf' });
  await page.waitForTimeout(350);
  await page.evaluate(() => { const slot = document.querySelector('[data-welcome-slot]') as HTMLElement; (slot.parentElement as HTMLElement).style.marginRight = '70px'; });
  await finished(page);
  const samples = await trace(page);
  const last = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal')!;
  near(last.avatar!, last.slot!);
});

test('reduced motion: both lines, no flight, under two seconds, still ends on the avatar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await signIn(page);
  await submit(page);
  await finished(page, 8000);
  const samples = await trace(page);
  const lines = samples.flatMap((s) => s.captions);
  expect(lines).toContain('Welcome back');
  expect(lines).toContain('Good to see you again, Ada');
  const travelling = samples.filter((s) => s.avatar && s.slot && s.attr === 'reveal' && Math.abs(s.avatar[0]! - s.slot[0]!) > 3 && Math.abs(s.avatar[0]! - s.slot[0]!) < 400);
  expect(travelling.length).toBeLessThanOrEqual(3);
  expect(samples.some((s) => (s.main ?? 0) > 1), 'no rising').toBe(false);
  expect(samples.find((s) => s.attr === 'reveal')!.t).toBeLessThan(2200);
  expect((await meta(page))[0]).toMatchObject({ reduced: true });
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
  await context.close();
});

test('phone: the keyboard is closed before the photo is placed, and it tucks into the menu button', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await signIn(page);
  await page.locator('#password').focus();
  await submit(page);
  await finished(page);
  const samples = await trace(page);
  expect(samples.filter((s) => s.overlay).every((s) => s.active !== 'INPUT')).toBe(true);
  const reveal = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal')!;
  const cx = reveal.slot![0]! + reveal.slot![2]! / 2, cy = reveal.slot![1]! + reveal.slot![3]! / 2;
  expect(Math.abs(reveal.avatar![0]! + reveal.avatar![2]! / 2 - cx)).toBeLessThanOrEqual(2);
  expect(Math.abs(reveal.avatar![1]! + reveal.avatar![3]! / 2 - cy)).toBeLessThanOrEqual(2);
  expect(reveal.avatar![2]).toBeLessThanOrEqual(30);
  expect(samples.flatMap((s) => s.captions)).toContain('Welcome back');
  await context.close();
});

test('a long name wraps and stays on the screen', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__fullName = 'Wolfeschlegelsteinhausenbergerdorffwelchevoralternwarengewissenhaftschaferswessenschafewarenwohlgepflegeundsorgfaltigkeitbeschutzenvorangreifendurchihrraubgierigfeindewelchevoralternzwolftausendjahresvorandieerscheinenvonderersteerdemenschderraumschiffgebrauchlichtalsseinursprungvonkraftgestartseinlangefahrthinzwischensternartigraumaufdersuchenachdiesternwelchegehabtbewohnbarplanetenkreisedrehensichundwohinderneurassevonverstandigmenschlichkeitkonntefortplanzenundsicherfreuenanlebenslanglichfreudeundruhemitnichteinfurchtvorangreifenvonandererintelligentgeschopfsvonhinzwischensternartigraum'; });
  await signIn(page);
  await submit(page);
  await finished(page, 16000);
  const widest = await trace(page);
  expect(widest.flatMap((s) => s.captions).some((line) => line.startsWith('Good to see you again, Wolfeschlegel'))).toBe(true);
  // The caption box never grows wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test('dark theme and an accent colour: the same flight, in the app\'s own colours', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('theme', 'dark'); localStorage.setItem('app-accent-color', 'ember'); });
  await signIn(page);
  await submit(page);
  await finished(page);
  const samples = await trace(page);
  expect(samples.flatMap((s) => s.captions)).toContain('Good to see you again, Ada');
  const last = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal')!;
  near(last.avatar!, last.slot!);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 17, 20)');
});

test('every accent colour, light and dark: the same flight, landing exactly', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const theme of ['light', 'dark']) {
    for (const accent of ['default', 'orchid', 'forest', 'ember', 'rose', 'lagoon']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.addInitScript(({ theme, accent }) => { localStorage.setItem('theme', theme); localStorage.setItem('app-accent-color', accent); }, { theme, accent });
      await signIn(page, { played: Date.now() - 60_000 });
      await submit(page);
      await finished(page);
      const samples = await trace(page);
      const last = [...samples].reverse().find((s) => s.avatar && s.slot && s.attr === 'reveal')!;
      near(last.avatar!, last.slot!);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-accent')), `${theme} ${accent}`).toBe(accent);
      await context.close();
    }
  }
});

test('hidden mid-flight: it jumps to the end instead of running unseen', async ({ page }) => {
  await signIn(page);
  await submit(page);
  await expect(page.locator('[data-signin-overlay]')).toHaveCount(1, { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('[data-signin-overlay]')).toHaveCount(0, { timeout: 4000 });
  expect(await calls(page)).toEqual(['signin_flight_started', 'signin_flight_skipped']);
  await expect(page.locator('[data-welcome-slot]')).toBeVisible();
});

test('a status shows inside the badge, as it does in the top bar', async ({ page }) => {
  await signIn(page, { status: { emoji: '🎧', text: 'Heads down', expiresAt: null, setAt: null, pausesNotifications: false } });
  await submit(page);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('[data-signin-avatar] .nb-presence-emoji')), { timeout: 6000 }).toBe(true);
  await finished(page);
});

test('frame drops while the next page loads, at four times slower than this machine', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium feature');
  await signIn(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    const w = window as any; w.__frames = [] as number[]; let last = performance.now();
    const tick = (now: number) => { w.__frames.push(Math.round(now - last)); last = now; w.__raf = requestAnimationFrame(tick); };
    w.__raf = requestAnimationFrame(tick);
  });
  await submit(page);
  await finished(page, 20000);
  const frames = await page.evaluate(() => (window as any).__frames as number[]);
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  const slow = frames.filter((f) => f > 100).length;
  info.annotations.push({ type: 'frames', description: `${frames.length} frames, p95 ${p95} ms, max ${sorted[sorted.length - 1]} ms, ${slow} over 100 ms` });
  // Smooth enough that the photo does not stutter even on a slow phone: no run of dropped frames.
  expect(slow).toBeLessThanOrEqual(6);
  expect(p95).toBeLessThan(80);
});
