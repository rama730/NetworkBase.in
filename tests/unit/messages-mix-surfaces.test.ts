import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('both Messages surfaces carry the nbm root class', () => {
  assert.match(readFileSync('src/app/(site)/(main)/messages/layout.tsx', 'utf8'), /<div data-messages-surface className="nbm /);
  assert.match(readFileSync('src/components/messages/ChatWindow.tsx', 'utf8'), /data-messages-surface[\s\S]{0,80}className=\{`nbm /);
});
