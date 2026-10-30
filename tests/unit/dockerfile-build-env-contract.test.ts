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

// NEXT_PUBLIC_* values are inlined into the browser bundle by `next build`. One the code reads but the build step
// doesn't receive is empty in production whatever Railway holds (Google One Tap was, 2026-10-30).
test("Dockerfile build step receives every NEXT_PUBLIC_ variable the code reads", async () => {
  const { execSync } = await import("node:child_process");
  const used = new Set(execSync("grep -rhoE 'process\\.env\\.NEXT_PUBLIC_[A-Z0-9_]+' src", { encoding: "utf8" })
    .split("\n").filter(Boolean).map((line) => line.replace("process.env.", "")));
  assert.ok(used.has("NEXT_PUBLIC_GOOGLE_CLIENT_ID"));
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const missing = [...used].filter((name) => !new RegExp(`^ARG ${name}$`, "m").test(dockerfile) || !new RegExp(`\\b${name}=\\$${name}\\b`).test(dockerfile));
  assert.deepEqual(missing, []);
});
