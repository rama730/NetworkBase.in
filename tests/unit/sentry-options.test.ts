import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { ErrorEvent } from "@sentry/nextjs";

import { baseSentryOptions, isSentryEnabled, scrubEvent } from "../../src/lib/observability/sentry-options";

describe("scrubEvent", () => {
  const scrubbed = (event: ErrorEvent) => JSON.stringify(scrubEvent(event));

  it("removes secrets from the message and exception values", () => {
    const text = scrubbed({
      type: undefined,
      message: "failed token=abc123",
      exception: { values: [{ value: "Bearer abcdefgh12345678" }] },
    });
    assert.ok(!text.includes("abc123"));
    assert.ok(!text.includes("abcdefgh12345678"));
  });

  it("removes the query string, cookies, headers and body from the request", () => {
    const text = scrubbed({
      type: undefined,
      request: {
        url: "https://networkbase.in/a?code=secret",
        query_string: "code=secret",
        cookies: { session: "cookie-value" },
        headers: { cookie: "session=cookie-value" },
        data: "request-body",
      },
    });
    for (const leaked of ["code=secret", "cookie-value", "request-body"]) {
      assert.ok(!text.includes(leaked), leaked);
    }
    assert.ok(text.includes("https://networkbase.in/a"));
  });

  it("removes raw console arguments and console breadcrumbs", () => {
    const text = scrubbed({
      type: undefined,
      extra: { arguments: ["raw-argument"], module: "files" },
      breadcrumbs: [
        { category: "console", message: "raw-console-line" },
        { category: "ui.click", message: "button" },
      ],
    });
    assert.ok(!text.includes("raw-argument"));
    assert.ok(!text.includes("raw-console-line"));
    assert.ok(text.includes("ui.click"));
    assert.ok(text.includes("files"));
  });

  it("removes query strings from breadcrumb URLs", () => {
    const text = scrubbed({
      type: undefined,
      breadcrumbs: [
        { category: "fetch", data: { url: "https://x.io/y?key=value", method: "GET" } },
        { category: "navigation", data: { from: "/a?invite=one", to: "/b?invite=two" } },
      ],
    });
    assert.ok(!text.includes("key=value"));
    assert.ok(!text.includes("invite="));
    assert.ok(text.includes("https://x.io/y"));
  });
});

describe("baseSentryOptions", () => {
  let original: string | undefined;
  let originalEnvironment: string | undefined;

  beforeEach(() => {
    original = process.env.NEXT_PUBLIC_SENTRY_DSN;
    originalEnvironment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = original;
    if (originalEnvironment === undefined) delete process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    else process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = originalEnvironment;
  });

  it("is off for a missing or blank DSN", () => {
    for (const dsn of [undefined, "", "   "]) {
      if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
      else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
      assert.equal(isSentryEnabled(), false);
      assert.equal(baseSentryOptions().enabled, false);
    }
  });

  it("is on for a DSN and never sends default personal data", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = " https://key@example.ingest.sentry.io/1 ";
    const options = baseSentryOptions();
    assert.equal(isSentryEnabled(), true);
    assert.equal(options.enabled, true);
    assert.equal(options.dsn, "https://key@example.ingest.sentry.io/1");
    assert.equal(options.sendDefaultPii, false);
  });

  it("drops the logger's own console line, which logger.error already reported", () => {
    const { beforeSend } = baseSentryOptions();
    const hint = {};
    assert.equal(beforeSend({ type: undefined, extra: { arguments: ["[logger]", {}] } }, hint), null);
    assert.ok(beforeSend({ type: undefined, extra: { arguments: ["[files] failed"] } }, hint));
    assert.ok(beforeSend({ type: undefined }, hint));
  });

  it("reports as production unless the environment is overridden", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    assert.equal(baseSentryOptions().environment, "production");
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = "verification";
    assert.equal(baseSentryOptions().environment, "verification");
  });
});
