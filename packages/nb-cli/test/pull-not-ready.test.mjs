import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// Found in the 2.1.6 live check: a workspace whose import never fetched some files stopped nb pull at the first one,
// and the files already fetched then read as conflicts. Now those files are skipped and the rest arrive.
it("nb pull skips files whose content isn't on the server yet and keeps the rest in sync", async () => {
  const api = await startFakeServer();
  try {
    putFile(api.state, "/ok.md", Buffer.from("fine\n"));
    putFile(api.state, "/later.md", Buffer.from("not yet\n"));
    /** @type {any} */ (api.state).notReady = new Set(["/later.md"]);
    const cwd = await tempDir("nb-notready-");
    const home = await tempDir("nb-notready-h-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
    const r = await runCli(["pull"], { api: api.url, cwd, home });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(cwd, "ok.md"), "utf8"), "fine\n");
    assert.match(r.stdout + r.stderr, /later\.md \(its content isn't on the server yet\)/);
    const status = await runCli(["status"], { api: api.url, cwd, home });
    assert.doesNotMatch(status.stdout, /conflict/);
  } finally { await api.close(); }
});
