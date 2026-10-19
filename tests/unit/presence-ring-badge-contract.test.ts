import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const badge = read("src/components/presence/PresenceBadge.tsx");
const css = read("src/app/globals.css");
const person = read("src/components/presence/PersonPresence.tsx");

test("ring badge draws four rings, each a gray track plus colored arcs", () => {
  assert.match(badge, /^"use client";/);
  assert.match(badge, /viewBox="205 270 880 880"/);
  for (const radius of [135, 240, 330, 413]) assert.match(badge, new RegExp(`r: ${radius}\\b`));
  assert.match(badge, /className="nb-presence-ring"/);
  assert.match(badge, /className="nb-presence-track"/);
  assert.match(badge, /className="nb-presence-arc"/);
});

test("ring badge keeps its accessible name, test id and availability hook", () => {
  assert.match(badge, /role=\{label \? "img" : undefined\}/);
  assert.match(badge, /aria-label=\{label\}/);
  assert.match(badge, /title=\{label\}/);
  assert.match(badge, /data-testid=\{testId\}/);
  assert.match(badge, /data-availability=\{availability\}/);
});

test("rings spin only through advanceBadgeSpin, never on the first render or before data loads", () => {
  assert.match(badge, /advanceBadgeSpin\(/);
  assert.match(badge, /animate = true/);
  assert.match(badge, /rotate\(\$\{spin\.angle\}deg\)/);
  assert.match(badge, /key=\{spin\.halo\}/);
  assert.match(person, /animate=\{presence\.loaded\}/);
});

test("the status emoji chip renders only through showStatusChip", () => {
  assert.match(badge, /showStatusChip\(statusEmoji, size\)/);
  assert.match(badge, /className="nb-presence-chip"/);
  assert.match(person, /statusEmoji=\{presence\.status\?\.emoji\}/);
  assert.match(person, /statusEmoji=\{presence\.status\?\.emoji\}[\s\S]*ProjectPresenceBadge|ProjectPresenceBadge[\s\S]*statusEmoji=\{presence\.status\?\.emoji\}/);
});

test("one hue per state with a dark override for every token", () => {
  for (const state of ["now", "today", "week", "offline"]) {
    const token = state === "offline" ? "off" : state;
    assert.match(css, new RegExp(`\\.nb-presence\\[data-availability="${state}"\\] \\{ --presence-arc:var\\(--presence-${token}\\); \\}`));
  }
  const dark = css.slice(css.indexOf(".dark {", css.indexOf("Presence ring badge")));
  const darkBlock = dark.slice(0, dark.indexOf("}"));
  for (const token of ["now", "today", "week", "off", "chip", "track"]) assert.match(darkBlock, new RegExp(`--presence-${token}:`));
});

test("ring and arc transitions: 1.1s spin, staggered inner to outer, reduced motion keeps only the color fade", () => {
  assert.match(css, /\.nb-presence-ring \{[^}]*transition:transform 1\.1s cubic-bezier\(\.45,\.05,\.2,1\)/);
  assert.match(css, /\.nb-presence-arc \{[^}]*transition:stroke 1s ease/);
  for (const [index, delay] of [[2, ".088s"], [3, ".176s"], [4, ".264s"]]) {
    assert.match(css, new RegExp(`\\.nb-presence-svg > \\.nb-presence-ring:nth-child\\(${index}\\) \\{ transition-delay:${delay.replace(".", "\\.")}; \\}`));
  }
  assert.match(css, /@keyframes nb-presence-halo/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{[^}]*\.nb-presence-ring \{ transition:none; \}[^}]*\.nb-presence-halo \{ display:none; \}/);
});

test("badge sizes per place follow the approved table", () => {
  assert.match(person, /if \(avatarSize <= 24\) return 11;/);
  assert.match(person, /if \(avatarSize <= 40\) return 14;/);
  assert.match(person, /if \(avatarSize <= 64\) return 20;/);
  assert.match(person, /return 26;/);
  assert.match(read("src/components/network/PersonPresenceDot.tsx"), /size=\{compact \? 16 : 20\}/);
  assert.match(read("src/components/layout/header/TopNav.tsx"), /<PersonPresenceBadge userId=\{user\?\.id\} live size=\{16\}/);
  assert.match(read("src/components/profile/v2/ProfileHeader.tsx"), /live=\{isOwner \|\| undefined\} size=\{24\}/);
});
