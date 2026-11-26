import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRis, readingWord, screeningCounts, themeRows } from "../../src/lib/organizations/lab-library";

// Report 35.4 (B6.4a): themes with Thin under 3 and Disagrees counts; Extracted; RIS read in the browser.
test("themes: the lab's order first, Thin under 3, Disagrees counted", () => {
  const links = [{ theme: "Low-light", disagrees: false }, { theme: "Low-light", disagrees: true }, { theme: "Low-light", disagrees: false }, { theme: "Video", disagrees: false }, { theme: "Old", disagrees: false }];
  assert.deepEqual(themeRows(links, ["Low-light", "3D scenes", "Video"]), [
    { theme: "Low-light", count: 3, thin: false, disagrees: 1 },
    { theme: "3D scenes", count: 0, thin: true, disagrees: 0 },
    { theme: "Video", count: 1, thin: true, disagrees: 0 },
    { theme: "Old", count: 1, thin: true, disagrees: 0 },
  ]);
});

test("reading words: Extracted only when Read and you wrote lab notes", () => {
  assert.equal(readingWord("read", true), "Extracted");
  assert.equal(readingWord("read", false), "Read");
  assert.equal(readingWord("to_read", true), "To read");
  assert.equal(readingWord(null, true), null);
});

test("RIS: TY … ER records with authors, year, DOI, journal; a record without a title is an error", () => {
  const { sources, errors } = parseRis(["TY  - JOUR", "TI  - NeRF in the Dark", "AU  - Mildenhall, Ben", "AU  - Hedman, Peter", "PY  - 2022/06/01", "JO  - CVPR",
    "DO  - https://doi.org/10.1/nerf", "UR  - https://example.org/nerf", "KW  - low-light", "ER  - ", "TY  - JOUR", "AU  - Nobody", "ER  -"].join("\n"));
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0], { title: "NeRF in the Dark", authors: "Mildenhall, Ben; Hedman, Peter", year: 2022, link: "https://example.org/nerf", doi: "10.1/nerf", venue: "CVPR", keyIssues: ["low-light"], summary: null });
  assert.deepEqual(errors, ["entry 2: no title"]);
});

test("screening counts match the rows: found is all, screened is past Found", () => {
  const rows = [{ screening: "found" as const }, { screening: "screened" as const }, { screening: "included" as const }, { screening: "excluded" as const }, { screening: "included" as const }, { screening: null }];
  assert.deepEqual(screeningCounts(rows), { found: 5, screened: 4, included: 2, excluded: 1 });
});
