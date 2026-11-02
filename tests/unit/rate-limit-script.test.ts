import assert from "node:assert/strict";
import test from "node:test";

import { runTokenBucket } from "@/lib/security/rate-limit";

function redis(hasScript: boolean, failure?: Error) {
  const sent: string[] = [];
  return {
    sent,
    evalsha: async () => {
      sent.push("evalsha");
      if (failure) throw failure;
      if (!hasScript) throw new Error("NOSCRIPT No matching script. Please use EVAL.");
      return [1, 1, 1, 0];
    },
    eval: async () => {
      sent.push("eval");
      return [1, 1, 1, 0];
    },
  };
}

test("a script Redis already holds is not sent again", async () => {
  const client = redis(true);
  await runTokenBucket(client, ["key"], []);
  assert.deepEqual(client.sent, ["evalsha"]);
});

test("the script is sent once when Redis does not hold it", async () => {
  const client = redis(false);
  assert.deepEqual(await runTokenBucket(client, ["key"], []), [1, 1, 1, 0]);
  assert.deepEqual(client.sent, ["evalsha", "eval"]);
});

test("other Redis failures reach the caller's fail-open or fail-closed handling", async () => {
  const client = redis(true, new Error("connection refused"));
  await assert.rejects(runTokenBucket(client, ["key"], []), /connection refused/);
  assert.deepEqual(client.sent, ["evalsha"]);
});
