import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { isPlainLeftClick } from "../../src/lib/navigation/links";

const read = (file: string) => fs.readFileSync(file, "utf8");

describe("real links and instant feedback (B15, R13, R14)", () => {
  it("only a plain left click is handled in-app; modifiers and other buttons open natively", () => {
    const click = (over: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }>) =>
      ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over });
    assert.equal(isPlainLeftClick(click({})), true);
    assert.equal(isPlainLeftClick(click({ metaKey: true })), false);
    assert.equal(isPlainLeftClick(click({ ctrlKey: true })), false);
    assert.equal(isPlainLeftClick(click({ shiftKey: true })), false);
    assert.equal(isPlainLeftClick(click({ button: 1 })), false);
    assert.equal(isPlainLeftClick(click({ defaultPrevented: true })), false);
  });

  it("search results and notifications are real links", () => {
    const cards = read("src/components/layout/header/GlobalSearchResultCards.tsx");
    assert.match(cards, /<Link\s+href=\{href\}[\s\S]*?className="absolute inset-0/);
    assert.equal(cards.match(/href=\{result\.href\}/g)?.length, 6, "every result passes its address");
    const row = read("src/components/notifications/NotificationRow.tsx");
    assert.match(row, /<Link\s+href=\{item\.href\}/);
    assert.match(row, /isPlainLeftClick\(event\)/);
  });

  it("mentions in update posts let modifier clicks open a new tab", () => {
    const src = read("src/components/workspaces/updates/UpdateContent.tsx");
    assert.match(src, /if \(!isPlainLeftClick\(e\)\) return;/);
  });

  it("links to other sites in update posts open in a new tab (R13)", () => {
    const src = read("src/components/workspaces/updates/UpdateContent.tsx");
    assert.match(src, /target="_blank"\s*\n\s*rel="noopener noreferrer"/);
  });

  it("cards show a pressed state at once and a wait bar when slow (R14)", () => {
    assert.match(read("src/components/ui/LinkPending.tsx"), /useLinkStatus\(\)/);
    assert.match(read("src/app/globals.css"), /\.nb-pressable:active/);
  });
});
