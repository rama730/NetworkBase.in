import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { csvCell, downloadFailureMessage, downloadFile, retryMessage, saveBlob, toCsvBlob } from "../../src/lib/download";
import { FEEDBACK_COPY } from "../../src/lib/feedback/copy";

type Link = { href: string; download: string; clicked: boolean; style: Record<string, string>; click(): void; remove(): void };
let links: Link[];
const realFetch = globalThis.fetch;
const stubbed = globalThis as unknown as Record<string, unknown>;
const stubFetch = (result: number | Error) => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (result instanceof Error) throw result;
    return { status: result, headers: new Headers() };
  }) as typeof fetch;
  return calls;
};

beforeEach(() => {
  links = [];
  stubbed.window = { location: { origin: "https://app.test" } };
  stubbed.document = {
    body: { appendChild: () => undefined },
    createElement: () => {
      const link: Link = { href: "", download: "", clicked: false, style: {}, click() { this.clicked = true; }, remove() {} };
      links.push(link);
      return link;
    },
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete stubbed.window;
  delete stubbed.document;
});

test("a permitted download checks first, then saves from the attachment URL", async () => {
  const calls = stubFetch(200);
  assert.equal(await downloadFile("/api/v1/chat/attachments/a?x=1", { filename: "a.pdf" }), true);
  assert.equal(calls[0]![0], "/api/v1/chat/attachments/a?x=1&download=1");
  assert.equal(calls[0]![1]!.method, "HEAD");
  assert.equal(links.length, 1);
  assert.equal(links[0]!.href, "/api/v1/chat/attachments/a?x=1&download=1");
  assert.equal(links[0]!.download, "a.pdf");
  assert.equal(links[0]!.clicked, true);
});

test("a refused or failed download saves nothing and stays on the page", async () => {
  for (const status of [401, 403, 404, 413, 429, 500, 502]) {
    stubFetch(status);
    assert.equal(await downloadFile("/f"), false, String(status));
  }
  stubFetch(new TypeError("offline"));
  assert.equal(await downloadFile("/f"), false);
  assert.equal(links.length, 0);
});

test("a double click starts one download", async () => {
  const calls = stubFetch(200);
  const results = await Promise.all([downloadFile("/f"), downloadFile("/f")]);
  assert.deepEqual(results, [true, false]);
  assert.equal(calls.length, 1);
  assert.equal(links.length, 1);
  assert.equal(await downloadFile("/f"), true, "a later click is a new download");
});

test("a file not served by this app is saved directly", async () => {
  const calls = stubFetch(200);
  assert.equal(await downloadFile("https://other.test/f.png", { filename: "f.png" }), true);
  assert.equal(calls.length, 0);
  assert.equal(links[0]!.href, "https://other.test/f.png");
});

test("a local preview of a file still uploading saves as it is", async () => {
  const calls = stubFetch(200);
  assert.equal(await downloadFile("blob:https://app.test/abc", { filename: "f.pdf" }), true);
  assert.equal(calls.length, 0);
  assert.equal(links[0]!.href, "blob:https://app.test/abc");
});

test("each failure says what happened, in reviewed copy", () => {
  for (const status of [401, 403, 404, 410, 413, 429, 500]) {
    const message = downloadFailureMessage(status);
    assert.ok(FEEDBACK_COPY[message], message);
  }
  assert.equal(downloadFailureMessage(429), "Too many downloads");
  assert.equal(downloadFailureMessage(403), "You don’t have access to this");
});

test("a saved blob keeps its URL long enough for slower browsers", () => {
  const urls = { created: 0, revoked: 0 };
  const realTimeout = globalThis.setTimeout;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  let delay = 0;
  globalThis.setTimeout = ((fn: () => void, ms: number) => { delay = ms; fn(); return 0; }) as unknown as typeof setTimeout;
  URL.createObjectURL = () => { urls.created += 1; return "blob:x"; };
  URL.revokeObjectURL = () => { urls.revoked += 1; };
  try {
    saveBlob(new Blob(["x"]), "x.txt");
  } finally {
    globalThis.setTimeout = realTimeout;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.equal(links[0]!.download, "x.txt");
  assert.equal(links[0]!.clicked, true);
  assert.equal(delay, 30_000);
  assert.deepEqual(urls, { created: 1, revoked: 1 });
});

test("a spreadsheet can't run a cell as a formula, and Excel reads the encoding", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  for (const lead of ["+", "-", "@", "\t", "\r"]) assert.equal(csvCell(`${lead}x`), `"'${lead}x"`);
  assert.equal(csvCell('say "hi"'), `"say ""hi"""`);
  assert.equal(csvCell(null), `""`);
  assert.equal(csvCell("plain"), `"plain"`);
  const blob = toCsvBlob([["a", "b"], ["1", "=2"]]);
  assert.equal(blob.type, "text/csv;charset=utf-8");
  assert.equal(blob.size, "﻿".length * 3 + `"a","b"\n"1","'=2"`.length);
});

test("a long wait says when to try again", async () => {
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = (async () => ({ status: 429, headers: new Headers({ "retry-after": "1800" }) })) as unknown as typeof fetch;
  assert.equal(await downloadFile("/api/v1/account/export"), false);
  globalThis.fetch = realFetch2;
  assert.equal(retryMessage(new Headers({ "retry-after": "1800" })), "Try again in 30 minutes");
  assert.equal(retryMessage(new Headers({ "retry-after": "60" })), null);
  assert.equal(retryMessage(new Headers()), null);
  assert.ok(FEEDBACK_COPY["Try again in {minutes} minutes"]);
});
