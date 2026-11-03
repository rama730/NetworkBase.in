import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { componentSource } from "./_helpers/component-source";

test("Project Updates Tab Design Specification Conformance Contract (Section 25 & Sections 03, 04, 05, 10)", async (t) => {
    const tabsDir = path.join(process.cwd(), "src/components/workspaces/tabs");
    const updatesDir = path.join(process.cwd(), "src/components/workspaces/updates");

    const updatesTab = componentSource("src/components/workspaces/tabs/UpdatesTab.tsx");
    const composer = fs.readFileSync(path.join(updatesDir, "WorkspaceUpdateComposer.tsx"), "utf-8");
    const mediaFrame = fs.readFileSync(path.join(updatesDir, "WorkspaceUpdateMediaFrame.tsx"), "utf-8");
    const editor = fs.readFileSync(path.join(updatesDir, "WorkspaceUpdateRichTextEditor.tsx"), "utf-8");

    const threadRailPath = path.join(process.cwd(), "src/components/ui/ThreadRail.tsx");
    const threadRail = fs.existsSync(threadRailPath) ? fs.readFileSync(threadRailPath, "utf-8") : "";
    const railSource = updatesTab + "\n" + threadRail;

    await t.test("UpdatesTab layout allocates generous 440px to right rail within max-w-[1240px] grid", () => {
        assert.match(updatesTab, /max-w-\[1240px\]/, "Container must be bounded to max-w-[1240px] like dashboard");
        assert.match(updatesTab, /xl:grid-cols-\[minmax\(0,1fr\)_440px\]/, "Grid must allocate 440px to right rail");
        assert.match(updatesTab, /xl:w-\[440px\]/, "Aside must specify xl:w-[440px]");
        assert.doesNotMatch(updatesTab, /clamp\(320px,27%,380px\)/, "Grid must not clamp right rail to 320-380px");
    });

    await t.test("UpdatesTab aside conforms to scroll-pinned tabs-height docking with unbroken divider", () => {
        assert.match(updatesTab, /border-l border-border pl-6/, "Aside must have unbroken vertical border and padding");
        assert.match(updatesTab, /top-\[calc\(var\(--workspace-tabs-height,42px\)\+1rem\)\]/, "Sticky container must dock cleanly below sticky tabs header");
        assert.doesNotMatch(updatesTab, /sticky top-4/, "Sticky container must not use hardcoded top-4");
    });

    await t.test("Threadline design adheres to continuous drafting centerline in collapsed & expanded states", () => {
        // Continuous centerline rail
        assert.match(railSource, /function ThreadAvatarRail/, "UpdatesTab must have dedicated ThreadAvatarRail");
        assert.match(railSource, /w-px -translate-x-1\/2 bg-border/, "Centerline must be 1px hairline neutral border rule");
        assert.match(railSource, /function ThreadRailBridge/, "UpdatesTab must have dedicated ThreadRailBridge");
        assert.match(railSource, /size-1 rounded-\[1px\] bg-muted-foreground\/50 ring-2 ring-background/, "Bridge must use geometric node");
    });

    await t.test("Strict zero rounded-full controls across all updates components", () => {
        assert.doesNotMatch(updatesTab, /rounded-full/, "UpdatesTab must not have rounded-full controls");
        assert.doesNotMatch(composer, /rounded-full/, "WorkspaceUpdateComposer must not have rounded-full controls");
        assert.doesNotMatch(mediaFrame, /rounded-full/, "WorkspaceUpdateMediaFrame must not have rounded-full controls");
        assert.doesNotMatch(editor, /rounded-full/, "WorkspaceUpdateRichTextEditor must not have rounded-full controls");
    });

    await t.test("Strict zero zinc-* and zero blue-* color token leaks across all updates components", () => {
        assert.doesNotMatch(updatesTab, /text-zinc-|bg-zinc-|border-zinc-|divide-zinc-/, "UpdatesTab must have zero zinc leaks");
        assert.doesNotMatch(updatesTab, /text-blue-|bg-blue-|border-blue-/, "UpdatesTab must have zero blue leaks");

        assert.doesNotMatch(composer, /text-zinc-|bg-zinc-|border-zinc-|divide-zinc-/, "WorkspaceUpdateComposer must have zero zinc leaks");
        assert.doesNotMatch(composer, /text-blue-|bg-blue-|border-blue-/, "WorkspaceUpdateComposer must have zero blue leaks");

        assert.doesNotMatch(mediaFrame, /text-zinc-|bg-zinc-|border-zinc-|divide-zinc-/, "WorkspaceUpdateMediaFrame must have zero zinc leaks");
        assert.doesNotMatch(mediaFrame, /text-blue-|bg-blue-|border-blue-/, "WorkspaceUpdateMediaFrame must have zero blue leaks");

        assert.doesNotMatch(editor, /text-zinc-|bg-zinc-|border-zinc-|divide-zinc-/, "WorkspaceUpdateRichTextEditor must have zero zinc leaks");
        assert.doesNotMatch(editor, /text-blue-|bg-blue-|border-blue-/, "WorkspaceUpdateRichTextEditor must have zero blue leaks");
    });

    await t.test("UpdatesTab empty states adhere to NetworkBase standard .nb-empty-state tokens", () => {
        assert.match(updatesTab, /nb-empty-state/, "Empty state must use .nb-empty-state");
        assert.match(updatesTab, /nb-empty-state-icon/, "Empty state icon must use .nb-empty-state-icon");
        assert.match(updatesTab, /nb-empty-state-title/, "Empty state title must use .nb-empty-state-title");
        assert.match(updatesTab, /nb-empty-state-desc/, "Empty state description must use .nb-empty-state-desc");
    });

    await t.test("WorkspaceUpdateComposer adheres to audience label and toolbar design contracts", () => {
        // Audience chip must show "Public" and never "Public followers"
        // Workspaces: "Public" / "Workspace members". Organizations: "Public · Also on Discover" / "Members" (decision 152).
        assert.match(composer, /visibility === "public" \? \(defaultVisibility === "members" \? "Public · Also on Discover" : "Public"\) : defaultVisibility === "members" \? "Members" : "Workspace members"/, "Audience chip must display 'Public' instead of 'Public followers'");
        assert.doesNotMatch(composer, /Public followers/, "Composer must not contain 'Public followers'");

        // Toolbar must never wrap icons and must use standardized semantic icons
        // Live-fix 28: the tools wrap so Post never leaves a narrow column; the Post group itself never shrinks.
        assert.match(composer, /flex min-w-0 flex-wrap items-center gap-1/, "Toolbar icons wrap inside the column");
        assert.match(composer, /ml-auto flex items-center gap-2\.5 shrink-0/, "The Post group stays whole");
        assert.match(composer, /ListTodo className="h-4 w-4"/, "Task context must use ListTodo icon");
        assert.match(composer, /Timer className="h-4 w-4"/, "Sprint context must use Timer icon");
        assert.match(composer, /Paperclip className="h-4 w-4"/, "File context must use Paperclip icon");
        assert.match(composer, /ImagePlus className="h-4 w-4"/, "Image action must use ImagePlus icon");
        assert.match(composer, /Link2 className="h-4 w-4"/, "Link action must use Link2 icon");

        // Rich text editor must be enclosed in drafting container
        assert.match(composer, /rounded-\[8px\] border border-border bg-card p-3/, "Editor must be in 8px drafting container");

        // Link fetching must reuse useLinkPreview implementation
        assert.match(composer, /useLinkPreview/, "Composer must reuse useLinkPreview hook");
        assert.match(composer, /from "@\/hooks\/useLinkPreview"/, "Composer must import from @/hooks/useLinkPreview");
    });

    await t.test("Comment rows provide unambiguous reply actions and adequate touch spacing for delete controls", () => {
        // Delete and Report live in one "⋯" per comment (trust and safety C15): a size-7 trigger with ml-2 clearance.
        assert.match(updatesTab, /<ItemMenu label="Comment actions" className="ml-2"/, "Comment actions menu must keep ml-2 clearance");
        assert.match(updatesTab, /Delete comment<\/DropdownMenuItem>/, "Delete stays a named destructive menu item");
        assert.match(fs.readFileSync(path.join(process.cwd(), "src/components/reports/ItemMenu.tsx"), "utf-8"), /nb-touch-target flex size-7 shrink-0/, "The menu trigger keeps the size-7 touch target");

        // Reply button must have clear pill styling, icon, and distinct vertical spacing
        assert.match(updatesTab, /mt-2 flex items-center gap-2 pt-0.5/, "Reply button must have distinct top spacing");
        assert.match(updatesTab, /inline-flex items-center gap-1 rounded-\[4px\] border border-border\/60 bg-muted\/30 px-2 py-0.5 font-mono text-\[11px\] font-medium uppercase tracking-\[0.06em\]/, "Reply button must be styled as a clear pill button");

        // Reply form must have Replying to context indicator and cancel button
        assert.match(updatesTab, /Replying to <span className="font-semibold text-foreground">@/, "Reply form must show clear Replying to username context");
        assert.match(updatesTab, /aria-label="Cancel reply"/, "Reply form must have an accessible cancel button");
    });

    await t.test("UpdateDetailPanel constrains media and locks sticky header in supporting rail", () => {
        // Media in right rail must pass compact prop to constrain height to 220px
        assert.match(updatesTab, /<UpdateContextAndMedia update=\{update\} compact \/>/, "Detail panel must pass compact prop to prevent image overpowering");

        // Threads header in right rail must be sticky with backdrop blur
        assert.match(updatesTab, /sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background\/95 pb-3 backdrop-blur-sm/, "Threads header in right rail must be sticky");
    });
});

