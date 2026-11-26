// What search engines, AI readers and a browser get from public pages.
// Usage: npm run check:findability -- [origin] [extra paths...]
const origin = (process.argv[2] ?? 'https://networkbase.in').replace(/\/$/, '');
const paths = [
  '/',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/workspaces/deepscope-ai',
  '/workspaces/deepscope-ai.md',
  '/org/cse-3b-data-structures-2026',
  ...process.argv.slice(3),
];

const readers: Record<string, string> = {
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  Bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'ChatGPT-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  'Claude-User': 'Claude-User/1.0',
  Chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

function readable(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function row(reader: string, path: string) {
  const res = await fetch(origin + path, { headers: { 'user-agent': readers[reader] }, redirect: 'manual' });
  const body = await res.text();
  const html = (res.headers.get('content-type') ?? '').includes('html');
  const title = html ? (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '') : '';
  const robots = html ? (body.match(/<meta[^>]+name="robots"[^>]+content="([^"]*)"/i)?.[1] ?? '') : (res.headers.get('x-robots-tag') ?? '');
  const ldTypes = [...body.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((m) => [...m[1].matchAll(/"@type":"([^"]+)"/g)].map((t) => t[1]));
  const md = /type="text\/markdown"/.test(body) ? 'yes' : 'no';
  const locs = path === '/sitemap.xml' ? String((body.match(/<loc>/g) ?? []).length) : '';
  return [reader, path, res.status, html ? readable(body).length : body.length, title.slice(0, 50), robots, [...new Set(ldTypes)].join(','), md, locs];
}

async function main() {
const rows = [['reader', 'path', 'status', 'chars', 'title', 'robots', 'json-ld', 'md alt', 'locs']];
for (const path of paths) {
  for (const reader of Object.keys(readers)) {
    rows.push((await row(reader, path).catch((e) => [reader, path, 'ERR', String(e).slice(0, 40), '', '', '', '', ''])).map(String));
  }
}
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join(' | '));
}

void main();
