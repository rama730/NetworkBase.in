// Unified diff of two texts (report A1.12, A5.5). Line LCS; files over 4,000 lines get a summary instead.

const MAX_LINES = 4000;
const CONTEXT = 3;

/**
 * @param {string} a old text @param {string} b new text
 * @returns {{ lines: Array<{ kind: " " | "-" | "+" | "@", text: string }>, added: number, removed: number } | null} null when too big
 */
export function unifiedDiff(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length > MAX_LINES || y.length > MAX_LINES) return null;
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  /** @type {Array<{ kind: " " | "-" | "+", text: string, oi: number, ni: number }>} */
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { ops.push({ kind: " ", text: x[i] ?? "", oi: i, ni: j }); i++; j++; }
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) { ops.push({ kind: "+", text: y[j] ?? "", oi: i, ni: j }); j++; }
    else { ops.push({ kind: "-", text: x[i] ?? "", oi: i, ni: j }); i++; }
  }
  const changed = ops.map((op, k) => (op.kind !== " " ? k : -1)).filter((k) => k >= 0);
  /** @type {Array<{ kind: " " | "-" | "+" | "@", text: string }>} */
  const lines = [];
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, (changed[k] ?? 0) - CONTEXT);
    let end = Math.min(ops.length, (changed[k] ?? 0) + CONTEXT + 1);
    while (k + 1 < changed.length && (changed[k + 1] ?? 0) - CONTEXT <= end) { k++; end = Math.min(ops.length, (changed[k] ?? 0) + CONTEXT + 1); }
    const first = ops[start];
    lines.push({ kind: "@", text: `@@ -${(first?.oi ?? 0) + 1} +${(first?.ni ?? 0) + 1} @@` });
    for (const op of ops.slice(start, end)) lines.push({ kind: op.kind, text: op.text });
    k++;
  }
  return { lines, added: ops.filter((o) => o.kind === "+").length, removed: ops.filter((o) => o.kind === "-").length };
}
