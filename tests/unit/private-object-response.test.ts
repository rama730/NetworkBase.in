import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  enforceExactByteLength,
  parseSingleByteRange,
  safeContentDisposition,
  streamPrivateObject,
} from "@/lib/storage/private-object-response";

describe("private object response", () => {
  it("accepts one bounded range and suffix ranges", () => {
    assert.deepEqual(parseSingleByteRange("bytes=10-19", 100), { start: 10, end: 19 });
    assert.deepEqual(parseSingleByteRange("bytes=90-", 100), { start: 90, end: 99 });
    assert.deepEqual(parseSingleByteRange("bytes=-10", 100), { start: 90, end: 99 });
  });

  it("rejects amplification and unsatisfiable ranges", () => {
    assert.throws(() => parseSingleByteRange("bytes=0-1,4-5", 100), RangeError);
    assert.throws(() => parseSingleByteRange("bytes=100-101", 100), RangeError);
    assert.throws(() => parseSingleByteRange("bytes=8-2", 100), RangeError);
  });

  it("sanitizes response filenames", () => {
    const value = safeContentDisposition("bad\"name\r\n.pdf", "attachment");
    assert.match(value, /^attachment;/);
    assert.doesNotMatch(value, /[\r\n]/);
  });

  // A raw non-Latin-1 name makes `new Headers` throw, which turned the whole response into a 500.
  it("builds a valid header for any filename", () => {
    const names = ["日本語.pdf", "it’s.pdf", "a—b.pdf", "résumé.pdf", "📄 notes.txt", "\ud83d.txt", "x".repeat(300) + "📄", "back\\slash\t.txt", "   "];
    for (const name of names) {
      const value = safeContentDisposition(name, "attachment");
      assert.doesNotThrow(() => new Headers({ "Content-Disposition": value }), name);
      assert.match(value, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%!#$&+\-.^_`|~]+$/, name);
    }
    assert.match(safeContentDisposition("日本語.pdf", "attachment"), /filename\*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E\.pdf$/);
    assert.match(safeContentDisposition("it's (1).pdf", "inline"), /filename\*=UTF-8''it%27s%20%281%29\.pdf$/);
    assert.match(safeContentDisposition("   ", "attachment"), /filename="download"/);
  });

  it("serves a non-English filename instead of failing", async () => {
    const res = await streamPrivateObject({
      request: new Request("https://app.test/f", { method: "HEAD" }),
      signedUrl: "https://storage.test/f",
      totalSize: 3,
      mimeType: "application/pdf",
      filename: "日本語 it’s.pdf",
      disposition: "attachment",
      etag: '"x"',
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition")!, /^attachment; filename="___ it_s\.pdf";/);
  });

  it("streams exactly the authorized number of bytes", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const bytes = await new Response(enforceExactByteLength(body, 3)).arrayBuffer();
    assert.deepEqual(Array.from(new Uint8Array(bytes)), [1, 2, 3]);
  });

  it("aborts oversized and truncated provider bodies", async () => {
    const body = (values: number[]) => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(values));
        controller.close();
      },
    });
    await assert.rejects(
      new Response(enforceExactByteLength(body([1, 2, 3]), 2)).arrayBuffer(),
      /exceeded the authorized byte range/,
    );
    await assert.rejects(
      new Response(enforceExactByteLength(body([1]), 2)).arrayBuffer(),
      /incomplete byte range/,
    );
  });

  it("never serves uploaded HTML inline and sandboxes everything but PDF", async () => {
    const etag = '"x"';
    const stream = (mimeType: string) => streamPrivateObject({
      request: new Request("https://app.test/f", { method: "HEAD" }),
      signedUrl: "https://storage.test/f",
      totalSize: 3,
      mimeType,
      filename: "evil.pdf",
      disposition: "inline",
      etag,
    });
    for (const type of ["text/html", "application/xhtml+xml", "text/xml", "image/svg+xml"]) {
      const res = await stream(type);
      assert.match(res.headers.get("content-disposition")!, /^attachment;/, type);
      assert.equal(res.headers.get("content-type"), "application/octet-stream", type);
      assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'", type);
    }
    const png = await stream("image/png");
    assert.match(png.headers.get("content-disposition")!, /^inline;/);
    assert.equal(png.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    const pdf = await stream("application/pdf");
    assert.match(pdf.headers.get("content-disposition")!, /^inline;/);
    assert.equal(pdf.headers.get("content-security-policy"), null);
  });
});
