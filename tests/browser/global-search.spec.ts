import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Global search mix (canvas BPugBoaWtuZ5UtgayjDNmT): the box and the results page as built, with a fixture answer.
const css = ['src/components/layout/header/search-box/search-box.css', 'src/components/search/search-page.css'].map((f) => readFileSync(f, 'utf8')).join('\n');
const hit = (kind: string, title: string, extra: Record<string, unknown> = {}) => ({
  id: `${kind}:${title}`, kind, title, sub: '', href: `/${kind}/${encodeURIComponent(title)}`, why: null, score: 3, createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  avatarUrl: null, tags: [], act: null, meta: {}, ...extra,
});
const result = {
  q: 'react', fixedFrom: null, email: null, tookMs: 42, suggestions: ['react native', 'react hyderabad'],
  skill: { name: 'React', people: 6, workspaces: 6, orgs: 3 },
  groups: {
    orgs: [hit('orgs', 'React Hyderabad', { sub: 'Community · 1,240 members', tags: ['React'], act: 'Follow', meta: { orgType: 'community', followers: 1240 } })],
    workspaces: [
      hit('workspaces', 'React component kit', { sub: 'Accessible components for student projects', tags: ['React', 'TypeScript'], act: 'Follow', meta: { openToCollaborate: true, openRoles: 2, followers: 84, isNew: true, updatedBy: 'Ananya Rao' } }),
      hit('workspaces', 'Campus events app', { sub: 'Events for KL University clubs', tags: ['React Native'], why: 'Skill · React Native', act: 'Follow', meta: { followers: 31, updatedBy: 'Vijay Kumar' } }),
    ],
    posts: [hit('posts', 'Ananya Rao', { sub: 'Shipped the react hooks picker for CSE 3B today', meta: { place: 'React component kit', likes: 12, isNew: true } })],
    people: [
      hit('people', 'Ananya Rao', { sub: 'Frontend developer · Chennai', tags: ['React', 'Figma'], act: 'Connect', meta: { userId: 'p1', relation: 'Works with you in CSE 3B', relKey: 'second', mutual: 2, location: 'Chennai', headline: 'Frontend developer' } }),
      hit('people', 'Sana Mirza', { sub: 'React Native developer · Hyderabad', tags: ['React Native'], act: 'Message', meta: { userId: 'p2', relation: 'Your connection', relKey: 'conn', mutual: 5, location: 'Hyderabad', headline: 'React Native developer' } }),
    ],
    messages: [hit('messages', 'Sana Mirza', { sub: 'react-hook-form or plain React state for the signup?', meta: { place: '#frontend', author: 'Sana Mirza', hasFile: true } })],
  },
  counts: { orgs: 1, workspaces: 2, posts: 1, people: 2, messages: 1 },
};

async function open(page: Page, query: string, options: { theme?: 'dark'; width?: number } = {}) {
  await page.setViewportSize({ width: options.width ?? 1280, height: 900 });
  await openApp(page, 'tests/browser/global-search.fixture.tsx', {
    path: `/?${query}${options.theme ? `&theme=${options.theme}` : ''}`,
    head: `window.__result=${JSON.stringify(result)};document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);});`,
    beforeGoto: async (p) => {
      await p.route('**/api/v1/search?**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: result }) }));
      await p.route('**/api/v1/search/saved', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { saved: [{ id: 's1', query: 'react', tab: 'discover', filters: {}, notify: 'weekly', newCount: 3 }], trending: ['hackathon', 'next.js 16'] } }) }));
    },
  });
}

test('the box from Discover: organizations first, best rows, See all', async ({ page }) => {
  await open(page, 'surface=box&q=react&from=/discover');
  const box = page.getByRole('dialog');
  await expect(box.getByText('See all 7 results for “react”')).toBeVisible();
  const labels = await box.locator('.nb-sx-glabel b').allTextContents();
  expect(labels.slice(0, 3)).toEqual(['Organizations', 'Workspaces', 'Posts']);
  await page.keyboard.press('ArrowDown');
  await expect(box.locator('[data-active]').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/global-search/box-discover.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('the box from Network puts people first; the empty box shows saved and trending', async ({ page }) => {
  await open(page, 'surface=box&q=react&from=/network');
  const labels = await page.getByRole('dialog').locator('.nb-sx-glabel b').allTextContents();
  expect(labels[0]).toBe('People');
  await open(page, 'surface=box&q=&from=/discover');
  await expect(page.getByText('3 NEW')).toBeVisible();
  await expect(page.getByRole('button', { name: 'hackathon' })).toBeVisible();
  await page.screenshot({ path: 'test-results/global-search/box-empty.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('the results page: tabs, filters with counts, quick look keys, list view', async ({ page }) => {
  await open(page, 'surface=page&q=react');
  await expect(page.getByRole('heading', { name: 'Results for “react”' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Discover/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /Only things tagged React/ }).click();
  await expect(page.getByText('Skill: React')).toBeVisible();
  await page.screenshot({ path: 'test-results/global-search/page-discover.png', fullPage: true });
  await page.locator('.nb-sp-main').focus();
  await page.keyboard.press('j');
  await expect(page.getByRole('complementary', { name: 'Quick look' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /People/ }).click();
  await page.getByRole('button', { name: /Sort: Best match/ }).click();
  await expect(page.getByRole('button', { name: /Sort: Most mutuals/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/global-search/page-people.png', fullPage: true });
  expect(await axeViolations(page)).toEqual([]);
});

test('dark and phone', async ({ page }) => {
  await open(page, 'surface=page&q=react', { theme: 'dark' });
  await page.screenshot({ path: 'test-results/global-search/page-dark.png', fullPage: true });
  await open(page, 'surface=page&q=react', { width: 390 });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/global-search/page-phone.png', fullPage: true });
  await open(page, 'surface=box&q=react&from=/discover', { width: 390 });
  await page.screenshot({ path: 'test-results/global-search/box-phone.png' });
});
