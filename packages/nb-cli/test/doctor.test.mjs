import { it } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report A6.4: nb doctor names each problem with its fix; --json for support.
it("nb doctor checks node, server, sign-in, folder, names, disk, role, agents, proxy and certificates", async () => {
  const api = await startFakeServer();
  try {
    const cwd = await tempDir("nb-doctor-");
    const home = await tempDir("nb-doctor-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    const r = await runCli(["doctor", "--json"], { api: api.url, cwd, home, env: { HTTPS_PROXY: "http://proxy.local:8080", NODE_EXTRA_CA_CERTS: "/nope/ca.pem" } });
    const checks = Object.fromEntries(JSON.parse(r.stdout).data.checks.map((/** @type {any} */ c) => [c.check, c]));
    for (const name of ["Node", "Version", "Proxy", "Certificates", "Server", "Clock", "Signed in", "Folder", "State", "Names", "Disk", "Role", "Agents"]) assert.ok(checks[name], `${name} checked`);
    assert.equal(checks.Proxy.ok, false);
    assert.match(checks.Proxy.fix, /NODE_USE_ENV_PROXY=1/);
    assert.equal(checks.Certificates.ok, false);
    assert.match(checks.Role.detail, /owner/);
    assert.equal(r.code, 1, "a failed check exits 1");
  } finally {
    await api.close();
  }
});
