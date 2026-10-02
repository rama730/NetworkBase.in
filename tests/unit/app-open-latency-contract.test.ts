import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("appearance GET always answers 200 from the session and is never cached", () => {
  const source = read("src/app/api/v1/appearance/route.ts");
  assert.doesNotMatch(source, /if-none-match|ETag|status: 304|max-age/i);
  assert.match(source, /no-store/);
});

test("CSRF token delivery does not wait on Redis", () => {
  assert.doesNotMatch(read("src/app/api/v1/security/csrf/route.ts"), /enforceRouteLimit|rate-limit/);
});

test("Redis and server Supabase calls are time-bounded", () => {
  const redis = read("src/lib/redis.ts");
  assert.match(redis, /signal: \(\) => AbortSignal\.timeout\(/);
  assert.match(redis, /retry: \{ retries: 1/);
  assert.match(redis, /recordCacheFailure\('get', error\)[\s\S]*?return null/);
  assert.match(redis, /recordCacheFailure\('set', error\)/);
  assert.match(read("src/lib/supabase/env.ts"), /AbortSignal\.timeout\(/);
  assert.match(read("src/lib/supabase/server.ts"), /global: \{ fetch: authBoundedFetch \}/);
  assert.match(read("src/lib/supabase/middleware.ts"), /global: \{ fetch: authBoundedFetch \}/);
});
