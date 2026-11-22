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
