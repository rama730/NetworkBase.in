import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// `next build` runs with NODE_ENV=production and loads src/lib/env.ts, so every
// secret the production check requires needs a build-only placeholder in the
// Dockerfile's build step, or the Railway build fails.
test("Dockerfile build step sets every required production secret", () => {
  const env = readFileSync("src/lib/env.ts", "utf8");
  const list = env.slice(env.indexOf("const requiredSecrets"), env.indexOf("] as const"));
  const required = [...list.matchAll(/\['([A-Z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(required.length > 0, "found no required secrets in env.ts");

  const dockerfile = readFileSync("Dockerfile", "utf8");
  const buildStep = dockerfile.slice(dockerfile.indexOf("RUN DATABASE_URL="), dockerfile.indexOf("npm run build"));
  const missing = required.filter((name) => !new RegExp(`\\b${name}=\\S`).test(buildStep));
  assert.deepEqual(missing, []);
});
