// The pixel grid trail (locked design: docs/superpowers/plans/2026-11-18-grid-auth-404-report.md).
// Framework-free: attachGridTrail(el, preset) draws on one canvas inside a `.nb-grid` element and returns cleanup.
// Hooks in the markup: data-grid-trail="hero|subtle", data-trail-script="cmd|cmd", data-pixel-word, data-word-font="7",
// data-word-align="center", [data-pixel-slot], [data-cta-row] containing [data-cta] (the main button that gets the ring).

export const TRAIL = {
  brand: '#D14E24',
  colors: ['#D14E24', '#EDBF85', '#2563C9', '#A7C3F0', '#2F6B4F', '#99CEAD'],
  popMs: 100,
  stepMs: 26,
  pushRadius: 2.3,
  glyphs: ['+', '-', '~', '>', '/', '@', '#', ':', '*', '.'],
  ignore: 'a, button, input, select, textarea, label, [role="button"], [contenteditable="true"], [data-trail-ignore]',
  presets: {
    hero: { alpha: 1, pool: 40, life: [100, 400], ring: true }, // ring: click ripple and the button ring
    subtle: { alpha: 0.45, pool: 14, life: [80, 260], ring: false },
  },
} as const;

export type TrailPreset = keyof typeof TRAIL.presets;

// 5x7 digits for the big 404 and 500.
const FONT7: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
};
export const glyph7 = (ch: string) => FONT7[ch] ?? [];
/** The orange piece of a big code: where the 4's bar crosses its stem, or the 5's lower-left corner. */
export const isMissingPiece = (first: string, x: number, y: number) => (first === '4' && y === 4 && x === 3) || (first === '5' && y === 5 && x === 0);
/** How long the orange piece takes to fly in: by the clock, so a busy page skips frames instead of crawling. */
const FLY_MS = 420;
// 4x5 letters for pixel words (M N T W Y are five wide, I is three).
const FONT5: Record<string, string[]> = {
  A: ['.##.', '#..#', '####', '#..#', '#..#'], B: ['###.', '#..#', '###.', '#..#', '###.'], C: ['.###', '#...', '#...', '#...', '.###'],
  D: ['###.', '#..#', '#..#', '#..#', '###.'], E: ['####', '#...', '###.', '#...', '####'], F: ['####', '#...', '###.', '#...', '#...'],
  H: ['#..#', '#..#', '####', '#..#', '#..#'], I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..##', '...#', '...#', '#..#', '.##.'],
  K: ['#..#', '#.#.', '##..', '#.#.', '#..#'], L: ['#...', '#...', '#...', '#...', '####'], M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'], O: ['.##.', '#..#', '#..#', '#..#', '.##.'], R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  S: ['.###', '#...', '.##.', '...#', '###.'], T: ['#####', '..#..', '..#..', '..#..', '..#..'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
};

export const glyph5 = (ch: string) => FONT5[ch] ?? ['....', '....', '....', '....', '....'];
/** Columns a 4x5 word takes: each letter plus a gap, then the 2-column full stop. */
export const wordWidth = (text: string) => [...text].reduce((n, ch) => n + glyph5(ch)[0]!.length + 1, 0) + 2;
export const isLightHex = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.55;
};
const ease = (t: number) => 1 - Math.pow(1 - t, 4); // close to githubuniverse.com's cubic-bezier(.3,.41,.04,1.01)
const randomOf = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
export const randomColor = () => randomOf(TRAIL.colors);

/** Scale of a trail pixel at `now`: pop in, hold for `life`, shrink out; -1 once it is gone, 0 before it starts. */
export function pixelScale(t0: number, life: number, now: number) {
  const dt = now - t0;
  if (dt < 0) return 0;
  if (dt < TRAIL.popMs) return ease(dt / TRAIL.popMs);
  if (dt < TRAIL.popMs + life) return 1;
  const t = (dt - TRAIL.popMs - life) / TRAIL.popMs;
  return t >= 1 ? -1 : 1 - ease(t);
}

/** The ring around a button that covers cells [bi, bi+wc) x [bj, bj+hc): one empty cell away on all four sides, clockwise from top-left. */
export function ringCells(bi: number, bj: number, wc: number, hc: number): [number, number][] {
  const i0 = bi - 2, j0 = bj - 2, i1 = bi + wc + 1, j1 = bj + hc + 1;
  const ring: [number, number][] = [];
  for (let i = i0; i <= i1; i++) ring.push([i, j0]);
  for (let j = j0 + 1; j <= j1; j++) ring.push([i1, j]);
  for (let i = i1 - 1; i >= i0; i--) ring.push([i, j1]);
  for (let j = j1 - 1; j > j0; j--) ring.push([i0, j]);
  return ring;
}

type Cell = { i: number; j: number; t0: number; life: number; free: boolean; color: string; glyph: string; glyphColor: string };
type WordPixel = { kind: 'letter' | 'dot'; hi: number; hj: number; x: number; y: number; fx: number; fy: number; start: number; last: number; color: string | null; scatterUntil: number; sx: number; sy: number };

export function attachGridTrail(el: HTMLElement, presetName: TrailPreset) {
  const p = TRAIL.presets[presetName];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(hover: none)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'nb-grid-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  el.prepend(canvas);
  const ctx = canvas.getContext('2d')!;
  // Canvas fonts can't read CSS variables, so resolve the app's mono family once.
  const monoFamily = `${getComputedStyle(el).getPropertyValue('--font-jetbrains-mono').trim() || '"JetBrains Mono"'}, ui-monospace, Menlo, monospace`;
  const cells = new Map<string, Cell>();
  let w = 0, h = 0, c = 16, dpr = 1, cols = 0, rows = 0, ox = 0, oy = 0;
  let raf = 0, visible = false, played = false, last: [number, number] | null = null;
  let ptr: { ci: number; cj: number; inside: boolean } | null = null;
  let word: WordPixel[] = [], wordBox: { i0: number; j0: number; i1: number; j1: number } | null = null, wordAnimEnd = 0, wsi = 0, wsj = 0;
  let blocked = new Set<string>(), solid = new Map<string, Element | null>(), outline: Cell[] = [];
  const queue: (string | null)[] = [];
  let firstFill = true, cmdAt = 0;
  let ink = '#FAF8F4', inkAt = -Infinity;
  let introDone = false; // the word is drawn only once its intro has started, so a resize before then draws nothing
  const key = (i: number, j: number) => i + ',' + j;
  const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows;
  const toCell = (x: number, y: number): [number, number] => [Math.floor((x - ox) / c), Math.floor((y - oy) / c)];
  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }

  // ---- layout: whole cells and the gap around text. blocked = content plus one cell; solid = cells content covers, with its element.
  const addWordBlocked = () => { for (const px of word) for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) blocked.add(key(px.hi + di, px.hj + dj)); };
  const measureBlocked = () => {
    blocked = new Set(); solid = new Map();
    const er = el.getBoundingClientRect();
    const block = (r: DOMRect, owner: Element | null) => {
      if (!r.width || !r.height) return;
      const [i0, j0] = toCell(r.left - er.left - c, r.top - er.top - c);
      const [i1, j1] = toCell(r.right - er.left + c - 1, r.bottom - er.top + c - 1);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) blocked.add(key(i, j));
      const [a0, b0] = toCell(r.left - er.left, r.top - er.top);
      const [a1, b1] = toCell(r.right - er.left - 1, r.bottom - er.top - 1);
      for (let i = a0; i <= a1; i++) for (let j = b0; j <= b1; j++) solid.set(key(i, j), owner);
    };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) block(r, n.parentElement);
    }
    el.querySelectorAll(TRAIL.ignore).forEach((e) => block(e.getBoundingClientRect(), e));
    addWordBlocked();
  };
  const isSolid = (i: number, j: number) => solid.has(key(i, j));

  // Snap each main button to the grid at layout time (never on hover): whole-cell width, row nudged onto grid lines.
  const alignCtas = () => {
    if (!p.ring) return;
    const er = el.getBoundingClientRect();
    el.querySelectorAll<HTMLElement>('[data-cta-row]').forEach((row) => {
      const btn = row.querySelector<HTMLElement>('[data-cta]');
      if (!btn) return;
      row.style.transform = ''; btn.style.width = '';
      btn.style.width = Math.ceil(btn.getBoundingClientRect().width / c) * c + 'px';
      const r = btn.getBoundingClientRect();
      const left = r.left - er.left - ox, top = r.top - er.top - oy;
      row.style.transform = `translate(${Math.round(left / c) * c - left}px, ${Math.ceil(top / c) * c - top}px)`;
    });
  };

  // ---- the pixel word. Only the orange piece flies in: the full stop, or on the 404 the missing pixel of the first 4.
  const wordPlan = () => {
    const slot = el.querySelector<HTMLElement>('[data-pixel-slot]'), text = (el.dataset.pixelWord || '').toUpperCase();
    if (!slot || !text) return null;
    slot.removeAttribute('data-hidden');
    const big = el.dataset.wordFont === '7';
    let sc = 1, width = wordWidth(text);
    if (big) {
      const w1 = text.length * 6 - 1;
      sc = Math.max(1, Math.min(2, Math.floor((cols - 4) / w1)));
      width = w1 * sc;
      slot.style.height = (7 * sc + 1) * c + 'px';
    }
    const er = el.getBoundingClientRect(), r = slot.getBoundingClientRect();
    const si = big || el.dataset.wordAlign === 'center' ? Math.floor((cols - width) / 2) : Math.ceil((r.left - er.left - ox) / c);
    const sj = Math.ceil((r.top - er.top - oy) / c);
    if (si < 1 || si + width > cols - 1) { slot.setAttribute('data-hidden', ''); return null; }
    return { text, big, sc, width, si, sj, tall: big ? 7 * sc : 5 };
  };
  const layoutWord = (animateDot: boolean) => {
    word = []; wordBox = null;
    const plan = wordPlan();
    if (!plan) return;
    const { text, big, sc, width, si, sj, tall } = plan;
    wsi = si; wsj = sj;
    const now = performance.now();
    const pixel = (kind: WordPixel['kind'], hi: number, hj: number, x = hi, y = hj, start = 0) =>
      word.push({ kind, hi, hj, x, y, fx: x, fy: y, start, last: 0, color: null, scatterUntil: 0, sx: 0, sy: 0 });
    let piece: [number, number][] = [];
    if (big) {
      [...text].forEach((ch, n) => (FONT7[ch] ?? []).forEach((row, y) => [...row].forEach((bit, x) => {
        if (bit !== '#') return;
        const hole = n === 0 && isMissingPiece(ch, x, y);
        for (let sx = 0; sx < sc; sx++) for (let sy = 0; sy < sc; sy++) {
          const hi = si + (n * 6 + x) * sc + sx, hj = sj + y * sc + sy;
          if (hole) piece.push([hi, hj]); else pixel('letter', hi, hj);
        }
      })));
    } else {
      let cx = si;
      for (const ch of text) {
        const g = glyph5(ch);
        g.forEach((row, y) => [...row].forEach((bit, x) => { if (bit === '#') pixel('letter', cx + x, sj + y); }));
        cx += g[0]!.length + 1;
      }
      piece = [[cx, sj + 3], [cx + 1, sj + 3], [cx, sj + 4], [cx + 1, sj + 4]];
    }
    piece.forEach(([hi, hj], n) => animateDot
      ? pixel('dot', hi, hj, hi + 6 + Math.round(Math.random() * 6), hj - 4 - Math.round(Math.random() * 6), now + 200 + n * 110)
      : pixel('dot', hi, hj));
    wordBox = { i0: si - 2, j0: sj - 2, i1: si + width + 2, j1: sj + tall + 2 };
    wordAnimEnd = animateDot ? now + 200 + piece.length * 110 + FLY_MS : 0;
    addWordBlocked();
    kick();
  };
  // Keep the word on its slot when the ground resizes, even mid-animation: shift every pixel by the slot's move.
  const followWord = () => {
    const plan = word.length ? wordPlan() : null;
    if (!plan) return layoutWord(false);
    const di = plan.si - wsi, dj = plan.sj - wsj;
    if (!di && !dj) return;
    for (const px of word) { px.hi += di; px.x += di; px.hj += dj; px.y += dj; }
    if (wordBox) { wordBox.i0 += di; wordBox.i1 += di; wordBox.j0 += dj; wordBox.j1 += dj; }
    wsi = plan.si; wsj = plan.sj;
  };
  const updateWord = (now: number) => {
    let busy = false;
    for (const px of word) {
      if (now < px.start) { busy = true; continue; }
      if (px.kind === 'dot' && px.start && now - px.start < FLY_MS) {
        const e = ease((now - px.start) / FLY_MS);
        px.x = Math.round(px.fx + (px.hi - px.fx) * e); px.y = Math.round(px.fy + (px.hj - px.fy) * e);
        busy = true; continue;
      }
      let tx = px.hi, ty = px.hj, pushed = false;
      if (px.scatterUntil > now) { tx += px.sx; ty += px.sy; busy = true; }
      else if (px.kind === 'letter' && ptr?.inside) {
        const dx = px.hi + 0.5 - ptr.ci, dy = px.hj + 0.5 - ptr.cj, d = Math.hypot(dx, dy);
        if (d < TRAIL.pushRadius) {
          const k = d < 0.01 ? 1 : 1.4 / d;
          const pxv = Math.round(dx * k);
          let pyv = Math.round(dy * k);
          if (!pxv && !pyv) pyv = dy < 0 ? -1 : 1;
          if (!isSolid(px.hi + pxv, px.hj + pyv)) { // never push a pixel under text or a control
            tx += pxv; ty += pyv; pushed = true;
            if (!px.color) px.color = randomColor();
          }
        }
      }
      if (px.x !== tx || px.y !== ty) {
        busy = true;
        if (now - px.last >= TRAIL.stepMs) { px.x += Math.sign(tx - px.x); px.y += Math.sign(ty - px.y); px.last = now; }
      } else if (!pushed && px.scatterUntil <= now) px.color = null;
    }
    return busy;
  };
  const scatterWord = () => {
    const now = performance.now();
    for (const px of word) {
      px.sx = 0; px.sy = 0;
      for (let tries = 0; tries < 8; tries++) { // land only on free cells inside the grid
        const sx = Math.round((Math.random() - 0.5) * 14) || 2, sy = Math.round((Math.random() - 0.5) * 8) || -2;
        if (inGrid(px.hi + sx, px.hj + sy) && !isSolid(px.hi + sx, px.hj + sy)) { px.sx = sx; px.sy = sy; break; }
      }
      px.scatterUntil = now + 220 + Math.random() * 260;
      px.color = px.kind === 'dot' ? null : randomColor();
    }
    kick();
  };

  const resize = () => {
    c = parseFloat(getComputedStyle(el).getPropertyValue('--nb-grid-cell')) || 16;
    const r = el.getBoundingClientRect();
    w = r.width; h = r.height;
    cols = Math.floor((w - 1) / c); rows = Math.floor((h - 1) / c);
    ox = Math.floor((w - cols * c - 1) / 2); oy = Math.floor((h - rows * c - 1) / 2);
    el.style.setProperty('--gx', ox + 'px'); el.style.setProperty('--gy', oy + 'px');
    el.style.setProperty('--gw', cols * c + 1 + 'px'); el.style.setProperty('--gh', rows * c + 1 + 'px');
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (introDone) { if (word.length && performance.now() < wordAnimEnd) followWord(); else layoutWord(false); }
    alignCtas();
    measureBlocked();
    kick();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  // ---- session script: a few random marks, a command, random marks, the next command
  const randomMark = () => (Math.random() < 0.3 ? '' : randomOf(TRAIL.glyphs));
  const nextGlyph = () => {
    const script = (el.dataset.trailScript || '').split('|').filter(Boolean);
    if (!script.length) return randomMark();
    if (!queue.length) {
      const n = firstFill ? 5 : 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) queue.push(null);
      for (const ch of script[cmdAt++ % script.length]!) queue.push(ch === ' ' ? '' : ch);
      firstFill = false;
    }
    const g = queue.shift();
    return g == null ? randomMark() : g;
  };

  const spawn = (i: number, j: number, now: number, o: { delay?: number; life?: number; free?: boolean; color?: string; glyph?: string; force?: boolean } = {}) => {
    if (!inGrid(i, j) || (!o.force && blocked.has(key(i, j)))) return null;
    const k = key(i, j), ex = cells.get(k);
    if (ex && pixelScale(ex.t0, ex.life, now) >= 0 && !o.force) return null; // a live pixel already covers this cell
    if (!o.free) {
      let live = 0;
      for (const cell of cells.values()) if (!cell.free) live++;
      if (live >= p.pool) for (const [kk, cell] of cells) if (!cell.free) { cells.delete(kk); break; }
    }
    const color = o.color || randomColor();
    const cell: Cell = {
      i, j, t0: now + (o.delay ?? 0), free: !!o.free, color, glyph: o.glyph ?? nextGlyph(),
      glyphColor: isLightHex(color) ? 'rgba(20,26,30,.78)' : 'rgba(250,248,244,.92)',
      life: o.life ?? p.life[0] + Math.random() * (p.life[1] - p.life[0]),
    };
    cells.delete(k);
    cells.set(k, cell);
    return cell;
  };

  // ---- pointer: a pixel only where an event lands (the broken trail), a ripple on click, the ring on the main button
  const onMove = (e: PointerEvent) => {
    const r = el.getBoundingClientRect(), now = performance.now();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    ptr = { ci: (x - ox) / c, cj: (y - oy) / c, inside: true };
    kick();
    const [i, j] = toCell(x, y);
    if (last && i === last[0] && j === last[1]) return;
    spawn(i, j, now);
    last = [i, j];
  };
  const onLeave = () => { last = null; if (ptr) ptr.inside = false; kick(); };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || (e.target as Element).closest(TRAIL.ignore)) return;
    const r = el.getBoundingClientRect(), now = performance.now();
    const [ci, cj] = toCell(e.clientX - r.left, e.clientY - r.top);
    if (wordBox && ci >= wordBox.i0 && ci <= wordBox.i1 && cj >= wordBox.j0 && cj <= wordBox.j1) { scatterWord(); return; }
    if (!p.ring) return;
    const color = randomColor();
    for (let di = -7; di <= 7; di++) for (let dj = -7; dj <= 7; dj++) {
      const d = Math.round(Math.hypot(di, dj));
      if (d >= 1 && d <= 7 && Math.random() < 0.8) spawn(ci + di, cj + dj, now, { delay: d * 45, life: 40, free: true, color, glyph: '' });
    }
    kick();
  };
  const outlineOn = (btn: HTMLElement) => {
    const er = el.getBoundingClientRect(), r = btn.getBoundingClientRect(), now = performance.now();
    const ring = ringCells(Math.round((r.left - er.left - ox) / c), Math.round((r.top - er.top - oy) / c), Math.round(r.width / c), Math.round(r.height / c));
    // All or nothing: if any ring cell would touch other text or another control, draw no ring at all.
    if (ring.some(([i, j]) => { const owner = solid.get(key(i, j)); return !inGrid(i, j) || (owner !== undefined && !(owner && btn.contains(owner))); })) return;
    let prev = '';
    outline = ring.map(([i, j], n) => {
      let color: string;
      do color = randomColor(); while (color === prev); // never the same colour as the pixel before it
      prev = color;
      return spawn(i, j, now, { delay: n * 7, life: Infinity, free: true, force: true, glyph: randomOf(TRAIL.glyphs), color });
    }).filter((cell): cell is Cell => !!cell);
    kick();
  };
  const outlineOff = () => {
    const now = performance.now();
    outline.forEach((cell, n) => { cell.life = Math.max(0, now - cell.t0 - TRAIL.popMs) + n * 4; });
    outline = [];
    kick();
  };

  const unlisten: (() => void)[] = [];
  let gone = false;
  const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
    target.addEventListener(type, fn); unlisten.push(() => target.removeEventListener(type, fn));
  };
  if (!reduced && !touch) {
    on(el, 'pointermove', onMove);
    on(el, 'pointerleave', onLeave);
    on(el, 'pointerdown', onDown);
    if (p.ring) el.querySelectorAll<HTMLElement>('[data-cta]').forEach((b) => { on(b, 'pointerenter', () => outlineOn(b)); on(b, 'pointerleave', outlineOff); });
  }
  // ---- pause off screen; the dot flies in the first time the grid is seen
  const io = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    if (visible && !played && entry!.intersectionRatio >= 0.35) {
      played = true;
      // The word and its flying piece wait for the first quiet moment after the page has loaded (at most 900ms),
      // so the animation never competes with the page setting itself up.
      const intro = () => { if (gone || introDone) return; introDone = true; layoutWord(!reduced); };
      if ('requestIdleCallback' in window) window.requestIdleCallback(intro, { timeout: 900 }); else setTimeout(intro, 200);
    }
    if (visible) kick(); else { cancelAnimationFrame(raf); raf = 0; }
  }, { threshold: [0, 0.35] });
  io.observe(el);

  // ---- draw, snapped to device pixels
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const fillCell = (i: number, j: number, s = 1) => {
    const size = (c - 1) * s, x = ox + i * c + 1 + (c - 1 - size) / 2, y = oy + j * c + 1 + (c - 1 - size) / 2;
    const x0 = snap(x), y0 = snap(y);
    ctx.fillRect(x0, y0, snap(x + size) - x0, snap(y + size) - y0);
  };
  function frame(now: number) {
    raf = 0;
    ctx.clearRect(0, 0, w, h);
    let moving = false;
    ctx.globalAlpha = 1;
    if (word.length) {
      if (updateWord(now)) moving = true;
      // Read the word's colour at most twice a second: a style read every frame forces work while the page is busy.
      if (now - inkAt > 500) { ink = getComputedStyle(el).getPropertyValue('--nb-grid-word-ink').trim() || '#FAF8F4'; inkAt = now; }
      for (const px of word) {
        if (now < px.start) continue;
        ctx.fillStyle = px.color || (px.kind === 'dot' ? TRAIL.brand : ink);
        fillCell(px.x, px.y, px.kind === 'dot' ? Math.min(1, (now - px.start) / TRAIL.popMs) : 1);
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.max(5, Math.round(c * 0.68))}px ${monoFamily}`;
    for (const [k, cell] of cells) {
      const s = pixelScale(cell.t0, cell.life, now);
      if (s < 0) { cells.delete(k); continue; }
      if (!(cell.life === Infinity && now - cell.t0 >= TRAIL.popMs)) moving = true;
      if (s === 0) continue;
      ctx.globalAlpha = cell.free && cell.life === Infinity ? 1 : p.alpha;
      ctx.fillStyle = cell.color;
      fillCell(cell.i, cell.j, s);
      if (cell.glyph && s > 0.85) {
        ctx.fillStyle = cell.glyphColor;
        ctx.fillText(cell.glyph, snap(ox + cell.i * c + 0.5 + c / 2), snap(oy + cell.j * c + 1 + c / 2));
      }
    }
    ctx.globalAlpha = 1;
    if (moving) kick();
  }

  return {
    refresh: resize,
    /** Draw the word again from data-pixel-word (after it changed): clear the trail, the dot flies in once more. */
    replay() {
      cells.clear(); outline = []; queue.length = 0; firstFill = true; cmdAt = 0;
      if (!played) return; // the first view plays the intro by itself
      introDone = true;
      resize(); layoutWord(!reduced); measureBlocked();
    },
    destroy() {
      gone = true;
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); unlisten.forEach((u) => u()); canvas.remove();
    },
  };
}
