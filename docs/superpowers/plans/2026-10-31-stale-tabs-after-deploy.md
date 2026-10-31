# Stale Tabs After a Deploy Implementation Plan

> **Changed while building:** `deploymentId` was removed. On one build with no deploy, a test made every link click a full reload (possibly because that server started without the value). Next.js already reloads a stale tab on navigation through each build's own id, confirmed with two real builds, so the setting isn't needed. Treat the `deploymentId` steps below as superseded.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person with a tab open across a deploy gets a clear way to recover instead of a click that silently does nothing, and each deploy stops creating a false Sentry alert.

**Architecture:** Two small parts. `deploymentId` makes Next.js reload a stale page when the person next navigates. An action fired from a stale page still fails (Next.js throws `UnrecognizedActionError`), so the browser `fetch` wrapper every request already goes through notices the failure once and offers a Reload button.

**Tech Stack:** Next.js 16.4 `deploymentId`, the `window.fetch` wrapper in `SecurityRuntimeProvider`, the `toast` feedback store, Sentry `beforeSend`.

**Spec:** Sentry issue JAVASCRIPT-NEXTJS-K, `Server Action ... was not found on the server`, on `/org/...` right after the deploys of 2026-10-31. Next docs: `01-app/02-guides/self-hosting.md` (Version Skew), `03-api-reference/05-config/01-next-config-js/deploymentId.md`, `01-app/02-guides/server-actions.md` (Deployment considerations: "surface the error as a retry path").

## Global Constraints

- No code until the user says "implement". No push until told, separately.
- Never reload automatically on a failed action: the person may have unsaved typing. Offer the button; a reload on navigation is what Next.js does by design, since navigating leaves the page anyway.
- Another session has uncommitted work in this checkout (`src/app/globals.css`, `src/components/layout/SidebarWorkspaces.tsx`, `tests/browser/org-*`). Stage only this plan's files by name.
- No temporary routes in the repo: the real test runs on a scratch copy on port 3100, with no production values.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Value of `deploymentId` | `process.env.RAILWAY_GIT_COMMIT_SHA \|\| undefined` | Already passed to the Docker build for Sentry's release; local builds stay unchanged |
| Where to notice a failed action | The `window.fetch` wrapper, by the `x-nextjs-action-not-found: 1` response header | One place, and it also sees the 176 files calling actions that catch their own errors and show a generic message |
| Auto reload or a button | A button | Protects unsaved typing |
| Sentry | Drop `UnrecognizedActionError` | Expected on every deploy for anyone with an open tab; a person cannot act on it |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Not set | Only needed across several instances of one build. Add it when running more than one instance |

## What People Will Notice

| Situation | Today | After |
|---|---|---|
| Stale tab, clicks a link | May work, or break oddly | Full page reload, on the new version |
| Stale tab, clicks a button that saves | Nothing happens, or a generic error | Same failure, plus "NetworkBase was updated. Reload to continue." with a Reload button. Their action was not saved, so they repeat it after reloading |
| Sentry | One alert per new action id | None for this error |

## Review Focus

1. A burst of failed actions: one notice, not a stack of them.
2. Next.js renaming its internal header in an upgrade: the feature would silently stop. A test reads the constant from the installed package, so an upgrade fails the test.
3. A response whose headers can't be read (opaque or failed fetch): the wrapper must return it untouched and never throw.
4. Pages with no `<Toaster />` (it is mounted only in `AuthRouteProviders`): legal pages have no actions, but the step below confirms it.
5. `?dpl=` on assets and images: `images.localPatterns` restricts query strings on local images, the service worker in `public/sw.js`, and the CSP must all still work. Task 3 checks them.

---

### Task 1: Notice a failed action once and offer Reload

**Files:** Create `src/lib/deployment/stale-action.ts`. Modify `src/components/providers/SecurityRuntimeProvider.tsx:43`. Test `tests/unit/stale-action.test.ts`.

**Produces:** `isStaleActionResponse(response: Response): boolean` and `withStaleActionNotice(fetchImpl: typeof fetch, notify?: () => void): typeof fetch`.

- [ ] **Step 1: Write the failing tests.** The header value `1` is stale; a missing header or other value is not. The wrapper returns the same response object and calls `notify` once across three stale responses. A rejected fetch rejects unchanged, with no notice. The header name equals `NEXT_ACTION_NOT_FOUND_HEADER` from `next/dist/client/components/app-router-headers`.
- [ ] **Step 2:** Run `npx tsx --test tests/unit/stale-action.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement. Default `notify` calls `toast.info("NetworkBase was updated. Reload to continue.", { action: { label: "Reload", onClick: () => window.location.reload() }, duration: Infinity })`, using the option names `src/lib/feedback` actually supports. Wrap in the provider: `window.fetch = withStaleActionNotice(createCsrfFetch(...))`.
- [ ] **Step 4:** Run it plus `tests/unit/csrf-client.test.ts`, and `npm run check:csp-contract`, which requires `window.fetch = createCsrfFetch`, updating that check's pattern if it is too strict. Expected: PASS. Commit `feat(deploys): a stale tab offers a reload when an action fails`.

### Task 2: Deployment id, and no false Sentry alert

**Files:** Modify `next.config.ts`, `src/lib/observability/sentry-options.ts`. Test `tests/unit/sentry-options.test.ts`.

- [ ] **Step 1: Write the failing test.** `beforeSend` returns null for an exception of type `UnrecognizedActionError`, and keeps other errors.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the filter with a `ponytail:` comment (ceiling: a deploy that breaks every action would not alert; upgrade: count these as a metric). Add `deploymentId: process.env.RAILWAY_GIT_COMMIT_SHA || undefined` to `nextConfig`.
- [ ] **Step 4:** Run `npm run typecheck`, `npm run test:unit`, and `npm run build`. Expected: PASS, and `tsconfig.json` restored if the build touched it. Commit `feat(deploys): stale tabs reload on navigation; deploys stop raising a false alert`.

### Task 3: Prove it with two real builds

On a scratch copy on port 3100, with fake service values and a temporary page that has one server action and one link, using `.claude/launch.json` temporarily and restoring it.

- [ ] **Step 1:** Build as `RAILWAY_GIT_COMMIT_SHA=aaa`, start it, and open the page in the built-in browser. Stop it, rebuild as `bbb` with the action renamed so its id changes, and start it, leaving the tab open.
- [ ] **Step 2:** Click the action. Expected: the notice appears once and Reload loads the `bbb` page. **If the wrapper doesn't see the response** because Next.js holds its own reference to `fetch`, fall back to a `window` `unhandledrejection` listener using `unstable_isUnrecognizedActionError` from `next/navigation`, and record that actions which catch their own errors won't get the notice.
- [ ] **Step 3:** Repeat from a fresh stale tab and click the link. Expected: a full reload onto `bbb`.
- [ ] **Step 4:** Check a page with a local `next/image`, and an asset with `?dpl=`, returns 200 with no CSP errors in the console. Confirm `public/sw.js` does not serve the old build.
- [ ] **Step 5:** Run `ponytail-review`, then `review`, then fix findings.

### Task 4: Rollout (needs the user's separate go-ahead)

- [ ] **Step 1:** Push the commits by name, leaving the other session's work out. Railway builds both services. No Inngest re-sync is needed.
- [ ] **Step 2:** This first deploy can't prove the notice, because tabs open now have no deployment id. Check the site is healthy, Sentry is quiet, and a fresh page's script URLs carry `?dpl=` with the commit. (`<html>` has no `data-dpl-id` here because of the custom root document; the two-build test showed reloads and the notice work anyway.)
- [ ] **Step 3:** On the next deploy, keep a tab open across it and click something. Expected: the notice or a reload, and no Sentry issue.
