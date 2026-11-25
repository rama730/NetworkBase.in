import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const view = readFileSync('src/components/messages/ConversationView.tsx', 'utf8');
const skeleton = readFileSync('src/components/messages/ConversationSkeleton.tsx', 'utf8');
const banner = readFileSync('src/components/messages/ConnectionBanner.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('channel intro: serif 30px heading with a muted #, mono created line, square buttons', () => {
  assert.match(view, /<h2 className="nbm-intro-title">/);
  assert.match(view, /<span className="nbm-chead-hash" aria-hidden="true">#<\/span>/);
  assert.match(view, /<p className="nbm-meta nbm-intro-meta">/);
  assert.match(css, /\.nbm-intro-title\s*\{[^}]*30px[^}]*var\(--nbm-serif\)|\.nbm-intro-title\s*\{[^}]*var\(--nbm-serif\)[^}]*30px/);
  assert.match(css, /\.nbm-intro\s*\{[^}]*animation:\s*nbm-fade/);
});

test('every intro sits in the same .nbm-intro block', () => {
  assert.ok((view.match(/className="nbm-intro"/g) ?? []).length >= 4);
});

test('skeletons: square soft blocks that breathe; no shared shimmer', () => {
  assert.doesNotMatch(skeleton, /<Skeleton\b/);
  assert.match(skeleton, /className=\{`nbm-sk /);
  assert.match(css, /\.nbm-sk\s*\{[^}]*background:\s*var\(--nbm-soft\)[^}]*border-radius:\s*2px[^}]*animation:\s*nbm-breathe/);
  assert.match(skeleton, /Loading messages…/);
});

test('connection banner: a warm strip with a square tag; Reconnecting carries the pixel beat', () => {
  assert.match(banner, /className="nbm-warn"/);
  assert.match(banner, /<span className="nbm-tag warn" aria-hidden="true">\{online \? "Reconnecting" : "Offline"\}<\/span>/);
  assert.match(banner, /\{online \? <PixelBeat \/> : <WifiOff/);
  assert.match(banner, /You’re offline\. New messages will show when you reconnect\./);
  assert.match(css, /\.nbm-warn\s*\{[^}]*min-height:\s*36px[^}]*color-mix\(in srgb, var\(--nbm-warn\)/);
});
