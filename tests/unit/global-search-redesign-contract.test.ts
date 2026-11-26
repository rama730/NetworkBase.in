import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("the box hangs under the top bar as the spec's command dialog (§31)", () => {
    const palette = source("src/components/layout/header/CommandPalette.tsx");
    const css = source("src/components/layout/header/search-box/search-box.css");
    // A full-screen sheet on a phone; on wider screens a 640px dialog under the search cell.
    assert.match(palette, /h-dvh w-screen/);
    assert.match(css, /top: calc\(var\(--ui-topnav-height, 56px\) \+ 8px\); width: min\(640px/);
    assert.match(css, /\.nb-sx-row, \.nb-sx-row-main \{ min-height: 52px; \}/);
    assert.match(palette, /nb-command-input h-full min-w-0 flex-1/);
    assert.match(palette, /style=\{\{ outline: "none", boxShadow: "none" \}\}/);
    assert.match(palette, /data-testid="global-search-enter-hint"/);
    assert.match(palette, /className="nb-sx-glabel nb-micro"/);
    assert.doesNotMatch(css, /border-left: [23]px solid var\(--nb-brand\)|inset 3px/, "no coloured edge accents");
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
