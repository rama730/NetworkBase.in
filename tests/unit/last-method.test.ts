import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LAST_SIGN_IN_KEY, LAST_SIGN_IN_TTL_MS, parseLastSignIn } from "../../src/lib/auth/last-method";

const read = (path: string) => readFileSync(path, "utf8");
const NOW = new Date(2026, 10, 10, 9, 0).getTime();

test("the last way in is read back, as a bare method (saved before the date was kept) or with its date", () => {
  assert.equal(parseLastSignIn("google", NOW), "google");
  assert.equal(parseLastSignIn(JSON.stringify({ method: "password", at: NOW - 1000 }), NOW), "password");
  for (const method of ["google", "github", "password", "code"]) assert.equal(parseLastSignIn(JSON.stringify({ method, at: NOW }), NOW), method);
});

test("after three months it is no longer 'last used', and garbage or a clock from the future is ignored", () => {
  assert.equal(parseLastSignIn(JSON.stringify({ method: "google", at: NOW - LAST_SIGN_IN_TTL_MS + 1000 }), NOW), "google");
  assert.equal(parseLastSignIn(JSON.stringify({ method: "google", at: NOW - LAST_SIGN_IN_TTL_MS - 1000 }), NOW), null);
  assert.equal(parseLastSignIn(JSON.stringify({ method: "google", at: NOW + 3_600_000 }), NOW), null);
  for (const raw of [null, undefined, "", "facebook", "{", JSON.stringify({ method: "sms", at: NOW }), JSON.stringify({ method: "google" }), "null"]) {
    assert.equal(parseLastSignIn(raw as string | null | undefined, NOW), null, String(raw));
  }
});

test("signing out clears the device but keeps the last way in, because the marker is for the page after signing out", () => {
  const cache = read("src/lib/utils/cache-manager.ts");
  assert.match(cache, /import \{ LAST_SIGN_IN_KEY \} from "@\/lib\/auth\/last-method"/);
  assert.match(cache, /SIGNIN_PLAYED_KEY,\s*\/\/[^\n]*\n\s*LAST_SIGN_IN_KEY,/);
  assert.equal(LAST_SIGN_IN_KEY, "nb_last_sign_in");
});

test("one marker for every way in: a chip on the top edge, buttons untouched, inline only on the code link", () => {
  const shell = read("src/components/auth/AuthShell.tsx");
  assert.match(shell, /export function LastUsedMarker\(\{ place \}: \{ place: 'edge' \| 'inline' \}\)/);
  assert.match(shell, /<LastUsedMarker place="edge" \/>/);
  assert.match(shell, /className="relative h-11 w-full font-medium" onClick=\{\(\) => void start\(provider\)\}/, "the provider buttons are as they were: centred, full width of their cell");
  assert.doesNotMatch(shell, /justify-start|nb-oauth-btn|-top-2/, "no left-aligning, no container, no old tag");
  const login = read("src/components/auth/LoginForm.tsx");
  assert.match(login, /<LastUsedMarker place="edge" \/>/);
  assert.match(login, /<LastUsedMarker place="inline" \/>/);
  assert.doesNotMatch(login, /LastUsedTag/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.nb-last-used \{ display:inline-flex;[^}]*border:1px solid var\(--border\);[^}]*background:var\(--card\);[^}]*font-size:11px;/);
  assert.match(css, /\.nb-last-used\[data-place="edge"\] \{ position:absolute; top:-10px; right:10px; \}/);
  assert.match(css, /\.nb-last-used\[data-place="inline"\] \{ margin-left:4px; \}/);
  assert.doesNotMatch(css, /container-type:inline-size; \}\s*@container \(max-width:139px\)/);
});
