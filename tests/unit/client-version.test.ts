import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";

import { tooOldCli } from "../../src/lib/api/client-version";

it("names a CLI older than the minimum; newer, equal and other clients pass", () => {
  assert.equal(tooOldCli("cli/0.9.9", "1.0.0"), "0.9.9");
  assert.equal(tooOldCli("cli/1.0.4", "2.0.0"), "1.0.4");
  assert.equal(tooOldCli("cli/2.0.0-next.1", "2.0.0"), null);
  assert.equal(tooOldCli("cli/2.1.0", "2.0.0"), null);
  assert.equal(tooOldCli("vscode/1.0.0", "2.0.0"), null);
  assert.equal(tooOldCli(null), null);
});

it("the proxy refuses old CLIs with 426 CLIENT_TOO_OLD and states the minimum on every API answer", () => {
  const proxy = fs.readFileSync("src/proxy.ts", "utf8");
  assert.match(proxy, /tooOldCli\(request\.headers\.get\("x-nb-client"\)\)/);
  assert.match(proxy, /CLIENT_TOO_OLD[\s\S]*status: 426/);
  assert.match(proxy, /response\.headers\.set\("x-nb-min-client"/);
});
