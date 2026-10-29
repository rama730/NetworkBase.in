import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const badge = read("src/components/presence/PresenceBadge.tsx");
const css = read("src/app/globals.css");
const person = read("src/components/presence/PersonPresence.tsx");
const hook = read("src/components/presence/usePresence.ts");
const action = read("src/app/actions/presence.ts");

test("ring badge draws four full rings, each a gray track plus colored arcs", () => {
  assert.match(badge, /^"use client";/);
  assert.match(badge, /viewBox="205 270 880 880"/);
  for (const radius of [135, 240, 330, 413]) assert.match(badge, new RegExp(`r: ${radius}\\b`));
  for (const radius of [237, 303, 366, 428]) assert.match(badge, new RegExp(`rs: ${radius}\\b`));
  assert.match(badge, /className="nb-presence-ring"/);
  assert.match(badge, /className="nb-presence-track"/);
  assert.match(badge, /className="nb-presence-arc"/);
  assert.match(css, /\.nb-presence-arc \{[^}]*stroke-dasharray:360 0/);
});

test("ring badge keeps its accessible name, test id and availability hooks", () => {
  assert.match(badge, /role=\{label \? "img" : undefined\}/);
  assert.match(badge, /aria-label=\{label\}/);
  assert.match(badge, /title=\{label\}/);
  assert.match(badge, /data-testid=\{testId\}/);
  assert.match(badge, /data-availability=\{availability\}/);
  assert.match(badge, /data-from=\{spin\.from\}/);
});

test("rings turn only through advanceBadgeSpin, never on first render, before data loads, or over the budget", () => {
  assert.match(badge, /advanceBadgeSpin\(/);
  assert.match(badge, /animate = true/);
  assert.match(badge, /rotate\(\$\{spin\.angle\}deg\)/);
  assert.match(badge, /motionBudget\.take\(\)/);
  assert.match(badge, /IntersectionObserver/);
  assert.match(badge, /key=\{spin\.halo\}/);
  assert.match(person, /animate=\{presence\.settled\}/);
});

test("ring weight and wave order come from the model, not from CSS copies", () => {
  assert.match(badge, /ringWeight\(availability\)/);
  assert.match(badge, /ringOrder\(index, spin\.dir\)/);
  assert.match(badge, /"--order"/);
});

test("status emoji sits inside the rings, only through showStatusEmoji, growing through statusBadgeSize", () => {
  assert.doesNotMatch(badge, /nb-presence-chip/);
  assert.match(badge, /statusBadgeSize\(size, statusSize, statusEmoji\)/);
  assert.match(badge, /showStatusEmoji\(statusEmoji, px\)/);
  assert.match(badge, /className="nb-presence-emoji"/);
  assert.match(badge, /data-status=\{open \? "" : undefined\}/);
  assert.doesNotMatch(css, /\.nb-presence-chip/);
  assert.match(person, /statusEmoji=\{presence\.status\?\.emoji\}/);
  assert.match(person, /statusSize=\{statusSize\}/);
  assert.match(person, /statusSize=\{size >= 32 \? 20 : undefined\}/);
});

test("timer ring and dotted ring come from the status's end time, start time and notification pause", () => {
  assert.match(badge, /statusTimerFraction\(/);
  assert.match(badge, /useNow\(/);
  assert.match(badge, /<mask/);
  assert.match(badge, /0\.1 11\.9/);
  assert.match(person, /statusTimer=\{presence\.statusTimer\}/);
  assert.match(person, /statusPaused=\{presence\.status\?\.pausesNotifications\}/);
  assert.match(hook, /statusTimer:/);
  assert.match(hook, /export function useNow/);
  assert.match(action, /status_set_at/);
  assert.match(action, /setAt:/);
});

test("the heartbeat ripple follows data refreshes for Active now badges of 20px or more", () => {
  assert.match(badge, /pulseKey/);
  assert.match(badge, /availability === "now"/);
  assert.match(person, /pulseKey=\{presence\.updatedAt\}/);
  assert.match(hook, /updatedAt:/);
  assert.match(css, /@keyframes nb-presence-ripple-a/);
  assert.match(css, /@keyframes nb-presence-ripple-b/);
});

test("one hue per state with a dark override for every token", () => {
  for (const state of ["now", "today", "week", "offline"]) {
    const token = state === "offline" ? "off" : state;
    assert.match(css, new RegExp(`\\.nb-presence\\[data-availability="${state}"\\] \\{ --presence-arc:var\\(--presence-${token}\\); \\}`));
    assert.match(css, new RegExp(`\\.nb-presence\\[data-from="${state}"\\] \\{ --presence-from:var\\(--presence-${token}\\); \\}`));
  }
  const dark = css.slice(css.indexOf(".dark {", css.indexOf("Presence ring badge")));
  const darkBlock = dark.slice(0, dark.indexOf("}"));
  for (const token of ["now", "today", "week", "off", "chip", "track"]) assert.match(darkBlock, new RegExp(`--presence-${token}:`));
});

test("a change shrinks the rings to their arcs, spins them, grows them back, with a staggered wave, a pop and a halo", () => {
  assert.match(css, /\.nb-presence-ring \{[^}]*transition:transform \.98s cubic-bezier\(\.45,\.05,\.2,1\) calc\(\.17s \+ var\(--order, 0\) \* \.09s\)/);
  for (const name of ["a", "b"]) {
    assert.match(css, new RegExp(`\\.nb-presence-badge\\[data-cycle="${name}"\\] \\.nb-presence-arc \\{[^}]*nb-presence-arc-${name} 1\\.44s ease-in-out calc\\(var\\(--order, 0\\) \\* \\.09s\\) both`));
    assert.match(css, new RegExp(`@keyframes nb-presence-arc-${name} \\{`));
    assert.match(css, new RegExp(`@keyframes nb-presence-pop-${name} \\{`));
  }
  assert.match(css, /\.nb-presence-halo \{[^}]*animation:nb-presence-halo \.9s ease-out 1\.65s 1 both/);
  assert.match(css, /@keyframes nb-presence-halo/);
});

test("status moves: rings open over .7s, emoji pops in, badge size eases, reduced motion keeps only the fades", () => {
  assert.match(css, /\.nb-presence-svg circle \{[^}]*r \.7s ease/);
  assert.match(css, /\.nb-presence-badge \{[^}]*transition:width \.4s ease, height \.4s ease/);
  assert.match(css, /\.nb-presence-emoji \{[^}]*animation:nb-presence-emoji-pop \.7s cubic-bezier\(\.34,1\.56,\.64,1\) both/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{[^@]*\.nb-presence-halo \{ display:none; \}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{[^@]*animation:none !important/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{[^@]*\.nb-presence-ring \{ transition:none; \}/);
});

test("badge sizes per place follow the approved table", () => {
  assert.match(person, /if \(avatarSize <= 24\) return 11;/);
  assert.match(person, /if \(avatarSize <= 40\) return 14;/);
  assert.match(person, /if \(avatarSize <= 64\) return 20;/);
  assert.match(person, /return 26;/);
  assert.match(read("src/components/network/PersonPresenceDot.tsx"), /size=\{compact \? 16 : 20\} statusSize=\{20\}/);
  assert.match(read("src/components/layout/header/TopNav.tsx"), /<PersonPresenceBadge userId=\{user\?\.id\} live size=\{16\} statusSize=\{20\}/);
  assert.match(read("src/components/profile/v2/ProfileHeader.tsx"), /live=\{isOwner \|\| undefined\} size=\{30\}/);
  const project = read("src/components/workspaces/WorkspaceAvatar.tsx");
  assert.match(project, /standalone \? 14 : compact \? 18 : 30/);
  assert.match(project, /Math\.round\(size \* 0\.2\)/);
  assert.match(project, /statusSize=\{standalone \? undefined : 20\}/);
});

test("while presence data loads: a gray placeholder, then gray arcs that spin, then a settle into the real state", () => {
  assert.match(badge, /data-phase=\{phase\}/);
  assert.match(badge, /LOADING_SHOW_AFTER_MS/);
  assert.match(badge, /LOADING_GIVE_UP_MS/);
  assert.match(badge, /loadingSettlePlan\(/);
  assert.match(badge, /const SETTLE_MS = 900/);
  assert.match(badge, /const FADE_MS = 600/);
  assert.match(badge, /className="nb-presence-spin"/);
  assert.match(badge, /DOMMatrix/);
  assert.match(badge, /setLoadHalo\(true\)/);
  // transform-box: view-box measures from the user-space origin, not the viewBox corner, so the pivot is the rings' centre in px.
  assert.match(css, /\.nb-presence-spin \{ transform-box:view-box; transform-origin:645px 710px; \}/);
  assert.match(css, /\.nb-presence-halo\[data-load\] \{ animation-delay:0s; \}/);
  assert.match(badge, /useLayoutEffect/);
  assert.match(badge, /data-reverse=\{index % 2 \? "" : undefined\}/);
  assert.match(badge, /data-paused=\{onScreen \? undefined : ""\}/);
  assert.match(css, /\.nb-presence-badge\[data-phase="wait"\], \.nb-presence-badge\[data-phase="load"\] \{[^}]*--presence-arc:var\(--presence-off\)[^}]*--presence-weight:\.6/);
  assert.match(css, /\.nb-presence-badge\[data-phase="wait"\] \.nb-presence-ring \{ opacity:\.55; \}/);
  assert.match(css, /\.nb-presence-badge\[data-phase="load"\] \.nb-presence-arc \{[^}]*nb-presence-load-in \.25s/);
  assert.match(css, /\.nb-presence-badge\[data-phase="load"\] \.nb-presence-spin \{[^}]*nb-presence-load-spin calc\(2\.6s \/ \(1 \+ var\(--i, 0\) \* \.12\)\) linear infinite/);
  assert.match(css, /\.nb-presence-badge\[data-phase="settle"\] \.nb-presence-arc \{[^}]*nb-presence-settle \.9s/);
  assert.match(css, /@keyframes nb-presence-load-in/);
  assert.match(css, /@keyframes nb-presence-load-spin/);
  assert.match(css, /@keyframes nb-presence-settle/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\) \{[^@]*\.nb-presence-spin[^@]*animation:none !important/);
});

test("only people badges load: projects already know their activity", () => {
  assert.match(person, /animate=\{presence\.settled\}/);
  const projectBadge = person.slice(person.indexOf("export function WorkspacePresenceBadge"));
  assert.doesNotMatch(projectBadge, /animate=/);
});

test("a failed or refused presence request ends the loading state instead of leaving the loader up", () => {
  assert.match(hook, /settled: Boolean\(data\) \|\| query\.isError/);
  assert.match(hook, /retry: retryPresence/);
  assert.match(person, /animate=\{presence\.settled\}/);
  assert.doesNotMatch(person, /animate=\{presence\.loaded\}/);
});
