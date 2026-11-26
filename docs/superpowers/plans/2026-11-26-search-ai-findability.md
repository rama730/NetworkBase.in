# Search + AI Findability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public NetworkBase workspace, org or profile shows up in Google and Bing under its own name, and when someone pastes its link into Claude, ChatGPT, Gemini or Perplexity, the chatbot can read what it is, the way it can with a GitHub repo.

**Architecture:** Every reader that isn't a browser person (search crawlers, AI crawlers, AI link fetchers, curl) gets a plain server-rendered article with the full public content: title, description, README, open roles, team, recent public updates, schema.org JSON-LD. Every public page also has a clean markdown copy at the same address plus `.md`. The sitemap lists every indexable workspace, org and profile. All content comes from the readers the app already uses for anonymous visitors, so a bot never sees more than a signed-out person can.

**Tech Stack:** Next.js 16.4 (App Router, `sitemap.ts`, `robots.ts`, metadata API), Drizzle, react-markdown 10 + remark-gfm 4 (already installed), node:test via `tsx --test`.

**Spec:** the 2026-11-26 findability report (this conversation; summary in memory `project_search_ai_discoverability.md`). Decision 2026-11-26 (middle option): search engines, AI search bots and AI link readers are **allowed**; AI **training** bots stay **blocked** (GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended, Bytespider, Amazonbot, meta-externalagent). Revisit around 2027-05.

## Global Constraints

- No new dependencies. react-markdown and remark-gfm are already in package.json.
- Read `node_modules/next/dist/docs/01-app/02-guides/json-ld.md` and `.../03-file-conventions/01-metadata/sitemap.md` before Tasks 4 and 6 (Next 16 differs from older versions).
- JSON-LD is written with `JSON.stringify(obj).replace(/</g, '\\u003c')` (Next's own XSS guidance), inside a `<script>` that carries the request nonce from the `x-nonce` header.
- Anonymous only: every piece of bot or markdown content passes `readSharePreview(url)` with **no viewer** (state `ready`) **and** `canReadWorkspaceTab(anonymousAccess, tab)` for its tab. Never widen what a signed-out person sees.
- "Indexable" has one meaning everywhere: `SharePreview.indexable` (src/lib/sharing/read.ts). The sitemap SQL must match it.
- Unlisted workspaces (`visibility = 'unlisted'`) and non-public profiles are never in the sitemap and keep `noindex`. That's the owner's "hide from search" switch. **No new switch is built.**
- User content links get `rel="nofollow ugc"`. README images are dropped (alt text only): no hotlinking, no extra egress.
- Markdown copies are capped at 100,000 characters, with a "… (truncated)" line at the end.
- Commit with `git commit -- <paths>` (shared checkout, shared index). No push, no Railway, no Cloudflare changes until the user says.
- Tests: unit tests in `tests/unit/*.test.ts` (`npm run test:unit`); DB tests in `tests/db/*.test.ts` on a private DB: `NB_TEST_PG_DB=nb_test_findability npm run test:db -- tests/db/<file>`.
- Typecheck: `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` (plain tsc runs out of memory and looks clean).

## Review Focus

1. **Leaks.** A private, unlisted or org-only workspace, a members-only update, a README with `visibilityOverride: members_only`, a hidden tab, or a private profile must never appear in the bot article or the `.md` copy. Tests are in Task 3.
2. **README syntax.** A README that uses smart blocks (`roles`, `files`…) and inline references must read as clean text, not raw `[[…]]` markers. Test in Task 2.
3. **Raw HTML in a README** (`<script>`, `<img onerror>`) must come out escaped in the article and as plain text in the `.md`. Test in Task 2.
4. **Address by id.** `/workspaces/<uuid>.md` must send a 301 to `/workspaces/<slug>.md`, matching what the HTML page does (workspace-route.tsx redirects an id to its slug). There's no slug history table, so an old slug is simply unavailable, the same as on the HTML page. Test in Task 5.
5. **People in a browser never get the bot article.** The UA check matches no normal Chrome, Safari, Firefox or Edge UA, desktop or mobile. Test in Task 1.

---

## Phase 0: Your steps (no code; do these any time, in this order)

These are account settings, so only you can change them. The Cloudflare connection here also isn't signed in.

**Status 2026-11-26:** Cloudflare steps 1–3 and 5 done (robots.txt checked live: training bots disallowed, search and AI readers allowed). Search Console was already verified; `sitemap.xml` was submitted 2026-10-12 (13 pages, last read 2026-11-21), so step 7 only needs a **Resubmit** after Task 6. Bing: site was already added; sitemap submitted 2026-11-26, read same day, Success, 13 URLs. **Phase 0 complete.**

**Cloudflare → networkbase.in**
1. **Security → Settings**, filter **Bot traffic** → **AI Crawler and Agent access policies** (this replaced the old "Block AI bots" switch): **Search** = Allow (do not block), **Agents** = Allow (do not block), **Training** = Disallow, **Enable Bot Preference Sync** on → Save. Disallow + sync writes the training-bot lines into robots.txt and blocks pure training crawlers at the edge; mixed Search+Training crawlers are left alone.
2. **AI Crawl Control → Crawlers**: set **PerplexityBot** to **Allow** (it gets 403 today). Confirm Googlebot, BingBot, OAI-SearchBot, Claude-SearchBot, ChatGPT-User, Claude-User and Perplexity-User show Allow; GPTBot, ClaudeBot, CCBot, Bytespider and Meta-ExternalAgent may show Block.
3. **Security → Settings → Bot traffic → AI Labyrinth**: leave as it is. It only targets bots that ignore robots.txt.
4. Leave **Bot Fight Mode** as it is. Googlebot already gets 200, and the check script below will show if anything breaks.
5. **Caching → Configuration → Crawler Hints: on.** Cloudflare then tells Bing, Yandex and other IndexNow engines when a page changes. That's free IndexNow with no code.

**Google Search Console** (search.google.com/search-console)
6. Add property → **Domain** → `networkbase.in`. It gives you a TXT record. Add it in Cloudflare **DNS** and click Verify.
7. **Sitemaps** → submit `https://networkbase.in/sitemap.xml`. Do this after Task 6 is live, so Google reads the full list the first time.
8. **URL Inspection** → paste 3 to 5 of your best public workspace links → **Request indexing**.

**Bing Webmaster Tools** (bing.com/webmasters)
9. Sign in → **Import from Google Search Console**. This copies the site and sitemap in one click. ChatGPT search leans heavily on Bing's index.

**Privacy wording (your decision)**
10. No change now. Public pages being shown in search and read by AI assistants is already what "public" means, and training stays blocked. If training is ever allowed, the privacy policy must say so first (that bumps `LEGAL_VERSIONS` and shows the re-accept screen), and School/under-18 organizations stay out.

---

## Task 0: Baseline measurement script

**Files:**
- Create: `scripts/check-public-findability.ts`
- Modify: `package.json` (add `"check:findability": "tsx scripts/check-public-findability.ts"`)

**Interfaces:**
- Produces: `npm run check:findability -- [origin]` (default `https://networkbase.in`). It prints one row per URL × reader.

- [ ] **Step 1: Write the script.**
  - URLs: `/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/workspaces/deepscope-ai`, `/workspaces/deepscope-ai.md`, `/org/cse-3b-data-structures-2026`, plus one public profile picked from the live sitemap after Task 6 (pass extras as more CLI args).
  - Readers (exact UA strings):
    - `Googlebot` = `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`
    - `Bingbot` = `Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)`
    - `GPTBot` = `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)`
    - `ClaudeBot` = `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)`
    - `PerplexityBot` = `Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)`
    - `ChatGPT-User` = `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot`
    - `Claude-User` = `Claude-User/1.0`
    - `Chrome` = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`
  - Columns: reader, path, HTTP status, readable characters (HTML with `<script>`/`<style>` removed, tags stripped, whitespace collapsed), `<title>`, robots meta, JSON-LD `@type` list, markdown alternate present (yes/no), and for `/sitemap.xml` the `<loc>` count.
  - Uses `fetch` with `redirect: 'manual'`. No dependencies.
- [ ] **Step 2: Run it against production and paste the table into "Results → Before" at the bottom of this file.**
  Run: `npm run check:findability`
  Expected (today): GPTBot, ClaudeBot and PerplexityBot get 403 (after Phase 0, only GPTBot and ClaudeBot should); Googlebot gets about 200 characters on `/workspaces/deepscope-ai`; `<loc>` count is 13.
- [ ] **Step 3: Commit.** `git commit -m "chore(seo): findability check script + baseline" -- scripts/check-public-findability.ts package.json docs/superpowers/plans/2026-11-26-search-ai-findability.md`

## Task 1: Recognise every non-browser reader

**Files:**
- Modify: `src/lib/sharing/presentation.ts:44-46` (`isShareCrawler`)
- Test: `tests/unit/share-crawler.test.ts`

**Interfaces:**
- Produces: `isShareCrawler(userAgent: string | null): boolean`, same name and signature, wider match. Its three callers (u/[username]/page.tsx, workspace-route.tsx, workspaces/view-record.ts) need no change. AI fetchers stop counting as workspace views, which is right.

- [ ] **Step 1: Write the failing test.**
  - `true` for every UA in Task 0's reader list except Chrome, plus: `OAI-SearchBot/1.0`, `Claude-SearchBot/1.0`, `Perplexity-User/1.0`, `Google-Extended`, `Applebot/0.1`, `meta-externalagent/1.1`, `DuckDuckBot/1.1`, `YandexBot/3.0`, `curl/8.7.1`, `python-requests/2.32`, `Go-http-client/2.0`, `node-fetch`, `''`, `null`.
  - `false` for real browsers: Chrome macOS (above), Chrome Android `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36`, Safari iOS `Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1`, Firefox `Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0`, Edge `… Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0`.
- [ ] **Step 2: Run it and confirm it fails.** `npx tsx --test tests/unit/share-crawler.test.ts` → FAIL on GPTBot, Claude-User, curl and the others.
- [ ] **Step 3: Widen the match.** Rule: a reader if the UA is empty, **or** has no `Mozilla/`, **or** matches the existing list plus `/bot|crawl|spider|slurp|-user\/|searchbot|google-extended|meta-externalagent|facebookexternalhit/i`. Keep the doc comment ("Only reduces crawler work; it never grants access…").
- [ ] **Step 4: Run it and confirm it passes.** Also run `npm run test:unit` for regressions; `messages-mix-share` and the `share-*` tests must still pass.
- [ ] **Step 5: Commit.** `feat(seo): treat AI fetchers, AI crawlers and non-browser clients as readers`

## Task 2: Pure builders for public text, markdown and JSON-LD

**Files:**
- Create: `src/lib/public-pages/text.ts` (no `server-only`; pure functions)
- Test: `tests/unit/public-pages-text.test.ts`

**Interfaces:**
- Consumes: `parseWorkspaceDocSmartBlocks`, `parseWorkspaceDocInlineReferences` from `src/lib/workspaces/doc-blocks.ts`; `SharePreview` from `src/lib/sharing/presentation.ts`.
- Produces (types are used by Tasks 3–5):
```ts
export type PublicUpdate = { id: string; type: string | null; text: string; author: string | null; createdAt: string };
export type PublicWorkspaceSnapshot = {
  preview: SharePreview;               // anonymous, state 'ready'
  kind: 'project' | 'organization';
  readme: { markdown: string; updatedAt: string | null } | null;
  updates: PublicUpdate[];             // newest first, max 5
  updatedAt: string | null;            // workspaces.updated_at
};
export type PublicProfileSnapshot = {
  preview: SharePreview;               // anonymous, state 'ready'
  bio: string | null; location: string | null; website: string | null;
  workspaces: { title: string; url: string; role: string | null }[]; // public contributions, max 20
};
export function readmeToPublicMarkdown(content: string): string;
export function workspaceMarkdown(s: PublicWorkspaceSnapshot): string;
export function profileMarkdown(s: PublicProfileSnapshot): string;
export function workspaceJsonLd(s: PublicWorkspaceSnapshot): Record<string, unknown>;
export function profileJsonLd(s: PublicProfileSnapshot): Record<string, unknown>;
export function jsonLdHtml(data: Record<string, unknown>): string; // JSON.stringify + '<' → '\\u003c'
export const PUBLIC_MARKDOWN_LIMIT = 100_000;
```

- [ ] **Step 1: Write the failing tests.**
  - `readmeToPublicMarkdown`: removes each smart block's `raw`; replaces each inline reference's `raw` with its `label`; keeps other markdown unchanged; trims to `PUBLIC_MARKDOWN_LIMIT` and adds `\n\n… (truncated)`.
  - `workspaceMarkdown` (fixture: title "DeepScope AI", description "See Beyond the Surface of Any Website.", skills `['TypeScript','Next.js']`, roles `[{title:'Frontend developer'}]`, team of 2, README "## Setup\nRun it.", one update) starts with `# DeepScope AI\n\n> See Beyond the Surface of Any Website.`. It contains `Source: https://networkbase.in/workspaces/deepscope-ai`, then the sections `## Skills`, `## Open roles`, `## Team`, `## README`, `## Recent updates`, each left out when empty. The README section repeats the README text unchanged, so `<script>alert(1)</script>` stays literal text (it's markdown, not HTML).
  - `workspaceJsonLd`: project → `@type: 'CreativeWork'`; organization → `@type: 'Organization'`. Has `name`, `description`, `url`, `image` (the og image), `keywords` (skills joined by `, `), `dateModified`; `creator`/`contributor` as `{ '@type': 'Person', name, url: '<origin>/u/<username>' }` (people without a username are left out); `isPartOf: { '@id': 'https://networkbase.in/#website' }`.
  - `profileJsonLd`: `@type: 'ProfilePage'`, `mainEntity: { '@type': 'Person', name, alternateName: '@<username>', description: headline, url, image, knowsAbout: skills, sameAs: [website] if set }`.
  - `jsonLdHtml({ name: '</script><script>x' })` contains `</script` and no `</script`.
- [ ] **Step 2: Run them and confirm they fail.** `npx tsx --test tests/unit/public-pages-text.test.ts` → FAIL (module missing).
- [ ] **Step 3: Write the functions in `src/lib/public-pages/text.ts`.** Get the origin from `new URL(preview.url).origin`; never hard-code it.
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(seo): public markdown + JSON-LD builders`

## Task 3: Anonymous snapshot readers

**Files:**
- Create: `src/lib/public-pages/snapshot.ts` (`import 'server-only'`, **not** a `'use server'` file, so nothing here becomes a callable action)
- Test: `tests/db/public-snapshot.test.ts`

**Interfaces:**
- Consumes: `readSharePreview` (src/lib/sharing/read.ts), `getWorkspaceAccessByIdentifier` + `canReadWorkspaceTab` (src/lib/data/workspace-access.ts), `readWorkspaceDocAction` (src/app/actions/workspace/doc.ts), `readWorkspaceUpdatesAction` (src/app/actions/workspace/updates.ts), `getProfileDetails` (src/lib/data/profile.ts), `shareOrigin`, `readmeToPublicMarkdown`.
- Produces:
```ts
export async function readPublicWorkspaceSnapshot(base: '/workspaces' | '/org', slug: string): Promise<PublicWorkspaceSnapshot | { preview: SharePreview }>;
export async function readPublicProfileSnapshot(username: string): Promise<PublicProfileSnapshot | { preview: SharePreview }>;
```
  When the preview isn't `ready`, it returns `{ preview }` only, so callers render the short "unavailable / private" text exactly as today.

- [ ] **Step 1: Write the failing DB tests** (helpers from `tests/db/_helpers.ts`; supabase stub returns no user, as in `workspace-slug-preview.test.ts`):
  1. A public active workspace with a published README and one public update plus one `visibility='members'` update → `readme.markdown` has the README text; `updates` has exactly 1 entry, the public one.
  2. The same workspace with `public_tab_visibility.readme = false` → `readme === null`. With `updates = false` → `updates` is `[]`.
  3. README `settings.visibilityOverride = 'members_only'` → `readme === null`.
  4. `visibility = 'private'` → only `{ preview }`, with `preview.state === 'restricted'`, and the result's JSON contains no README text.
  5. `visibility = 'unlisted'` → full snapshot, `preview.indexable === false`.
  6. `discover_hidden_at` set → `preview.indexable === false`.
  7. A profile with `visibility = 'private'` → only `{ preview }`, and its `bio` text appears nowhere in the result. A public profile → `bio` is there; `workspaces` lists only public contributions to public workspaces (same rule as `readPublicPortfolio` in read.ts).
- [ ] **Step 2: Run them and confirm they fail.** `NB_TEST_PG_DB=nb_test_findability npm run test:db -- tests/db/public-snapshot.test.ts` → FAIL (module missing).
- [ ] **Step 3: Write `readPublicWorkspaceSnapshot`.**
  - `url = new URL(\`${base}/${encodeURIComponent(slug)}\`, shareOrigin()).href`; `preview = await readSharePreview(url)` (no viewer); if not `ready`, return `{ preview }`.
  - `access = await getWorkspaceAccessByIdentifier(slug, null)`.
  - If `canReadWorkspaceTab(access, 'readme')`: `readWorkspaceDocAction(access.project.id)`. When `success` and `data.version`, set `readme = { markdown: readmeToPublicMarkdown(data.version.content), updatedAt: data.version.createdAt }`.
  - If `canReadWorkspaceTab(access, 'updates')`: `readWorkspaceUpdatesAction(access.project.id)`; take the first 5. Map them to `PublicUpdate`, with `text` = the update content passed through `shareText` and cut to 2,000 characters.
  - Each read is wrapped in `.catch(() => null)` with a `logger.warn('public.snapshot.<part>.unavailable')`. One failed part never fails the page.
  - Both actions read the request session. Bots and the `.md` route carry no session, so they read as anonymous. The anonymous gates above run first either way.
- [ ] **Step 4: Write `readPublicProfileSnapshot`** with the same pattern. `bio`, `location` and `website` come from `getProfileDetails(username, { viewerUser: null })`; `website` goes through `normalizeSafeExternalUrl`.
- [ ] **Step 5: Run them and confirm they pass.** Same command → PASS 7/7.
- [ ] **Step 6: Commit.** `feat(seo): anonymous public snapshots for workspaces, orgs and profiles`

## Task 4: The reader article, JSON-LD and title fix

**Files:**
- Create: `src/components/public-pages/PublicWorkspaceArticle.tsx`, `src/components/public-pages/PublicProfileArticle.tsx` (server components)
- Modify: `src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx:124-128` (replace the stub `<article>`)
- Modify: `src/app/(site)/(main)/u/[username]/page.tsx` (replace the stub `<article>`; keep the `permanentRedirect` line above it)
- Modify: `src/lib/sharing/metadata.ts` (title + markdown alternate)
- Test: `tests/unit/share-metadata-title.test.ts`

**Interfaces:**
- Consumes: Task 2 builders, Task 3 readers.
- Produces: `<PublicWorkspaceArticle base slug />`, `<PublicProfileArticle username />`. `shareMetadata(preview)` now returns `title` ending in ` · NetworkBase` and `alternates.types['text/markdown'] = preview.url + '.md'` when `preview.state === 'ready'` and the kind is project or profile.

- [ ] **Step 1: Write the failing test.**
  - `shareMetadata` on a ready project preview titled "DeepScope AI" → `title === 'DeepScope AI · NetworkBase'`.
  - A profile preview already titled `… · NetworkBase` isn't doubled.
  - `alternates.types['text/markdown'] === 'https://networkbase.in/workspaces/deepscope-ai.md'`.
  - An `unavailable` preview has no markdown alternate.
  - The existing `alternates.canonical` is unchanged.
- [ ] **Step 2: Run it and confirm it fails.** `npx tsx --test tests/unit/share-metadata-title.test.ts`
- [ ] **Step 3: Change `shareMetadata`:** add the brand suffix when the title doesn't already end with `NetworkBase`, and merge `types` into the `alternates` that `buildRouteMetadata` returns.
- [ ] **Step 4: Write the two article components.**
  - Plain semantic HTML: `<article>`, `<h1>`, `<p>`, `<h2>` sections, `<ul>`, in the same order as the markdown from Task 2.
  - README rendered with `react-markdown` + `remark-gfm`, no `rehype-raw` (raw HTML stays escaped). `components.a` adds `rel="nofollow ugc"`; `components.img` renders only its `alt` text.
  - Team names link to `/u/<username>`. Org articles link their public child workspaces when `preview.project` lists them.
  - Ends with `<a href={preview.url}>Open on NetworkBase</a>` and `<a href={preview.url + '.md'}>Markdown version</a>`.
  - JSON-LD: `<script type="application/ld+json" nonce={(await headers()).get('x-nonce') ?? undefined} dangerouslySetInnerHTML={{ __html: jsonLdHtml(...) }} />`.
  - When the snapshot is `{ preview }` only, render exactly today's stub (title, description, "Open NetworkBase").
- [ ] **Step 5: Run the unit tests and the typecheck.** `npm run test:unit` and `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → PASS / 0 errors.
- [ ] **Step 6: Check locally on a scratch copy** (never add temp routes to the repo; scratch copy on :3100). Run: `npm run check:findability -- http://localhost:3100 /workspaces/<a-local-public-slug>`.
  Expected: Googlebot and Claude-User get 200 with more than 1,000 readable characters on a workspace with a README; the JSON-LD types include `CreativeWork`; the Chrome row is unchanged from before.
- [ ] **Step 7: Commit.** `feat(seo): full public article for readers, JSON-LD, branded titles`

## Task 5: Markdown copies at `<page>.md`

**Files:**
- Create: `src/app/md/[kind]/[slug]/route.ts`
- Create: `src/lib/public-pages/markdown-path.ts`
- Modify: `src/proxy.ts` (rewrite before the auth step)
- Test: `tests/unit/markdown-path.test.ts`, plus one case in `tests/db/public-snapshot.test.ts`

**Interfaces:**
- Produces: `markdownRewritePath(pathname: string): string | null`.
  - `/workspaces/x.md` → `/md/workspaces/x`
  - `/org/x.md` → `/md/org/x`
  - `/u/x.md` → `/md/u/x`
  - Anything else → `null`. That includes nested paths, an empty slug, `..`, and slugs outside `^[A-Za-z0-9_-]{1,200}$` (usernames go through `profileSharePath` rules).

- [ ] **Step 1: Write the failing tests** for `markdownRewritePath` with the cases above, plus `/workspaces/x.md/extra` → `null` and `/workspaces/.md` → `null`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Write `markdownRewritePath`.** In `src/proxy.ts`, at the top of the handler (after the scanner-probe check), call it and `NextResponse.rewrite(new URL(target, request.url))` when it returns a path. The proxy matcher already includes `.md` paths; nothing to change there.
- [ ] **Step 4: Write the route handler `GET(req, { params })`.**
  - `kind` is `workspaces | org | u`, otherwise 404.
  - Read the snapshot from Task 3.
  - Not ready → `404` with body `# Not available\n\nThis page is private or doesn't exist.`
  - Ready but `new URL(preview.url).pathname` differs from the requested path → `301` to `<canonical>.md`.
  - Otherwise `200`, `Content-Type: text/markdown; charset=utf-8`, `X-Robots-Tag: noindex` (so Google indexes the HTML page, not the copy), `Link: <canonical>; rel="canonical"`, `Cache-Control: private, max-age=0`, and the body is `workspaceMarkdown` / `profileMarkdown`.
- [ ] **Step 5: Add a DB test case:** the route returns 404 for a private workspace and 301 from `/md/workspaces/<uuid>` to `/workspaces/<slug>.md`.
- [ ] **Step 6: Run all tests and confirm they pass.**
- [ ] **Step 7: Commit.** `feat(seo): markdown copy of every public page at <url>.md`

## Task 6: Full sitemap

**Files:**
- Modify: `src/app/sitemap.ts`
- Test: `tests/db/public-sitemap.test.ts`

**Interfaces:**
- Produces: `sitemap()` returns home + legal + indexable orgs + indexable workspaces + indexable profiles, at most 50,000 URLs (Google's limit per file).

- [ ] **Step 1: Write the failing DB test** (import `sitemap` from `src/app/sitemap.ts`):
  - Includes `https://networkbase.in/` and a public active workspace `/workspaces/<slug>`.
  - Excludes private, unlisted, draft, `discover_hidden_at` set, `suspended_at` set, deleted, and child-of-a-suspended-org workspaces.
  - Includes a public profile `/u/<username>`; excludes private, `connections` and deleted profiles.
  - Every URL appears once.
- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement.**
  - Add `{ url: origin + '/', changeFrequency: 'weekly', priority: 1 }`.
  - Workspaces: `kind = 'project'`, `visibility = 'public'`, `status IN ('active','completed','archived')`, `slug IS NOT NULL`, `deleted_at IS NULL`, `discoverListedSql()`. Priority 0.6, `lastModified = updated_at`. This is the same rule as `indexable` in `readProject`.
  - Profiles: `visibility = 'public'`, `username IS NOT NULL`, `deleted_at IS NULL`, `readableProfileIdentitySql(null)`. Priority 0.5.
  - Keep the org query as is.
  - Workspaces and profiles are ordered by `updated_at DESC`, so the freshest pages survive the cap.
  - Replace the 5,000 ponytail comment with: `// ponytail: one sitemap, 50,000 URLs; split with generateSitemaps (Next 16: id is a Promise<string>) + list each file in robots.ts when public pages pass that.`
- [ ] **Step 4: Run it and confirm it passes.**
- [ ] **Step 5: Commit.** `feat(seo): sitemap lists home, public workspaces and public profiles`

## Task 7: llms.txt and robots.txt

**Files:**
- Modify: `src/lib/agents/tool-reference.ts` (`llmsText`)
- Modify: `src/app/robots.ts`
- Test: `tests/unit/tool-reference.test.ts` (it already covers `llmsText`)

- [ ] **Step 1: Write the failing test:** `llmsText()` contains a `## Public pages` section with these lines: `- Workspaces: https://networkbase.in/workspaces/<slug>`, `- Organizations: https://networkbase.in/org/<handle>`, `- People: https://networkbase.in/u/<username>`, `- Add .md to any of these for a markdown copy.`, `- Sitemap: https://networkbase.in/sitemap.xml`.
- [ ] **Step 2: Run it and confirm it fails; add the section after the summary line; run it and confirm it passes.**
- [ ] **Step 3: robots.ts:** keep the `allow` list as is (`tests/unit/legal-system-contract.test.ts` reads it for the legal paths, and with `User-agent: *` anything not disallowed is allowed anyway). Keep `disallow` as is, plus `/md/` (bots use the `.md` addresses). Add one rule `{ userAgent: TRAINING_BOTS, disallow: '/' }` before the `*` rule, with `const TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'Amazonbot', 'meta-externalagent']`. This repeats Cloudflare's managed block in our own file, so it holds if that setting is ever turned off. Do not list PerplexityBot, OAI-SearchBot, Claude-SearchBot or the `-User` fetchers.
  - Test (add to an existing robots test if there is one, else `tests/unit/robots.test.ts`): `robots().rules` has a rule whose `userAgent` includes all 8 training bots with `disallow: '/'`, and no rule names `PerplexityBot`, `OAI-SearchBot`, `Claude-SearchBot`, `ChatGPT-User` or `Claude-User`.
- [ ] **Step 4: Commit.** `feat(seo): llms.txt public-page guide; robots allows search and AI readers, blocks training bots`

## Task 8: Review, ship, live check

- [ ] **Step 1:** `ponytail-review`, then `review` on the branch diff (CLAUDE.md order). Fix findings.
- [ ] **Step 2:** Full gates: `npm run test:unit`, the three DB test files on `nb_test_findability`, typecheck with 6 GB, `npm run build`, `npm run check:force-dynamic-allowlist`, `npm run check:head-contract`.
- [ ] **Step 3:** Push **only when the user says** (memory rule). Railway auto-deploys; wait for web + worker SUCCESS.
- [ ] **Step 4:** `npm run check:findability -- https://networkbase.in /u/<a-public-username-from-the-sitemap>` and paste the output into "Results → After".
  Pass if:
  - Googlebot, Bingbot, PerplexityBot, ChatGPT-User and Claude-User get 200 (after Phase 0 step 1). GPTBot and ClaudeBot get 403 (blocked by choice).
  - `/robots.txt` disallows the 8 training bots and does not disallow PerplexityBot, OAI-SearchBot or Claude-SearchBot.
  - Googlebot gets more than 1,000 characters on deepscope-ai.
  - `.md` returns `text/markdown`.
  - The sitemap `<loc>` count is greater than 13.
  - The Chrome row is unchanged.
- [ ] **Step 5:** Google Rich Results Test (search.google.com/test/rich-results) on one workspace and one profile: no errors.
- [ ] **Step 6:** Paste `https://networkbase.in/workspaces/deepscope-ai` into Claude, ChatGPT and Gemini, and ask "what is this project and who is on it?". Write down which ones answer from the README.
- [ ] **Step 7:** One week later, Search Console → Pages: indexed count. Railway → egress: compare with the week before. If egress jumps, the fix is a Cloudflare cache rule for the `.md` paths and bot HTML, not code.
- [ ] **Step 8:** `canary` on the live site. Update the memory file.

---

## Results

### Before (Task 0, production, 2026-11-26 after Phase 0)
```
reader        | path                             | status | chars | title                                              | robots                       | json-ld                           | md alt | locs
Googlebot     | /                                | 200    | 6945  | NetworkBase — Find your people. Build something to | index, follow                | Organization,ContactPoint,WebSite | no     |     
Bingbot       | /                                | 200    | 6945  | NetworkBase — Find your people. Build something to | index, follow                | Organization,ContactPoint,WebSite | no     |     
GPTBot        | /                                | 403    | 25    |                                                    |                              |                                   | no     |     
ClaudeBot     | /                                | 403    | 25    |                                                    |                              |                                   | no     |     
PerplexityBot | /                                | 403    | 25    |                                                    |                              |                                   | no     |     
ChatGPT-User  | /                                | 200    | 6945  | NetworkBase — Find your people. Build something to | index, follow                | Organization,ContactPoint,WebSite | no     |     
Claude-User   | /                                | 200    | 6945  | NetworkBase — Find your people. Build something to | index, follow                | Organization,ContactPoint,WebSite | no     |     
Chrome        | /                                | 200    | 6945  | NetworkBase — Find your people. Build something to | index, follow                | Organization,ContactPoint,WebSite | no     |     
Googlebot     | /robots.txt                      | 200    | 3280  |                                                    |                              |                                   | no     |     
Bingbot       | /robots.txt                      | 200    | 3280  |                                                    |                              |                                   | no     |     
GPTBot        | /robots.txt                      | 200    | 3280  |                                                    |                              |                                   | no     |     
ClaudeBot     | /robots.txt                      | 200    | 3280  |                                                    |                              |                                   | no     |     
PerplexityBot | /robots.txt                      | 200    | 3280  |                                                    |                              |                                   | no     |     
ChatGPT-User  | /robots.txt                      | 200    | 3280  |                                                    |                              |                                   | no     |     
Claude-User   | /robots.txt                      | 200    | 3280  |                                                    |                              |                                   | no     |     
Chrome        | /robots.txt                      | 200    | 3280  |                                                    |                              |                                   | no     |     
Googlebot     | /sitemap.xml                     | 200    | 2186  |                                                    |                              |                                   | no     | 13  
Bingbot       | /sitemap.xml                     | 200    | 2186  |                                                    |                              |                                   | no     | 13  
GPTBot        | /sitemap.xml                     | 403    | 25    |                                                    |                              |                                   | no     | 0   
ClaudeBot     | /sitemap.xml                     | 403    | 25    |                                                    |                              |                                   | no     | 0   
PerplexityBot | /sitemap.xml                     | 403    | 25    |                                                    |                              |                                   | no     | 0   
ChatGPT-User  | /sitemap.xml                     | 200    | 2186  |                                                    |                              |                                   | no     | 13  
Claude-User   | /sitemap.xml                     | 200    | 2186  |                                                    |                              |                                   | no     | 13  
Chrome        | /sitemap.xml                     | 200    | 2186  |                                                    |                              |                                   | no     | 13  
Googlebot     | /llms.txt                        | 200    | 16675 |                                                    |                              |                                   | no     |     
Bingbot       | /llms.txt                        | 200    | 16675 |                                                    |                              |                                   | no     |     
GPTBot        | /llms.txt                        | 403    | 25    |                                                    |                              |                                   | no     |     
ClaudeBot     | /llms.txt                        | 403    | 25    |                                                    |                              |                                   | no     |     
PerplexityBot | /llms.txt                        | 403    | 25    |                                                    |                              |                                   | no     |     
ChatGPT-User  | /llms.txt                        | 200    | 16675 |                                                    |                              |                                   | no     |     
Claude-User   | /llms.txt                        | 200    | 16675 |                                                    |                              |                                   | no     |     
Chrome        | /llms.txt                        | 200    | 16675 |                                                    |                              |                                   | no     |     
Googlebot     | /workspaces/deepscope-ai         | 200    | 199   | DeepScope AI                                       | index, follow                | Organization,ContactPoint,WebSite | no     |     
Bingbot       | /workspaces/deepscope-ai         | 200    | 199   | DeepScope AI                                       | index, follow                | Organization,ContactPoint,WebSite | no     |     
GPTBot        | /workspaces/deepscope-ai         | 403    | 25    |                                                    |                              |                                   | no     |     
ClaudeBot     | /workspaces/deepscope-ai         | 403    | 25    |                                                    |                              |                                   | no     |     
PerplexityBot | /workspaces/deepscope-ai         | 403    | 25    |                                                    |                              |                                   | no     |     
ChatGPT-User  | /workspaces/deepscope-ai         | 200    | 3470  | Overview · DeepScope AI · NetworkBase              | noindex, nofollow, noarchive | Organization,ContactPoint,WebSite | no     |     
Claude-User   | /workspaces/deepscope-ai         | 200    | 3470  | Overview · DeepScope AI · NetworkBase              | noindex, nofollow, noarchive | Organization,ContactPoint,WebSite | no     |     
Chrome        | /workspaces/deepscope-ai         | 200    | 3470  | Overview · DeepScope AI · NetworkBase              | noindex, nofollow, noarchive | Organization,ContactPoint,WebSite | no     |     
Googlebot     | /workspaces/deepscope-ai.md      | 200    | 201   | Workspace on NetworkBase                           | noindex, nofollow, noarchive | Organization,ContactPoint,WebSite | no     |     
Bingbot       | /workspaces/deepscope-ai.md      | 200    | 201   | Workspace on NetworkBase                           | noindex, nofollow, noarchive | Organization,ContactPoint,WebSite | no     |     
GPTBot        | /workspaces/deepscope-ai.md      | 403    | 25    |                                                    |                              |                                   | no     |     
ClaudeBot     | /workspaces/deepscope-ai.md      | 403    | 25    |                                                    |                              |                                   | no     |     
PerplexityBot | /workspaces/deepscope-ai.md      | 403    | 25    |                                                    |                              |                                   | no     |     
ChatGPT-User  | /workspaces/deepscope-ai.md      | 200    | 142   | Workspace on NetworkBase                           | noindex                      | Organization,ContactPoint,WebSite | no     |     
Claude-User   | /workspaces/deepscope-ai.md      | 200    | 142   | Workspace on NetworkBase                           | noindex                      | Organization,ContactPoint,WebSite | no     |     
Chrome        | /workspaces/deepscope-ai.md      | 200    | 142   | Workspace on NetworkBase                           | noindex                      | Organization,ContactPoint,WebSite | no     |     
Googlebot     | /org/cse-3b-data-structures-2026 | 200    | 254   | CSE 3B · Data Structures 2026                      | index, follow                | Organization,ContactPoint,WebSite | no     |     
Bingbot       | /org/cse-3b-data-structures-2026 | 200    | 254   | CSE 3B · Data Structures 2026                      | index, follow                | Organization,ContactPoint,WebSite | no     |     
GPTBot        | /org/cse-3b-data-structures-2026 | 403    | 25    |                                                    |                              |                                   | no     |     
ClaudeBot     | /org/cse-3b-data-structures-2026 | 403    | 25    |                                                    |                              |                                   | no     |     
PerplexityBot | /org/cse-3b-data-structures-2026 | 403    | 25    |                                                    |                              |                                   | no     |     
ChatGPT-User  | /org/cse-3b-data-structures-2026 | 200    | 1906  | About · CSE 3B · Data Structures 2026 · NetworkBas | noindex, nofollow, noarchive | Organization,ContactPoint,WebSite | no     |     
Claude-User   | /org/cse-3b-data-structures-2026 | 200    | 1906  | About · CSE 3B · Data Structures 2026 · NetworkBas | noindex, nofollow, noarchive | Organization,ContactPoint,WebSite | no     |     
Chrome        | /org/cse-3b-data-structures-2026 | 200    | 1906  | About · CSE 3B · Data Structures 2026 · NetworkBas | noindex, nofollow, noarchive | Organization,ContactPoint,WebSite | no     |
```
Note: a signed-out browser gets `noindex` on workspace and org pages today; only the crawler branch says `index`.

### After (Task 8, production)
_(paste table)_
