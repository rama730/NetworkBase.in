import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("Skeleton architectural contract: Section 33 CSS tokens and shimmer animations", () => {
    const cssSource = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf-8");

    // Must define design system skeleton tokens
    assert.match(cssSource, /--skeleton-base:\s*color-mix\(in srgb,\s*var\(--muted\)\s*88%,\s*var\(--background\)\)/);
    assert.match(cssSource, /--skeleton-highlight:\s*color-mix\(in srgb,\s*var\(--card\)\s*72%,\s*var\(--muted\)\)/);

    // Dark mode variant
    assert.match(cssSource, /--skeleton-base:\s*color-mix\(in srgb,\s*var\(--muted\)\s*82%,\s*var\(--background\)\)/);
    assert.match(cssSource, /--skeleton-highlight:\s*color-mix\(in srgb,\s*var\(--card\)\s*76%,\s*var\(--muted\)\)/);

    // CSS Shimmer animation class
    assert.match(cssSource, /\.nb-skeleton\s*\{[^}]*linear-gradient\(\s*100deg,\s*var\(--skeleton-base\)/);
    assert.match(cssSource, /@keyframes nb-skeleton-shimmer/);

    // Reduced motion accessibility
    assert.match(cssSource, /html\[data-reduce-motion="true"\]\s+\.nb-skeleton/);
});

test("Skeleton architectural contract: Canonical route loading shells exist", () => {
    const canonicalRoutes = [
        "src/app/(site)/(main)/discover/loading.tsx",
        "src/app/(site)/(main)/discover/loading.tsx",
        "src/app/(site)/(main)/network/loading.tsx",
        "src/app/(site)/(main)/network/loading.tsx",
        "src/app/(site)/(main)/workspaces/[slug]/loading.tsx",
        "src/app/(site)/(main)/workspaces/new/loading.tsx",
        "src/app/(site)/(main)/u/[username]/loading.tsx",
        "src/app/(site)/(main)/my-profile/loading.tsx",
        "src/app/(site)/(main)/my-profile/loading.tsx",
        "src/app/(site)/(main)/messages/(lists)/loading.tsx",
        "src/app/(site)/(main)/settings/loading.tsx",
    ];

    for (const routePath of canonicalRoutes) {
        assert.ok(existsSync(resolve(ROOT, routePath)), `Route loading shell missing: ${routePath}`);
    }
});

test("Skeleton architectural contract: Header and Global overlay hygiene", () => {
    const notifPreview = readFileSync(resolve(ROOT, "src/components/layout/header/NotificationPreview.tsx"), "utf-8");
    const cmdPalette = readFileSync(resolve(ROOT, "src/components/layout/header/CommandPalette.tsx"), "utf-8");

    // Notification preview must not use raw bg-muted divs for skeleton
    assert.doesNotMatch(notifPreview, /<div className="h-\[34px\] w-\[34px\] shrink-0 rounded-md bg-muted" \/>/);
    assert.match(notifPreview, /<Skeleton className="h-\[34px\] w-\[34px\] shrink-0 rounded-full" \/>/);
    assert.match(notifPreview, /role="status"/);

    // Command palette preview must not use raw bg-muted spans
    assert.doesNotMatch(cmdPalette, /<span className="size-10 shrink-0 rounded-\[5px\] bg-muted" \/>/);
    assert.match(cmdPalette, /<Skeleton className="size-10 shrink-0 rounded-\[5px\]" \/>/);
});

test("Skeleton architectural contract: People and Network measured card skeletons", () => {
    const peopleClient = readFileSync(resolve(ROOT, "src/components/network/NetworkPeopleTab.tsx"), "utf-8");
    const peopleHub = readFileSync(resolve(ROOT, "src/components/network/NetworkClient.tsx"), "utf-8");
    const invitations = readFileSync(resolve(ROOT, "src/components/network/InvitationsClient.tsx"), "utf-8");

    assert.match(peopleClient, /<PersonCardSkeleton key=\{item\} \/>/);
    assert.match(peopleHub, /<PersonCardSkeleton key=\{item\} \/>/);
    assert.match(invitations, /<InvitationCardSkeleton key=\{item\} \/>/);
});

test("Skeleton architectural contract: Task Drawer subtasks and files measured skeletons", () => {
    const subtasksTab = readFileSync(resolve(ROOT, "src/components/workspaces/v2/tasks/TaskDetailTabs/SubtasksTab.tsx"), "utf-8");
    const filesTab = readFileSync(resolve(ROOT, "src/components/workspaces/v2/tasks/TaskDetailTabs/FilesTab.tsx"), "utf-8");

    // SubtasksTab must render measured Skeleton rows when loading
    assert.doesNotMatch(subtasksTab, /<Loader2 className="size-5 animate-spin text-muted-foreground" \/>/);
    assert.match(subtasksTab, /role="status"/);
    assert.match(subtasksTab, /aria-label="Loading subtasks"/);

    // FilesTab must render measured Skeleton rows when loading
    assert.doesNotMatch(filesTab, /<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" \/>/);
    assert.match(filesTab, /aria-label="Loading files"/);
});

test("Skeleton architectural contract: Project Tab Skeletons modularization", () => {
    const projectTabs = readFileSync(resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceTabsRegistry.tsx"), "utf-8");
    const updatesSkeleton = resolve(ROOT, "src/components/workspaces/skeletons/SkeletonUpdates.tsx");

    assert.ok(existsSync(updatesSkeleton), "SkeletonUpdates.tsx must exist in skeletons directory");
    assert.match(projectTabs, /import \{ SkeletonUpdates \} from "@\/components\/workspaces\/skeletons\/SkeletonUpdates";/);
});

test("Skeleton architectural contract: Settings loading CSS purge hygiene", () => {
    const settingsLoading = readFileSync(resolve(ROOT, "src/app/(site)/(main)/settings/loading.tsx"), "utf-8");

    // No dynamically evaluated class template strings
    assert.doesNotMatch(settingsLoading, /className=\{`h-10 \$\{width\} rounded-md`\}/);
    assert.match(settingsLoading, /SETTINGS_SECTIONS\.map/, "the fallback has one block per settings section");
});
