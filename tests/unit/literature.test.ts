import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBibtex, sourceKey, toBibtex } from "../../src/lib/workflows/literature";

// Plan B1.8b (report 30.6 W5).
const BIB = `@article{rao2020,
  title = {Graph {Neural} Networks for Traffic},
  author = {Rao, Asha and Iyer, Dev},
  year = 2020,
  doi = {https://doi.org/10.1000/XYZ},
  keywords = {traffic; graphs}
}
@comment{ignore me}
@inproceedings{nokey,
  author = "Somebody"
}
@book{shah2019, title = "Sensors \\& Power", year = {2019}, url = {https://example.com/b}}`;

test("BibTeX in: fields read, braces cleaned, DOI trimmed, an entry with no title reported", () => {
  const r = parseBibtex(BIB);
  assert.deepEqual(r.errors, ["nokey: no title"]);
  assert.deepEqual(r.sources.map((s) => [s.title, s.authors, s.year, s.doi, s.link, s.keyIssues]), [
    ["Graph Neural Networks for Traffic", "Rao, Asha; Iyer, Dev", 2020, "10.1000/XYZ", null, ["traffic", "graphs"]],
    ["Sensors & Power", null, 2019, null, "https://example.com/b", []],
  ]);
});

test("BibTeX out round-trips titles, authors and years; duplicates match by DOI or title", () => {
  const back = parseBibtex(toBibtex(parseBibtex(BIB).sources)).sources;
  assert.deepEqual(back.map((s) => [s.title, s.authors, s.year]), [["Graph Neural Networks for Traffic", "Rao, Asha; Iyer, Dev", 2020], ["Sensors & Power", null, 2019]]);
  assert.equal(sourceKey({ title: "x", doi: "10.1000/XYZ" }), sourceKey({ title: "y", doi: "10.1000/xyz" }));
  assert.equal(sourceKey({ title: "Graph neural networks, for traffic!", doi: null }), sourceKey({ title: "graph neural networks for traffic", doi: null }));
});
