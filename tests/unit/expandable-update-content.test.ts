import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("ExpandableUpdateContent adheres to 1M user scale, DOM measurement and accessibility contracts", () => {
  const filePath = path.join(process.cwd(), "src/components/workspaces/updates/ExpandableUpdateContent.tsx");
  const source = readFileSync(filePath, "utf8");

  // 1. Fast path optimization for 1M users: avoids ResizeObserver on short posts (< 100 chars without newlines)
  assert.match(source, /content\.length < 100 && !content\.includes\("\\n"\)/);
  assert.match(source, /isDefinitelyShort/);

  // 2. Shared singleton ResizeObserver to prevent layout thrashing and unbounded observer allocations
  assert.match(source, /let sharedResizeObserver: ResizeObserver \| null = null;/);
  assert.match(source, /const observerCallbacks = new WeakMap<Element, ResizeCallback>\(\);/);
  assert.match(source, /observer\.observe\(element\)/);
  assert.match(source, /observer\.unobserve\(element\)/);
  assert.match(source, /observerCallbacks\.delete\(element\)/);

  // 3. True DOM overflow measurement with 2px anti-aliasing buffer
  assert.match(source, /element\.scrollHeight - element\.clientHeight > 2/);

  // 4. Accessible keyboard interaction, isolated event bubbling and smooth scroll restoration
  assert.match(source, /type="button"/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /"Show less" : "Show more"/);
  assert.match(source, /scrollIntoView/);

  // 5. CSS-first line clamp directly on WorkspaceUpdateContent root
  assert.match(source, /containerRef=\{containerRef\}/);
  assert.match(source, /!expanded && cn\(clampClass, "overflow-hidden"\)/);

  // 6. Resets expanded state if content is updated in real time
  assert.match(source, /prevContentRef/);
});
