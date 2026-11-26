import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const page = () => read('src/app/(site)/(main)/search/page.tsx');
const client = () => read('src/components/search/SearchPageClient.tsx');

test('the page is for a signed-in person; the tabs load like Discover and Network do', () => {
  assert.match(page(), /redirect\(`\/login\?next=\$\{encodeURIComponent\(/);
  assert.match(client(), /\/api\/v1\/search\/people\?/);
  assert.match(client(), /log: "1"/);
});

// Design spec §15/§16 (2026-11-27, the user: the page didn't follow the design specification): Discover's and
// Network's own parts, not look-alikes.
test('the Discover tab is the Discover feed itself, under the results header', () => {
  const source = client();
  assert.match(source, /<DiscoverClient[\s\S]*?renderHeader=/);
  assert.match(source, /<DiscoverFilterTags /);
  assert.match(read('src/components/discover/DiscoverClient.tsx'), /renderHeader\?: \(props: DiscoverHeaderProps\) => ReactNode/);
});

test('the People tab is Network’s person card, grid and filters', () => {
  const source = client();
  assert.match(source, /<PersonCard profile=\{person\}/);
  assert.match(source, /<PersonCardGrid /);
  assert.match(source, /<NetworkFilters tab="suggested"/);
  assert.match(source, /<NetworkFilterChips /);
  assert.match(read('src/lib/search/global/people-cards.ts'), /readPersonCardDetails\(/);
});

test('header and toolbar follow spec §16: page title, underlined tabs with mono counts, 256px search, Filters, 1240px, 320px rail', () => {
  const source = client();
  assert.match(source, /<h1 className="nb-page-title">Results for “\{q\}”<\/h1>/);
  assert.match(source, /className="nb-network-toolbar /);
  assert.match(source, /<TabMarker overlap \/>/);
  assert.match(source, /<span className="nb-meta"><span aria-hidden="true">\{count\}<\/span>/);
  assert.match(source, /<SearchField value=\{value\}[^\n]*className="w-64 max-w-full" \/>/);
  assert.match(source, /max-w-\[1240px\]/);
  assert.match(source, /className="nb-network-rail sticky self-start space-y-4"/);
  assert.match(source, /<RailSection title=/);
});

test('nothing the spec rules out: no Best match label, no sort cycle, no grid/list toggle, no look-alike cards or styles', () => {
  const source = client();
  assert.doesNotMatch(source, /Sort: |Best match|aria-label="View"|LayoutGrid|nb-sp-/);
  assert.equal(existsSync('src/components/search/search-page.css'), false);
  assert.doesNotMatch(source, /band/i);
});

test('the box follows spec §31: 640px dialog, 11px micro labels, 13px titles, 12px mono metadata, 16px kind icons', () => {
  const css = read('src/components/layout/header/search-box/search-box.css');
  const box = read('src/components/layout/header/CommandPalette.tsx');
  const row = read('src/components/layout/header/search-box/BoxRow.tsx');
  assert.match(css, /width: min\(640px, calc\(100vw - 32px\)\)/);
  assert.match(css, /border-radius: 12px; box-shadow: 0 18px 44px -16px rgba\(13, 17, 20, \.26\)/);
  assert.match(css, /\.nb-sx-icon svg \{ width: 16px; height: 16px; \}/);
  assert.match(css, /\.nb-sx-row:hover, \.nb-sx-row\[data-active\] \{ background: var\(--sidebar-accent\); \}/);
  assert.match(box, /className="nb-sx-glabel nb-micro"/);
  assert.match(row, /"nb-sx-t1 nb-ui-label"/);
  assert.match(row, /"nb-sx-t2 nb-meta"/);
  assert.doesNotMatch(css, /1040px|720px|10\.5px|13\.5px|11\.5px/);
  assert.doesNotMatch(box, /BoxPreview/);
});
