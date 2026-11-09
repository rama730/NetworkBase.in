import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { DETAIL_RULES, backTargetFor, isStartPath } from "../../src/lib/navigation/back-routes";

const MAIN = "src/app/(site)/(main)";

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pages(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

/** `src/app/(site)/(main)/u/[username]/page.tsx` → `/u/sample`. */
function samplePath(file: string) {
  const rel = path.relative(MAIN, path.dirname(file));
  const parts = rel.split(path.sep).filter((part) => part && part !== "." && !/^\(.*\)$/.test(part));
  return `/${parts.map((part) => (/^\[.*\]$/.test(part) ? "sample" : part)).join("/")}`;
}

test("every main page has a deliberate back decision (A8)", () => {
  const files = pages(MAIN);
  assert.ok(files.length > 20, "found the main pages");
  for (const file of files) {
    const pathname = samplePath(file);
    const target = backTargetFor(pathname);
    const deliberate = isStartPath(pathname) || !target.show || DETAIL_RULES.some((rule) => rule.pattern.test(pathname));
    assert.ok(deliberate, `${file} (${pathname}) needs a row in src/lib/navigation/back-routes.ts`);
  }
});

test("the parent breadcrumb never says Back (R7)", () => {
  const src = fs.readFileSync("src/components/organizations/OrgHeaderParts.tsx", "utf8");
  const crumb = src.slice(src.indexOf("export function OrgBreadcrumb"), src.indexOf("export function", src.indexOf("export function OrgBreadcrumb") + 10));
  assert.ok(crumb.length > 0);
  assert.doesNotMatch(crumb, /\bBack\b/);
});
