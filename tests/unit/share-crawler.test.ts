import assert from 'node:assert/strict';
import test from 'node:test';
import { isShareCrawler } from '../../src/lib/sharing/presentation';

const readers = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  'Claude-User/1.0',
  'OAI-SearchBot/1.0',
  'Claude-SearchBot/1.0',
  'Perplexity-User/1.0',
  'Google-Extended',
  'Applebot/0.1',
  'meta-externalagent/1.1',
  'DuckDuckBot/1.1',
  'YandexBot/3.0',
  'curl/8.7.1',
  'python-requests/2.32',
  'Go-http-client/2.0',
  'node-fetch',
  '',
  null,
];

const browsers = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Linux; Android 13; CUBOT KINGKONG 9 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
];

test('search engines, AI readers and non-browser clients get the reader page', () => {
  for (const ua of readers) assert.equal(isShareCrawler(ua), true, String(ua));
});

test('people in a normal browser never get the reader page', () => {
  for (const ua of browsers) assert.equal(isShareCrawler(ua), false, ua);
});
