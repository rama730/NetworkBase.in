import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import * as Sentry from "@sentry/nextjs";

import { reportInngestFailure } from "../../src/inngest/functions/report-failure-to-sentry";
import { scrubEvent } from "../../src/lib/observability/sentry-options";

describe("reportInngestFailure", () => {
  const events: Sentry.ErrorEvent[] = [];

  const delivered = async () => {
    await Sentry.flush(1000);
    return events.splice(0);
  };

  before(() => {
    Sentry.init({
      dsn: "https://key@example.ingest.sentry.io/1",
      defaultIntegrations: false,
      skipOpenTelemetrySetup: true,
      beforeSend(event) {
        events.push(scrubEvent(event));
        return null;
      },
    });
  });

  after(() => Sentry.close(1000));

  it("rebuilds the error and groups by job", async () => {
    reportInngestFailure({
      function_id: "nb-s3-email-delivery",
      run_id: "run-1",
      error: { name: "TypeError", message: "bad value", stack: "TypeError: bad value\n    at send (/app/mail.js:3:7)" },
    });
    const [event] = await delivered();
    assert.equal(event.exception?.values?.[0]?.type, "TypeError");
    assert.equal(event.exception?.values?.[0]?.value, "bad value");
    assert.equal(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.function, "send");
    assert.deepEqual(event.fingerprint, ["inngest", "nb-s3-email-delivery"]);
    assert.equal(event.tags?.function_id, "nb-s3-email-delivery");
    assert.equal(event.tags?.run_id, "run-1");
  });

  it("scrubs secrets from the failure message", async () => {
    reportInngestFailure({
      function_id: "nb-s3-email-delivery",
      run_id: "run-2",
      error: { message: "failed token=abc123" },
    });
    const [event] = await delivered();
    assert.ok(!JSON.stringify(event).includes("abc123"));
  });

  it("ignores its own failure, so it cannot loop", async () => {
    reportInngestFailure({
      function_id: "nb-s3-report-failure-to-sentry",
      run_id: "run-3",
      error: { message: "reporter broke" },
    });
    assert.equal((await delivered()).length, 0);
  });
});

it("runs on the worker with the other background jobs", () => {
  const registry = readFileSync("src/inngest/registry.ts", "utf8");
  assert.match(registry, /const \{ reportFailureToSentry \} = loadModule\("\.\/functions\/report-failure-to-sentry"\)/);
  assert.match(registry, /^\s+reportFailureToSentry,$/m);
});
