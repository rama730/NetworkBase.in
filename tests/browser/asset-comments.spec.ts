import { expect, test, type Page } from '@playwright/test';

import { openApp } from './app-bundle';
import { axeViolations } from './axe';

// Report 38.16 W3–W5, W9 (plan A7.2).
async function open(page: Page, kind: 'image' | 'video', width = 1200) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((k) => {
    const calls: unknown[] = [];
    (window as any).__calls = calls;
    const c = (id: string, version: number, anchor: unknown, content: string, extra: Record<string, unknown> = {}) => ({ id, version, anchor, parentId: null, content, authorId: 'u2', authorName: 'Dev', resolvedAt: null, createdAt: `2026-11-2${id.length}T10:00:00Z`, ...extra });
    (window as any).__actions = {
      readFileCommentsAction: async () => ({ success: true, version: 3, kind: k === 'video' ? 'media' : 'image', canComment: true, canResolve: true, me: 'u1',
        comments: k === 'video' ? [c('a', 3, { t: 42 }, 'Cut here')] : [c('a', 3, { x: 0.25, y: 0.5 }, 'Too close to the edge'), c('bb', 3, null, 'Looks good'), c('ccc', 2, { x: 0.1, y: 0.1 }, 'Old note'),
          { ...c('dddd', 3, null, 'Agreed'), parentId: 'a', authorName: 'Asha' }] }),
      addFileCommentAction: async (input: unknown) => { calls.push(input); return { success: true, id: 'new' }; },
      changeFileCommentAction: async (input: unknown) => { calls.push(input); return { success: true }; },
    };
  }, kind);
  await openApp(page, 'tests/browser/asset-comments.fixture.tsx', { path: `/?kind=${kind}` });
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls);

test('W3: numbered pins on the image; Pin a comment → click a spot → post with that spot; replies under their comment', async ({ page }) => {
  await open(page, 'image');
  const list = page.getByTestId('file-comments');
  await expect(list.getByTestId('file-comment')).toHaveCount(2);
  await expect(list.getByTestId('file-comment').first()).toContainText(/Pin 1\s*Dev\s*Too close to the edge\s*Asha\s*Agreed/);
  await page.getByRole('button', { name: 'Pin a comment' }).click();
  const stage = page.getByTestId('asset-stage');
  const box = (await stage.boundingBox())!;
  await stage.click({ position: { x: box.width * 0.5, y: box.height * 0.25 } });
  await page.getByLabel('Comment', { exact: true }).fill('Move the logo up');
  await page.getByRole('button', { name: 'Post' }).click();
  const [posted] = await calls(page);
  expect(posted).toMatchObject({ nodeId: 'i', version: 3, content: 'Move the logo up' });
  expect(Math.abs(posted.anchor.x - 0.5)).toBeLessThan(0.02);
  expect(Math.abs(posted.anchor.y - 0.25)).toBeLessThan(0.02);
  await page.screenshot({ path: 'test-results/asset-comments/image.png' });
  expect(await axeViolations(page)).toEqual([]);
});

test('W5: earlier versions’ comments show on request, labelled with their version; Resolve', async ({ page }) => {
  await open(page, 'image');
  await page.getByRole('button', { name: 'Show 1 on earlier versions' }).click();
  await expect(page.getByTestId('file-comments')).toContainText(/on version 2 · Pin 1\s*Dev\s*Old note/);
  await page.getByTestId('file-comment').first().getByRole('button', { name: 'Resolve' }).click();
  expect(await calls(page)).toEqual([{ projectId: '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', nodeId: 'i', commentId: 'a', action: 'resolve' }]);
});

test('W4: video comments at a moment; the moment label is a button; phone', async ({ page }) => {
  await open(page, 'video', 375);
  await expect(page.getByTestId('file-comment')).toContainText(/At 0:42\s*Dev\s*Cut here/);
  await expect(page.getByRole('button', { name: 'At 0:42' })).toBeVisible();
  await page.getByRole('button', { name: /Comment at 0:00/ }).click();
  await page.getByLabel('Comment', { exact: true }).fill('Intro is long');
  await page.getByRole('button', { name: 'Post' }).click();
  expect(await calls(page)).toEqual([expect.objectContaining({ nodeId: 'v', anchor: { t: 0 }, content: 'Intro is long' })]);
  expect(await axeViolations(page)).toEqual([]);
});
