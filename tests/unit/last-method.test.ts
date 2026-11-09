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

test("one marker for every way in: inside the button, shared styles, a dot where there is no room, nothing on the border", () => {
  const shell = read("src/components/auth/AuthShell.tsx");
  assert.match(shell, /export function LastUsedMarker\(\{ place \}: \{ place: 'oauth' \| 'primary' \| 'inline' \}\)/);
  assert.match(shell, /<LastUsedMarker place="oauth" \/>/);
  assert.match(shell, /nb-oauth-btn relative h-11 w-full justify-start font-medium/, "the provider buttons are left-aligned and are containers");
  assert.doesNotMatch(shell, /-top-2/, "the old tag that sat on the border is gone");
  const login = read("src/components/auth/LoginForm.tsx");
  assert.match(login, /<LastUsedMarker place="primary" \/>/);
  assert.match(login, /<LastUsedMarker place="inline" \/>/);
  assert.doesNotMatch(login, /LastUsedTag/);
  const css = read("src/app/globals.css");
  assert.match(css, /\.nb-last-used \{ display:inline-flex;[^}]*border:1px solid var\(--border\);[^}]*background:var\(--secondary\);[^}]*font-size:11px;/);
  assert.match(css, /\.nb-last-used\[data-place="primary"\] \{ position:absolute;/);
  assert.match(css, /\.nb-oauth-btn \{ container-type:inline-size; \}/);
  assert.match(css, /@container \(max-width:139px\) \{[^}]*\.nb-last-used\[data-place="oauth"\] \{ width:8px; height:8px;/);
  assert.match(css, /\.nb-last-used-text \{ position:absolute; width:1px; height:1px;/, "the words stay for screen readers");
});
