import { it } from "node:test";
import assert from "node:assert/strict";

import { scanForSecrets } from "../../src/lib/security/secret-scan";
import { fromPublicRole, toPublicRole } from "../../src/lib/workspaces/task-file-intelligence";

const bytes = (s: string) => new TextEncoder().encode(s);

it("finds credentials by file name and content, with the line", () => {
  assert.deepEqual(scanForSecrets("/app/.env", bytes("A=1")).map((f) => f.rule), ["Environment file"]);
  assert.deepEqual(scanForSecrets("/app/.env.example", bytes("A=1")), []);
  assert.deepEqual(scanForSecrets("/keys/id_ed25519", bytes("x")).map((f) => f.rule), ["SSH private key file"]);
  const found = scanForSecrets("/src/config.ts", bytes("const a = 1;\nconst t = 'nb_pat_0123456789abcdef0123';\n"));
  assert.deepEqual(found, [{ path: "/src/config.ts", rule: "NetworkBase token", line: 2 }]);
  assert.equal(scanForSecrets("/a.txt", bytes("sk_live_" + "a".repeat(24)))[0]?.rule, "Stripe live key");
  assert.deepEqual(scanForSecrets("/notes.md", bytes("Ordinary notes about AKIA and keys.")), []);
});

it("translates role words both ways (report D11)", () => {
  assert.equal(toPublicRole("deliverable"), "final");
  assert.equal(toPublicRole("working"), "draft");
  assert.equal(fromPublicRole("final"), "deliverable");
  assert.equal(fromPublicRole("draft"), "working");
  assert.equal(fromPublicRole("deliverable"), "deliverable");
  assert.equal(fromPublicRole("nonsense"), null);
});
