import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, test } from "node:test";
import { gzipSync } from "node:zlib";

import tar from "tar-stream";

import { fetchAndParseTarball } from "@/lib/github/tarball-stream";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function archive(files: Array<[string, Buffer]>) {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on("data", (chunk: Buffer) => chunks.push(chunk));
  for (const [name, content] of files) pack.entry({ name: `owner-repo-sha/${name}` }, content);
  pack.finalize();
  await new Promise((resolve) => pack.on("end", resolve));
  return gzipSync(Buffer.concat(chunks));
}

/** Serves `bytes` in 64 KiB pieces and records how much was pulled and whether the request was aborted. */
function serve(bytes: Buffer) {
  const state = { pulled: 0, aborted: false };
  globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
    init?.signal?.addEventListener("abort", () => { state.aborted = true; });
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        const piece = bytes.subarray(offset, offset + 65536);
        offset += piece.length;
        state.pulled = offset;
        controller.enqueue(new Uint8Array(piece));
      },
    }), { status: 200 });
  }) as typeof fetch;
  return state;
}

test("yields every accepted file with the root folder stripped", async () => {
  serve(await archive([["a.txt", Buffer.from("A")], ["dir/b.txt", Buffer.from("BB")], ["node_modules/x.js", Buffer.from("skip")]]));
  const seen: string[] = [];
  for await (const file of fetchAndParseTarball("https://github.com/o/r", "sha")) seen.push(`${file.path}:${file.content.length}`);
  assert.deepEqual(seen, ["a.txt:1", "dir/b.txt:2"]);
});

// PERF-001: a slow consumer must not let extraction buffer the whole archive.
test("extraction stays about one file ahead of a slow consumer", async () => {
  const files = Array.from({ length: 24 }, (_, i): [string, Buffer] => [`f${i}.bin`, randomBytes(1024 * 1024)]);
  const bytes = await archive(files);
  const state = serve(bytes);
  const iterator = fetchAndParseTarball("https://github.com/o/r", "sha");
  const first = await iterator.next();
  assert.equal(first.done, false);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(state.pulled < bytes.length / 2, `pulled ${state.pulled} of ${bytes.length}`);
  await iterator.return(undefined);
});

test("stopping early cancels the download", async () => {
  const state = serve(await archive([["a.bin", randomBytes(256 * 1024)], ["b.bin", randomBytes(256 * 1024)]]));
  const iterator = fetchAndParseTarball("https://github.com/o/r", "sha");
  await iterator.next();
  await iterator.return(undefined);
  assert.equal(state.aborted, true);
});
