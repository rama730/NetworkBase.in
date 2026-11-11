// A QR code for the approval link (report A4), so a server or SSH session can be approved from a phone. Byte mode,
// error correction level L, versions 1–10 (up to 271 bytes): enough for any approval URL. No dependency (G25.1).
// The steps follow ISO/IEC 18004: data bits → Reed–Solomon blocks → function patterns → zigzag placement → the
// mask with the lowest penalty → format and version bits. tests/qr.test.mjs checks a matrix that macOS decoded.

// Level L, versions 1–10: error-correction codewords per block, and blocks.
const ECC_PER_BLOCK = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
const BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];

/** Codewords for data and error correction together. @param {number} ver */
function rawCodewords(ver) {
  let modules = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (ver >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}
const dataCodewords = (/** @type {number} */ ver) => rawCodewords(ver) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (/** @type {number} */ a, /** @type {number} */ b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The Reed–Solomon remainder of `data` for `degree` check bytes. @param {number[]} data @param {number} degree */
function reedSolomon(data, degree) {
  // Generator: (x - α^0)(x - α^1)…(x - α^(degree-1)), highest power first and its leading 1 left out.
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  gen = gen.slice(1);
  const rem = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ /** @type {number} */ (rem.shift());
    rem.push(0);
    for (let j = 0; j < degree; j++) rem[j] ^= mul(gen[j], factor);
  }
  return rem;
}

/** The codewords to place: data split into blocks, each with its check bytes, interleaved. @param {Uint8Array} bytes @param {number} ver */
function codewords(bytes, ver) {
  const capacity = dataCodewords(ver);
  /** @type {number[]} */
  const bits = [];
  const put = (/** @type {number} */ value, /** @type {number} */ length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks = BLOCKS[ver];
  const ecc = ECC_PER_BLOCK[ver];
  const total = rawCodewords(ver);
  const shortBlocks = blocks - (total % blocks);
  const shortData = Math.floor(total / blocks) - ecc;
  const parts = [];
  for (let i = 0, at = 0; i < blocks; i++) {
    const length = shortData + (i < shortBlocks ? 0 : 1);
    const chunk = data.slice(at, at + length);
    at += length;
    parts.push({ data: chunk, ecc: reedSolomon(chunk, ecc) });
  }
  const out = [];
  for (let i = 0; i <= shortData; i++) for (const p of parts) if (i < p.data.length) out.push(p.data[i]);
  for (let i = 0; i < ecc; i++) for (const p of parts) out.push(p.ecc[i]);
  return out;
}

const MASKS = [
  (/** @type {number} */ x, /** @type {number} */ y) => (x + y) % 2 === 0,
  (/** @type {number} */ _x, /** @type {number} */ y) => y % 2 === 0,
  (/** @type {number} */ x) => x % 3 === 0,
  (/** @type {number} */ x, /** @type {number} */ y) => (x + y) % 3 === 0,
  (/** @type {number} */ x, /** @type {number} */ y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (/** @type {number} */ x, /** @type {number} */ y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (/** @type {number} */ x, /** @type {number} */ y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (/** @type {number} */ x, /** @type {number} */ y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Lower is easier to scan (ISO/IEC 18004 §7.8.3). @param {boolean[][]} m */
function penalty(m) {
  const size = m.length;
  let score = 0;
  const line = (/** @type {(i: number) => boolean} */ at) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && at(i) === at(i - 1)) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    // Finder-like 1:1:3:1:1 with four light modules on one side.
    for (let i = 0; i + 11 <= size; i++) {
      const s = Array.from({ length: 11 }, (_, k) => (at(i + k) ? 1 : 0)).join("");
      if (s === "10111010000" || s === "00001011101") score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => m[y][x]);
  for (let x = 0; x < size; x++) line((y) => m[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  }
  const total = size * size;
  return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}

/**
 * The module matrix for `text` (true = dark), smallest version that fits. Throws when it needs more than version 10.
 * @param {string} text
 * @returns {boolean[][]}
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= 10 && 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  if (ver > 10) throw new Error("Too long for a QR code here");
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (/** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ dark) => { m[y][x] = dark; fixed[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  if (ver >= 2) {
    const count = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < count; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  // Reserve the format areas (filled per mask below), the dark module, and the version bits.
  const format = (/** @type {number} */ mask) => {
    let rem = (0b01 << 3) | mask;
    const data = rem;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (/** @type {number} */ i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  const words = codewords(bytes, ver);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x] && i < words.length * 8) {
          m[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }

  let best = /** @type {boolean[][] | null} */ (null);
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const masked = m.map((row, y) => row.map((dark, x) => (fixed[y][x] ? dark : dark !== MASKS[mask](x, y))));
    const keep = m.map((row) => [...row]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) m[y][x] = masked[y][x];
    format(mask);
    const score = penalty(m);
    if (score < bestScore) { bestScore = score; best = m.map((row) => [...row]); }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) m[y][x] = keep[y][x];
  }
  return /** @type {boolean[][]} */ (best);
}

/**
 * Two module rows per text line with half blocks, light modules drawn: on a dark terminal the code reads as dark on
 * light, and phone cameras read the inverse too. A two-module quiet zone keeps it narrow.
 * @param {string} text
 */
export function qrLines(text) {
  const m = qrMatrix(text);
  const quiet = 2;
  const size = m.length + quiet * 2;
  const light = (/** @type {number} */ x, /** @type {number} */ y) => {
    const mx = x - quiet;
    const my = y - quiet;
    return !(mx >= 0 && my >= 0 && mx < m.length && my < m.length && m[my][mx]);
  };
  const lines = [];
  for (let y = 0; y < size; y += 2) {
    let row = "";
    for (let x = 0; x < size; x++) {
      const top = light(x, y);
      const bottom = y + 1 < size ? light(x, y + 1) : false;
      row += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(row);
  }
  return lines;
}
