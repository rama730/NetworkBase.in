import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("PersonCardReview provides direct Accept and Decline decision buttons with isolated event bubbling", () => {
  const filePath = path.join(process.cwd(), "src/components/network/PersonCardReview.tsx");
  const source = readFileSync(filePath, "utf8");

  // Direct Accept and Decline buttons on the card
  assert.match(source, /Accept/);
  assert.match(source, /Decline/);
  assert.match(source, /aria-label=\{`Accept request from \$\{name\}`\}/);
  assert.match(source, /aria-label=\{`Decline request from \$\{name\}`\}/);
  assert.match(source, /onClick=\{\(\) => void decide\('accept'\)\}/);
  assert.match(source, /onClick=\{\(\) => void decide\('decline'\)\}/);

  // Stop propagation to prevent card click navigation
  assert.match(source, /e\.stopPropagation\(\)/);

  // Upper-right corner subtle three-dot overflow menu for notes and trust/safety reporting
  assert.match(source, /absolute top-3 right-3/);
  assert.match(source, /View note/);
  assert.match(source, /reporting\.open/);
});

test("PersonCardContent renders SharedOrgChip in the name line with expanded width to prevent cut-offs", () => {
  const filePath = path.join(process.cwd(), "src/components/network/PersonCardContent.tsx");
  const source = readFileSync(filePath, "utf8");

  // SharedOrgChip is rendered in head beside the name with generous max-width
  assert.match(source, /head=\{<h3 className="nb-person-name-line">/);
  assert.match(source, /SharedOrgChip userId=\{person\.id\}/);
  assert.match(source, /max-w-\[320px\]/);

  // meta array only contains mutual connections and connection/footer date, preventing 3-row overlap
  const metaIndex = source.indexOf("meta={[");
  assert.notEqual(metaIndex, -1);
  const metaContent = source.slice(metaIndex, source.indexOf("]", metaIndex));
  assert.equal(metaContent.includes("SharedOrgChip"), false);
});
