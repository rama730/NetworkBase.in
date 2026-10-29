import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

test("project detail header and discovery project cards omit the status/building badge", () => {
    const layoutSource = readFileSync(resolve(ROOT, "src/components/workspaces/dashboard/WorkspaceLayout.tsx"), "utf-8");
    const cardSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceCard.tsx"), "utf-8");
    const skeletonSource = readFileSync(resolve(ROOT, "src/components/workspaces/WorkspaceCardSkeleton.tsx"), "utf-8");

    // WorkspaceLayout title header
    assert.doesNotMatch(
        layoutSource,
        /projectStageLabel/,
        "WorkspaceLayout should not import or use projectStageLabel"
    );
    assert.doesNotMatch(
        layoutSource,
        /<h1[^>]*>[\s\S]*?<\/h1>\s*<span className="nb-status"/,
        "WorkspaceLayout header must not render a status badge next to the title"
    );

    // ProjectCard header
    assert.doesNotMatch(
        cardSource,
        /projectStageLabel/,
        "ProjectCard should not import or use projectStageLabel"
    );
    assert.doesNotMatch(
        cardSource,
        /<h3[^>]*>[\s\S]*?<\/h3>\s*<span className="nb-status"/,
        "ProjectCard must not render a status badge next to the title"
    );

    // Skeleton matches card layout
    assert.doesNotMatch(
        skeletonSource,
        /h-5 w-16 rounded-sm bg-muted/,
        "WorkspaceCardSkeleton should not render a status badge placeholder"
    );
});
