import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// sonner 2's toast.promise returns the toast id, not the promise: `await toast.promise(p, …)` resolves at
// once and never throws, so a rollback in the caller's catch never runs. Awaited calls must `.unwrap()`.
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && (depth -= 1) === 0) return i;
  }
  return -1;
}

test("every awaited toast.promise unwraps, so failures reach the caller", () => {
  const offenders: string[] = [];
  for (const file of sources(path.join(process.cwd(), "src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/await toast\.promise\(/g)) {
      const end = closingParen(text, match.index! + match[0].length - 1);
      if (!text.slice(end + 1).startsWith(".unwrap()")) {
        offenders.push(`${path.relative(process.cwd(), file)}:${text.slice(0, match.index).split("\n").length}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
