// Terminal design system (report §31, A5): semantic colors that follow the user's theme, symbols with an
// ASCII fallback, display width that counts wide characters, and safe() for every server-provided string.

/** @typedef {0 | 1 | 2 | 3} ColorLevel none, 16, 256, truecolor */

/** @param {NodeJS.WriteStream} stream @param {NodeJS.ProcessEnv} env @returns {ColorLevel} */
export function colorLevel(stream, env = process.env) {
  if (env.NB_PLAIN === "1" || "NO_COLOR" in env) return 0;
  if (env.FORCE_COLOR !== undefined) {
    const forced = Number(env.FORCE_COLOR);
    return /** @type {ColorLevel} */ (Number.isInteger(forced) ? Math.max(0, Math.min(3, forced)) : 1);
  }
  if (!stream.isTTY || env.TERM === "dumb") return 0;
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")) return 3;
  if (/256/.test(env.TERM ?? "")) return 2;
  return 1;
}

/** Body text uses the terminal's own foreground; color marks meaning only (A5.2). @param {ColorLevel} level */
export function palette(level) {
  const sgr = (/** @type {string} */ open, /** @type {string} */ close) => (/** @type {string} */ s) => (level ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return {
    bold: sgr("1", "22"),
    dim: sgr("2", "22"),
    muted: level >= 2 ? sgr("38;5;245", "39") : sgr("90", "39"),
    brand: level === 3 ? sgr("38;2;192;86;56", "39") : level === 2 ? sgr("38;5;173", "39") : sgr("31", "39"),
    accent: sgr("36", "39"),
    success: sgr("32", "39"),
    warning: sgr("33", "39"),
    danger: sgr("31", "39"),
    info: sgr("34", "39"),
  };
}

/** @param {NodeJS.ProcessEnv} env */
export function asciiOnly(env = process.env) {
  if (env.NB_ASCII === "1") return true;
  if (process.platform === "win32") return !env.WT_SESSION && !env.TERM_PROGRAM;
  const lang = `${env.LC_ALL ?? ""}${env.LC_CTYPE ?? ""}${env.LANG ?? ""}`;
  return lang !== "" && !/utf-?8/i.test(lang);
}

/** @param {boolean} ascii */
export function symbols(ascii) {
  return ascii
    ? { active: "*", done: "+", warn: "!", error: "x", brand: "@", other: "o", rail: "|", end: "`", cursor: ">", check: "v", arrow: "->", ellipsis: "..." }
    : { active: "◆", done: "◇", warn: "▲", error: "■", brand: "●", other: "○", rail: "│", end: "└", cursor: "❯", check: "✓", arrow: "→", ellipsis: "…" };
}

// Strips C0/C1 control characters (keeps newline and tab) so text from other people can't move the cursor,
// write the clipboard (OSC 52) or hide content (report A3.11, finding 32).
 
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
/** @param {unknown} value */
export const safe = (value) => String(value ?? "").replace(CONTROL, "");

 
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** @param {string} s */
export const stripAnsi = (s) => s.replace(ANSI, "");

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;
/** East Asian Wide/Fullwidth and emoji take two cells. @param {number} cp */
const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);

/** Cells the text takes in a terminal (report A5.4, finding 100). @param {string} s */
export function width(s) {
  const plain = stripAnsi(s);
  let total = 0;
  const parts = segmenter ? Array.from(segmenter.segment(plain), (x) => x.segment) : Array.from(plain);
  for (const g of parts) total += isWide(g.codePointAt(0) ?? 0) ? 2 : 1;
  return total;
}

/** Cut to `max` cells with an ellipsis at the end (titles). @param {string} s @param {number} max @param {string} [ell] */
export function truncateEnd(s, max, ell = "…") {
  if (width(s) <= max) return s;
  let out = "";
  for (const ch of Array.from(stripAnsi(s))) {
    if (width(out + ch) > max - width(ell)) break;
    out += ch;
  }
  return out + ell;
}

/** Cut in the middle (paths keep their start and file name). @param {string} s @param {number} max @param {string} [ell] */
export function truncateMiddle(s, max, ell = "…") {
  const plain = stripAnsi(s);
  if (width(plain) <= max) return plain;
  const chars = Array.from(plain);
  const keep = max - width(ell);
  const head = Math.ceil(keep / 3);
  return chars.slice(0, head).join("") + ell + chars.slice(chars.length - (keep - head)).join("");
}

/** Pad to `n` cells. @param {string} s @param {number} n */
export const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));
