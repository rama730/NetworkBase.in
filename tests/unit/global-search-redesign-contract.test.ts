import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("CommandPalette enforces canonical max-w-640px geometry, rounded-12px radius, and nb-micro section headers", () => {
    const palette = source("src/components/layout/header/CommandPalette.tsx");

    // Geometry & Radius
    assert.match(palette, /sm:max-w-\[640px\]/);
    assert.match(palette, /sm:rounded-\[12px\]/);
    assert.match(palette, /sm:border-border sm:bg-card/);

    // Search Input Bar (Zero orange focus-visible outline)
    assert.match(palette, /h-14 shrink-0 items-center gap-3 border-b border-border/);
    assert.match(palette, /nb-command-input h-full min-w-0 flex-1/);
    assert.match(palette, /focus-visible:outline-none focus-visible:ring-0/);
    assert.match(palette, /style=\{\{ outline: "none", boxShadow: "none" \}\}/);
    assert.match(palette, /data-testid="global-search-enter-hint"/);

    // Monospace Micro-Label Section Headers
    assert.match(palette, /className="nb-micro uppercase tracking-\[0\.09em\] text-muted-foreground"/);
    assert.match(palette, /Workspaces · \$\{projectResults\.length\}/);
    assert.match(palette, /People · \$\{profileResults\.length\}/);

    // Related Skills as Drafting-Table Chips
    assert.match(palette, /Skills in these workspaces/);
    assert.match(palette, /data-testid="related-skills-scroll"/);
    assert.match(palette, /rounded-\[3px\] border px-2\.5 text-xs font-mono/);
    assert.doesNotMatch(palette, /Scroll to explore/, "Must not include redundant 'Scroll to explore' text");
    assert.doesNotMatch(palette, /rounded-full.*related-skills/, "Skills chips must follow 3px drafting-table radius");
});

test("GlobalSearchResultCards renders canonical status badges, squared avatars, and tabular metrics", () => {
    const cards = source("src/components/layout/header/GlobalSearchResultCards.tsx");

    // ResultShell Contract
    assert.match(cards, /rounded-\[8px\] border p-3/);
    assert.match(cards, /border-zinc-300 bg-zinc-50 shadow-none/);
    assert.match(cards, /border-border bg-muted\/65/);

    // Project Card Contract
    assert.match(cards, /nb-status shrink-0/);
    assert.match(cards, /projectStageLabel\(result\.status\)/);
    assert.match(cards, /truncate text-\[15px\] font-semibold text-foreground/);
    assert.match(cards, /UsersRound className="size-3 text-muted-foreground\/70"/);
    assert.match(cards, /Eye className="size-3 text-muted-foreground\/70"/);
    assert.match(cards, /openRolesCount/);
    assert.match(cards, /open \{result\.openRolesCount === 1 \? "role" : "roles"\}/);

    // Builder Card Contract
    assert.match(cards, /<PersonPresenceDot userId=\{result\.userId\} lastActiveAt=\{result\.lastActiveAt\} compact \/>/);
    assert.match(cards, /UserAvatar identity=.*size=\{40\} className="rounded-\[5px\]"/);
    assert.match(cards, /result\.connectionStatus === "connected"/);
    assert.match(cards, /inline-flex h-\[28px\] shrink-0 items-center gap-1\.5 self-center rounded-\[5px\] bg-primary/);
    assert.match(cards, /MapPin className="size-3 text-muted-foreground\/70"/);

    // Task Card Contract
    assert.match(cards, /font-mono text-\[11px\] font-medium text-muted-foreground/);
    assert.match(cards, /getTaskStatusPresentation\(result\.status\)/);
    assert.match(cards, /getTaskPriorityPresentation\(result\.priority\)/);
});

test("useGlobalSearchPreviews maps project lifecycle status and validates preview contracts", () => {
    const hook = source("src/hooks/useGlobalSearchPreviews.ts");
    assert.match(hook, /status\?: string \| null/);
    assert.match(hook, /status: project\.status \?\? null/);
    assert.match(hook, /isNullableString\(preview\.username\)/);
    assert.match(hook, /preview\.status === undefined \|\| isNullableString\(preview\.status\)/);
    assert.match(hook, /Array\.isArray\(preview\.skills\)/);
    assert.match(hook, /PREVIEW_LIMIT = 6/);
});

test("GlobalSearch trigger conforms to control height, 5px radius, and semantic border tokens", () => {
    const trigger = source("src/components/layout/header/GlobalSearch.tsx");

    assert.match(trigger, /h-\[var\(--ui-control-height\)\] w-60 lg:w-80/);
    assert.match(trigger, /rounded-\[5px\]/);
    assert.match(trigger, /border-border hover:border-input/);
    assert.match(trigger, /rounded-\[3px\] bg-muted\/60 border border-border text-\[11px\] font-mono/);
});
