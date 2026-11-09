/**
 * Terminal output → styled runs (report A9.2). Only SGR (colors, bold, dim, italic, underline) is kept, mapped to the
 * app's tokens; cursor moves, OSC links and other escapes are dropped. No dependency.
 */
export type AnsiRun = { text: string; tone?: "success" | "warning" | "danger" | "info" | "muted"; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean };

const TONE_BY_BASE: Record<number, AnsiRun["tone"]> = { 1: "danger", 2: "success", 3: "warning", 4: "info", 5: "info", 6: "info" };

/** Nearest tone for a 256-color or truecolor value, by hue. */
function toneOfRgb(r: number, g: number, b: number): AnsiRun["tone"] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40) return "muted";
  if (r === max) return g > r * 0.6 ? "warning" : "danger";
  if (g === max) return "success";
  return "info";
}
function rgbOf256(n: number): [number, number, number] {
  if (n < 16) return [[0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229]][n % 8] as [number, number, number];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return [v, v, v]; }
  const i = n - 16;
  const step = (x: number) => (x ? 55 + x * 40 : 0);
  return [step(Math.floor(i / 36)), step(Math.floor(i / 6) % 6), step(i % 6)];
}

export function parseAnsi(input: string): AnsiRun[] {
  const runs: AnsiRun[] = [];
  let style: Omit<AnsiRun, "text"> = {};
  // CSI … letter, OSC … BEL/ST, and lone ESC pairs; only "m" (SGR) changes anything.
  const re = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
  let last = 0;
  const push = (text: string) => { if (text) runs.push({ text, ...style }); };
  for (const m of input.matchAll(re)) {
    push(input.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    if (m[2] !== "m") continue;
    const codes = (m[1] || "0").split(";").map((c) => Number.parseInt(c, 10) || 0);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!;
      if (c === 0) style = {};
      else if (c === 1) style = { ...style, bold: true };
      else if (c === 2) style = { ...style, dim: true };
      else if (c === 3) style = { ...style, italic: true };
      else if (c === 4) style = { ...style, underline: true };
      else if (c === 22) style = { ...style, bold: false, dim: false };
      else if (c === 23) style = { ...style, italic: false };
      else if (c === 24) style = { ...style, underline: false };
      else if (c === 39) style = { ...style, tone: undefined };
      else if (c === 90) style = { ...style, tone: "muted" };
      else if ((c >= 31 && c <= 36) || (c >= 91 && c <= 96)) style = { ...style, tone: TONE_BY_BASE[c % 10] };
      else if (c === 38 && codes[i + 1] === 5) { style = { ...style, tone: toneOfRgb(...rgbOf256(codes[i + 2] ?? 0)) }; i += 2; }
      else if (c === 38 && codes[i + 1] === 2) { style = { ...style, tone: toneOfRgb(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0) }; i += 4; }
      else if (c === 48 && (codes[i + 1] === 5 || codes[i + 1] === 2)) i += codes[i + 1] === 5 ? 2 : 4; // backgrounds: ignored
    }
  }
  push(input.slice(last));
  return runs;
}

/** Text without any escapes (what Copy puts on the clipboard). */
export const stripAnsi = (input: string) => parseAnsi(input).map((r) => r.text).join("");

/** `$ nb push` lines → the commands without the prompt; a line ending in `\` continues the command. */
export function commandsOf(text: string): string {
  return text.split("\n").map((line) => line.replace(/^\s*[$>]\s?/, "")).join("\n").trimEnd();
}
