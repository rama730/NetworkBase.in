import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import * as Icons from "@/components/ui/icons";
import { iconBox, iconGeometry } from "@/components/ui/icons";
import { ICON_CELLS, TASK_STATUS_CELLS, type IconKey } from "@/lib/icon-cells";

const { Check, Heart, Github, Folder, Inbox, Circle } = Icons;
const components = Object.entries(Icons).filter(([name]) => /^[A-Z]/.test(name)) as [string, Icons.IconComponent][];

test("every drawing is a square of # and . cells: 7x7 main, 6x6 small", () => {
  for (const [key, [main, small]] of Object.entries(ICON_CELLS)) {
    const rows = main.split("/");
    assert.equal(rows.length, 7, key);
    for (const r of rows) assert.match(r, /^[#.]{7}$/, key);
    if (small) for (const r of small.split("/")) assert.match(r, /^[#.]{6}$/, `${key} small`);
    assert.equal(small?.split("/").length ?? 6, 6, `${key} small rows`);
  }
  for (const [key, rows] of Object.entries(TASK_STATUS_CELLS)) assert.equal(rows.split("/").length, 6, key);
});

test("the box comes from the size prop, then the size class, then 16", () => {
  assert.equal(iconBox(20, "size-4"), 20);
  assert.equal(iconBox(undefined, "h-3.5 w-3.5 text-muted"), 14);
  assert.equal(iconBox(undefined, "size-4 sm:size-5"), 16);
  assert.equal(iconBox(undefined, "shrink-0 size-[18px]"), 18);
  assert.equal(iconBox(undefined, "nb-empty-state-icon mb-3"), 24);
  assert.equal(iconBox(undefined, undefined, { width: 32 }), 32);
  assert.equal(iconBox(undefined, "text-primary"), 16);
});

test("every icon at every size the app uses lands on whole pixels, centred", () => {
  for (const key of Object.keys(ICON_CELLS) as IconKey[]) for (const size of [8, 10, 12, 14, 15, 16, 18, 20, 24, 32, 40, 48]) {
    const g = iconGeometry(key, size);
    const nums = (g.out + g.inside).match(/-?\d+(\.\d+)?/g) ?? [];
    for (const v of nums) assert.ok(Number.isInteger(Number(v)), `${key}@${size}: ${v}`);
    assert.ok(g.out.length > 0, `${key}@${size} draws something`);
    const xs = [...g.out.matchAll(/M(\d+) /g)].map((m) => Number(m[1]));
    assert.ok(Math.min(...xs) >= 0, `${key}@${size} inside the box`);
  }
});

test("an icon with no 6x6 drawing takes 14px instead of being squeezed to 12", () => {
  const html = renderToStaticMarkup(<Heart className="size-3" />);
  assert.match(html, /width="14"/);
  assert.match(html, /style="width:14px;height:14px"/);
  assert.match(renderToStaticMarkup(<Check className="size-3" />), /width="12"/);
});

test("a heart has inside cells that fill-current paints; a check has none", () => {
  const liked = renderToStaticMarkup(<Heart className="h-3.5 w-3.5 fill-current" />);
  assert.match(liked, /class="nb-pi-in"/);
  assert.match(liked, /fill="none"/);
  assert.doesNotMatch(renderToStaticMarkup(<Check />), /nb-pi-in/);
  assert.match(renderToStaticMarkup(<Heart rise className="fill-current" />), /nb-pi-rise/);
  assert.match(renderToStaticMarkup(<Folder fill="currentColor" />), /fill="currentColor"/);
});

test("icons are hidden from screen readers unless labelled", () => {
  assert.match(renderToStaticMarkup(<Inbox />), /aria-hidden="true"/);
  assert.doesNotMatch(renderToStaticMarkup(<Inbox aria-label="Inbox" />), /aria-hidden/);
});

test("brand marks keep their line drawing; the menu dot draws at 8px", () => {
  assert.match(renderToStaticMarkup(<Github className="size-4" />), /stroke="currentColor"/);
  assert.match(renderToStaticMarkup(<Circle className="size-2 fill-current" />), /width="8"/);
});

test("every export renders", () => {
  assert.ok(components.length > 300);
  for (const [name, Icon] of components) assert.match(renderToStaticMarkup(<Icon />), /^<svg[^>]*class="nb-pi/, name);
});

test("nothing imports lucide-react any more", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs)$/.test(n) && /from\s*["']lucide-react["']/.test(readFileSync(p, "utf8"))) offenders.push(p);
    }
  };
  walk(join(process.cwd(), "src"));
  assert.deepEqual(offenders, []);
});
