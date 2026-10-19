import assert from "node:assert/strict";
import test from "node:test";
import { conversationHref, readPanes, parseMessageSeq, isMessageSeq, MAX_MESSAGE_SEQ } from "../../src/lib/messaging/routes";
import { normalizeSafeExternalUrl, parseSafeLinkToken, sameOriginPath } from "../../src/lib/messaging/safe-links";
import { firstExternalMarkdownLink, markdownDestinations } from "../../src/lib/messaging/markdown-links";
import { readPreviewMetadata } from "../../src/lib/links/preview-metadata";
import { normalizeLinkPreview } from "../../src/lib/links/preview-data";
import { canvasAssetIds } from "../../src/lib/messaging/canvas-store";
import { attachmentRetryUrl } from "../../src/lib/messaging/attachment-ttl";
import { buildRouteMetadata } from "../../src/lib/metadata/route-metadata";

const channel = "11111111-1111-4111-8111-111111111111";

test("URL patching preserves tabs and independent state, and round-trips the visible drawer", () => {
  const href = conversationHref(channel, { thread: 12, details: "members", pane: "details" }, "tab=canvas&foo=bar&m=40");
  const params = new URL(href, "https://networkbase.in").searchParams;
  assert.deepEqual(readPanes(params), { thread: 12, m: 40, details: "members", tab: "canvas", pane: "details" });
  assert.equal(params.get("foo"), "bar");
  const tab = new URL(conversationHref(channel, { tab: "canvas", m: null }, "m=40&thread=12&details=members"), "https://networkbase.in");
  assert.equal(tab.searchParams.has("m"), false);
  assert.equal(tab.searchParams.get("thread"), "12");
  const closed = conversationHref(channel, { thread: null, m: null }, params.toString());
  assert.equal(new URL(closed, "https://networkbase.in").searchParams.get("tab"), "canvas");
  assert.equal(new URL(closed, "https://networkbase.in").searchParams.has("pane"), false);
});

test("sequence validation matches the SQL wire range and removes invalid values", () => {
  for (const value of ["-1", "0", "01", "1.5", "1e2", "Infinity", "NaN", "2147483648", "", " 2"]) assert.equal(parseMessageSeq(value), null, value);
  for (const value of [-1, 0, 1.5, Infinity, MAX_MESSAGE_SEQ + 1]) assert.equal(isMessageSeq(value), false);
  assert.equal(parseMessageSeq(String(MAX_MESSAGE_SEQ)), MAX_MESSAGE_SEQ);
  assert.equal(conversationHref(channel, {}, "thread=-2&m=Infinity&tab=canvas"), `/messages/${channel}?tab=canvas`);
});

test("URL normalization preserves destinations and rejects unsafe schemes, hosts and credentials", () => {
  for (const value of ["mailto:person@example.com", "javascript:alert(1)", "data:text/html,x", "https://user:password@example.com", "https://localhost/x", "https://10.0.0.1/x", "https://127.0.0.1/x", "https://[::ffff:127.0.0.1]/x", "https://[::ffff:a00:1]/x", "//evil.test", "https://example.com/\\evil", "https://example.com/a\nb"]) assert.equal(normalizeSafeExternalUrl(value), null, value);
  assert.equal(normalizeSafeExternalUrl("example.com:8080/path"), "https://example.com:8080/path");
  assert.equal(normalizeSafeExternalUrl("https://example.com/wiki/Foo_(bar)?q=a%26b#section"), "https://example.com/wiki/Foo_(bar)?q=a%26b#section");
  assert.deepEqual(parseSafeLinkToken("https://example.com/wiki/Foo_(bar))."), { href: "https://example.com/wiki/Foo_(bar)", display: "https://example.com/wiki/Foo_(bar)", trailing: ")." });
  assert.equal(normalizeSafeExternalUrl("https://example.com/path."), "https://example.com/path.");
});

test("Markdown preview extraction agrees with rendering: skip code, images and application links", () => {
  const body = '`https://code.test`\n\n```\nhttps://fenced.test\n```\n\n![image](https://image.test)\n\n[message](https://networkbase.in/messages/abc?m=1)\n\n[real][ref]\n\n[ref]: https://example.com/wiki/Foo_(bar)\n';
  assert.equal(firstExternalMarkdownLink(body, "https://networkbase.in"), "https://example.com/wiki/Foo_(bar)");
  assert.deepEqual(markdownDestinations(body, "image"), ["https://image.test"]);
  assert.equal(firstExternalMarkdownLink("https://example.com/path.", "https://networkbase.in"), "https://example.com/path");
});

test("bounded preview metadata handles quoting, entities, Twitter fallback and redirect-relative images", () => {
  const data = readPreviewMetadata(`<meta content="Bob's &amp; Shop" property = "og:title"><meta name='description' content='hello &quot;world&quot;'><meta property='og:image' content='../photo.png?a=1&amp;b=2'><title>Fallback</title>`, new URL("https://example.com/new/page"));
  assert.equal(data.title, "Bob's & Shop");
  assert.equal(readPreviewMetadata('<meta property="og:title" content="A &amp;lt; B > C">', new URL("https://example.com")).title, "A &lt; B > C");
  assert.equal(data.description, 'hello "world"');
  assert.equal(data.image, "https://example.com/photo.png?a=1&b=2");
  assert.equal(readPreviewMetadata('<meta name="twitter:title" content="Twitter"><title>HTML</title>', new URL("https://example.com")).title, "Twitter");
  assert.equal(readPreviewMetadata(' '.repeat(65536) + '<meta property="og:title" content="too late">', new URL("https://example.com")).title, null);
  assert.equal(readPreviewMetadata('<meta property="og:image" content="http://127.0.0.1/x">', new URL("https://example.com")).image, null);
});

test("cached preview normalization is safe and idempotent", () => {
  const preview = normalizeLinkPreview({ url: "https://example.com", title: "A &amp; B", image: "javascript:alert(1)", description: "hello" }, "https://example.com");
  assert.ok(preview);
  assert.equal(preview.image, null);
  assert.deepEqual(normalizeLinkPreview(preview, preview.url), preview);
  assert.equal(normalizeLinkPreview({ url: "https://other.test" }, "https://example.com"), null);
});

test("canvas retention only accepts real same-origin image references", () => {
  assert.deepEqual(canvasAssetIds(`![ok](/api/v1/chat/attachments/${channel})\n![bad](https://evil.test/api/v1/chat/attachments/${channel})\n\`![code](/api/v1/chat/attachments/${channel})\``), [channel]);
  assert.deepEqual(canvasAssetIds(`![bad](https://evil.test/api/v1/chat/attachments/${channel})`), []);
});

test("notification destinations retain query state and reject foreign/malformed targets", () => {
  assert.equal(sameOriginPath(`https://networkbase.in/messages/${channel}?m=12&thread=3`, "https://networkbase.in"), `/messages/${channel}?m=12&thread=3`);
  for (const url of ["https://evil.test", "//evil.test", "//networkbase.in/x", "example.com", "/\\evil.test/x", "javascript:alert(1)", "https://person@networkbase.in/x", "http://networkbase.in/x"]) assert.equal(sameOriginPath(url, "https://networkbase.in"), null);
});

test("attachment recovery is restricted to the stable endpoint and one automatic attempt", () => {
  assert.equal(attachmentRetryUrl(`/api/v1/chat/attachments/${channel}`, 0, 42), `/api/v1/chat/attachments/${channel}?_reauth=42`);
  assert.equal(attachmentRetryUrl(`/api/v1/chat/attachments/${channel}`, 1, 42), null);
  assert.equal(attachmentRetryUrl("https://storage.example.com/token", 0), null);
});

test("route metadata uses a consistent canonical/social URL and explicit privacy policy", () => {
  const metadata = buildRouteMetadata({ title: "Messages | NetworkBase", description: "Private messaging", path: "/messages", robots: { index: false, follow: false } });
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(metadata.alternates?.canonical, "/messages");
  assert.equal((metadata.openGraph as { url: string }).url, "/messages");
});

test("service-worker notification clicks constrain destinations and preserve message identity", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  async function click(href: string, existing = false) {
    const handlers = new Map<string, (event: any) => void>();
    let pending: Promise<unknown> = Promise.resolve();
    let opened: string | null = null;
    let navigated: string | null = null;
    class Channel {
      port1: { onmessage?: () => void } = {};
      port2 = { postMessage: () => this.port1.onmessage?.() };
    }
    const self = { location: { origin: "https://networkbase.in" }, addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler), clients: {
      matchAll: async () => existing ? [{ url: "https://networkbase.in/discover", focused: true, focus: async () => undefined, postMessage: (message: any, ports: any[]) => { navigated = message.href; ports[0].postMessage("ok"); } }] : [],
      openWindow: async (url: string) => { opened = url; },
    } };
    vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, MessageChannel: Channel, setTimeout, clearTimeout });
    handlers.get("notificationclick")!({ notification: { close() {}, data: { href } }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    return { opened, navigated };
  }
  for (const href of ["https://evil.test", "//evil.test", "//networkbase.in/x", "messages/abc", "javascript:alert(1)", "https://person@networkbase.in/x", "/\\evil.test"]) assert.equal((await click(href)).opened, "https://networkbase.in/");
  const href = `/messages/${channel}?m=12&thread=3`;
  assert.equal((await click(href)).opened, `https://networkbase.in${href}`);
  assert.deepEqual(await click(href, true), { opened: null, navigated: href });
});
