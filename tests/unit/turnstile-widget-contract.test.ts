import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const widget = readFileSync("src/components/auth/TurnstileWidget.tsx", "utf8");
const login = readFileSync("src/components/auth/LoginForm.tsx", "utf8");

// next/script fires onLoad once per page load, so a remount (in-app navigation, a new token after a
// failed attempt) would wait forever and leave the box blank until a reload.
test("the box draws on every mount, not only the first", () => {
  assert.match(widget, /onReady=\{\(\) => setScriptReady\(true\)\}/);
  assert.doesNotMatch(widget, /onLoad=/);
});

test("the script loads as soon as the page is interactive", () => {
  assert.match(widget, /strategy="afterInteractive"/);
});

test("the box fills the form on any width and shows only when Cloudflare needs a click", () => {
  assert.match(widget, /size: window\.matchMedia\(NARROW_FORM\)\.matches \? 'compact' : 'flexible'/);
  assert.match(widget, /appearance: 'interaction-only'/);
  assert.match(widget, /'before-interactive-callback': \(\) => setInteractive\(true\)/);
  assert.match(widget, /interactive \? 'mb-4' : 'h-0 overflow-hidden'/);
  assert.doesNotMatch(widget, /Protected by Cloudflare/);
});

test("a failure can be retried without a refresh", () => {
  assert.match(widget, /The security check didn’t load/);
  assert.match(widget, /'error-callback': handleFailure/);
  assert.match(widget, /'timeout-callback': handleFailure/);
  assert.match(widget, /<button[\s\S]*?type="button"[\s\S]*?onClick=\{retry\}/);
  assert.doesNotMatch(login, /Refresh the page and try again/);
});

// A failed attempt gets a new token straight away, so clearing every error on verify would wipe "wrong password".
test("a new token clears only the security-check prompt, never a real error", () => {
  for (const file of [
    "src/components/auth/LoginForm.tsx",
    "src/components/auth/SignupForm.tsx",
    "src/app/(site)/(auth)/forgot-password/page.tsx",
  ]) {
    const form = readFileSync(file, "utf8");
    const onVerify = form.match(/key=\{captchaKey\}[\s\S]*?onVerify=\{(.*)\}/)?.[1] ?? "";
    assert.match(onVerify, /current === SECURITY_CHECK_PROMPT \? null : current/, file);
    assert.match(form, /Error\(SECURITY_CHECK_PROMPT\)/, file);
  }
});
