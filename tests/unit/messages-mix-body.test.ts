import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBody } from '@/components/messages/MessageBody';
import { isBigEmoji } from '@/lib/messaging/emoji';

const names: Record<string, string> = { '11111111-1111-4111-8111-111111111111': 'Me Person', '22222222-2222-4222-8222-222222222222': 'Ana Ruiz' };
const render = (body: string) => renderToStaticMarkup(createElement(MessageBody, { body, nameOf: (id: string) => names[id], channelNameOf: () => 'design', meId: '11111111-1111-4111-8111-111111111111' }));

test('isBigEmoji: one to three emoji alone', () => {
  assert.equal(isBigEmoji('🎉'), true);
  assert.equal(isBigEmoji('🎉🎉🎉'), true);
  assert.equal(isBigEmoji(' 👍🏽 '), true);
  assert.equal(isBigEmoji('🇮🇳'), true);
  assert.equal(isBigEmoji('🎉 hi'), false);
  assert.equal(isBigEmoji('🎉🎉🎉🎉'), false);
  assert.equal(isBigEmoji('1'), false);
  assert.equal(isBigEmoji(''), false);
});

test('a body of only emoji renders big', () => {
  assert.match(render('🎉'), /class="nbm-body nbm-body-big"/);
  assert.doesNotMatch(render('🎉 nice'), /nbm-body-big/);
});

test('mentions: tint chip with clay text, you get the warm mark, @here bold, an unknown person muted', () => {
  assert.match(render('<@22222222-2222-4222-8222-222222222222> hi'), /<span class="nbm-mn">@Ana Ruiz<\/span>/);
  assert.match(render('<@11111111-1111-4111-8111-111111111111> hi'), /<span class="nbm-mn nbm-mn-me">@Me Person<\/span>/);
  assert.match(render('<!here> hi'), /<span class="nbm-mn nbm-mn-all">@here<\/span>/);
  assert.match(render('<@33333333-3333-4333-8333-333333333333> hi'), /<span class="nbm-mn-gone">@someone<\/span>/);
});

test('quote is a soft fill block (no bar); inline code is the mono cell', () => {
  const html = render('> quoted words\n\nand `code`');
  assert.match(html, /<blockquote class="nbm-quote">/);
  assert.doesNotMatch(html, /border-l/);
  assert.match(html, /<code class="nbm-code">code<\/code>/);
});

test('markdown: headings, tables in a scroll box, task lists, rules, images', () => {
  const html = render('## Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n---\n\n![diagram](https://example.com/d.png)');
  assert.match(html, /<h2 class="nbm-h">Plan<\/h2>/);
  assert.match(html, /<div class="nbm-tw" tabindex="0" role="region" aria-label="Table"><table>/);
  assert.match(html, /class="nbm-task"/);
  assert.match(html, /<hr class="nbm-hr"\/>/);
  // Nothing loads from another host until you ask (no tracking pixels): a click-to-load cell first.
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<button type="button" class="nbm-img-load" title="example\.com">Show image · diagram<\/button>/);
  // Not https: never offered as an image, only its alt text.
  assert.doesNotMatch(render('![x](http://example.com/d.png)'), /<img|nbm-img-load/);
});
