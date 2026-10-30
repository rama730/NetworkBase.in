import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES,
    WORKSPACE_UPDATE_MAX_MEDIA_ITEMS,
    WORKSPACE_UPDATE_MAX_REFERENCES,
    WORKSPACE_UPDATE_MEDIA_BUCKET,
    WORKSPACE_UPDATE_MEDIA_MAX_BYTES,
    WORKSPACE_UPDATE_SCHEMA_CONTRACT,
    composeWorkspaceUpdateRoleLabel,
    isWorkspaceUpdateType,
    isSafeWorkspaceUpdateUrl,
    normalizeWorkspaceUpdateAuthorRoleSnapshot,
    normalizeWorkspaceUpdateMediaItems,
    normalizeWorkspaceUpdateFilter,
    normalizeWorkspaceUpdateReferences,
    normalizeWorkspaceUpdateType,
    projectUpdateDisplayText,
    projectUpdateImageExtensionFromMimeType,
    projectUpdateMediaApplicationUrl,
    projectUpdateDraftStorageKey,
    projectUpdateExcerpt,
    resolveWorkspaceUpdateAuthorRoleDisplay,
    sanitizeWorkspaceUpdateContent,
    sanitizeWorkspaceUpdateRoleTitle,
    shouldNotifyWorkspaceUpdateFollowers,
} from "../../src/lib/workspaces/updates";
import { componentSource } from "./_helpers/component-source";

test("workspace update normalization fails closed for unknown types and filters", () => {
    assert.equal(isWorkspaceUpdateType("progress"), true);
    assert.equal(isWorkspaceUpdateType("on_track"), false);
    assert.equal(isWorkspaceUpdateType("at_risk"), false);
    assert.equal(isWorkspaceUpdateType("status"), false);
    assert.equal(normalizeWorkspaceUpdateType("release"), "release");
    assert.equal(normalizeWorkspaceUpdateType("unknown"), null);
    assert.equal(normalizeWorkspaceUpdateFilter("blocker"), "blocker");
    assert.equal(normalizeWorkspaceUpdateFilter("behind_the_scenes"), "behind_the_scenes");
    assert.equal(normalizeWorkspaceUpdateFilter("unknown"), "all");
    assert.equal(normalizeWorkspaceUpdateFilter(null), "all");
});

test("workspace update content and excerpts are bounded for feed and notification surfaces", () => {
    assert.equal(sanitizeWorkspaceUpdateContent("  shipped beta  "), "shipped beta");
    assert.equal(sanitizeWorkspaceUpdateContent(42), "");
    assert.equal(sanitizeWorkspaceUpdateContent("abcdef", 4), "abcd");
    assert.equal(projectUpdateExcerpt("Alpha\n\nBeta   Gamma", 40), "Alpha Beta Gamma");
    assert.equal(projectUpdateExcerpt("A long update body", 8), "A long…");
});

test("workspace update display text converts legacy reference tokens into readable labels", () => {
    const fileToken = '{% ref.files id="9a0966ed-c08c-4b52-98a1-3453fad1e26d" label="SECURITY.md" %}';
    const taskToken = '{% ref.tasks id="9fbd8943-e594-473c-8f82-5830851d1d7a" label="Task: Update the related files" %}';
    assert.equal(
        projectUpdateDisplayText(`hello ${fileToken} hope you like it`),
        "hello SECURITY.md hope you like it",
    );
    assert.equal(
        projectUpdateExcerpt(`${taskToken} we are working on this task`, 120),
        "Task: Update the related files we are working on this task",
    );
    assert.equal(
        projectUpdateExcerpt("{% project.tasks ids=\"task-1,task-2\" %}", 120),
        "Workspace tasks",
    );
});

test("workspace update notification signal avoids noisy follower fanout", () => {
    assert.equal(shouldNotifyWorkspaceUpdateFollowers({ content: "tiny" }), false);
    assert.equal(shouldNotifyWorkspaceUpdateFollowers({ content: "We finished the first integration pass and merged the end-to-end update flow." }), true);
    assert.equal(shouldNotifyWorkspaceUpdateFollowers({ content: "Linked task", entityRefs: { taskId: "task-1" } }), true);
    assert.equal(shouldNotifyWorkspaceUpdateFollowers({ content: "Linked sprint", entityRefs: { references: [{ kind: "sprint", id: "sprint-1" }] } }), true);
    assert.equal(shouldNotifyWorkspaceUpdateFollowers({ content: "Link", media: [{ type: "link", url: "https://example.com" }] }), true);
});

test("workspace update media normalization keeps only safe public links", () => {
    assert.equal(isSafeWorkspaceUpdateUrl("https://example.com/demo"), true);
    assert.equal(isSafeWorkspaceUpdateUrl("/api/v1/workspaces/project-1/update-media?key=abc"), true);
    assert.equal(isSafeWorkspaceUpdateUrl("blob:https://example.com/demo"), false);
    assert.equal(isSafeWorkspaceUpdateUrl("javascript:alert(1)"), false);
    assert.deepEqual(normalizeWorkspaceUpdateMediaItems([
        { type: "link", url: "https://example.com/demo", label: "Demo" },
        {
            type: "image",
            url: "/api/v1/workspaces/project-1/update-media?key=projects/project-1/update-media/user-1/demo.png",
            label: "Demo image",
            altText: "Screenshot",
            mimeType: "image/png",
            size: 2048,
            width: 1200,
            height: 800,
            bucket: WORKSPACE_UPDATE_MEDIA_BUCKET,
            storageKey: "projects/project-1/update-media/user-1/demo.png",
        },
        { type: "link", url: "javascript:alert(1)", label: "Unsafe" },
        { type: "unknown", url: "https://example.com/nope" },
    ]), [
        {
            type: "link",
            assetId: null,
            url: "https://example.com/demo",
            label: "Demo",
            altText: null,
            mimeType: null,
            size: null,
            width: null,
            height: null,
            bucket: null,
            storageKey: null,
        },
        {
            type: "image",
            assetId: null,
            url: "/api/v1/workspaces/project-1/update-media?key=projects/project-1/update-media/user-1/demo.png",
            label: "Demo image",
            altText: "Screenshot",
            mimeType: "image/png",
            size: 2048,
            width: 1200,
            height: 800,
            bucket: WORKSPACE_UPDATE_MEDIA_BUCKET,
            storageKey: "projects/project-1/update-media/user-1/demo.png",
        },
    ]);
});

test("stored update media always uses the authorized application route", () => {
    const projectId = "9a0966ed-c08c-4b52-98a1-3453fad1e26d";
    const storageKey = `projects/${projectId}/update-media/user/demo.png`;
    const expected = `/api/v1/workspaces/${projectId}/update-media?key=${encodeURIComponent(storageKey)}`;
    assert.equal(projectUpdateMediaApplicationUrl(WORKSPACE_UPDATE_MEDIA_BUCKET, storageKey), expected);
    assert.equal(projectUpdateMediaApplicationUrl("other", storageKey), null);
    assert.equal(projectUpdateMediaApplicationUrl(WORKSPACE_UPDATE_MEDIA_BUCKET, `projects/${projectId}/update-media/../secret`), null);
    assert.equal(normalizeWorkspaceUpdateMediaItems([{
        type: "image",
        url: "https://example.supabase.co/storage/v1/object/public/project-updates-media/legacy.png",
        bucket: WORKSPACE_UPDATE_MEDIA_BUCKET,
        storageKey,
    }])[0]?.url, expected);
});

test("workspace update media route authorizes normalized assets and streams bytes", () => {
    const routeSource = readFileSync(path.join(process.cwd(), "src/app/api/v1/workspaces/[id]/update-media/route.ts"), "utf8");
    const accessSource = readFileSync(path.join(process.cwd(), "src/lib/data/workspace-access.ts"), "utf8");

    assert.match(routeSource, /workspaceUpdateMediaAssets/);
    assert.match(routeSource, /eq\(storageAssets\.state, "verified"\)/);
    assert.match(routeSource, /createSignedUrl\(storageKey, 60\)/);
    assert.match(routeSource, /streamPrivateObject/);
    assert.match(routeSource, /publicTabVisibility: access\.project\.publicTabVisibility/);
    assert.match(routeSource, /private, no-store/);
    assert.equal(routeSource.includes(".from(projects)"), false);
    assert.match(accessSource, /publicTabVisibility\?: unknown/);
    assert.match(accessSource, /publicTabVisibility: workspaces\.publicTabVisibility/);

    assert.match(routeSource, /etag:/);
});

test("workspace update references and image upload contracts stay bounded", () => {
    assert.deepEqual(normalizeWorkspaceUpdateReferences([
        { kind: "task", id: " task-1 " },
        { kind: "task", id: "task-1" },
        { kind: "sprint", id: "sprint-1" },
        { kind: "file", id: "file-1" },
        { kind: "readme", id: "readme-1" },
        { kind: "file", id: "" },
    ]), [
        { kind: "task", id: "task-1" },
        { kind: "sprint", id: "sprint-1" },
        { kind: "file", id: "file-1" },
    ]);
    assert.equal(normalizeWorkspaceUpdateReferences(
        Array.from({ length: WORKSPACE_UPDATE_MAX_REFERENCES + 2 }, (_, index) => ({ kind: "task", id: `task-${index}` })),
    ).length, WORKSPACE_UPDATE_MAX_REFERENCES);
    assert.equal(WORKSPACE_UPDATE_MAX_MEDIA_ITEMS, 4);
    assert.equal(WORKSPACE_UPDATE_MEDIA_MAX_BYTES, 8 * 1024 * 1024);
    assert.equal(WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES.has("image/png"), true);
    assert.equal(WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES.has("image/svg+xml"), false);
    assert.equal(projectUpdateImageExtensionFromMimeType("image/png"), "png");
    assert.equal(projectUpdateImageExtensionFromMimeType("image/webp"), "webp");
    assert.equal(projectUpdateImageExtensionFromMimeType("image/gif"), "gif");
    assert.equal(projectUpdateImageExtensionFromMimeType("image/jpeg"), "jpg");
});

test("workspace update draft and schema contracts are stable", () => {
    assert.equal(projectUpdateDraftStorageKey("project-1", "user-1"), "nb.project-updates.draft.project-1.user-1");
    assert.equal(WORKSPACE_UPDATE_SCHEMA_CONTRACT.tables.includes("workspace_updates"), true);
    assert.equal(WORKSPACE_UPDATE_SCHEMA_CONTRACT.tables.includes("workspace_update_drafts"), true);
    assert.equal(WORKSPACE_UPDATE_SCHEMA_CONTRACT.indexes.includes("workspace_updates_workspace_pinned_created_idx"), true);
    assert.equal(WORKSPACE_UPDATE_SCHEMA_CONTRACT.indexes.includes("workspace_update_comments_parent_idx"), true);
    assert.equal(WORKSPACE_UPDATE_SCHEMA_CONTRACT.indexes.includes("workspace_update_drafts_updated_at_idx"), true);
    assert.equal(WORKSPACE_UPDATE_SCHEMA_CONTRACT.minPolicyCounts.workspace_updates, 3);
    assert.equal(WORKSPACE_UPDATE_SCHEMA_CONTRACT.minPolicyCounts.workspace_update_drafts, 1);
});

test("workspace update comment threading schema is present in the migrations", () => {
    const schemaSource = readFileSync(path.join(process.cwd(), "src/lib/db/schema/index.ts"), "utf8");
    const migration = readFileSync(path.join(process.cwd(), "drizzle/0012_workspace_updates.sql"), "utf8");

    assert.match(schemaSource, /parentId:\s*uuid\(["']parent_id["']\)/);
    assert.match(schemaSource, /workspace_update_comments_parent_idx/);
    assert.match(migration, /parent_id uuid,/);
    assert.match(migration, /FOREIGN KEY \(update_id, parent_id\) REFERENCES public\.workspace_update_comments\(update_id, id\)/);
    assert.match(migration, /workspace_update_comments_parent_idx/);
});

test("workspace update composer stores selected project records as structured refs", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/workspaces/updates/WorkspaceUpdateComposer.tsx"), "utf8");
    assert.match(source, /const addContextReference = \(/);
    assert.match(source, /addContextReference\("file", node\.id/);
    assert.equal(source.includes("buildInlineReadmeReference"), false);
    assert.equal(source.includes("setMentionPickerOpen"), false);
    assert.equal(source.includes("insertTextAtCursor(markdown"), false);
});

test("workspace update notifications avoid duplicate body and secondary text", () => {
    const actionSource = readFileSync(path.join(process.cwd(), "src/app/actions/workspace/updates.ts"), "utf8");
    const rowSource = readFileSync(path.join(process.cwd(), "src/components/notifications/NotificationRow.tsx"), "utf8");
    assert.match(actionSource, /function projectUpdateNotificationBody/);
    assert.match(actionSource, /body: notificationBody/);
    assert.match(actionSource, /secondaryText: null/);
    assert.match(rowSource, /secondaryText !== bodyText/);
    assert.match(rowSource, /projectUpdateDisplayText/);
});

test("updates tab loads feed data once from the client-owned query path", () => {
    const pageSource = readFileSync(path.join(process.cwd(), "src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx"), "utf8");
    const actionSource = readFileSync(path.join(process.cwd(), "src/app/actions/workspace/updates.ts"), "utf8");

    assert.equal(pageSource.includes("readWorkspaceUpdatesAction"), false);
    assert.equal(pageSource.includes("initialUpdatesPage="), false);
    assert.equal(actionSource.includes("function readProjectUpdateMovementSummary"), false);
    assert.match(actionSource, /movementSummary:\s*null/);
});

test("workspace update draft hydration does not immediately autosave an unchanged empty draft", () => {
    const composerSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/updates/WorkspaceUpdateComposer.tsx"), "utf8");

    assert.match(composerSource, /let initialContent = ""/);
    assert.match(composerSource, /let initialVisibility: WorkspaceUpdateVisibility = "public"/);
    assert.match(composerSource, /lastSavedDraftRef\.current = JSON\.stringify\(\{/);
    assert.match(composerSource, /content: initialContent/);
    assert.match(composerSource, /visibility: initialVisibility/);
    assert.match(composerSource, /entityRefs: initialEntityRefs/);
    assert.match(composerSource, /media: initialMedia/);
});

test("the Updates tab listens on one workspace topic, not to database rows", () => {
    const tabSource = componentSource("src/components/workspaces/tabs/UpdatesTab.tsx");
    const liveSource = readFileSync(path.join(process.cwd(), "src/hooks/useUpdateLive.ts"), "utf8");

    assert.equal(tabSource.includes("subscribeActiveResource"), false);
    assert.match(tabSource, /useWorkspaceUpdatesLive\(projectId, Boolean\(currentUserId\), isMember, handleCreated\)/);
    assert.match(liveSource, /`updates:workspace:\$\{projectId\}`/);
    assert.match(liveSource, /subscribeBroadcast\(topic/);
});

test("workspace update likes persist counters synchronously", () => {
    const actionSource = readFileSync(path.join(process.cwd(), "src/app/actions/workspace/updates.ts"), "utf8");

    assert.match(actionSource, /export async function toggleWorkspaceUpdateLikeAction/);
    assert.match(actionSource, /\.update\(workspaceUpdates\)/);
    assert.match(actionSource, /returning\(\{ likeCount: workspaceUpdates\.likeCount \}\)/);
    assert.equal(actionSource.includes("project:updates:likes"), false);
    assert.equal(actionSource.includes("redis.hincrby"), false);
});

test("an update's author reads as job title · access level, and only Owner and Admin are worth naming", () => {
    assert.equal(sanitizeWorkspaceUpdateRoleTitle("  Lead   Front-end Developer  "), "Lead Front-end Developer");
    assert.equal(composeWorkspaceUpdateRoleLabel({ roleTitle: "Frontend Developer", membershipRoleLabel: "Owner" }), "Frontend Developer · Owner");
    assert.equal(composeWorkspaceUpdateRoleLabel({ roleTitle: "UX Designer", membershipRoleLabel: "Admin" }), "UX Designer · Admin");
    assert.equal(composeWorkspaceUpdateRoleLabel({ roleTitle: "UX Designer", membershipRoleLabel: "Member" }), "UX Designer");
    assert.equal(composeWorkspaceUpdateRoleLabel({ roleTitle: "UX Designer", membershipRoleLabel: "Viewer" }), "UX Designer");
    assert.equal(composeWorkspaceUpdateRoleLabel({ roleTitle: null, membershipRoleLabel: "Owner" }), "Owner");
    assert.equal(composeWorkspaceUpdateRoleLabel({ roleTitle: "Product Owner", membershipRoleLabel: "Owner" }), "Product Owner");
});

test("a frozen 'Lead' on an old update never shows: the author's current access level wins", () => {
    const frozen = normalizeWorkspaceUpdateAuthorRoleSnapshot({
        displayRoleLabel: "Lead Full stack developer",
        roleTitle: "Full stack developer",
        membershipRoleLabel: "Lead",
        source: "project_role",
        capturedAt: "2026-06-06T00:00:00.000Z",
    });
    assert.deepEqual(resolveWorkspaceUpdateAuthorRoleDisplay({ snapshot: frozen, projectRoleTitle: "Frontend Developer", membershipRoleLabel: "Owner" }), {
        roleLabel: "Frontend Developer · Owner",
        roleTitle: "Frontend Developer",
        membershipRoleLabel: "Owner",
        roleSource: "project_role",
    });
    // No current title: the job title frozen with the update still says what they did, with today's level.
    assert.deepEqual(resolveWorkspaceUpdateAuthorRoleDisplay({ snapshot: frozen, projectRoleTitle: null, membershipRoleLabel: "Admin" }), {
        roleLabel: "Full stack developer · Admin",
        roleTitle: "Full stack developer",
        membershipRoleLabel: "Admin",
        roleSource: "snapshot",
    });
    const bare = normalizeWorkspaceUpdateAuthorRoleSnapshot({ displayRoleLabel: "Lead", roleTitle: "Lead", membershipRoleLabel: "Lead", source: "membership", capturedAt: "2026-06-06T00:00:00.000Z" });
    assert.deepEqual(resolveWorkspaceUpdateAuthorRoleDisplay({ snapshot: bare, projectRoleTitle: null, membershipRoleLabel: "Owner" }), {
        roleLabel: "Owner",
        roleTitle: null,
        membershipRoleLabel: "Owner",
        roleSource: "membership",
    });
    // Titles saved with the old role word attached lose it.
    for (const roleTitle of ["Lead / Tester", "Tester - Lead", "Co-lead · Tester"]) {
        assert.equal(resolveWorkspaceUpdateAuthorRoleDisplay({ snapshot: null, projectRoleTitle: roleTitle, membershipRoleLabel: "Member" }).roleLabel, "Tester", roleTitle);
    }
    assert.equal(resolveWorkspaceUpdateAuthorRoleDisplay({ snapshot: null, projectRoleTitle: "Lead - Lead", membershipRoleLabel: "Owner" }).roleLabel, "Owner");
    // "Lead Designer" is someone's real job title, not an access level.
    assert.equal(resolveWorkspaceUpdateAuthorRoleDisplay({ snapshot: null, projectRoleTitle: "Lead Designer", membershipRoleLabel: "Member" }).roleLabel, "Lead Designer");
});

test("updates tab right rail stays a shortcut index instead of a duplicate feed", () => {
    const source = componentSource("src/components/workspaces/tabs/UpdatesTab.tsx");
    const railStart = source.indexOf("function UpdatesRightRail");
    const detailStart = source.indexOf("function UpdateDetailPanel");
    assert.notEqual(railStart, -1);
    assert.notEqual(detailStart, -1);

    const railSource = source.slice(railStart, detailStart);
    assert.match(railSource, /Update shortcuts/);
    assert.match(railSource, /postingMembers/);
    assert.match(railSource, /latestByAuthor/);
    assert.match(railSource, /updateAuthorRoleLabel/);
    assert.match(railSource, /updateRelativeTime\(update\.createdAt, "long"\)/);
    assert.match(railSource, /truncate text-sm/);
    assert.equal(railSource.includes("RIGHT_RAIL_PREVIEW_LIMIT"), false);
    assert.equal(railSource.includes("View all updates"), false);
    assert.equal(railSource.includes("Write first update"), false);
    assert.equal(railSource.includes("likeCount"), false);
    assert.equal(railSource.includes("commentCount"), false);
    assert.equal(railSource.includes("updatePreviewText"), false);
    assert.equal(railSource.includes("line-clamp"), false);
    assert.equal(railSource.includes("Latest project posts from the team."), false);

    [
        "Movement",
        "Moving today",
        "Follower signal",
        "Contributor momentum",
        "View as visitor",
        "Latest movement",
        "Linked work",
        "Publishing guidance",
        "Work links",
        "movement.pulse",
    ].forEach((copy) => {
        assert.equal(railSource.includes(copy), false, `${copy} should not render in the default updates rail`);
    });
});

test("updates tab owns one composer placement and refreshes realtime posts directly", () => {
    const tabSource = componentSource("src/components/workspaces/tabs/UpdatesTab.tsx");
    const composerSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/updates/WorkspaceUpdateComposer.tsx"), "utf8");

    assert.match(tabSource, /const isDesktopUpdatesRail = useMediaMatch\("\(min-width: 1280px\)"\)/);
    assert.match(tabSource, /isDesktopUpdatesRail === false/);
    assert.match(tabSource, /isDesktopUpdatesRail === true/);
    assert.match(tabSource, /invalidateQueries\(\{ queryKey: updatesQueryKey \}\)/);
    assert.equal(tabSource.includes("New updates available"), false);
    assert.equal(tabSource.includes("newUpdatesAvailable"), false);
    assert.equal(tabSource.includes("composerOpenSignal"), false);
    assert.equal(tabSource.includes("onWriteFirstUpdate"), false);
    assert.equal(tabSource.includes("onViewAll"), false);
    assert.equal(composerSource.includes("openSignal"), false);
});

test("workspace update composer renders structured context and image media before posting", () => {
    const composerSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/updates/WorkspaceUpdateComposer.tsx"), "utf8");

    assert.match(composerSource, /ImagePlus/);
    assert.match(composerSource, /createWorkspaceUpdateMediaUploadUrlAction/);
    assert.match(composerSource, /finalizeWorkspaceUpdateMediaUploadAction/);
    assert.match(composerSource, /uploadToSupabaseSignedUrl/);
    assert.match(composerSource, /WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES/);
    assert.match(composerSource, /WORKSPACE_UPDATE_MEDIA_MAX_BYTES/);
    assert.match(composerSource, /pendingMediaUploads/);
    assert.equal(composerSource.includes("selectedReferences"), false);
    assert.match(composerSource, /normalizeWorkspaceUpdateReferences\(entityRefs\.references\)/);
    assert.match(composerSource, /references: normalizeWorkspaceUpdateReferences\(entityRefs\.references\)/);
    assert.match(composerSource, /WorkspaceUpdateMediaFrame/);
    assert.match(composerSource, /isWorkspaceUpdateVideoMedia\(item\)/);
    assert.match(composerSource, /src=\{item\.previewUrl\}/);
    assert.match(composerSource, /src=\{item\.url\}/);
    assert.match(composerSource, /handleImageFiles\(event\.dataTransfer\.files\)/);
    assert.match(composerSource, /selectedFiles\.slice\(0, remainingSlots\)/);
    assert.equal(composerSource.includes("EMPTY_SELECTED_CONTEXT"), false);
});

test("updates feed and detail render context references and actual images", () => {
    const tabSource = componentSource("src/components/workspaces/tabs/UpdatesTab.tsx");
    const mediaFrameSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/updates/WorkspaceUpdateMediaFrame.tsx"), "utf8");
    const referenceLinkStart = tabSource.indexOf("function ReferenceLink");
    const rendererStart = tabSource.indexOf("function UpdateContextAndMedia");
    const cardStart = tabSource.indexOf("function UpdateCard");
    const detailStart = tabSource.indexOf("function UpdateDetailPanel");
    assert.notEqual(referenceLinkStart, -1);
    assert.notEqual(rendererStart, -1);
    assert.notEqual(cardStart, -1);
    assert.notEqual(detailStart, -1);

    const referenceLinkSource = tabSource.slice(referenceLinkStart, rendererStart);
    const clickableReferenceStart = referenceLinkSource.indexOf("return (\n    <a");
    const clickableReferenceEnd = referenceLinkSource.indexOf("</a>", clickableReferenceStart);
    assert.notEqual(clickableReferenceStart, -1);
    assert.notEqual(clickableReferenceEnd, -1);
    const clickableReferenceSource = referenceLinkSource.slice(clickableReferenceStart, clickableReferenceEnd);
    const rendererSource = tabSource.slice(rendererStart, cardStart);
    const cardSource = tabSource.slice(cardStart, detailStart);
    const detailSource = tabSource.slice(detailStart);

    assert.match(tabSource, /type UpdateReferenceLinkKind = "task" \| "sprint" \| "file"/);
    assert.match(tabSource, /function normalizeUpdateReferenceLinkKind/);
    assert.match(tabSource, /if \(kind === "file"\) return `\/workspaces\/\$\{slug\}\?tab=files&fileId=\$\{id\}`/);
    assert.match(tabSource, /update\.context\.references/);
    assert.match(tabSource, /update\.context\.task/);
    assert.match(referenceLinkSource, /resolveWorkspaceUpdateMentionTargetAction/);
    assert.match(referenceLinkSource, /referenceFallbackHref/);
    assert.match(referenceLinkSource, /const normalizedKind = normalizeUpdateReferenceLinkKind\(reference\.kind\)/);
    assert.match(referenceLinkSource, /kind: normalizedKind/);
    assert.match(clickableReferenceSource, /href=\{fallbackHref\}/);
    assert.match(clickableReferenceSource, /hover:underline/);
    assert.equal(clickableReferenceSource.includes("bg-blue-50"), false);
    assert.equal(clickableReferenceSource.includes("rounded"), false);
    assert.equal(clickableReferenceSource.includes("border"), false);
    assert.equal(tabSource.includes("getBreadcrumbs("), false);
    assert.match(rendererSource, /item\.type === "image"/);
    assert.match(rendererSource, /WorkspaceUpdateMediaFrame/);
    assert.match(rendererSource, /WorkspaceUpdateMediaViewer/);
    assert.match(rendererSource, /setViewerMedia\(item\)/);
    assert.equal(rendererSource.includes("href={item.url}"), false);
    assert.match(rendererSource, /isWorkspaceUpdateVideoMedia\(item\)/);
    assert.match(rendererSource, /inline-flex min-w-0 items-center font-mono text-xs text-foreground/);
    assert.equal(rendererSource.includes("rounded-xl border border-zinc-200 px-3 py-2"), false);
    assert.match(rendererSource, /mt-2 space-y-2/);
    assert.match(mediaFrameSource, /data-project-update-media-frame="true"/);
    assert.match(mediaFrameSource, /data-media-orientation=\{orientation\}/);
    assert.match(mediaFrameSource, /onOpen\?: \(\) => void/);
    assert.match(mediaFrameSource, /type="button"/);
    assert.match(mediaFrameSource, /return "10 \/ 16"/);
    assert.match(mediaFrameSource, /if \(!ratio\) return "portrait"/);
    assert.match(mediaFrameSource, /return "portrait"/);
    assert.match(mediaFrameSource, /max-w-\[320px\]/);
    assert.equal(mediaFrameSource.includes("square"), false);
    assert.equal(mediaFrameSource.includes("max-w-[360px]"), false);
    assert.equal(mediaFrameSource.includes("max-w-[420px]"), false);
    assert.equal(mediaFrameSource.includes("max-w-[560px]"), false);
    assert.match(mediaFrameSource, /object-cover object-center/);
    assert.match(mediaFrameSource, /data-media-load-state=\{loadState\}/);
    assert.match(mediaFrameSource, /onLoad=\{\(\) => setLoadState\("ready"\)\}/);
    assert.match(mediaFrameSource, /onLoadedData=\{\(\) => setLoadState\("ready"\)\}/);
    assert.match(mediaFrameSource, /Loading media/);
    assert.equal(mediaFrameSource.includes("mx-auto"), false);
    assert.equal(mediaFrameSource.includes("w-fit"), false);
    assert.equal(rendererSource.includes("UpdateContextIcon"), false);
    assert.match(cardSource, /<WorkspaceUpdateContent/);
    assert.match(detailSource, /<WorkspaceUpdateContent/);
    assert.match(cardSource, /<UpdateContextAndMedia update=\{update\} \/>/);
    assert.match(cardSource, /border-b border-border\/80 px-1 py-3/);
    assert.match(tabSource, /const UPDATE_CARD_CONTROL_SELECTOR/);
    assert.match(tabSource, /const control = target\.closest\(UPDATE_CARD_CONTROL_SELECTOR\)/);
    assert.match(tabSource, /control && control !== card/);
    assert.match(cardSource, /role="button"/);
    assert.match(cardSource, /tabIndex=\{isEditing \? -1 : 0\}/);
    assert.match(cardSource, /isEditing \|\| event\.defaultPrevented \|\| isUpdateCardControl\(event\.target, event\.currentTarget\)/);
    assert.match(cardSource, /onOpenDetail\(update\.id\)/);
    assert.match(cardSource, /!isEditing && "cursor-pointer hover:bg-muted\/30/);
    assert.match(cardSource, /size=\{34\}/);
    assert.match(cardSource, /gap-x-1\.5 gap-y-0\.5 text-sm leading-5/);
    assert.match(cardSource, /className="mt-1 block w-full whitespace-pre-wrap/);
    assert.doesNotMatch(cardSource, /<div\s+role="button"/);
    assert.match(cardSource, /text-\[15px\] leading-relaxed text-foreground\/90/);
    assert.match(cardSource, /mt-2\.5 flex items-center gap-2 font-mono text-xs text-muted-foreground/);
    assert.match(detailSource, /<UpdateContextAndMedia update=\{update\} compact \/>/);
    assert.match(detailSource, /py-4 pr-1/);
    assert.match(detailSource, /border-b border-border pb-4/);
    assert.match(detailSource, /size=\{34\}/);
    assert.match(detailSource, /mt-1 whitespace-pre-wrap break-words text-\[15px\] leading-relaxed/);
    assert.match(detailSource, /mt-2\.5 flex items-center gap-2 font-mono text-xs text-muted-foreground/);
    assert.equal(cardSource.includes("Object.entries(update.context"), false);
    assert.equal(cardSource.includes("Object.values(update.context"), false);
});

test("workspace update comments and replies use the compact feed conversation layout", () => {
    const tabSource = componentSource("src/components/workspaces/tabs/UpdatesTab.tsx");
    const commentRowStart = tabSource.indexOf("function CommentRow");
    const updateCommentsStart = tabSource.indexOf("function UpdateComments");
    const updateCardStart = tabSource.indexOf("function UpdateCard");
    assert.notEqual(commentRowStart, -1);
    assert.notEqual(updateCommentsStart, -1);
    assert.notEqual(updateCardStart, -1);

    const commentRowSource = tabSource.slice(commentRowStart, updateCommentsStart);
    const updateCommentsSource = tabSource.slice(updateCommentsStart, updateCardStart);

    assert.match(commentRowSource, /relative flex gap-2\.5 rounded-\[5px\] px-1/);
    assert.match(tabSource, /import \{ ThreadAvatarRail, ThreadRailBridge \} from "@\/components\/ui\/ThreadRail"/);
    assert.match(commentRowSource, /<ThreadAvatarRail incoming=\{!isFirst\} outgoing=\{!isLast\}>/);
    assert.equal(tabSource.includes("-z-10 left-[15px]"), false);
    assert.match(commentRowSource, /flex flex-wrap items-baseline gap-x-1\.5 gap-y-0\.5 text-\[13px\] leading-4/);
    assert.match(commentRowSource, /mt-1 whitespace-pre-wrap break-words text-\[13px\] leading-/);
    assert.match(commentRowSource, /mt-2 flex items-center gap-2/);
    assert.match(commentRowSource, /mt-2\.5 rounded-\[6px\] border border-border/);
    assert.match(commentRowSource, /size=\{24\}/);
    assert.equal(commentRowSource.includes("rounded-2xl bg-zinc-50 px-3 py-2"), false);
    assert.equal(commentRowSource.includes("mt-1 whitespace-pre-wrap break-words text-sm"), false);

    assert.match(updateCommentsSource, /rounded-\[5px\] transition-colors duration-\[180ms\]/);
    assert.match(updateCommentsSource, /bg-muted\/30 px-2 py-1/);
    assert.match(updateCommentsSource, /mt-2 flex min-h-0 flex-col border-t/);
    assert.match(updateCommentsSource, /min-h-0 flex-1 space-y-0\.5 overflow-y-auto/);
    assert.match(updateCommentsSource, /mb-1\.5 mt-1\.5 flex shrink-0 gap-2 pl-10/);
    assert.match(updateCommentsSource, /mb-2 flex shrink-0 gap-2/);
    assert.match(updateCommentsSource, /size=\{28\}/);
    assert.match(updateCommentsSource, /h-8 min-w-0 flex-1/);
    assert.match(updateCommentsSource, /nb-skeleton h-8 shrink-0 rounded-\[5px\]/);
    assert.match(updateCommentsSource, /min-h-0 flex-1 space-y-1\.5 overflow-y-auto/);
    assert.equal(updateCommentsSource.includes("rounded-2xl bg-zinc-50 px-3 py-2"), false);
    assert.equal(updateCommentsSource.includes("mt-1 whitespace-pre-wrap break-words text-sm"), false);
});

test("workspace updates use the feed icon in project navigation", () => {
    const layoutSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/dashboard/WorkspaceLayout.tsx"), "utf8");

    assert.match(layoutSource, /\{ id: "updates", label: WORKSPACE_TAB_LABELS.updates, icon: Newspaper \}/);
    assert.equal(layoutSource.includes('icon: Megaphone'), false);
});

test("workspace update backend treats references as first-class linked work", () => {
    const actionsSource = readFileSync(path.join(process.cwd(), "src/app/actions/workspace/updates.ts"), "utf8");

    assert.match(actionsSource, /const refs = normalizeEntityRefs\(row\.entityRefs\)/);
    assert.match(actionsSource, /for \(const reference of refs\.references \?\? \[\]\)/);
    assert.match(actionsSource, /if \(reference\.kind === "task"\) taskIds\.add\(reference\.id\)/);
    assert.match(actionsSource, /shouldNotifyWorkspaceUpdateFollowers\(\{ content, entityRefs, media \}\)/);
    assert.match(actionsSource, /const hasReferences = normalizeWorkspaceUpdateReferences\(entityRefs\.references\)\.length > 0/);
    assert.match(actionsSource, /!content\.trim\(\) && !hasReferences && media\.length === 0/);
    assert.match(actionsSource, /export async function resolveWorkspaceUpdateMentionTargetAction/);
    assert.match(actionsSource, /function projectSprintHref/);
    assert.match(actionsSource, /function encodeProjectNodePath/);
    assert.match(actionsSource, /function projectFileHref\(project: \{ id: string; slug: string \| null \}, row: \{ id: string; path: string \| null; name: string \}\)/);
    assert.match(actionsSource, /const fileId = encodeURIComponent\(row\.id\)/);
    assert.match(actionsSource, /tab=files&fileId=\$\{fileId\}&path=\$\{encodedPath\}/);
    assert.match(actionsSource, /pathParts\.map\(\(part\) => encodeURIComponent\(part\)\)\.join\("\/"\)/);
    assert.match(actionsSource, /canReadProjectUpdateTargetTab/);
    assert.equal(actionsSource.includes("encodeURIComponent(pathOrName)"), false);
});

test("workspace update file mentions survive the dashboard and Files V3 handoff", () => {
    const dashboardSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx"), "utf8");
    const tabsRegistrySource = readFileSync(path.join(process.cwd(), "src/components/workspaces/dashboard/WorkspaceTabsRegistry.tsx"), "utf8");
    const filesRootSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/v2/files-tab/FilesTabRoot.tsx"), "utf8");

    assert.match(dashboardSource, /const initialOpenFileId = searchParams\?\.get\('fileId'\) \|\| null/);
    assert.match(dashboardSource, /initialOpenFileId=\{initialOpenFileId\}/);
    assert.match(tabsRegistrySource, /files-tab\/FilesTabRoot/);
    assert.match(filesRootSource, /initialOpenFileId\?: string \| null/);
    assert.match(filesRootSource, /const navigateToInitialFile = useNavigateTo\(projectId\)/);
    assert.match(filesRootSource, /getNodeMetadataBatch\(projectId, \[initialOpenFileId\], \{\s*includeBreadcrumbs: true,?\s*\}\)/);
    assert.match(filesRootSource, /upsertNodes\(projectId, result\.data\.nodes\)/);
    assert.match(filesRootSource, /handledInitialFileIdRef/);
    assert.match(filesRootSource, /nodesById\[initialOpenFileId\]\?\.type === "file"/);
    assert.match(filesRootSource, /navigateToInitialFile\(initialOpenFileId\)/);
    assert.match(filesRootSource, /stage: initialOpenFileId \? "diagnostics" : stage/);
});

test("workspace update task mentions keep retrying until the task panel opens", () => {
    const tasksTabSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/v2/TasksTab.tsx"), "utf8");

    assert.match(tasksTabSource, /const loadingInitialOpenTaskRef = useRef<string \| null>\(null\)/);
    assert.match(tasksTabSource, /if \(loadingInitialOpenTaskRef\.current === initialOpenTaskId\) return/);
    assert.match(tasksTabSource, /handledInitialOpenTaskRef\.current = initialOpenTaskId;\s*\n\s*openTask\(localTask, initialPanelTab(?:, true)?\);\s*\n\s*onInitialTaskOpened\?\.\(\)/);
    assert.match(tasksTabSource, /handledInitialOpenTaskRef\.current = initialOpenTaskId;\s*\n\s*openTask\(normalizedTask, initialPanelTab(?:, true)?\);\s*\n\s*onInitialTaskOpened\?\.\(\)/);
    assert.equal(
        /handledInitialOpenTaskRef\.current = initialOpenTaskId;\s*\n\s*const localTask/.test(tasksTabSource),
        false,
        "TasksTab must not mark the deep-link request handled before a local or fetched task actually opens",
    );
});

test("updates tab balances the feed with a bounded responsive supporting rail", () => {
    const tabSource = componentSource("src/components/workspaces/tabs/UpdatesTab.tsx");
    const layoutSource = readFileSync(path.join(process.cwd(), "src/components/workspaces/dashboard/WorkspaceLayout.tsx"), "utf8");

    assert.match(tabSource, /xl:grid-cols-\[minmax\(0,1fr\)_440px\]/);
    assert.match(tabSource, /gap-8/);
    assert.match(tabSource, /hidden w-full min-w-0 xl:block xl:w-\[440px\] shrink-0 border-l border-border pl-6/);
    assert.match(tabSource, /sticky top-\[calc\(var\(--workspace-tabs-height,42px\)\+1rem\)\]/);
    assert.equal(tabSource.includes("_300px"), false);
    assert.match(layoutSource, /isUpdatesTab\s*\n\s*\? "w-full p-4 sm:py-5 sm:pl-5 sm:pr-6"/);
});
