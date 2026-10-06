import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// COR-042: every "use server" export is remotely callable with arbitrary
// arguments, so none may accept the caller's identity as a parameter.
const IDENTITY_PARAM = /\b(actorUserId|actorId|viewerId|viewerUserId|currentUserId|requesterId)\b/;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

function exportedParams(source: string) {
  const out: Array<{ name: string; params: string }> = [];
  for (const match of source.matchAll(/^export (?:async )?function (\w+)\s*(?:<[^>]*>)?\(/gm)) {
    let depth = 0;
    let end = match.index! + match[0].length - 1;
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++;
      else if (source[end] === ")" && --depth === 0) break;
    }
    out.push({ name: match[1]!, params: source.slice(match.index! + match[0].length, end) });
  }
  return out;
}

test("no server action accepts the caller's identity as an argument", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    if (!/^\s*["']use server["']/.test(source)) continue;
    for (const { name, params } of exportedParams(source)) {
      if (IDENTITY_PARAM.test(params)) offenders.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(offenders, []);
});
