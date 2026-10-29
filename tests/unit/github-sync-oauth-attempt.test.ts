import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { setImmediate as settle } from "node:timers/promises";

function fixture(identities: Array<{ provider: string; identity_data?: Record<string, string> }> = []) {
  const navigations: string[] = [];
  let options: unknown;
  let linking: unknown;
  let identityError: Error | null = null;
  let lookup!: (value: unknown) => void;
  let pendingLookup: Promise<unknown> | null = null;
  let complete!: (value: unknown) => void;
  const result = new Promise((resolve) => {
    complete = resolve;
  });
  const code = ts.transpileModule(
    readFileSync("src/lib/github/oauth-client.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const cjs = {
    exports: {} as {
      startGithubRepositoryAuthorization: (options: unknown) => Promise<void>;
      startGithubSyncAuthorization: (options: unknown) => Promise<void>;
    },
  };
  vm.runInNewContext(code, {
    module: cjs,
    exports: cjs.exports,
    URL,
    crypto: { randomUUID: () => "attempt" },
    process: {
      env: { NEXT_PUBLIC_SUPABASE_URL: "https://workspace.supabase.co" },
    },
    window: {
      location: {
        origin: "https://networkbase.test",
        pathname: "/workspaces/research",
        search: "?tab=files&filesView=github",
        hash: "",
        assign: (url: string) => navigations.push(url),
      },
    },
    require: (name: string) => {
      if (name === "@/lib/auth/redirects")
        return {
          resolveAuthBaseUrl: () => "https://networkbase.test",
          buildOAuthRedirectTo: () => "https://networkbase.test/auth/callback",
        };
      if (name === "@/lib/auth/oauth")
        return {
          continueBrowserOAuthRedirect: () => {
            throw new Error("Sync uses its verified cancellable redirect path");
          },
        };
      if (name === "@/lib/github/oauth-errors")
        return { clearGithubOAuthReturn: () => {} };
      if (name === "@/lib/supabase/client")
        return {
          createSupabaseBrowserClient: () => ({
            auth: {
              getUserIdentities: () => pendingLookup || Promise.resolve({ data: { identities }, error: identityError }),
              linkIdentity: (value: unknown) => { linking = value; return result; },
              signInWithOAuth: (value: unknown) => {
                options = value;
                return result;
              },
            },
          }),
        };
      throw new Error(name);
    },
  });
  return {
    start: cjs.exports.startGithubRepositoryAuthorization,
    startSync: cjs.exports.startGithubSyncAuthorization,
    failIdentityLookup: () => { identityError = new Error("Identity lookup unavailable"); },
    deferIdentityLookup: () => { pendingLookup = new Promise((resolve) => { lookup = resolve; }); },
    completeIdentityLookup: (value: unknown) => lookup(value),
    get linking() { return linking; },
    complete,
    navigations,
    get options() {
      return options as { options: { skipBrowserRedirect?: boolean } };
    },
  };
}
test("a cancelled or superseded sign-in request cannot navigate when the provider request returns", async () => {
  const f = fixture();
  let current = true;
  const pending = f.start({ isCurrent: () => current });
  assert.equal(f.options.options.skipBrowserRedirect, true);
  current = false;
  f.complete({
    data: {
      url: "https://workspace.supabase.co/auth/v1/authorize?provider=github",
    },
    error: null,
  });
  await pending;
  assert.deepEqual(f.navigations, []);
});
test("the current sign-in attempt navigates only to the configured authorization endpoint", async () => {
  const f = fixture();
  const pending = f.start({ isCurrent: () => true });
  f.complete({
    data: {
      url: "https://workspace.supabase.co/auth/v1/authorize?provider=github",
    },
    error: null,
  });
  await pending;
  assert.deepEqual(f.navigations, [
    "https://workspace.supabase.co/auth/v1/authorize?provider=github",
  ]);
  const bad = fixture();
  const rejected = bad.start({ isCurrent: () => true });
  bad.complete({
    data: { url: "https://untrusted.example/auth/v1/authorize" },
    error: null,
  });
  await assert.rejects(rejected, /unexpected authorization destination/);
  assert.deepEqual(bad.navigations, []);
});
test("a failed authorization request stays an error and never implies successful sign-in", async () => {
  const f = fixture();
  const pending = f.start({ isCurrent: () => true });
  f.complete({ data: { url: null }, error: null });
  await assert.rejects(pending, /could not be started/);
  assert.deepEqual(f.navigations, []);
});

test("sync renews a current linked identity rather than linking it again", async () => {
  const f = fixture([{ provider: "github", identity_data: { user_name: "linked-user" } }]);
  const pending = f.startSync({ isCurrent: () => true });
  await settle();
  assert.equal(f.linking, undefined);
  assert.ok(f.options);
  f.complete({ data: { url: "https://workspace.supabase.co/auth/v1/authorize?provider=github" }, error: null });
  await pending;
  assert.equal(f.navigations.length, 1);
});

test("sync links only after a successful current lookup proves GitHub is absent", async () => {
  const f = fixture([{ provider: "google" }]);
  const pending = f.startSync({ isCurrent: () => true });
  await settle();
  assert.ok(f.linking);
  assert.equal(f.options, undefined);
  f.complete({ data: { url: "https://workspace.supabase.co/auth/v1/authorize?provider=github" }, error: null });
  await pending;
  assert.equal(f.navigations.length, 1);
});

test("a failed identity lookup cannot fall back to linking or account switching", async () => {
  const f = fixture();
  f.failIdentityLookup();
  await assert.rejects(f.startSync({ isCurrent: () => true }), /Identity lookup unavailable/);
  assert.equal(f.linking, undefined);
  assert.equal(f.options, undefined);
  assert.deepEqual(f.navigations, []);
});

test("cancellation during identity lookup starts neither authorization nor linking", async () => {
  const f = fixture();
  f.deferIdentityLookup();
  let current = true;
  const pending = f.startSync({ isCurrent: () => current });
  current = false;
  f.completeIdentityLookup({ data: { identities: [] }, error: null });
  await pending;
  assert.equal(f.linking, undefined);
  assert.equal(f.options, undefined);
  assert.deepEqual(f.navigations, []);
});
