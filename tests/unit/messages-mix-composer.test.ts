import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const composer = readFileSync('src/components/messages/Composer.tsx', 'utf8');
const editor = readFileSync('src/components/messages/ChatEditor.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('one frame: hairline, 6px, ink border on focus (no clay ring)', () => {
  assert.match(composer, /<div className="nbm-comp">/);
  assert.match(css, /\.nbm-comp\s*\{[^}]*border:\s*1px solid var\(--nbm-line\)[^}]*border-radius:\s*6px/);
  assert.match(css, /\.nbm-comp:focus-within\s*\{[^}]*border-color:\s*var\(--foreground\)/);
});

test('bottom bar cells and the formatting strip are square cells', () => {
  assert.match(composer, /function barButton\(active: boolean\) \{\s*return `nbm-cell nbm-comp-cell\$\{active \? " is-on" : ""\}`;/);
  assert.match(editor, /className="nbm-comp-tools"/);
  assert.match(editor, /className=\{`nbm-comp-tool\$\{active\[name\] \? " is-on" : ""\}`\}/);
  assert.match(css, /\.nbm-comp-tools\s*\{[^}]*border-bottom:\s*1px solid var\(--nbm-line\)/);
});

test('Send split in clay; blocked = soft fill; the reason as a mono hint under the box', () => {
  assert.match(composer, /className="nbm-send"/);
  assert.match(composer, /data-blocked=\{canSend \? undefined : "true"\}/);
  assert.match(css, /\.nbm-send > button\s*\{[^}]*background:\s*var\(--nbm-brand\)[^}]*color:\s*var\(--nbm-on-brand\)/);
  assert.match(css, /\.nbm-send > button\[data-blocked="true"\][^{]*\{[^}]*background:\s*var\(--nbm-soft\)/);
  assert.match(css, /border-left:\s*1px solid color-mix\(in srgb, var\(--nbm-on-brand\) 24%, transparent\)/);
  assert.match(composer, /<p className="nbm-comp-hint" aria-hidden="true">\{canSend \? sendHint : sendBlockedReason\}/);
});

test('attachments: square tiles, 10-square pixel progress, failed tiles in red with Retry and ×', () => {
  assert.doesNotMatch(composer, /UploadBar/);
  assert.match(composer, /<li key=\{u\.id\} className="nbm-tile" data-failed=\{u\.error \? "true" : undefined\}>/);
  assert.match(composer, /<PixelProgress value=\{u\.progress\} label=\{`Upload progress: \$\{u\.name\}`\} \/>/);
  assert.match(composer, /className="nbm-ftile" data-failed=\{u\.error \? "true" : undefined\}/);
  assert.match(css, /\.nbm-tile\s*\{[^}]*width:\s*64px[^}]*height:\s*64px[^}]*border-radius:\s*3px/);
  assert.match(css, /\.nbm-tile\[data-failed="true"\][^{]*\{[^}]*var\(--nbm-bad\)/);
});

test('a queued send shows the pixel progress in the Send button', () => {
  assert.match(composer, /\{queued \? <PixelProgress value=\{uploadPercent\} label="Upload progress" \/> : <SendHorizontal size=\{16\} \/>\}/);
});

test('with files attached the mono hint also states the limits, from the real constants', () => {
  assert.match(composer, /\{uploads\.length \? ` · Max \$\{CHAT_MAX_ATTACHMENTS\} files · \$\{Math\.round\(DEFAULT_ATTACHMENT_UPLOAD_MAX_FILE_BYTES \/ 1024 \/ 1024\)\} MB each · no SVG` : ""\}/);
});

const view = readFileSync('src/components/messages/ConversationView.tsx', 'utf8');

test('read-only footers are one cell in the composer’s place, same words', () => {
  assert.ok((view.match(/<div className="nbm-comp-foot"><div className="nbm-comp-foot-cell">/g) ?? []).length >= 3);
  assert.match(view, /You’re previewing/);
  assert.match(view, /You can’t reply to this conversation\./);
  assert.match(view, /This channel is archived\. You can read it, but not post\./);
  assert.match(css, /\.nbm-comp-foot-cell\s*\{[^}]*border:\s*1px solid var\(--nbm-line\)[^}]*border-radius:\s*6px/);
});

test('away notice: a warm strip with square tags, hidden until someone is away; draft tag; square Also send to', () => {
  assert.match(composer, /<p role="status" className="nbm-warn nbm-comp-note">/);
  assert.match(css, /\.nbm-comp-note:not\(:has\(\[data-away\]\)\)\s*\{\s*display:\s*none/);
  assert.match(composer, /<span data-away className="nbm-tag">/);
  assert.match(composer, /<span className="nbm-tag">Draft<\/span>/);
  assert.match(composer, /className="nbm-check"/);
  assert.match(view, /className="nbm-meta nbm-dmctx"/);
});
