import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "./helpers/fake-server.mjs";
import { runCli } from "./helpers/run-cli.mjs";

// Report 21.4, 38.15 W6 (plan A6.35): nb snippets list and get.
describe("nb snippets", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */ let api;
  before(async () => {
    api = await startFakeServer();
    /** @type {any} */ (api.state).snippets = [{ slug: "retry", name: "Retry with backoff", language: "TypeScript", tags: ["network"], purpose: null, code: "await retry(fn);" }];
  });
  after(() => api.close());

  it("lists name, language and tags", async () => {
    const r = await runCli(["snippets", "list", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Retry with backoff\s+TypeScript\s+network/);
  });

  it("get prints only the code; an unknown name fails", async () => {
    const r = await runCli(["snippets", "get", "retry with backoff", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "await retry(fn);");
    const miss = await runCli(["snippets", "get", "nope", "-w", "design-lab"], { api: api.url });
    assert.notEqual(miss.code, 0);
    assert.match(miss.stderr, /No snippet named[\s\S]*nb snippets list/);
  });
});

describe("nb doc new --template", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */ let api;
  before(async () => { api = await startFakeServer(); });
  after(() => api.close());

  it("makes a doc from a template, with its title", async () => {
    const r = await runCli(["doc", "new", "--template", "tech-spec", "Sign-in", "-w", "design-lab"], { api: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Docs\/Tech spec – Sign-in\.md is a workspace doc · nb doc view tech-spec-sign-in/);
  });

  it("needs --template", async () => {
    const r = await runCli(["doc", "new", "Sign-in", "-w", "design-lab"], { api: api.url });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /nb doc templates/);
  });
});
