import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("Notification tray redesign architecture: solid opaque sticky headers eliminate bleed-through", () => {
    const listSource = readFileSync(resolve(ROOT, "src/components/notifications/NotificationList.tsx"), "utf-8");

    // 1. Sticky headers use solid opaque backgrounds (no transparent bleed-through)
    assert.match(listSource, /sticky top-0 z-10 border-b border-border bg-card dark:bg-\[#141A1E\] px-4 py-2 text-destructive/);
    assert.match(listSource, /sticky top-0 z-10 border-b border-border bg-card dark:bg-\[#141A1E\]/);
    assert.doesNotMatch(listSource, /bg-muted\/80 px-4 py-2 backdrop-blur-none/);

    // 2. Needs attention header is clean and typographic without status dot
    assert.match(listSource, /<div className="nb-micro sticky top-0 z-10 border-b border-border bg-card dark:bg-\[#141A1E\] px-4 py-2 text-destructive shadow-2xs">\s*Needs attention\s*<\/div>/);

    // 3. Empty state renders canonical EmptyState with nb-grid-ground blueprint grid
    assert.match(listSource, /import \{ EmptyState \} from ["']@\/components\/ui\/EmptyState["']/);
    assert.match(listSource, /<EmptyState[\s\S]*?icon=\{Bell\}[\s\S]*?title="No notifications"/);
});

test("Notification dropdown shell architecture: segmented tab bar, stable scroll panel, and unread pill", () => {
    const previewSource = readFileSync(resolve(ROOT, "src/components/layout/header/NotificationPreview.tsx"), "utf-8");

    // 1. DropdownContent geometry: max 26rem, 12px rounded-xl, solid card background
    assert.match(previewSource, /max-w-\[26rem\] flex-col overflow-hidden rounded-xl border border-border bg-card/);

    // 2. Unread badge rendered as subtle drafting pill
    assert.match(previewSource, /rounded-full bg-primary\/10 px-2 py-0\.5 font-mono text-\[11px\] font-medium text-primary/);

    // 3. Segmented tab bar (controls round 2): hairline cells across the width, the clay marker, the unread count in mono
    assert.match(previewSource, /className="nb-seg" data-fill="" role="tablist"/);
    assert.match(previewSource, /<TabMarker \/>/);
    assert.match(previewSource, /<span className="nb-seg-n">\{unreadCount\}<\/span>/);

    // 4. Scroll panel has overflow-anchor: none to prevent layout jumps
    assert.match(previewSource, /\[overflow-anchor:none\]/);
});

test("Notification thread rail architecture: geometric drafting stem, branching elbow, and aligned avatar", () => {
    const bundleSource = readFileSync(resolve(ROOT, "src/components/notifications/NotificationBundleRow.tsx"), "utf-8");
    const rowSource = readFileSync(resolve(ROOT, "src/components/notifications/NotificationRow.tsx"), "utf-8");

    // 1. Lead row uses standard px-4 padding so lead avatar aligns with standard rows
    assert.match(bundleSource, /group relative flex min-h-16 items-start gap-2 px-4 py-3/);

    // 2. Chevron toggle is right-aligned beside action menu
    assert.match(bundleSource, /<div className="flex items-center gap-0\.5 shrink-0 mt-0\.5">\s*<button[\s\S]*?onClick=\{\(\) => setExpanded/);

    // 3. Continuous vertical drafting rail stem centered at x=33px under avatar
    assert.match(bundleSource, /absolute left-\[33px\] top-0 bottom-4 w-px bg-border\/80 dark:bg-border/);

    // 4. Curved branching elbow (rounded-bl-[6px]) into child rows
    assert.match(bundleSource, /absolute left-\[33px\] top-3\.5 h-3 w-3 rounded-bl-\[6px\] border-b border-l border-border\/80/);

    // 5. Child row receives compact prop
    assert.match(bundleSource, /<NotificationRow[\s\S]*?compact\s*\/>/);

    // 6. NotificationRow renders 26px avatar and min-h-12 when compact
    assert.match(rowSource, /compact \? 26 : 34/);
    assert.match(rowSource, /compact \? "min-h-12 px-3 py-2" : "min-h-16 px-4 py-3"/);
});

test("Notification polish enhancements: compact timestamps, drafting chip excerpts, unread paper wash, RotateCcw icon, and Clear All", () => {
    const listSource = readFileSync(resolve(ROOT, "src/components/notifications/NotificationList.tsx"), "utf-8");
    const rowSource = readFileSync(resolve(ROOT, "src/components/notifications/NotificationRow.tsx"), "utf-8");
    const previewSource = readFileSync(resolve(ROOT, "src/components/layout/header/NotificationPreview.tsx"), "utf-8");

    // Idea 1: Compact drafting timestamps & chip excerpts
    assert.match(rowSource, /formatRelativeTimestamp/);
    assert.match(rowSource, /rounded-\[4px\] border border-border\/70 bg-muted\/30 px-2 py-0\.5 font-mono text-\[11px\] text-foreground\/80 not-italic/);

    // Idea 2: Unread paper wash, RotateCcw icon, list pb-3 gutter
    assert.match(rowSource, /bg-primary\/\[0\.04\] hover:bg-primary\/\[0\.07\] dark:bg-primary\/\[0\.08\] dark:hover:bg-primary\/\[0\.12\]/);
    assert.match(rowSource, /<RotateCcw className="mr-2 h-4 w-4" \/>\s*Mark as unread/);
    assert.match(listSource, /className="pb-3"/);

    // Idea 3: Clear all action button on "All" tab when items exist
    assert.match(previewSource, /activeFilter === "all" && items\.length > 0/);
    assert.match(previewSource, />\s*Clear all\s*<\/button>/);

    // Bundle row consistency
    const bundleSource = readFileSync(resolve(ROOT, "src/components/notifications/NotificationBundleRow.tsx"), "utf-8");
    assert.match(bundleSource, /formatRelativeTimestamp/);
    assert.match(bundleSource, /bg-primary\/\[0\.04\] hover:bg-primary\/\[0\.07\] dark:bg-primary\/\[0\.08\] dark:hover:bg-primary\/\[0\.12\]/);
});

