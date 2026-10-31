import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import * as Sentry from "@sentry/nextjs";
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

  it("keeps only the opaque user id, never an IP address, email or name", () => {
    const event = scrubEvent({
      type: undefined,
      user: { id: "user-1", ip_address: "203.0.113.9", email: "a@b.c", username: "person", geo: { city: "Pune" } },
      request: { env: { REMOTE_ADDR: "203.0.113.9" } },
    });
    assert.deepEqual(event.user, { id: "user-1", geo: {} });
    assert.ok(!JSON.stringify(event).includes("203.0.113.9"));
  });

  it("stops location being worked out even when there is no user", () => {
    assert.deepEqual(scrubEvent({ type: undefined }).user, { geo: {} });
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

  it("is on for a DSN", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = " https://key@example.ingest.sentry.io/1 ";
    const options = baseSentryOptions();
    assert.equal(isSentryEnabled(), true);
    assert.equal(options.enabled, true);
    assert.equal(options.dsn, "https://key@example.ingest.sentry.io/1");
  });

  // Every one of these defaults to on in Sentry 11, and sendDefaultPii no longer controls them.
  it("turns off every kind of personal data Sentry collects by default", () => {
    assert.deepEqual(baseSentryOptions().dataCollection, {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it("leaves no data collection option at its default", () => {
    const client = new Sentry.NodeClient({
      dsn: "https://key@example.ingest.sentry.io/1",
      integrations: [],
      stackParser: () => [],
      transport: () => ({ send: async () => ({}), flush: async () => true }),
      dataCollection: baseSentryOptions().dataCollection,
    });
    const { frameContextLines, ...collected } = client.getDataCollectionOptions();
    assert.equal(frameContextLines, 5, "source lines from our own code are the one thing kept");
    assert.ok(!/true/.test(JSON.stringify(collected)), JSON.stringify(collected));
  });

  it("drops the logger's own console line, which logger.error already reported", () => {
    const { beforeSend } = baseSentryOptions();
    const hint = {};
    assert.equal(beforeSend({ type: undefined, logger: "console", extra: { arguments: ["[logger]", {}] } }, hint), null);
    assert.ok(beforeSend({ type: undefined, logger: "console", message: "[files] failed", extra: { arguments: ["[files] failed"] } }, hint));
    assert.ok(beforeSend({ type: undefined }, hint));
  });

  it("titles and groups a console error by its own message", () => {
    const { beforeSend } = baseSentryOptions();
    const event = beforeSend(
      {
        type: undefined,
        logger: "console",
        message: "[files] upload failed token=abc123 [object Object]",
        extra: { arguments: ["[files] upload failed token=abc123", {}] },
        exception: { values: [{ value: "[files] upload failed token=abc123 [object Object]", mechanism: { type: "console", synthetic: true } }] },
      },
      {},
    );
    assert.deepEqual(event?.fingerprint, ["console", "[files] upload failed token=[REDACTED] [object Object]"]);
    assert.equal(event?.exception?.values?.[0]?.type, "console.error");
    assert.equal(event?.exception?.values?.[0]?.mechanism?.synthetic, false);
  });

  it("leaves a real Error logged to the console with its own title and grouping", () => {
    const event = baseSentryOptions().beforeSend(
      {
        type: undefined,
        logger: "console",
        extra: { arguments: [new Error("boom")] },
        exception: { values: [{ type: "TypeError", value: "boom", mechanism: { type: "auto.core.capture_console" } }] },
      },
      {},
    );
    assert.equal(event?.fingerprint, undefined);
    assert.equal(event?.exception?.values?.[0]?.type, "TypeError");
  });

  it("does not mistake a browser timeout error, which also carries arguments, for a console error", () => {
    const event = baseSentryOptions().beforeSend(
      {
        type: undefined,
        extra: { arguments: [] },
        exception: { values: [{ type: "Error", value: "boom", mechanism: { type: "auto.browser.browserapierrors.setTimeout" } }] },
      },
      {},
    );
    assert.equal(event?.fingerprint, undefined);
    assert.equal(event?.exception?.values?.[0]?.type, "Error");
  });

  it("reports as production unless the environment is overridden", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    assert.equal(baseSentryOptions().environment, "production");
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = "verification";
    assert.equal(baseSentryOptions().environment, "verification");
  });
});
