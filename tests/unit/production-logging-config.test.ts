import assert from "node:assert/strict";
import { test } from "node:test";

// OPS-001: the production compiler must not strip the logger's console transport.
test("production build keeps console.error/warn/info for logger and metrics", async () => {
  const previous = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    const { default: config } = await import(`../../next.config.ts?production=${Date.now()}`);
    const removeConsole = config.compiler?.removeConsole;
    assert.ok(removeConsole && typeof removeConsole === "object", "removeConsole must be an exclude config, not true");
    for (const level of ["error", "warn", "info"]) {
      assert.ok(removeConsole.exclude?.includes(level), `console.${level} must survive the production compiler`);
    }
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = previous;
  }
});
