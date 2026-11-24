import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanTags, fenceLanguage, matchesSnippet, snippetCode, snippetMarkdown } from "../../src/lib/workflows/snippets";

test("A6.35: a snippet's markdown round-trips its code, even code with backticks", () => {
  const code = "const s = `a ${1}`;\n```nested```\n";
  const md = snippetMarkdown({ name: "Retry", language: "TypeScript", code, purpose: "Retries with backoff.", sourceUrl: "https://example.com/x" });
  assert.match(md, /^# Retry\n\nRetries with backoff\.\n\n````typescript\n/);
  assert.match(md, /Source: <https:\/\/example\.com\/x>\n$/);
  assert.equal(snippetCode(md), code.replace(/\n$/, ""));
  assert.equal(snippetCode("# No code"), null);
  assert.equal(snippetCode("x\n~~~sql\nSELECT 1;\n~~~\n"), "SELECT 1;");
});

test("A6.35: languages, tags and search", () => {
  assert.deepEqual(["C#", "C++", "Other", "Shell"].map(fenceLanguage), ["csharp", "cpp", "", "shell"]);
  assert.deepEqual(cleanTags([" Network ", "network", "db util", "", "x".repeat(31)]), ["network", "db-util"]);
  const s = { name: "Postgres upsert", purpose: "Insert or update", language: "SQL", tags: ["db"] };
  assert.equal(matchesSnippet(s, "sql upsert"), true);
  assert.equal(matchesSnippet(s, "db"), true);
  assert.equal(matchesSnippet(s, "retry"), false);
});
