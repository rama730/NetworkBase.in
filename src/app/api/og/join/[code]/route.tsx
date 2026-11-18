import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getJoinPreviewAction } from '@/app/actions/organizations';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { glyph5 } from '@/lib/grid-trail';

// The app's own static font instances (src/app/fonts/README.md); no remote font requests.
const fonts = Promise.all([
  readFile(join(process.cwd(), 'src/app/fonts/InstrumentSans-Share-Semibold.ttf')),
  readFile(join(process.cwd(), 'src/app/fonts/JetBrainsMono-Share-Regular.ttf')),
]).then(([semibold, mono]) => [
  { name: 'Instrument Sans', data: semibold, weight: 600 as const, style: 'normal' as const },
  { name: 'JetBrains Mono', data: mono, weight: 400 as const, style: 'normal' as const },
]);

const CELL = 16, S = 2; // grid cell, and font pixels drawn 2x2 cells
const LATIN = /^[\u0020-\u024f\u2000-\u206f]*$/;

/** The JOIN word as absolutely placed cells, with the orange full stop. */
function pixelWord(word: string) {
  const cells: { x: number; y: number; orange?: boolean }[] = [];
  let cx = 0;
  for (const ch of word) {
    const g = glyph5(ch);
    g.forEach((row, y) => [...row].forEach((bit, x) => { if (bit === '#') cells.push({ x: cx + x, y }); }));
    cx += g[0]!.length + 1;
  }
  for (const [x, y] of [[0, 3], [1, 3], [0, 4], [1, 4]] as const) cells.push({ x: cx + x, y, orange: true });
  return cells.flatMap(({ x, y, orange }) => Array.from({ length: S * S }, (_, n) => (
    <div key={`${x}-${y}-${n}`} style={{ position: 'absolute', left: (x * S + (n % S)) * CELL + 1, top: (y * S + Math.floor(n / S)) * CELL + 1, width: CELL - 1, height: CELL - 1, background: orange ? '#D14E24' : '#FAF8F4' }} />
  )));
}

/** Share image for a join link: the sign-in panel's look, with the organization's name. The page itself shows the same name to anyone with the code. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const limited = await enforceRouteLimit(request, 'share-image', 60, 60, 'publicRead');
  if (limited) return limited;
  const { code } = await params;
  const result = await getJoinPreviewAction(code).catch(() => null);
  const name = result?.success ? result.preview.title.trim() : '';
  const title = name && LATIN.test(name) ? `Join ${name.length > 60 ? `${name.slice(0, 57)}…` : name}` : 'Join an organization';
  const path = result?.success ? `join/${code.toUpperCase().slice(0, 12)}` : 'join';
  return new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '64px', background: '#141A1E', backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '16px 16px', color: '#FAF8F4', fontFamily: 'Instrument Sans' }}>
      <div style={{ display: 'flex', fontFamily: 'JetBrains Mono', fontSize: 20, color: '#B6C0C5' }}>networkbase /&nbsp;<span style={{ color: '#FAF8F4' }}>{path}</span></div>
      <div style={{ display: 'flex', position: 'relative', height: 10 * CELL + 32, marginTop: 32 }}>{pixelWord('JOIN')}</div>
      <div style={{ display: 'flex', marginTop: 'auto', fontSize: 64, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1000 }}>{title}</div>
      <div style={{ display: 'flex', marginTop: 28, fontFamily: 'JetBrains Mono', fontSize: 20, color: '#B6C0C5' }}>{`networkbase.in/${path}`}</div>
    </div>,
    { width: 1200, height: 630, fonts: await fonts, headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
