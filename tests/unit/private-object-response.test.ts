import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  enforceExactByteLength,
  parseSingleByteRange,
  safeContentDisposition,
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
});
