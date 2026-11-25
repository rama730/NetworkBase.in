import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const path = 'src/components/messages/messages-mix.css';
const css = existsSync(path) ? readFileSync(path, 'utf8') : '';
const layout = readFileSync('src/app/(site)/(main)/layout.tsx', 'utf8');

test('the main layout loads the Messages stylesheet (the floating window lives on every page)', () => {
  assert.match(layout, /import\s+["']@\/components\/messages\/messages-mix\.css["']/);
});

test('every rule is scoped under .nbm', () => {
  assert.ok(css.length > 0, 'stylesheet missing');
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@(media|supports)[^{]+\{/g, '');
  const selectors = body.match(/[^{}]+(?=\{)/g) ?? [];
  for (const s of selectors.map((x) => x.trim()).filter(Boolean))
    for (const part of s.split(',')) assert.match(part.trim(), /^(html\[data-reduce-motion="true"\]\s+|\.dark\s+)?\.nbm(\b|-)/, part);
});

test('nbm- classes work on portalled content and on the .nbm root itself (no ancestor needed)', () => {
  for (const cls of ['nbm-enter-dialog', 'nbm-enter-rise', 'nbm-beat', 'nbm-tag', 'nbm-count', 'nbm-pxprog'])
    assert.match(css, new RegExp(`(^|[},]\\s*)\\.${cls}[\\s{.,:>\\[]`, 'm'), cls);
  assert.match(css, /\.nbm,\s*\.nbm \*/, 'reduced motion must cover the .nbm root too');
});

test('reduced motion keeps the cues: the jump highlight still fades and the beat stays visible', () => {
  assert.match(css, /\.nbm-flash[^{]*\{[^}]*animation-duration:\s*2\.5s\s*!important/);
  assert.match(css, /\.nbm-beat > i[^{]*\{[^}]*opacity:\s*\.6/);
});

test('motion tokens match the language', () => {
  assert.match(css, /--nbm-ease:\s*cubic-bezier\(\.16,\s*1,\s*\.3,\s*1\)/);
  assert.match(css, /--nbm-m1:\s*150ms/);
  assert.match(css, /--nbm-m2:\s*220ms/);
  assert.match(css, /--nbm-m3:\s*300ms/);
});

test('reduced motion is honoured from the OS and from the app setting', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /html\[data-reduce-motion="true"\] \.nbm/);
  assert.match(css, /animation-delay:\s*0s\s*!important/);
});

test('no coloured edge bars and no shimmer', () => {
  assert.doesNotMatch(css, /border-left:\s*\d+px\s+solid\s+var\(--(primary|nbm-brand|brand)/);
  assert.doesNotMatch(css, /shimmer/i);
});

test('dark values exist for the tokens that broke on dark', () => {
  for (const t of ['--nbm-on-bad:', '--nbm-scrim:', '--nbm-shadow-pop:', '--nbm-hl:', '--nbm-mark:'])
    assert.ok(css.split(t).length >= 3, `${t} needs a light and a dark value`);
});

test('segmented cells are 44px tall on touch', () => {
  assert.match(css, /@media \(pointer: coarse\) \{[^}]*\.nbm-seg > button \{[^}]*min-height: 44px/);
});
