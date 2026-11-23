import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const css = readFileSync('src/app/globals.css', 'utf8');
const pf = css.slice(css.indexOf('/* ===== profile mix'));
const read = (p: string) => existsSync(p) ? readFileSync(p, 'utf8') : '';

test('the band follows the theme: its colours are defined for light and for dark', () => {
    assert.ok(pf.length > 100, 'the profile mix section exists in globals.css');
    assert.match(pf, /:root\s*{[^}]*--pf-band-bg:/);
    assert.match(pf, /\.dark\s*{[^}]*--pf-band-bg:/);
});

test('the tab bar keeps 8px rounded corners once it floats, under a mask', () => {
    assert.match(pf, /\.nb-pf-tabwrap\[data-stuck\] \.nb-pf-tabbar\s*{[^}]*border-radius:\s*var\(--radius-lg\)/);
    assert.match(pf, /\.nb-pf-tabwrap\[data-stuck\]::before\s*{[^}]*opacity:\s*1/);
});

test('no coloured edges on any profile card', () => {
    assert.doesNotMatch(pf, /border-left:\s*[23]px|inset\s+[23]px\s+0/);
});

test('the tab bar and its sticky hook exist and are shared', () => {
    assert.match(read('src/components/profile/v2/ProfileTabBar.tsx'), /export function ProfileTabBar/);
    assert.match(read('src/components/profile/v2/useStickyBar.ts'), /export function useStickyBar/);
});

test('About stays in body text, never the serif', () => {
    const about = read('src/components/profile/v2/sections/AboutSection.tsx');
    assert.doesNotMatch(about, /font-serif|nb-pf-name/);
    assert.doesNotMatch(pf.match(/\.nb-pf-about-body[^{]*{[^}]*}/g)?.join('') ?? '', /serif/);
});

test('owner-only parts render behind isOwner', () => {
    const card = read('src/components/profile/v2/sections/ProfileFactsCard.tsx');
    assert.match(card, /const completeness = isOwner && /);
    assert.match(card, /const health = isOwner && /, 'only the owner sees the broken-link warning and Fix');
    assert.match(card, /const order = isOwner \? \[completeness/);
    const timeline = read('src/components/profile/v2/sections/ContributionTimeline.tsx');
    assert.match(timeline, /const menu = isOwner \?/);
    assert.match(timeline, /isOwner && drafts\.length/);
    const grid = read('src/components/profile/v2/sections/WorkspacesGridCard.tsx');
    assert.match(grid, /\{isOwner \? \(\s*<button type="button" className="nb-pf-ib ml-auto" aria-pressed=\{pins\.has/);
});

test('a move refreshes the profile like Pin and Hide do', () => {
    const timeline = read('src/components/profile/v2/sections/ContributionTimeline.tsx');
    const move = timeline.slice(timeline.indexOf('const move = async'), timeline.indexOf('const item = '));
    assert.match(move, /onChanged\?\.\(\)/);
});

test('Edit profile: drafts link wired, ⌘S ignores the contribution panel, no save while a photo uploads', () => {
    const editor = read('src/components/profile/edit/EditProfileEditor.tsx');
    assert.match(editor, /contributionDrafts=\{/);
    assert.match(editor, /onOpenDrafts=\{/);
    assert.match(editor, /closest\?\.\("\.nb-pf-cd"\)/);
    assert.match(editor, /startsWith\("blob:"\)/);
});

test('the tab strip is rounded and clipped like its bar, so the first tab’s underline follows the corner', () => {
    assert.match(pf, /\.nb-pf-tb\s*{[^}]*overflow:\s*clip[^}]*border-radius:\s*0 0 calc\(var\(--radius-lg\) - 1px\)/);
    assert.match(pf, /\.nb-pf-tabwrap\[data-stuck\] \.nb-pf-tb\s*{[^}]*border-radius:\s*calc\(var\(--radius-lg\) - 1px\)/);
});
