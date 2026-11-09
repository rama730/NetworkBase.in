import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { rememberDeparture, takeDeparture } from "../../src/lib/navigation/external-return";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

const from = { path: "/settings?tab=integrations", title: "Settings · NetworkBase" };

describe("round trips to GitHub (R4)", () => {
  it("skip lands on the departure entry", () => {
    const store = memoryStore();
    rememberDeparture(store, 5, 1_000, from);
    assert.deepEqual(takeDeparture(store, 8, 2_000), { skip: 3, from });
  });

  it("stale departure ignored (older than 10 minutes)", () => {
    const store = memoryStore();
    rememberDeparture(store, 5, 0, from);
    assert.equal(takeDeparture(store, 8, 10 * 60_000 + 1), null);
  });

  it("non-positive skip ignored", () => {
    const store = memoryStore();
    rememberDeparture(store, 8, 0, from);
    assert.equal(takeDeparture(store, 8, 1), null);
  });

  it("one-shot", () => {
    const store = memoryStore();
    rememberDeparture(store, 5, 0, from);
    assert.ok(takeDeparture(store, 8, 1));
    assert.equal(takeDeparture(store, 8, 2), null);
  });

  it("every way out to GitHub records the departure first", () => {
    assert.match(fs.readFileSync("src/lib/auth/oauth.ts", "utf8"), /noteExternalDeparture\(\)\s*\n\s*window\.location\.assign\(resolvedTargetUrl\.href\)/);
    const client = fs.readFileSync("src/lib/github/oauth-client.ts", "utf8");
    assert.equal(client.match(/noteExternalDeparture\(\);\s*\n\s*window\.location\.assign/g)?.length, 2);
    assert.match(fs.readFileSync("src/lib/navigation/in-app-history.ts", "utf8"), /takeDeparture\(/);
  });
});
