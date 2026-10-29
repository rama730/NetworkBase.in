import assert from "node:assert/strict";
import Module from "node:module";
import { before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { DiscoverUpdateView } from "@/types/discover";

// The card pulls in server-action modules, which read validated environment on import.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
let DiscoverUpdateCard: typeof import("@/components/discover/DiscoverUpdateCard").default;
let updatePages: typeof import("@/components/projects/updates/update-helpers").updatePages;
let updateRelativeTime: typeof import("@/components/projects/updates/update-helpers").updateRelativeTime;
const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
before(async () => {
    // The thread's server actions import "server-only", which only Next's bundler resolves.
    const originalLoad = loader._load;
    loader._load = (request, ...args) => (request === "server-only" ? {} : originalLoad(request, ...args));
    DiscoverUpdateCard = (await import("@/components/discover/DiscoverUpdateCard")).default;
    ({ updatePages, updateRelativeTime } = await import("@/components/projects/updates/update-helpers"));
    loader._load = originalLoad;
});

const update = (patch: Partial<DiscoverUpdateView> = {}): DiscoverUpdateView => ({
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    projectName: "DeepScope AI",
    projectSlug: "deepscope-ai",
    projectCoverImage: null,
    author: { id: "33333333-3333-4333-8333-333333333333", fullName: "Asha Rao", username: "asha", avatarUrl: null, roleLabel: "Lead Frontend developer", masked: false },
    content: "Shipped the **new** importer.",
    updateType: "progress",
    media: [],
    isPinned: false,
    likeCount: 3,
    commentCount: 2,
    likedByViewer: false,
    replyPolicy: "logged_in",
    canComment: true,
    canEdit: false,
    canDelete: false,
    editedAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...patch,
});

const render = (value: DiscoverUpdateView) => renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() },
        createElement(DiscoverUpdateCard, { update: value, viewerId: "viewer", onOpen: () => {}, onHide: () => {}, onVisitProject: () => {} })),
);

test("an update card leads with its author and names its project in the footer", () => {
    const html = render(update());
    assert.doesNotMatch(html, />Update</, "no Update badge");
    assert.ok(html.indexOf("Asha Rao") < html.indexOf("DeepScope AI"), "author comes before the workspace name");
    assert.match(html, /href="\/projects\/deepscope-ai"/);
    assert.doesNotMatch(html, /<img/, "a project without a cover shows no placeholder picture");
    assert.match(html, /Lead Frontend developer/);
    assert.match(html, /<time[^>]*dateTime="2026-10-01T10:00:00.000Z"/);
});

test("the like control is a toggle with a name that says what it does", () => {
    const html = render(update());
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /aria-label="Like this update/);
    assert.match(render(update({ likedByViewer: true })), /aria-pressed="true"/);
});

test("Markdown in an update renders instead of showing its markers", () => {
    const html = render(update());
    assert.match(html, /<strong>new<\/strong>/);
    assert.doesNotMatch(html, /\*\*new\*\*/);
});

test("a private author shows no name or profile link", () => {
    const html = render(update({ author: { id: "44444444-4444-4444-8444-444444444444", fullName: null, username: null, avatarUrl: null, roleLabel: null, masked: true } }));
    assert.match(html, /Private member/);
    assert.doesNotMatch(html, /href="\/u\//);
});

test("updatePages patches pages of updates and leaves every other cache shape alone", () => {
    const bump = <T extends { id: string }>(item: T) => ({ ...item, likeCount: 9 });
    const pages = { pages: [{ updates: [{ id: "a", likeCount: 0 }], nextCursor: null }], pageParams: [undefined] };
    const patched = updatePages(pages as never, bump as never) as unknown as typeof pages;
    assert.equal(patched.pages[0]!.updates[0]!.likeCount, 9);

    const comments = { pages: [{ comments: [{ id: "c" }] }], pageParams: [undefined] };
    assert.deepEqual(updatePages(comments as never, bump as never), comments);
    assert.equal(updatePages(undefined, bump as never), undefined);
});

test("relative time never reads \"12 months\": a count that would round to 12 falls through to weeks", () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    assert.equal(updateRelativeTime(new Date().toISOString()), "Just now");
    assert.match(updateRelativeTime(daysAgo(350)), /50\s?w/i);
    assert.match(updateRelativeTime(daysAgo(366)), /year|yr|1/i);
    assert.match(updateRelativeTime(daysAgo(45)), /mo|month/i);
    assert.equal(updateRelativeTime("not a date"), "");
});
