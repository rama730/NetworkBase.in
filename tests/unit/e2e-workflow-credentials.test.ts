import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// OPS-002: a green E2E workflow must mean the tests ran. Fork pull requests may skip, and so may a repository that has
// not opted in with the E2E_ENABLED variable (it warns); once enabled, a missing secret fails.
for (const file of [".github/workflows/e2e-pr-gate.yml", ".github/workflows/e2e-nightly-full.yml"]) {
  test(`${file} fails on missing credentials unless the run is from a fork`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /UNTRUSTED_FORK: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.fork == true \}\}/);
    assert.match(source, /E2E_ENABLED: \$\{\{ vars\.E2E_ENABLED \}\}[\s\S]*if \[ "\$E2E_ENABLED" != "true" \]; then[\s\S]*::warning::[\s\S]*ready=false[\s\S]*exit 0/);
    const check = source.slice(source.indexOf("if [ -z"), source.indexOf('echo "ready=true"'));
    assert.match(check, /if \[ "\$UNTRUSTED_FORK" = "true" \]; then[\s\S]*ready=false[\s\S]*exit 0[\s\S]*fi[\s\S]*::error::[\s\S]*exit 1/);
  });
}
