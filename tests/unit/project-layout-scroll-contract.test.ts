import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("project detail header stays route-owned", () => {
    const source = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectLayout.tsx"),
        "utf8",
    );

    assert.doesNotMatch(
        source,
        /isContainedWorkspaceTab|isDocEditWorkspaceTab/,
        "The project layout has no contained Doc edit workspace",
    );
    assert.doesNotMatch(source, /isFilesTab \|\| isDocEditWorkspaceTab \|\| isSettingsTab/);
    assert.doesNotMatch(
        source,
        /handleNestedScroll|handleWheel|nestedScrollTops/,
        "contained workspace panes should own their own scroll chrome",
    );
    assert.doesNotMatch(source, /isFilesTab && isScrolled/, "Files must not toggle the project identity header");
    assert.match(
        source,
        /isFilesTab[\s\S]{0,120}h-\[calc\(100dvh-var\(--ui-topnav-height\)-var\(--project-tabs-height\)\)\]/,
        "Files should retain a viewport-sized internal workspace beneath the sticky project tabs",
    );
    assert.match(source, /isSettingsTab\s*\?\s*"w-full"/, "Settings must remain in the route-owned page flow");
    assert.doesNotMatch(
        source,
        /activeTabButton\?\.scrollIntoView/,
        "revealing an active project tab horizontally must not move the route vertically",
    );
    assert.match(
        source,
        /tabList\.scrollTo\(\{ left: Math\.max\(0, centeredLeft\), behavior: "smooth" \}\)/,
        "overflowing project tabs should be revealed through the horizontal tab scroller only",
    );
    assert.match(source, /isScrolled && "shadow-none"/, "sticky header treatment should remain flat for all scroll sources");
});

test("project tab changes restore the project identity header", () => {
    const dashboardSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectDashboardClient.tsx"),
        "utf8",
    );

    assert.match(
        dashboardSource,
        /routeRoot\?\.scrollTo\(\{ top: 0, left: routeRoot\.scrollLeft, behavior: 'auto' \}\)/,
        "selecting any project tab should reset the route-owned scroll surface",
    );
    assert.match(dashboardSource, /router\.replace\(nextUrl, \{ scroll: false \}\)/);
    assert.match(dashboardSource, /<TabErrorBoundary tabName="Settings">/, "Settings should remain in the route-owned document flow");
});

test("project detail consumes the shell width without changing the collapsed rail", () => {
    const layoutSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectLayout.tsx"),
        "utf8",
    );
    const cssSource = fs.readFileSync(
        path.join(process.cwd(), "src/app/globals.css"),
        "utf8",
    );

    assert.doesNotMatch(
        layoutSource,
        /max-w-7xl mx-auto|max-w-\[1240px\] mx-auto/,
        "project identity, tabs, and active content should not retain auto margins after the shell releases width",
    );
    assert.match(
        cssSource,
        /\.nb-sidebar\[data-collapsed="true"\]\s*\{\s*width:var\(--nb-sidebar-collapsed-width\);\s*\}/,
        "the collapsed sidebar must retain its narrow rail width",
    );
    assert.match(
        cssSource,
        /\.app-scroll-gutter\s*\{\s*scrollbar-gutter:\s*stable;\s*\}/,
        "app-scroll-gutter must use stable without both-edges to avoid an unnatural gap against the left navigation rail",
    );
    assert.doesNotMatch(
        cssSource,
        /scrollbar-gutter:\s*stable\s+both-edges/,
        "app-scroll-gutter must not reserve both-edges which separates content from the left sidebar",
    );
    assert.doesNotMatch(
        cssSource,
        /\[data-project-tool="true"\]\s+\.nb-project-identity h1/,
        "Tasks, Files, Sprints, and other project tools must not shrink the shared project title",
    );
    assert.match(
        layoutSource,
        /<h1 className="nb-page-title min-w-0 break-words text-foreground">/,
        "Every project tab must use the canonical project title treatment",
    );
});

test("Files workspace hands initial pane scrolling to the route-owned project header", () => {
    const layoutSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/dashboard/ProjectLayout.tsx"),
        "utf8",
    );
    const filesRootSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/v2/files-tab/FilesTabRoot.tsx"),
        "utf8",
    );

    assert.doesNotMatch(layoutSource, /FILES_WORKSPACE_SCROLL_EVENT/);
    assert.match(layoutSource, /data-project-identity-height=\{projectIdentityHeight\}/);
    assert.match(filesRootSource, /onScrollCapture=\{handleFilesScroll\}/, "Both Files panes should report scrolling through their shared root");
    assert.match(filesRootSource, /addEventListener\("wheel", handleFilesWheel, \{ passive: false, capture: true \}\)/);
    assert.match(filesRootSource, /addEventListener\("touchmove", handleFilesTouchMove, \{ passive: false, capture: true \}\)/);
    assert.match(filesRootSource, /routeRoot\.scrollTop \+= routeDelta/);
    assert.match(filesRootSource, /target\.scrollTop = currentScrollTop - routeDelta/);
    assert.match(filesRootSource, /scrollPane\.scrollTop <= 0/);
});

test("Tasks tab allows uninhibited vertical scroll chaining to route scroller", () => {
    const kanbanSource = fs.readFileSync(
        path.join(process.cwd(), "src/components/projects/v2/tasks/KanbanBoard.tsx"),
        "utf8",
    );
    const cssSource = fs.readFileSync(
        path.join(process.cwd(), "src/app/globals.css"),
        "utf8",
    );

    // .app-scroll-x must not trap vertical overscroll and must clip without creating a Y scroll container
    assert.match(
        cssSource,
        /\.app-scroll-x\s*\{[^}]*overscroll-behavior-y:\s*auto;/,
        ".app-scroll-x must restore overscroll-behavior-y to auto",
    );
    assert.match(
        cssSource,
        /\.app-scroll-x\s*\{[^}]*overflow-y:\s*clip;/,
        ".app-scroll-x must use overflow-y: clip to prevent secondary scroll container creation",
    );

    // Kanban board scroller must preserve vertical scroll chaining
    assert.match(
        kanbanSource,
        /overscroll-x-contain\s+overscroll-y-auto/,
        "Kanban horizontal scroller must allow vertical scroll to pass through to route root",
    );

    // Kanban board must actively forward unlatched vertical wheel gestures to route scroller
    assert.match(
        kanbanSource,
        /addEventListener\("wheel", handleWheel, \{ passive: false, capture: true \}\)/,
        "Kanban board root must capture wheel events to forward vertical scroll intent",
    );
    assert.match(
        kanbanSource,
        /routeRoot\.scrollTop\s*=\s*Math\.max\([\s\S]*?routeRoot\.scrollTop \+ deltaY/,
        "Kanban board must directly adjust route scroller scrollTop",
    );
});
