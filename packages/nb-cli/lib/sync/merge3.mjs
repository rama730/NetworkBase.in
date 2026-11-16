// Three-way merge (report G9): base, theirs (the workspace's current version) and mine (the change set's item).
// Pure JavaScript, shared by the CLI ("update the draft") and the server (apply's prepare step). Line based; changes
// that don't overlap merge, overlapping ones are a conflict. Line endings follow theirs; a final newline stays as
// it was. Text only: no zero byte in the first 8 KB, valid UTF-8, each side at most 1 MB.

export const MAX_MERGE_BYTES = 1024 * 1024;

/** @param {Uint8Array} bytes */
export function isMergeableText(bytes) {
  if (bytes.byteLength > MAX_MERGE_BYTES) return false;
  if (bytes.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} text */
const split = (text) => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = text.endsWith("\n");
  const body = finalNewline ? text.slice(0, -(text.endsWith("\r\n") ? 2 : 1)) : text;
  return { lines: body === "" && !finalNewline ? [] : body.split(/\r?\n/), eol, finalNewline };
};

/**
 * The edits that turn `a` into `b`: [start in a, end in a (exclusive), replacement lines]. LCS on lines; files over
 * 4,000 lines a side fall back to one edit of the whole changed middle.
 * @param {string[]} a @param {string[]} b @returns {Array<[number, number, string[]]>}
 */
function edits(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const x = a.slice(pre, a.length - suf);
  const y = b.slice(pre, b.length - suf);
  if (!x.length && !y.length) return [];
  if (x.length > 4000 || y.length > 4000) return [[pre, a.length - suf, y]];
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  /** @type {Array<[number, number, string[]]>} */
  const out = [];
  let i = 0;
  let j = 0;
  /** @type {[number, number, string[]] | null} */
  let open = null;
  const close = () => { if (open) { out.push(open); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { close(); i++; j++; continue; }
    open ??= [pre + i, pre + i, []];
    if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) { open[2].push(/** @type {string} */ (y[j])); j++; }
    else { i++; open[1] = pre + i; }
  }
  close();
  return out;
}

/**
 * @param {string} base @param {string} theirs @param {string} mine
 * @returns {{ ok: true, text: string } | { ok: false, conflicts: Array<{ baseStart: number, baseEnd: number }> }}
 */
export function merge3(base, theirs, mine) {
  if (theirs === mine) return { ok: true, text: theirs };
  if (base === theirs) return { ok: true, text: mine };
  if (base === mine) return { ok: true, text: theirs };
  const b = split(base);
  const t = split(theirs);
  const m = split(mine);
  const ours = edits(b.lines, m.lines).map((e) => ({ side: "mine", e }));
  const other = edits(b.lines, t.lines).map((e) => ({ side: "theirs", e }));
  const all = [...ours, ...other].sort((p, q) => p.e[0] - q.e[0] || p.e[1] - q.e[1]);
  /** @type {Array<{ baseStart: number, baseEnd: number }>} */
  const conflicts = [];
  /** @type {Array<[number, number, string[]]>} */
  const chosen = [];
  for (const { e } of all) {
    const last = chosen.at(-1);
    // Edits from the two sides that overlap or touch (as git decides) conflict, unless they're the same change.
    // One side's own edits never touch: its hunks are kept apart by unchanged lines.
    if (last && e[0] <= last[1]) {
      const same = last[0] === e[0] && last[1] === e[1] && last[2].join("\n") === e[2].join("\n");
      if (!same) conflicts.push({ baseStart: Math.min(last[0], e[0]), baseEnd: Math.max(last[1], e[1]) });
      continue;
    }
    chosen.push(e);
  }
  if (conflicts.length) return { ok: false, conflicts };
  const lines = [];
  let at = 0;
  for (const [start, end, repl] of chosen) {
    lines.push(...b.lines.slice(at, start), ...repl);
    at = end;
  }
  lines.push(...b.lines.slice(at));
  // The final newline: whichever side changed it wins; otherwise as it was.
  const finalNewline = m.finalNewline !== b.finalNewline ? m.finalNewline : t.finalNewline;
  return { ok: true, text: lines.join(t.eol) + (finalNewline && lines.length ? t.eol : "") };
}
