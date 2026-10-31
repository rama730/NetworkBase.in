# Sentry Error Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every real production error, in the server, the browser or a background job, reaches Sentry with a readable stack trace and emails the owner, and no secrets or private content go with it.

**Architecture:** `@sentry/nextjs` starts from Next's `src/instrumentation.ts` and `src/instrumentation-client.ts`, both using one shared options and scrub module. Most server errors are caught and logged rather than thrown, so `logger.error` reports to Sentry directly, and a server-only console integration covers code that still uses `console.error`. Background jobs report through one Inngest function listening to `inngest/function.failed`.

**Tech Stack:** Next.js 16.4 (`next build --webpack`), `@sentry/nextjs` 11.x, Inngest 3, Railway (`networkbase-web`, `networkbase-worker`), Sentry org `networkbase`, project `javascript-nextjs`.

**Spec:** The user's request in this session: monitor production errors with Sentry. No separate spec.

## Global Constraints

- No code until the user says "implement". Commit locally on `main`. No push, Railway change or production Sentry change until the user says so (Task 6 is separate).
- Declare the dependency with `npm install --package-lock-only --ignore-scripts @sentry/nextjs@<ver>`. Never `pnpm add`.
- No temporary routes in the repo. Test thrown errors on a scratch copy on port 3100.
- Reuse the existing Sentry project `javascript-nextjs` (no issues in the last 90 days). Do not create another.
- Sentry is off when `NEXT_PUBLIC_SENTRY_DSN` is blank or unset, so local dev and tests send nothing.
- Every `dataCollection` option off (Sentry 11 defaults them all on and removed `sendDefaultPii`). No tracing and no Session Replay in this phase.
- Only the opaque `userId` may identify a person in an event. No emails, IP addresses, cookies, request bodies, message text or file contents.
- Read `node_modules/next/dist/docs/` before touching Next files, and take Sentry option names from the installed package's types, because they change between major versions.
- Measure before and after: First Load JS with `npm run analyze:bundle`, and web and worker memory from Railway metrics. If First Load JS grows by more than 60 KB gzipped, stop and report.

## Deliberate Shortcuts (ledger with `ponytail:` comments)

| Shortcut | Ceiling | Upgrade when |
|---|---|---|
| No tunnel route; the browser posts directly to Sentry (CSP `connect-src` already allows `https:`) | Ad blockers hide some browser errors | Browser errors are clearly under-reported |
| No tracing | No slow-request breakdown | Slowness can't be explained from Railway metrics |
| No edge config (no `runtime = "edge"` in `src`; Next 16 Proxy runs on Node) | An edge route would go unreported | The first edge route is added |
| Browser `console.error` not captured (17 component and hook files) | Errors a component catches itself are missed | One of them hides a real incident |

## Review Focus

1. A secret in an error message, URL query or log context (JWT, Bearer token, `token=`, connection string) must not reach Sentry. Pinned in Task 1.
2. Sentry being down, blocked or out of quota must not change any response or crash any job. Pinned in Task 2.
3. One failure reported through both `logger.error` and a throw or console path should appear once, not twice. Pinned in Task 2.
4. Every missing or blank DSN case must leave the app working and sending nothing, including a Railway service missing the variable. Pinned in Task 1.
5. A failure in the failure reporter must not trigger itself in a loop. Pinned in Task 4.

---

### Task 1: SDK, shared scrubbing and server and browser start-up

**Files:**
- Modify: `package.json`, `package-lock.json`, `next.config.ts:183`, `Dockerfile:13-35`, `Dockerfile:39-51`, `.env.local.example`
- Create: `src/lib/observability/sentry-options.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`
- Test: `tests/unit/sentry-options.test.ts`

**Interfaces:**
- Consumes: `scrubMessage(message: string): string` from `src/lib/logger.ts`
- Produces: `isSentryEnabled(): boolean`, `scrubEvent<T extends Event>(event: T): T`, `baseSentryOptions(): Pick<NodeOptions & BrowserOptions, "dsn" | "enabled" | "environment" | "sendDefaultPii" | "beforeSend">`

- [ ] **Step 1: Record the "before" numbers.** Run `npm run analyze:bundle` and save First Load JS for `/` and `/discover`. Read memory for both Railway services with `get-service-metrics`.
- [ ] **Step 2: Write the failing tests**

```ts
test("scrubs secrets from message, exception, url and breadcrumbs", () => {
  const out = scrubEvent({
    message: "failed token=abc123",
    exception: { values: [{ value: "Bearer abcdefgh12345678" }] },
    request: { url: "https://networkbase.in/a?code=secret", cookies: { s: "1" }, headers: { cookie: "s=1" }, data: "body" },
    extra: { arguments: ["raw"] },
    breadcrumbs: [{ category: "console", message: "raw" }, { category: "fetch", data: { url: "https://x.io/y?key=v" } }],
  });
  const text = JSON.stringify(out);
  for (const leaked of ["abc123", "abcdefgh12345678", "code=secret", '"s":"1"', "s=1", "body", "raw", "key=v"]) {
    assert.ok(!text.includes(leaked), leaked);
  }
});
test("blank or missing DSN disables Sentry", () => {
  for (const dsn of [undefined, "", "   "]) {
    setDsn(dsn);
    assert.equal(isSentryEnabled(), false);
    assert.equal(baseSentryOptions().enabled, false);
  }
});
```

- [ ] **Step 3: Run them.** `npx tsx --test tests/unit/sentry-options.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 4: Declare the dependency and implement `sentry-options.ts`.** Use `process.env.NEXT_PUBLIC_SENTRY_DSN` (trimmed) and environment `process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production"`, the only override, for the scratch run in Task 5. `scrubEvent` runs `scrubMessage` on the message and exception values, strips query strings from `request.url` and breadcrumb URLs, deletes `request.cookies`, `request.headers`, `request.data` and `extra.arguments`, and drops `console` breadcrumbs.
- [ ] **Step 5: Implement start-up.** `src/instrumentation.ts`: `register()` calls `Sentry.init(baseSentryOptions() + captureConsoleIntegration({ levels: ["error"] }))` when `NEXT_RUNTIME === "nodejs"`, and `export const onRequestError = Sentry.captureRequestError`. `src/instrumentation-client.ts`: `Sentry.init(baseSentryOptions())` and `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart`, if the installed version still requires it without tracing.
- [ ] **Step 6: Wrap the config and pass build values.** `next.config.ts`: `withSentryConfig(withBundleAnalyzer(nextConfig), { org: "networkbase", project: "javascript-nextjs", authToken: process.env.SENTRY_AUTH_TOKEN, release: { name: process.env.RAILWAY_GIT_COMMIT_SHA }, silent: true, widenClientFileUpload: true })`; confirm source maps are deleted after upload. `Dockerfile` builder stage: `ARG` and `ENV` for `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (the contract test requires this), and `ARG` only for `SENTRY_AUTH_TOKEN` and `RAILWAY_GIT_COMMIT_SHA`, passed inline on the `RUN` line so the token never enters `ENV` or the runner stage. Document the variables in `.env.local.example`.
- [ ] **Step 7: Verify.** `npx tsx --test tests/unit/sentry-options.test.ts tests/unit/dockerfile-build-env-contract.test.ts` PASS. `npm run typecheck`, `npm run check:csp-contract` and `npm run build` with no DSN or token all succeed. Confirm no `.map` files remain under `.next/static` in a token-enabled build.
- [ ] **Step 8: Commit.** `feat(monitoring): start Sentry on server and browser, scrubbed`

### Task 2: `logger.error` reports to Sentry

**Files:**
- Modify: `src/lib/logger.ts:57-60`, plus any of `src/app/api/v1/auth/signup/route.ts`, `auth/verify-email/route.ts`, `auth/session/route.ts`, `link-preview/route.ts` that return 500 with no log at all
- Test: `tests/unit/logger-sentry.test.ts`

**Interfaces:**
- Consumes: `Sentry.captureException`, `Sentry.captureMessage`, `scrubEvent` through `beforeSend` from Task 1
- Produces: every `logger.error` call becomes one Sentry event, fingerprinted `["logger", message]`, with `extra` set to the already-sanitized context

- [ ] **Step 1: Write the failing tests.** Start Sentry in-process with a fake transport that collects events:

```ts
test("logger.error sends sanitized context, never raw values", async () => {
  logger.error("files.upload.failed", { module: "files", password: "p4ss", email: "a@b.c", error: new Error("token=abc123") });
  const [event] = await flushEvents();
  const text = JSON.stringify(event);
  assert.ok(text.includes("files.upload.failed"));
  for (const leaked of ["p4ss", "a@b.c", "abc123"]) assert.ok(!text.includes(leaked), leaked);
});
test("the same Error logged twice is one event", ...);
test("logger.warn sends nothing", ...);
test("a throwing transport does not make logger.error throw", ...);
test("logger.error works when Sentry was never started", ...);
```

- [ ] **Step 2: Run them.** `npx tsx --test tests/unit/logger-sentry.test.ts`. Expected: FAIL, no events collected.
- [ ] **Step 3: Implement.** In the `error` case of `emit`, after the console call, wrap in `try/catch`: `captureException(originalError)` when `context.error` is an `Error`, otherwise `captureMessage(message, "error")`. Both pass `{ extra: safeContext, fingerprint: ["logger", message], user: userId ? { id: userId } : undefined }`. Drop the logger's own `[logger]` line in the server console integration through `beforeSend` so it isn't reported twice.
- [ ] **Step 4: Close the silent 500s.** Read the four routes above. Where a 500 path has neither `logger.error` nor `console.error`, add `logger.error` with the route's existing message style.
- [ ] **Step 5: Verify.** `npx tsx --test tests/unit/logger-sentry.test.ts tests/unit/logger.test.ts tests/unit/logger-scrub.test.ts` PASS. `npm run check:api-envelope-contract` PASS.
- [ ] **Step 6: Commit.** `feat(monitoring): logged errors reach Sentry`

### Task 3: Browser error screens report what they catch

**Files:**
- Create: `src/lib/observability/use-report-boundary-error.ts`, `src/app/global-error.tsx`
- Modify: the six `error.tsx` files in `(site)/(onboarding)`, `(site)/(main)`, `(site)/(auth)`, `(main)/settings`, `(main)/messages`, `(main)/my-profile/edit`
- Test: `tests/unit/error-boundaries-report.test.ts`

**Interfaces:**
- Produces: `shouldReportBoundaryError(error: { digest?: string }): boolean` (false when `digest` is set, because the server already reported it) and `useReportBoundaryError(error: Error & { digest?: string }): void`

- [ ] **Step 1: Write the failing tests.** Assert `shouldReportBoundaryError({ digest: "1" }) === false` and `shouldReportBoundaryError({}) === true`. In the repo's source-check style, assert every `src/app/**/error.tsx` and `global-error.tsx` calls `useReportBoundaryError`.
- [ ] **Step 2: Run them.** `npx tsx --test tests/unit/error-boundaries-report.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the hook and call it in each boundary.** `global-error.tsx` follows `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md`, with its own `<html>` and `<body>` and the same message and retry as `(main)/error.tsx`.
- [ ] **Step 4: Verify.** The test passes. `npm run check:page-contract`, `npm run check:theme-contract` and `npm run typecheck` pass.
- [ ] **Step 5: Commit.** `feat(monitoring): error screens report to Sentry`

### Task 4: Background job failures reach Sentry

**Files:**
- Create: `src/inngest/functions/report-failure-to-sentry.ts`
- Modify: `src/inngest/registry.ts` (worker list)
- Test: `tests/unit/report-failure-to-sentry.test.ts`

**Interfaces:**
- Consumes: Inngest's `inngest/function.failed` event, which fires once after retries run out
- Produces: `reportInngestFailure(data: { function_id: string; run_id: string; error: { name?: string; message: string; stack?: string } }): void`, fingerprinted `["inngest", function_id]`

- [ ] **Step 1: Write the failing tests.** The serialized error becomes an `Error` with the same message and stack, tagged `function_id` and `run_id`. An event whose `function_id` ends in `report-failure-to-sentry` sends nothing. The worker registry includes the function and the web registry stays empty.
- [ ] **Step 2: Run them.** `npx tsx --test tests/unit/report-failure-to-sentry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `inngest.createFunction({ id: "report-failure-to-sentry", retries: 0 }, { event: "inngest/function.failed" }, ...)`. Register it through `loadModule` like its neighbours. Keep the two existing `onFailure` handlers.
- [ ] **Step 4: Verify.** The test passes and `npm run typecheck` passes.
- [ ] **Step 5: Commit.** `feat(monitoring): failed background jobs reach Sentry`

### Task 5: Legal pages and an end-to-end proof

**Files:**
- Modify: `src/app/(legal)/subprocessors/page.tsx:9-14`, `src/app/(legal)/privacy/page.tsx:32` (provider list)

- [ ] **Step 1: Add Sentry.** Subprocessors row: `["Sentry", "Error monitoring", "Error details, technical request and device data, and pseudonymous user identifiers"]`. Privacy section 10: add "Sentry for error monitoring". Run `npm run check:legal-readiness`.
- [ ] **Step 2: Scratch run with the real DSN.** On a scratch copy outside the repo, on port 3100, with `NEXT_PUBLIC_SENTRY_ENVIRONMENT=verification`, add temporary pages and routes that: throw in a Server Component, throw in a route handler, call `logger.error` with fake secrets, `console.error` on the server, throw in a client component (error screen), and throw in a client timeout. Run a production build with source maps uploaded.
- [ ] **Step 3: Confirm in Sentry.** `search_issues` with `environment:verification` shows one issue per trigger, TypeScript file paths in stacks, and none of the fake secrets. Then resolve those issues.
- [ ] **Step 4: Measure.** Re-run `npm run analyze:bundle` and compare with Task 1's numbers against the 60 KB limit.
- [ ] **Step 5: Review.** Run `ponytail-review`, then `review`, and fix findings. Run `npm run test:unit`, `npm run lint`, `npm run check:runtime-boundaries` and `npm run check:review-guardrails`.
- [ ] **Step 6: Commit.** `docs(legal): list Sentry as a subprocessor`

### Task 6: Production rollout (needs the user's separate go-ahead)

- [ ] **Step 1: User creates the token.** Create a Sentry organization auth token with release-upload permission and add it as `SENTRY_AUTH_TOKEN` on `networkbase-web` and `networkbase-worker` in Railway. Claude does not handle this secret.
- [ ] **Step 2: Set `NEXT_PUBLIC_SENTRY_DSN` on both services** with the DSN from `find_dsns`. Confirm `RAILWAY_GIT_COMMIT_SHA` reaches the build.
- [ ] **Step 3: Ship the Sentry commits alone.** Put them directly on top of `origin/main` and push only them, then rebase local `main` on top. The 15 unpushed download and view-count commits have their own rollout steps (migration 0039, a Railway variable, a Cloudflare rule) and stay local.
- [ ] **Step 4: Re-sync the worker in Inngest** so `report-failure-to-sentry` is registered.
- [ ] **Step 5: Add alerts.** Keep alert 2891935 (high-priority issues, email). Add "New production issue": first-seen issues, `production` only, email, 30-minute interval.
- [ ] **Step 6: Add uptime.** `create_uptime_monitor` for `https://networkbase.in/api/v1/live`, every 300 seconds, 10000 ms timeout, down after 2 failures. Confirm Cloudflare lets Sentry's checker through.
- [ ] **Step 7: Prove the browser path on production.** In the built-in browser on `networkbase.in`, run `setTimeout(() => { throw new Error("sentry prod check") })` and confirm the issue appears with `environment:production` and the right release, then resolve it.
- [ ] **Step 8: Prove the server path.** Run `canary`, then compare Railway error logs with Sentry for the first 24 hours; each `[logger]` error should have a matching event. Task 5 proves the code path but no safe trigger exists on production, so report this as unproven until the first real server error matches.
- [ ] **Step 9: Measure.** Compare web and worker memory with Task 1's numbers. Check quota use on Sentry's usage page and confirm the student plan is active.
