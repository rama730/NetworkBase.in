import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import * as Sentry from "@sentry/nextjs";

import { logger } from "../../src/lib/logger";
import { scrubEvent } from "../../src/lib/observability/sentry-options";

const quiet = () => {};

describe("logger.error and Sentry", () => {
  const events: Sentry.ErrorEvent[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;

  const delivered = async () => {
    await Sentry.flush(1000);
    return events.splice(0);
  };

  before(() => {
    console.error = quiet;
    console.warn = quiet;
  });

  after(async () => {
    console.error = originalError;
    console.warn = originalWarn;
    await Sentry.close(1000);
  });

  // Has to run first: nothing has started Sentry yet.
  it("does nothing when Sentry was never started", () => {
    assert.doesNotThrow(() => logger.error("not.started", { error: new Error("boom") }));
  });

  describe("once Sentry is started", () => {
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

    it("sends only sanitized context and scrubbed text", async () => {
      logger.error("files.upload.failed", {
        module: "files",
        userId: "user-1",
        password: "p4ss-value",
        email: "person@example.com",
        error: new Error("failed token=abc123"),
      });
      const [event] = await delivered();
      const text = JSON.stringify(event);
      for (const leaked of ["p4ss-value", "person@example.com", "abc123"]) {
        assert.ok(!text.includes(leaked), leaked);
      }
      assert.equal(event.user?.id, "user-1");
      assert.equal(event.extra?.module, "files");
      assert.deepEqual(event.fingerprint, ["logger", "files.upload.failed"]);
    });

    it("sends a message when no Error was logged, scrubbing its fingerprint too", async () => {
      logger.error("export failed token=abc123", { module: "exports" });
      const [event] = await delivered();
      assert.equal(event.level, "error");
      assert.ok(!JSON.stringify(event).includes("abc123"));
    });

    it("sends an Error passed as the first argument with its stack", async () => {
      logger.error(new Error("direct.error"));
      const [event] = await delivered();
      assert.equal(event.exception?.values?.[0]?.value, "direct.error");
      assert.ok(event.exception?.values?.[0]?.stacktrace?.frames?.length);
    });

    it("sends the same Error object once", async () => {
      const error = new Error("twice");
      logger.error("first.log", { error });
      logger.error("second.log", { error });
      assert.equal((await delivered()).length, 1);
    });

    it("does not send warnings", async () => {
      logger.warn("only.a.warning", { module: "files" });
      assert.equal((await delivered()).length, 0);
    });
  });
});
