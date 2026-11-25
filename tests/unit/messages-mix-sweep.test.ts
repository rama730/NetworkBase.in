import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

test('Messages components use tokens, square marks and no edge bars (the exported note document aside)', () => {
  const bad: string[] = [];
  for (const file of files('src/components/messages')) {
    if (file.endsWith('CanvasEditor.tsx')) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/\b(text-white|bg-white|bg-black|text-black)\b|bg-red-\d|#[0-9A-Fa-f]{6}\b|border-l-[24]\b/.test(line)) bad.push(`${file}:${i + 1}`);
      if (/rounded-full/.test(line) && !/h-1 w-10 rounded-full bg-border/.test(line)) bad.push(`${file}:${i + 1} rounded-full`);
    });
  }
  assert.deepEqual(bad, []);
});

test('messages-mix.css: colour literals live only in the two token blocks', () => {
  const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');
  const blocks = [...css.matchAll(/(^|\n)(\.nbm|\.dark \.nbm) \{[\s\S]*?\n\}/g)].map((m) => m[0]);
  let rest = css;
  for (const block of blocks) rest = rest.replace(block, '');
  const literals = rest.split('\n').filter((line) => /#[0-9A-Fa-f]{3,8}\b|rgba?\(/.test(line) && !line.trim().startsWith('/*'));
  assert.deepEqual(literals, []);
  assert.match(css, /--nbm-sheet:/);
});
