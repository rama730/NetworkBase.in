import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";

import { toast } from "../../src/lib/feedback";
import { isStaleActionResponse, showStaleActionNotice, withStaleActionNotice } from "../../src/lib/deployment/stale-action";

const respond = (headers: Record<string, string> = {}) => new Response(null, { headers });

describe("isStaleActionResponse", () => {
  it("recognises the header Next.js sets when an action isn't on the server", () => {
    assert.equal(isStaleActionResponse(respond({ "x-nextjs-action-not-found": "1" })), true);
  });

  it("ignores everything else", () => {
    assert.equal(isStaleActionResponse(respond()), false);
    assert.equal(isStaleActionResponse(respond({ "x-nextjs-action-not-found": "0" })), false);
  });

  // An internal Next.js name: if an upgrade renames it, this feature would silently stop.
  it("uses the header name the installed Next.js sends", () => {
    const source = readFileSync("node_modules/next/dist/client/components/app-router-headers.js", "utf8");
    assert.match(source, /NEXT_ACTION_NOT_FOUND_HEADER = 'x-nextjs-action-not-found'/);
  });
});

describe("withStaleActionNotice", () => {
  it("returns the response untouched and notices a stale one", async () => {
    let notices = 0;
    const response = respond({ "x-nextjs-action-not-found": "1" });
    const wrapped = withStaleActionNotice(async () => response, () => { notices += 1; });
    assert.equal(await wrapped("/page", { method: "POST" }), response);
    assert.equal(notices, 1);
  });

  it("stays quiet for a normal response", async () => {
    let notices = 0;
    const wrapped = withStaleActionNotice(async () => respond(), () => { notices += 1; });
    await wrapped("/page");
    assert.equal(notices, 0);
  });

  it("passes a failed request through unchanged", async () => {
    const failure = new Error("offline");
    let notices = 0;
    const wrapped = withStaleActionNotice(async () => { throw failure; }, () => { notices += 1; });
    await assert.rejects(wrapped("/page"), (error) => error === failure);
    assert.equal(notices, 0);
  });

  it("never breaks the request if the notice itself fails", async () => {
    const response = respond({ "x-nextjs-action-not-found": "1" });
    const wrapped = withStaleActionNotice(async () => response, () => { throw new Error("no store"); });
    assert.equal(await wrapped("/page"), response);
  });
});

describe("showStaleActionNotice", () => {
  beforeEach(() => toast.clear());

  it("shows one notice however many actions fail, with a Reload button", () => {
    showStaleActionNotice();
    showStaleActionNotice();
    showStaleActionNotice();
    const toasts = toast.getToasts();
    assert.equal(toasts.length, 1);
    assert.match(String(toasts[0]!.title), /NetworkBase was updated/);
    assert.equal(toasts[0]!.action?.label, "Reload");
  });

  it("stays until the person acts, so it can't be missed", () => {
    showStaleActionNotice();
    assert.equal(toast.getToasts()[0]!.duration, Infinity);
  });
});
