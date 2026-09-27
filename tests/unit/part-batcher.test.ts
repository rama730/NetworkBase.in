import assert from "node:assert/strict";
import test from "node:test";

import { createPartBatcher } from "@/lib/part-batcher";

test("parts requested in the same tick share one load call", async () => {
    const calls: string[][] = [];
    const read = createPartBatcher<{ a: number; b: string }>(async (parts) => {
        calls.push(parts);
        return { a: 1, b: "two" };
    });
    const [a, b, again] = await Promise.all([read("a"), read("b"), read("a")]);
    assert.deepEqual([a, b, again], [1, "two", 1]);
    assert.deepEqual(calls, [["a", "b"]]);
    assert.equal(await read("b"), "two");
    assert.equal(calls.length, 2);
});

test("a failed load rejects every waiter in the batch", async () => {
    const read = createPartBatcher<{ a: number; b: number }>(async () => {
        throw new Error("down");
    });
    const results = await Promise.allSettled([read("a"), read("b")]);
    assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
});
