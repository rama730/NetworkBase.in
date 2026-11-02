import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getWorkspaceAvatarUrl } from "@/components/workspaces/WorkspaceAvatar";
import { componentSource } from "./_helpers/component-source";
import { projectActionsSource } from "./_workspace-actions-source";

const ROOT = process.cwd();

test("getWorkspaceAvatarUrl resolves across all valid cover image fields and trims whitespace", () => {
    assert.equal(getWorkspaceAvatarUrl({ coverImage: "https://example.com/logo.png" } as any), "https://example.com/logo.png");
    assert.equal(getWorkspaceAvatarUrl({ cover_image: "https://example.com/logo2.png" } as any), "https://example.com/logo2.png");
    assert.equal(getWorkspaceAvatarUrl({ coverImageUrl: "https://example.com/logo3.png" } as any), "https://example.com/logo3.png");
    assert.equal(getWorkspaceAvatarUrl({ coverImage: "  https://example.com/logo4.png  " } as any), "https://example.com/logo4.png");
    assert.equal(getWorkspaceAvatarUrl({ coverImage: "" } as any), null);
    assert.equal(getWorkspaceAvatarUrl({ coverImage: "   " } as any), null);
    assert.equal(getWorkspaceAvatarUrl({} as any), null);
    assert.equal(getWorkspaceAvatarUrl(null), null);
    assert.equal(getWorkspaceAvatarUrl(undefined), null);
});

test("WorkspaceLayout conditionally renders WorkspaceAvatar scoped to two lines with zero-presence fallback and clean metadata row", () => {
    const layoutSource = readFileSync(resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceLayout.tsx"), "utf-8");

    assert.match(layoutSource, /import WorkspaceAvatar from "@\/components\/workspaces\/WorkspaceAvatar"/);
    assert.match(layoutSource, /<WorkspaceAvatar\s+project=\{project\}\s+size="detail"[\s\S]*?placeholder/);

    // One layout: the slot beside the title and tagline, then the people row under them.
    assert.match(layoutSource, /<WorkspaceAvatar[\s\S]*?nb-page-title[\s\S]*?shortDescription[\s\S]*?\{projectIdentityMetadata\}/);

    // Line 3: update date removed completely
    assert.doesNotMatch(layoutSource, /data-testid="project-presence-indicator"/);
});

test("ProjectCard conditionally renders WorkspaceAvatar with card-size lockup and zero-presence fallback", () => {
    const cardSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceCard.tsx"), "utf-8");

    assert.match(cardSource, /import WorkspaceAvatar,\s*\{\s*getWorkspaceAvatarUrl\s*\}\s*from\s*"@\/components\/workspaces\/WorkspaceAvatar"/);
    assert.match(cardSource, /const coverUrl = getWorkspaceAvatarUrl\(project\);/);
    assert.match(cardSource, /<WorkspaceAvatar\s+project=\{project\}\s+size="card"/);

    // Verify zero-presence fallback branch exists
    assert.match(cardSource, /:\s*\(\s*<>\s*<div className="flex flex-wrap items-start gap-2">\s*<h3 className="nb-project-card-title/);
});

test("WorkspaceAvatar enforces inset ring framing, 80px detail size, presence dot with offline last updated tooltip, and owner edit shortcut", () => {
    const avatarSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceAvatar.tsx"), "utf-8");

    assert.match(avatarSource, /ring-1 ring-inset ring-black\/5 dark:ring-white\/10/, "Must include inset ring framing");
    assert.match(avatarSource, /size-\[80px\] rounded-xl/, "Detail size must be 80px");
    assert.match(avatarSource, /size-11 rounded-md/, "Card size must be 44px");
    assert.doesNotMatch(avatarSource, /[Pp]resence/, "A workspace has no presence");
    assert.match(avatarSource, /if \(!hasImage && !placeholder\) \{\s*return null;\s*\}/, "Must return null with no image unless the slot is kept");
    assert.match(avatarSource, /tab=settings#project-settings-general/, "Owner edit overlay must deep link to general settings");
});

test("Architectural enhancements: native single tooltip, default cursor, zero-presence owner affordance, and global search avatar presence", () => {
    const avatarSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceAvatar.tsx"), "utf-8");
    const layoutSource = readFileSync(resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceLayout.tsx"), "utf-8");
    const searchCardsSource = readFileSync(resolve(ROOT, "src/components/layout/header/GlobalSearchResultCards.tsx"), "utf-8");

    // 2. Native single tooltip on dot (no duplicate floating tooltip at top, no question mark cursor)
    assert.doesNotMatch(avatarSource, /TooltipProvider/);
    assert.doesNotMatch(avatarSource, /TooltipContent/);
    assert.doesNotMatch(avatarSource, /cursor-help/);
    assert.match(readFileSync(resolve(process.cwd(), "src/components/presence/PresenceBadge.tsx"), "utf8"), /title=\{label\}/);
    assert.match(readFileSync(resolve(process.cwd(), "src/components/presence/PresenceBadge.tsx"), "utf8"), /aria-label=\{label\}/);

    // 4. With no image the owner adds one from the slot itself
    assert.doesNotMatch(layoutSource, /Add image/);
    assert.match(avatarSource, /aria-label="Add workspace avatar"/);

    // 5. Cross-platform design consistency: Global Search project cards render WorkspaceAvatar with presence dot
    assert.match(searchCardsSource, /import WorkspaceAvatar from "@\/components\/workspaces\/WorkspaceAvatar"/);
    assert.match(searchCardsSource, /<WorkspaceAvatar[\s\S]*?project=\{\{[\s\S]*?coverImage: result\.coverImage[\s\S]*?size="card"/);
});

test("The update line sits with the actions and the people stay in the identity column", () => {
    const layoutSource = readFileSync(resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceLayout.tsx"), "utf-8");

    // The title stands alone; who last updated it reads under the buttons.
    assert.doesNotMatch(layoutSource, /[Pp]resenceDot|WorkspaceStatusControl/);
    assert.equal(layoutSource.match(/<WorkspaceLastUpdate projectId=\{project\.id\}/g)?.length, 1);

    const metadataBlock = layoutSource.match(/const projectIdentityMetadata = \([\s\S]*?\n\s*\);/)?.[0] ?? "";
    assert.match(metadataBlock, /<ProjectTeamAvatars/);
});

test("Header architecture: Created by and Guided by are completely removed, team avatars and workspace links are separated by divider line", () => {
    const layoutSource = readFileSync(resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceLayout.tsx"), "utf-8");

    // 1. Verify "Created by" and "Guided by" are completely removed
    assert.doesNotMatch(layoutSource, /Created by/);
    assert.doesNotMatch(layoutSource, /ownerName/);
    assert.doesNotMatch(layoutSource, /Guided by/);
    assert.doesNotMatch(layoutSource, /guidanceName/);
    assert.doesNotMatch(layoutSource, /guidanceHref/);

    // 2. Verify divider line between team avatars and workspace links on Line 3
    assert.match(layoutSource, /<ProjectTeamAvatars[\s\S]*?<div className="mx-0\.5 h-4 w-px shrink-0 bg-border last:hidden" aria-hidden="true" \/>[\s\S]*?<WorkspaceLinkCluster/);

    // 3. Verify clean right actions column
    assert.match(layoutSource, /Right: actions/);
    assert.match(layoutSource, /<div className="flex flex-wrap items-center justify-end gap-2[^"]*">/);
});

test("Discovery page ProjectCard and detail page WorkspaceStatsBar: last updated date removed from card, unified X-platform view icon (BarChart2)", () => {
    const cardSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceCard.tsx"), "utf-8");
    const statsSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceStatsBar.tsx"), "utf-8");

    // 1. Last updated date is completely removed from ProjectCard
    assert.doesNotMatch(cardSource, /Clock/);
    assert.doesNotMatch(cardSource, /formatDistanceToNow/);
    assert.doesNotMatch(cardSource, /lastActiveDate/);

    // 2. ProjectCardss icon uses BarChart2 (X-platform analytics bars)
    assert.match(cardSource, /import\s*\{[^}]*BarChart2[^}]*\}\s*from\s*"lucide-react"/);
    assert.match(cardSource, /<BarChart2\s+size=\{14\}\s+aria-hidden="true"\s*\/>.*\{views\.text\}/);

    // 3. WorkspaceStatsBar on detail page also uses BarChart2 (unified with card)
    assert.match(statsSource, /import\s*\{[^}]*BarChart2[^}]*\}\s*from\s*"lucide-react"/);
    assert.match(statsSource, /<BarChart2\s+className=\{(?:iconClass|cn\(iconClass, "max-md:hidden"\))\}\s+aria-hidden="true"\s*\/>/);
});

test("Animated GIF avatar architecture: bypass canvas rasterization, preserve frames as image/gif, and render unoptimized", () => {
    const prepSource = readFileSync(resolve(ROOT, "src/lib/upload/image-prep-client.ts"), "utf-8");
    const settingsSource = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
    const avatarSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceAvatar.tsx"), "utf-8");

    // 1. image-prep-client must bypass 2D canvas for GIFs so animation frames are never flattened
    assert.match(prepSource, /prepareWorkspaceImageForUpload[\s\S]*?file\.type === "image\/gif"[\s\S]*?contentType:\s*"image\/gif"/);

    // 2. WorkspaceSettingsTab must preserve GIF type and avoid forcing outputType: "image/jpeg"
    // GIFs keep their frames: the shared upload helper (Settings and create step 4) skips JPEG output for them.
    const uploadHelperSource = readFileSync(resolve(ROOT, "src/lib/upload/workspace-image-upload-client.ts"), "utf-8");
    assert.match(uploadHelperSource, /const isGif = file\.type === "image\/gif"/);
    assert.match(uploadHelperSource, /outputType:\s*isGif \? undefined : "image\/jpeg"/);
    assert.match(settingsSource, /await uploadWorkspaceImage\(projectId, coverDraft\.file,/);

    // 3. WorkspaceAvatar must use unoptimized so browser's native engine plays the animated GIF
    assert.match(avatarSource, /<Image[\s\S]*?src=\{avatarUrl!\}[\s\S]*?unoptimized/);
});

test("GIF avatar optimizations: 2MB preflight guard, adaptive draft UI, revocable caching, compositor throttling, and async decoding", () => {
    const settingsSource = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
    const routeSource = readFileSync(resolve(ROOT, "src/app/api/v1/workspaces/[id]/image/route.ts"), "utf-8");
    const avatarSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceAvatar.tsx"), "utf-8");
    const globalsCss = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf-8");

    // 1. Instant 2MB preflight check on file selection before memory allocation
    assert.match(settingsSource, /if\s*\(file\.size > WORKSPACE_IMAGE_UPLOAD_MAX_BYTES\)\s*\{\s*toast\.warning/);

    // 2. Adaptive draft UI for GIFs (disables drag/zoom sliders, indicates 1:1 direct preservation)
    assert.match(settingsSource, /const isDraftGif = coverDraft\.file\.type === "image\/gif"/);
    assert.match(settingsSource, /Animated GIF · Motion kept/);

    // 3. Versioned cover responses remain inside the five-minute visibility-revocation budget.
    assert.match(routeSource, /request\.nextUrl\.searchParams\.get\("v"\) !== version/);
    assert.match(routeSource, /public, max-age=300, s-maxage=300, must-revalidate/);
    assert.match(routeSource, /private, max-age=300, must-revalidate/);

    // 4. Compositor throttling: content-visibility: auto on project cards prevents offscreen GIF decoding
    assert.match(globalsCss, /\.nb-project-card\s*\{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:\s*auto 240px;/);
    assert.match(globalsCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.nb-project-card/);

    // 5. Async decoding & eager/lazy loading on WorkspaceAvatar
    assert.match(avatarSource, /decoding="async"/);
    assert.match(avatarSource, /loading=\{isDetail \? "eager" : "lazy"\}/);
});

test("Workspace image fit architecture: enforces objectFit cover across detail page, cards, settings, and globals to eliminate gaps", () => {
    const avatarSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceAvatar.tsx"), "utf-8");
    const settingsSource = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
    const globalsCss = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf-8");

    // 1. WorkspaceAvatar enforces inline objectFit cover with 100% fill
    assert.match(avatarSource, /style=\{\{\s*objectFit:\s*"cover"\s*\}\}/);

    // 2. WorkspaceSettingsTab enforces objectFit cover in both published and draft GIF previews
    assert.match(settingsSource, /style=\{\{\s*objectFit:\s*"cover"\s*\}\}/);

    // 3. globals.css enforces 100% cover with !important to prevent any gaps or pillarboxing
    assert.match(globalsCss, /\[data-testid="project-avatar"\] img,\s*\.group\\\/avatar img\s*\{\s*object-fit:\s*cover !important;\s*width:\s*100% !important;\s*height:\s*100% !important;\s*\}/);
});

test("Discovery page avatar cache synchronization & multi-tab real-time updates contract", () => {
    const projectActionsText = projectActionsSource();
    const avatarSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceAvatar.tsx"), "utf-8");
    const settingsSource = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
    const hubClientSource = readFileSync(resolve(ROOT, "src/components/discover/DiscoverClient.tsx"), "utf-8");

    // 1. Server route revalidation includes /discover, /hub, and /my-profile
    assert.match(projectActionsText, /const revalidateWorkspacePaths = async[\s\S]*?revalidatePath\("\/discover"\)/);
    assert.match(projectActionsText, /export async function invalidateWorkspacePublicCaches[\s\S]*?revalidatePath\("\/discover"\)/);

    // 2. WorkspaceAvatar exports broadcastWorkspaceUpdated for 0ms cross-window/tab sync
    assert.match(avatarSource, /export function broadcastWorkspaceUpdated\(projectId: string, update\?:/);
    assert.match(avatarSource, /new BroadcastChannel\("nb-project-updated-v1"\)/);

    // 3. WorkspaceSettingsTab broadcasts and invalidates hub queries on avatar upload/clear
    assert.match(settingsSource, /broadcastWorkspaceUpdated\(projectId,\s*\{\s*coverImage:\s*finalized\.publicUrl\s*\}\)/);
    assert.match(settingsSource, /broadcastWorkspaceUpdated\(projectId,\s*\{\s*coverImage:\s*null\s*\}\)/);
    assert.match(settingsSource, /queryClient\.invalidateQueries\(\{\s*queryKey:\s*queryKeys\.discover\.projectsSimpleRoot\(\)\s*\}\)/);

    // 4. DiscoverClient synchronizes initialProjectsPage and listens to nb-project-updated
    assert.match(hubClientSource, /window\.addEventListener\("nb-project-updated"/);
    assert.match(hubClientSource, /new BroadcastChannel\("nb-project-updated-v1"\)/);
    assert.match(hubClientSource, /queryClient\.setQueriesData<any>\(\s*\{\s*queryKey:\s*queryKeys\.discover\.projectsSimpleRoot\(\)\s*\}/);
});

test("Discovery feed smooth scrolling & Virtuoso stability contract", () => {
    const globalsCss = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf-8");
    const hubClientSource = readFileSync(resolve(ROOT, "src/components/discover/DiscoverClient.tsx"), "utf-8");
    const avatarSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceAvatar.tsx"), "utf-8");

    // 1. Virtualized list overrides content-visibility to visible to prevent ResizeObserver measurement oscillations
    assert.match(globalsCss, /\[data-testid="discover-feed-scroll"\] \.nb-project-card[\s\S]*?content-visibility:\s*visible;[\s\S]*?contain-intrinsic-size:\s*none;/);

    // 2. Vertical scroll area contains rubberband momentum to prevent parent layout bounce
    assert.match(globalsCss, /\.app-scroll\s*\{[\s\S]*?overscroll-behavior-y:\s*contain;/);

    // 3. DiscoverClient provides stable memoized Virtuoso props (no inline component remounting)
    assert.match(hubClientSource, /const VIRTUOSO_CONTAINER_STYLE = \{ width: "100%" \} as const;/);
    // Keys are namespaced per kind (project / update), so an id can never collide across the two.
    assert.match(hubClientSource, /const computeFeedItemKey = \(_: number, item: DiscoverFeedItem\) => feedItemKey\(item\);/);
    assert.match(hubClientSource, /components=\{virtuosoComponents\}/);
    assert.match(hubClientSource, /itemContent=\{renderFeedItem\}/);

    // 5. Scroll container and virtuoso scroller disable scroll anchoring to prevent upward scroll jitter
    assert.match(globalsCss, /\[data-testid="discover-feed-scroll"\][\s\S]*?overflow-anchor:\s*none;/);

    // 6. Virtuoso sets generous viewport buffer to prevent upward scrolling compensation jitter
    assert.match(hubClientSource, /increaseViewportBy=\{VIRTUOSO_INCREASE_VIEWPORT_BY\}/);
    assert.match(hubClientSource, /const VIRTUOSO_INCREASE_VIEWPORT_BY = \{\s*top:\s*1200,\s*bottom:\s*800\s*\}\s*as const;/);
});
