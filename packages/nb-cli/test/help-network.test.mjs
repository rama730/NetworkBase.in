import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { TOPICS } from "../lib/help-topics.mjs";
import { parseFlags, resolveCommand } from "../lib/args.mjs";
import { networkEnv, proxyCapable } from "../lib/network.mjs";
import { installMethod } from "../lib/commands/misc.mjs";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report C5, C6, F7 (M4b): help topics with examples that really parse, nb upgrade, proxy and certificate settings.
describe("help topics, upgrade, network settings", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("every topic example is a real command with real flags", () => {
    for (const [name, topic] of Object.entries(TOPICS)) {
      for (const example of topic.examples) {
        const argv = (example.match(/"[^"]*"|\S+/g) ?? []).slice(1).map((a) => a.replace(/^"|"$/g, ""));
        const { spec, rest } = resolveCommand(argv);
        assert.ok(spec, `${name}: ${example}`);
        assert.doesNotThrow(() => parseFlags(/** @type {any} */ (spec), rest), `${name}: ${example}`);
      }
    }
  });

  it("nb help <topic> prints it; an unknown one names the topics", async () => {
    assert.match((await runCli(["help", "offline"], { api: api.url })).stdout, /Working offline[\s\S]*nb queue retry/);
    assert.match((await runCli(["help", "cooking"], { api: api.url })).stderr, /files, agents, classes, sign-in, offline/);
  });

  it("nb upgrade knows how nb was installed", async () => {
    assert.equal(installMethod("/home/me/.npm/_npx/abc/node_modules/@networkbase/cli/bin/nb.mjs"), "npx");
    assert.equal(installMethod("/usr/lib/node_modules/@networkbase/cli/bin/nb.mjs"), "npm");
    assert.equal(installMethod("C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@networkbase\\cli\\bin\\nb.mjs"), "npm");
    assert.equal(installMethod("/src/nb-s3/packages/nb-cli/bin/nb.mjs"), "other");
    const r = await runCli(["upgrade", "--dry-run", "--json"], { api: api.url });
    assert.equal(JSON.parse(r.stdout).data.command, "npm i -g @networkbase/cli@latest");
  });

  it("a proxy or extra certificates are set for one restart, only when needed", () => {
    assert.equal(proxyCapable("20.18.0"), false);
    assert.equal(proxyCapable("22.20.0"), false);
    assert.equal(proxyCapable("22.21.0"), true);
    assert.equal(proxyCapable("24.1.0"), true);
    assert.equal(networkEnv({}, {}, "22.22.0"), null, "nothing configured: no restart");
    assert.deepEqual(networkEnv({ proxy: "http://p:8080" }, {}, "22.22.0"), { HTTPS_PROXY: "http://p:8080", HTTP_PROXY: "http://p:8080", NODE_USE_ENV_PROXY: "1", NB_NETWORK_APPLIED: "1" });
    assert.deepEqual(networkEnv({}, { HTTPS_PROXY: "http://p" }, "22.22.0"), { NODE_USE_ENV_PROXY: "1", NB_NETWORK_APPLIED: "1" });
    assert.deepEqual(networkEnv({ "ca-file": "/etc/corp.pem" }, {}, "20.18.0"), { NODE_EXTRA_CA_CERTS: "/etc/corp.pem", NB_NETWORK_APPLIED: "1" });
    assert.equal(networkEnv({ proxy: "http://p" }, { NB_NETWORK_APPLIED: "1" }, "22.22.0"), null, "never restarts twice");
  });
});
