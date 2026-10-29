import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  UnsafeOutboundUrlError,
  assertPublicNetworkUrl,
  fetchPublicUrlWithRedirectValidation,
  readBoundedBody,
  isBlockedIpAddress,
} from "@/lib/security/outbound-url";

describe("outbound URL safeguards", () => {
  it("blocks private and loopback IP addresses", () => {
    assert.equal(isBlockedIpAddress("127.0.0.1"), true);
    assert.equal(isBlockedIpAddress("10.0.0.8"), true);
    assert.equal(isBlockedIpAddress("192.168.1.10"), true);
    assert.equal(isBlockedIpAddress("::1"), true);
    assert.equal(isBlockedIpAddress("fd00::1"), true);
    assert.equal(isBlockedIpAddress("2001::1"), true);
    assert.equal(isBlockedIpAddress("2002:c000:0204::"), true);
    assert.equal(isBlockedIpAddress("64:ff9b::808:808"), true);
    assert.equal(isBlockedIpAddress("100::1"), true);
    assert.equal(isBlockedIpAddress("::ffff:192.168.1.10"), true);
    assert.equal(isBlockedIpAddress("0:0:0:0:0:ffff:c0a8:010a"), true);
    assert.equal(isBlockedIpAddress("::ffff:8.8.8.8"), false);
    assert.equal(isBlockedIpAddress("0:0:0:0:0:ffff:0808:0808"), false);
    assert.equal(isBlockedIpAddress("8.8.8.8"), false);
    assert.equal(isBlockedIpAddress("2606:4700:4700::1111"), false);
  });

  it("rejects localhost-style hosts before fetch", async () => {
    await assert.rejects(
      assertPublicNetworkUrl("http://localhost:3000/test"),
      UnsafeOutboundUrlError,
    );
    await assert.rejects(
      assertPublicNetworkUrl("http://service.internal/test"),
      UnsafeOutboundUrlError,
    );
  });

  it("accepts public URLs when DNS resolves to public addresses", async () => {
    const url = await assertPublicNetworkUrl("https://example.com/path?q=1#section", {
      resolveAddresses: async () => ["93.184.216.34"],
    });

    assert.equal(url.hostname, "example.com");
    assert.equal(url.pathname, "/path");
    assert.equal(url.search, "?q=1");
    assert.equal(url.hash, "#section");
  });

  it("rejects hosts that resolve to private addresses", async () => {
    await assert.rejects(
      assertPublicNetworkUrl("https://example.com/path", {
        resolveAddresses: async () => ["10.0.0.4"],
      }),
      UnsafeOutboundUrlError,
    );
  });

  it("respects a caller-provided abort signal while preserving timeout cleanup", async () => {
    const controller = new AbortController();

    await assert.rejects(
      fetchPublicUrlWithRedirectValidation({
        url: "https://example.com/path",
        init: {
          signal: controller.signal,
        },
        resolveAddresses: async () => ["93.184.216.34"],
        fetchImpl: async (_url, init) => {
          controller.abort();
          if (init?.signal?.aborted) {
            throw new DOMException("The operation was aborted.", "AbortError");
          }
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("The operation was aborted.", "AbortError")),
              { once: true },
            );
          });
        },
      }),
      (error: unknown) =>
        error instanceof DOMException &&
        error.name === "AbortError",
    );
  });

  // API-004: one deadline covers the headers, every redirect hop and the body.
  it("aborts a body that stalls after headers once the total deadline passes", async () => {
    const started = Date.now();
    const { response, release } = await fetchPublicUrlWithRedirectValidation({
      url: "https://example.com/slow",
      timeoutMs: 300,
      resolveAddresses: async () => ["93.184.216.34"],
      fetchImpl: async (_url, init) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
          },
        });
        return new Response(stream, { status: 200 });
      },
    });
    try {
      await assert.rejects(async () => {
        const reader = response.body!.getReader();
        for (;;) if ((await reader.read()).done) break;
      }, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
      assert.ok(Date.now() - started < 2_000);
    } finally {
      release();
    }
  });

  it("does not spend a fresh deadline on each redirect hop", async () => {
    const started = Date.now();
    let hops = 0;
    await assert.rejects(
      fetchPublicUrlWithRedirectValidation({
        url: "https://example.com/a",
        timeoutMs: 300,
        maxRedirects: 5,
        resolveAddresses: async () => ["93.184.216.34"],
        fetchImpl: async (_url, init) => {
          hops += 1;
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
          return new Response(null, { status: 302, headers: { location: `https://example.com/b${hops}` } });
        },
      }),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
    assert.ok(hops <= 3, `stopped after ${hops} hops`);
    assert.ok(Date.now() - started < 1_000);
  });

  it("readBoundedBody stops at the limit and cancels the stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024).fill(65)); },
      cancel() { cancelled = true; },
    });
    const { bytes, truncated } = await readBoundedBody(new Response(stream), 3_000);
    assert.equal(bytes.length, 3_000);
    assert.equal(truncated, true);
    assert.equal(cancelled, true);
    const small = await readBoundedBody(new Response("hello"), 3_000);
    assert.deepEqual([new TextDecoder().decode(small.bytes), small.truncated], ["hello", false]);
  });

  // API-013: fixed-host providers share the one validated transport.
  it("keeps every hop of a provider call inside its host allowlist", async () => {
    const calls: string[] = [];
    await assert.rejects(
      fetchPublicUrlWithRedirectValidation({
        url: "https://api.github.com/repos/a/b",
        allowedHosts: ["api.github.com"],
        resolveAddresses: async () => ["140.82.112.5"],
        fetchImpl: async (url) => {
          calls.push(String(url));
          return new Response(null, { status: 302, headers: { location: "https://evil.example.com/steal" } });
        },
      }),
      UnsafeOutboundUrlError,
    );
    assert.deepEqual(calls, ["https://api.github.com/repos/a/b"]);

    await assert.rejects(
      fetchPublicUrlWithRedirectValidation({
        url: "https://example.com/x",
        allowedHosts: ["api.github.com"],
        resolveAddresses: async () => ["93.184.216.34"],
        fetchImpl: async () => { throw new Error("must not fetch"); },
      }),
      UnsafeOutboundUrlError,
    );

    const ok = await fetchPublicUrlWithRedirectValidation({
      url: "https://api.github.com/repos/a/b",
      allowedHosts: ["api.github.com"],
      resolveAddresses: async () => ["140.82.112.5"],
      fetchImpl: async (url) => String(url).endsWith("/b")
        ? new Response(null, { status: 301, headers: { location: "https://api.github.com/repositories/1" } })
        : new Response("{}", { status: 200 }),
    });
    assert.equal(ok.response.status, 200);
    ok.release();
  });

  it("github actions no longer use the retired safeFetch guard", () => {
    const source = readFileSync("src/app/actions/github.ts", "utf8");
    assert.doesNotMatch(source, /safeFetch|ssrf-guard/);
    assert.equal(existsSync("src/lib/security/ssrf-guard.ts"), false);
  });
});

describe("pinned egress transport (SEC-006)", () => {
  it("connects to the validated address, not to whatever the hostname resolves to", async () => {
    const { createServer } = await import("node:http");
    const { fetchPinnedToAddresses } = await import("@/lib/security/outbound-url");
    const server = createServer((req, res) => {
      res.setHeader("set-cookie", ["a=1", "b=2"]);
      res.end(`host=${req.headers.host} enc=${req.headers["accept-encoding"]}`);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const port = (server.address() as { port: number }).port;
      // "pinned.invalid" never resolves: success proves the supplied address was used.
      const response = await fetchPinnedToAddresses(new URL(`http://pinned.invalid:${port}/x`), { headers: { accept: "text/plain" } }, ["127.0.0.1"]);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), `host=pinned.invalid:${port} enc=identity`);
      assert.deepEqual(response.headers.getSetCookie(), ["a=1", "b=2"]);
    } finally {
      server.close();
    }
  });

  // https.request sends no User-Agent of its own (fetch did), and GitHub's API answers 403 without one.
  it("sends a User-Agent unless the caller set its own", async () => {
    const { createServer } = await import("node:http");
    const { fetchPinnedToAddresses } = await import("@/lib/security/outbound-url");
    const server = createServer((req, res) => res.end(req.headers["user-agent"] ?? "none"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const url = new URL(`http://pinned.invalid:${(server.address() as { port: number }).port}/`);
      assert.match(await (await fetchPinnedToAddresses(url, {}, ["127.0.0.1"])).text(), /^NetworkBase\//);
      assert.equal(await (await fetchPinnedToAddresses(url, { headers: { "User-Agent": "LinkPreviewBot/1.0" } }, ["127.0.0.1"])).text(), "LinkPreviewBot/1.0");
    } finally {
      server.close();
    }
  });

  it("the default fetch path no longer uses the global fetch", () => {
    const source = readFileSync("src/lib/security/outbound-url.ts", "utf8");
    assert.doesNotMatch(source, /input\.fetchImpl \?\? fetch/);
    assert.match(source, /fetchPinnedToAddresses\(currentUrl, init, hop\.addresses\)/);
  });
});
