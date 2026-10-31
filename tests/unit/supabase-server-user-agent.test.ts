import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Sign-in runs on the server, so without this Supabase records the server's runtime ("node") as the
// session's device and Settings → Security shows "Unknown browser on Unknown OS".
async function serverClientOptions(userAgent: string | null) {
  const source = ts.transpileModule(fs.readFileSync(path.join(process.cwd(), "src/lib/supabase/server.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let options: { global?: { headers?: Record<string, string> } } = {};
  const mocks: Record<string, unknown> = {
    "@supabase/ssr": { createServerClient: (_url: string, _key: string, opts: typeof options) => { options = opts; return { auth: { getUser: async () => ({}), mfa: {} } }; } },
    "@/lib/security/mfa": { factorListFromAuthServer: () => async () => ({}) },
    "next/headers": {
      cookies: async () => ({ getAll: () => [] }),
      headers: async () => ({ get: (key: string) => (key === "user-agent" ? userAgent : null) }),
    },
    "@/lib/supabase/env": { authBoundedFetch: fetch, resolveSupabasePublicEnv: () => ({ url: "https://test.supabase.co", anonKey: "anon" }) },
    "@/lib/supabase/cookie-options": { resolveSupabaseServerCookieOptions: () => ({}) },
    "@/lib/routing/route-metric": { toPrivacySafeRouteMetric: () => "/test" },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(source, { exports, require: (name: string) => mocks[name] ?? {}, process, console, Date, Promise });
  await exports.createClient();
  return options;
}

test("server Supabase requests carry the browser's user agent", async () => {
  const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15";
  assert.equal((await serverClientOptions(safari)).global?.headers?.["User-Agent"], safari);
  assert.equal((await serverClientOptions(null)).global?.headers?.["User-Agent"], undefined);
});
