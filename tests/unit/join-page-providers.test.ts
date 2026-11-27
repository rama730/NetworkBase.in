// Live check 2026-11-28: /join/[code] crashed for every signed-in visitor ("No QueryClient set") since B5.1b — the
// join buttons read the join terms through React Query, and the (auth) pages have no providers of their own.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

test("the join page gives its React Query buttons a provider", () => {
  const page = read("src/app/(site)/(auth)/join/[code]/page.tsx");
  const layout = read("src/app/(site)/(auth)/layout.tsx");
  const usesQuery = /useQuery|useJoinTerms/.test(read("src/components/organizations/JoinOrgButton.tsx"));
  if (!usesQuery) return;
  const providedByLayout = /QueryProvider|AuthRouteProviders/.test(layout);
  for (const name of ["JoinOrgButton", "JoinRequestPending", "JoinReportLink"]) {
    const at = page.indexOf(`<${name} `);
    assert.ok(at > 0, name);
    assert.ok(providedByLayout || page.lastIndexOf("<JoinProviders>", at) > page.lastIndexOf("</JoinProviders>", at), `${name} renders inside a QueryProvider`);
  }
  assert.ok(providedByLayout || /<QueryProvider>/.test(page));
});
