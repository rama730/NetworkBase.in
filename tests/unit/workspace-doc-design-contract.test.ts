import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Docs Tab Design Specification Conformance Contract (Section 22 & Sections 04, 05, 10, 19)", async (t) => {
    const docDir = path.join(process.cwd(), "src/components/workspaces/doc");
    const skeletonsDir = path.join(process.cwd(), "src/components/workspaces/skeletons");
    const tabsDir = path.join(process.cwd(), "src/components/workspaces/tabs");

    const skeletonDoc = fs.readFileSync(path.join(skeletonsDir, "SkeletonDoc.tsx"), "utf-8");
    const renderer = fs.readFileSync(path.join(docDir, "WorkspaceDocRenderer.tsx"), "utf-8");
    const commandBlock = fs.readFileSync(path.join(docDir, "WorkspaceDocCommandBlock.tsx"), "utf-8");
    const smartBlock = fs.readFileSync(path.join(docDir, "WorkspaceDocSmartBlock.tsx"), "utf-8");
    const referencePreview = fs.readFileSync(path.join(docDir, "WorkspaceDocReferencePreview.tsx"), "utf-8");
    const viewer = fs.readFileSync(path.join(docDir, "WorkspaceDocViewer.tsx"), "utf-8");
    const docTab = fs.readFileSync(path.join(tabsDir, "DocTab.tsx"), "utf-8");

    await t.test("SkeletonDoc eliminates layout shift and matches right documents rail grid", () => {
        assert.match(skeletonDoc, /max-w-\[1240px\]/, "SkeletonDoc should match viewer max-w-[1240px]");
        assert.match(skeletonDoc, /xl:grid-cols-\[minmax\(0,1fr\)_260px\]/, "SkeletonDoc should match viewer 260px right documents rail grid");
        assert.doesNotMatch(skeletonDoc, /rounded-full/, "SkeletonDoc must not use rounded-full pill shapes");
        assert.doesNotMatch(skeletonDoc, /zinc-/, "SkeletonDoc must not use raw zinc tokens");
        assert.match(skeletonDoc, /rounded-\[5px\]/, "SkeletonDoc interactive elements should use 5px corners");
    });

    await t.test("WorkspaceDocRenderer conforms to Section 04 Typography and drafting tokens", () => {
        assert.match(renderer, /text-\[\d+px\] sm:text-\[30px\]/, "H1 must conform to 30px scale");
        assert.match(renderer, /text-\[\d+px\] sm:text-\[24px\]/, "H2 must conform to 24px scale");
        assert.match(renderer, /text-\[\d+px\] sm:text-\[20px\]/, "H3 must conform to 20px scale");
        assert.match(renderer, /text-\[\d+px\] sm:text-\[17px\]/, "H4 must conform to 17px scale");
        assert.match(renderer, /text-\[15px\] leading-\[1\.65\]/, "Body prose must conform to 15px/1.65 line height");
        assert.match(renderer, /border-l-2 border-border/, "Blockquotes must use neutral 2px fine rule");
        assert.doesNotMatch(renderer, /border-l-4/, "Blockquotes must not use coarse 4px rules");
        assert.match(renderer, /tracking-\[0\.05em\]/, "Table headers must use mono 11px uppercase tracking");
        assert.doesNotMatch(renderer, /text-zinc-|bg-zinc-|border-zinc-/, "Renderer must have zero zinc leaks");
        assert.doesNotMatch(renderer, /text-blue-|bg-blue-|border-blue-/, "Renderer must have zero blue leaks");
    });

    await t.test("WorkspaceDocCommandBlock adheres to Section 04/22 code block specification", () => {
        // One terminal style app-wide (CLI report A9.9): 13px mono at 1.6 from the shared block, header in .nb-micro (0.09em).
        const terminalClasses = fs.readFileSync(path.join(process.cwd(), "src/components/ui/terminal-classes.ts"), "utf-8");
        assert.match(commandBlock, /components\/ui\/terminal-classes/, "Code blocks use the shared terminal style");
        assert.match(terminalClasses, /font-mono text-\[13px\] leading-\[1\.6\]/, "Code blocks must use 13px mono at 1.6 leading");
        assert.match(commandBlock, /className="nb-micro"/, "Language header must use the .nb-micro label (0.09em tracking)");
        assert.match(commandBlock, /size-7.*rounded-\[5px\]/, "Copy button must be 28px square with 5px radius");
    });

    await t.test("WorkspaceDocSmartBlock & WorkspaceDocReferencePreview conform to Card and Option geometry", () => {
        assert.doesNotMatch(smartBlock, /zinc-/, "SmartBlock skeleton must not use raw zinc tokens");
        assert.match(smartBlock, /rounded-\[8px\]/, "SmartBlock container must use 8px card radius");
        assert.match(referencePreview, /rounded-\[5px\].*border.*bg-card/, "ReferenceOptionCard must use 5px corners");
        assert.match(referencePreview, /WorkspaceDocSmartBlockPreviewCard[\s\S]*rounded-\[8px\]/, "SmartBlockPreviewCard must use 8px container radius");
    });

    const rail = fs.readFileSync(path.join(docDir, "WorkspaceDocRail.tsx"), "utf-8");

    await t.test("WorkspaceDocRail conforms to sticky positioning without gaps and uninterrupted hairline divider", () => {
        assert.match(rail, /border-l border-border pl-6/, "Rail must place continuous left border on the outer aside");
        assert.match(rail, /top-\[calc\(var\(--workspace-tabs-height,42px\)\+1rem\)\]/, "Rail sticky container must dock directly below sticky tabs using dynamic variable");
        assert.doesNotMatch(rail, /sticky top-24/, "Rail must not use hardcoded top-24 causing floating gap");
    });

    await t.test("WorkspaceDocViewer and DocTab maintain layout and dedicated right documents rail", () => {
        assert.match(viewer, /max-w-\[1240px\]/, "Viewer must use 1240px drafting boundary");
        assert.match(viewer, /xl:grid-cols-\[minmax\(0,1fr\)_260px\]/, "Viewer must allocate 260px to right documents rail");
        assert.match(viewer, /WorkspaceDocRail/, "Viewer must render the dedicated right documents rail");
        assert.doesNotMatch(viewer, /ProjectDocQuickConsole/, "Viewer must not render the quick console context rail");
        assert.match(docTab, /nb-empty-state nb-grid-ground py-12/, "DocTab empty state must have generous vertical rhythm");
        assert.match(docTab, /nb-empty-state-icon/, "DocTab empty state must style icon consistently");
    });
});
