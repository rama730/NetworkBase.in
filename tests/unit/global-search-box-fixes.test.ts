import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { offlineKey } from '../../src/hooks/useGlobalSearch';
import { acceptsSuggestion, isStoredHit } from '../../src/components/layout/header/search-box/recent';
import { savedSearchHref } from '../../src/lib/search/global/saved-href';

const read = (path: string) => readFileSync(path, 'utf8');

// Phase 2 review, Critical 1: the offline copy belongs to one account and goes on sign-out and on a block.
test('the offline copy is per account, under the prefix blocks and sign-out clear', () => {
  assert.equal(offlineKey('u1', '/api/v1/search?q=rama'), 'offline:search:global:u1:/api/v1/search?q=rama');
  assert.equal(offlineKey('', '/api/v1/search?q=rama'), null);
  assert.match(read('src/components/providers/query-provider.tsx'), /forgetOfflineSearch\(\)/);
  assert.match(read('src/lib/privacy/device-forget.ts'), /export async function forgetOfflineSearch/);
});

// Important 2: offline still reaches the kept copy and the banner.
test('the search runs while offline so the kept copy can show', () => {
  assert.match(read('src/hooks/useGlobalSearch.ts'), /networkMode: "always"/);
});

// Important 3: a notched phone keeps the 52 px input row and the 40 px footer.
test('the phone sheet adds the safe area to its rows instead of squeezing them', () => {
  const css = read('src/components/layout/header/search-box/search-box.css');
  assert.match(css, /\.nb-sx-input \{ height: calc\(52px \+ env\(safe-area-inset-top, 0px\)\);/);
  assert.match(css, /\.nb-sx-foot \{ height: calc\(40px \+ env\(safe-area-inset-bottom, 0px\)\);/);
});

// Important 4: back to search marks the result you opened again (the reset doesn't run on opening).
test('opening the box keeps the result to mark; only new words reset it', () => {
  const box = read('src/components/layout/header/CommandPalette.tsx');
  assert.match(box, /const lastReset = useRef/);
  assert.match(box, /if \(lastReset\.current === resetKey\) return;/);
});

// Important 5: the Who can find me control shows what is on.
test('the Who can find me control reads the saved value', () => {
  const control = read('src/components/layout/header/search-box/SettingControl.tsx');
  assert.match(control, /usePrivacySettings\(\)/);
  assert.match(control, /tagProps\(current === value\)/);
  assert.match(control, /"aria-pressed": pressed/);
});

// Important 6: Tab finishes a word only when a different word is on screen.
test('Tab is taken only for a shown, different suggestion', () => {
  assert.equal(acceptsSuggestion({ q: 'rea', suggestions: ['react'], shown: true }), 'react');
  assert.equal(acceptsSuggestion({ q: 'rea', suggestions: ['react'], shown: false }), null);
  assert.equal(acceptsSuggestion({ q: 'react', suggestions: ['react'], shown: true }), null);
  assert.equal(acceptsSuggestion({ q: 'rea', suggestions: [], shown: true }), null);
});

// Minor 11 regraded: a bad stored item never crashes the box or leaves the site.
test('recently viewed items from storage are checked', () => {
  const good = { id: 'p:1', kind: 'people', title: 'Rama', href: '/u/rama', sub: '', meta: {}, tags: [] };
  assert.equal(isStoredHit(good), true);
  assert.equal(isStoredHit({ ...good, meta: null }), false);
  assert.equal(isStoredHit({ ...good, href: '/\\evil.com' }), false);
  assert.equal(isStoredHit({ ...good, href: '//evil.com' }), false);
  assert.equal(isStoredHit({ ...good, tags: 'x' }), false);
});

// Minor 13 regraded: typing with an input method doesn't open rows mid-word.
test('Enter waits for an input method to finish', () => {
  assert.match(read('src/components/layout/header/CommandPalette.tsx'), /event\.nativeEvent\.isComposing/);
});

// Minor 14 regraded: a saved search opens with its own tab and filters.
test('a saved search opens its own results', () => {
  assert.equal(savedSearchHref('react', 'people', { loc: 'Hyderabad' }), '/search?q=react&tab=people&loc=Hyderabad');
  assert.equal(savedSearchHref('react', 'discover', {}), '/search?q=react');
  assert.match(read('src/components/layout/header/search-box/BoxExtras.tsx'), /savedSearchHref\(/);
});

// Live check 2026-11-27: ⌘J is My work's shortcut, so moving the chat switcher there opened both. Decision 5 read
// literally: the switcher keeps ⌘K inside Messages and the chat window; the top bar's search opens the one box there.
test('⌘K stays the chat switcher in Messages; nothing else takes ⌘J from My work', () => {
  assert.match(read('src/components/messages/MessagesChrome.tsx'), /\(e\.metaKey \|\| e\.ctrlKey\) && \(e\.key === "k" \|\| e\.key === "K"\)/);
  assert.match(read('src/components/messages/ShortcutsDialog.tsx'), /k\("mod\+k"\), "Jump to a conversation or person"/);
  const topNav = read('src/components/layout/header/TopNav.tsx');
  assert.match(topNav, /closest\("\[data-messages-surface\]"\) \|\| document\.getElementById\("chat-window"\)/);
  assert.doesNotMatch(topNav, /key\.toLowerCase\(\) === "j"/);
  assert.doesNotMatch(read('src/components/messages/ChatSections.tsx'), /useModKeyHint\("j"\)/);
});
