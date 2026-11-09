import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Report A3.4: the token goes to the OS keychain, not the file. A fake `security` / `secret-tool` stands in.
it("login keeps the token in the keychain; whoami reads it back and says where", { skip: process.platform === "win32" && "DPAPI needs Windows" }, async () => {
  const api = await startFakeServer();
  const home = await tempDir("nb-kc-home-");
  const bin = await tempDir("nb-kc-bin-");
  const vault = path.join(bin, "vault");
  const tool = process.platform === "darwin" ? "security" : "secret-tool";
  // security: add-generic-password ... -w <token>; find-generic-password ... -w. secret-tool: store (stdin) / lookup.
  fs.writeFileSync(path.join(bin, tool), `#!/bin/sh
case "$1" in
  -h|--version) exit 0;;
  add-generic-password) while [ $# -gt 0 ]; do if [ "$1" = "-w" ]; then shift; printf %s "$1" > "${vault}"; fi; shift; done;;
  store) cat > "${vault}";;
  find-generic-password|lookup) cat "${vault}";;
  delete-generic-password|clear) rm -f "${vault}";;
esac
`, { mode: 0o755 });
  try {
    Object.assign(api.state.device, { answer: "approve", afterPolls: 1, tokenType: "device" });
    const env = { NB_CREDENTIAL_STORE: "", PATH: `${bin}:${process.env.PATH}` };
    const r = await runCli(["login", "--device"], { api: api.url, home, token: null, env });
    assert.equal(r.code, 0, r.stderr);
    const file = fs.readFileSync(path.join(home, ".networkbase", "credentials.json"), "utf8");
    assert.ok(!file.includes("nb_pat_"), "no token in the file");
    assert.match(fs.readFileSync(vault, "utf8"), /^nb_pat_/);
    const who = await runCli(["whoami"], { api: api.url, home, token: null, env });
    assert.equal(who.code, 0, who.stderr);
    assert.match(who.stdout, /kept in the (macOS Keychain|system keyring)/);
    assert.equal((await runCli(["logout"], { api: api.url, home, token: null, env })).code, 0);
    assert.ok(!fs.existsSync(vault), "logout removes it");
  } finally {
    await api.close();
  }
});
