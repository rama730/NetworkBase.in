import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

test('optimization 11: pixelsHaveTransparency fast-path correctly detects transparent pixels', async () => {
    const { pixelsHaveTransparency } = await import('@/lib/messaging/image-compression');
    // 64 pixels (256 bytes), all opaque
    const opaque = new Uint8ClampedArray(256).fill(255);
    assert.equal(pixelsHaveTransparency(opaque), false, 'Opaque buffer must return false');

    // Buffer with a transparent pixel in the body
    const withAlpha = new Uint8ClampedArray(256).fill(255);
    withAlpha[67] = 0; // alpha channel of pixel 16 (stride test)
    assert.equal(pixelsHaveTransparency(withAlpha), true, 'Buffer with alpha must return true');
});

test('optimization 13: renderTextWithMentions fast-paths plain text without regex parsing', () => {
    const renderFile = readFileSync(
        resolve(ROOT, 'src/components/messages/parts/message-rendering.tsx'),
        'utf8',
    );
    assert.match(
        renderFile,
        /if\s*\(!text\.includes\('`'\)\s*&&\s*!text\.includes\('@'\)\s*&&\s*!text\.includes\('http'\)\s*&&\s*!text\.includes\('www\.'\)\)\s*{\s*return text;\s*}/,
        'Must fast-path plain text strings without running regex split',
    );
});

test('optimization 14: MediaViewerModal is dynamically loaded on demand', () => {
    const attFile = readFileSync(
        resolve(ROOT, 'src/components/messages/parts/message-attachments.tsx'),
        'utf8',
    );
    assert.match(
        attFile,
        /const MediaViewerModal = dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/ui\/media-viewer'\)/,
        'MediaViewerModal must be loaded dynamically with next/dynamic',
    );
});

test('optimization 18: detectCodeLanguage limits sample scanning to 1,500 characters', () => {
    const codeFile = readFileSync(
        resolve(ROOT, 'src/lib/messaging/code-snippets.ts'),
        'utf8',
    );
    assert.match(
        codeFile,
        /const sample = normalizeSnippetContent\(content\)\.slice\(0,\s*1500\);/,
        'detectCodeLanguage must slice sample to 1500 characters for high-speed regex scan',
    );
});
