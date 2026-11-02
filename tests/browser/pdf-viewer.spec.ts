import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { expect, test } from '@playwright/test';

// PDF preview on pdf.js 6 (the npm audit fix): page painted on the canvas, selectable text sized over it.
const origin = 'https://pdf-viewer.test';
let script: string, css: string, worker: Buffer;

/** A one-page PDF with a line of text, xref offsets computed. */
function samplePdf() {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        null,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const stream = 'BT /F1 24 Tf 40 100 Td (Hello NetworkBase) Tj ET';
    objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    let body = '%PDF-1.4\n';
    const offsets = objects.map((object, i) => { const at = body.length; body += `${i + 1} 0 obj\n${object}\nendobj\n`; return at; });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
}

test.beforeAll(async () => {
    const bundle = await build({ entryPoints: [path.resolve('tests/browser/pdf-viewer.fixture.tsx')], bundle: true, write: false, format: 'esm', platform: 'browser',
        define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'error' });
    script = bundle.outputFiles![0]!.text;
    css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
    worker = await readFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
});

test('a PDF renders on the canvas with its text layer on top', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(origin + '/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/app.js') return route.fulfill({ body: script, contentType: 'application/javascript' });
        if (url.pathname === '/pdf.worker.min.mjs') return route.fulfill({ body: worker, contentType: 'application/javascript' });
        if (url.pathname === '/app.css') return route.fulfill({ body: css, contentType: 'text/css' });
        if (url.pathname === '/sample.pdf' || url.pathname.endsWith('/preview')) return route.fulfill({ body: samplePdf(), contentType: 'application/pdf' });
        return route.fulfill({ body: '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>', contentType: 'text/html' });
    });
    await page.goto(origin);
    const canvas = page.getByLabel('PDF document page 1 of 1');
    await expect(canvas).toBeVisible();
    const text = page.locator('.pdf-text-layer span', { hasText: 'Hello NetworkBase' });
    await expect(text).toHaveCount(1);

    // Painted: some dark pixels where the text is drawn.
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => {
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i]! < 128 && data[i + 3]! > 0) dark++;
        return dark;
    })).toBeGreaterThan(100);

    // The selectable text sits over the drawn text at a real size.
    const [box, page1] = [await text.boundingBox(), await canvas.boundingBox()];
    expect(box!.height).toBeGreaterThan(15);
    expect(box!.x).toBeGreaterThan(page1!.x);
    expect(box!.x + box!.width).toBeLessThan(page1!.x + page1!.width);
    await page.screenshot({ path: test.info().outputPath('pdf-viewer.png') });
    expect(errors).toEqual([]);
});
