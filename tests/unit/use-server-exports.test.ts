import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Found live (B3.5a): a "use server" file exporting an array broke every action in it at runtime
// ("A 'use server' file can only export async functions"); typecheck and build don't catch it.
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });

test('"use server" files export only async functions (types are fine)', () => {
  const bad = files("src").filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8"))).flatMap((f) =>
    readFileSync(f, "utf8").split("\n").filter((l) => /^export (const|let|var|class|enum) /.test(l) && !/^export (const|let) \w+(\s*:[^=]+)?\s*=\s*async\b/.test(l)).map((l) => `${f}: ${l.slice(0, 80)}`));
  assert.deepEqual(bad, []);
});
