import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import path, { resolve } from "node:path";
import test from "node:test";
import { buildOwnerProfileTitle } from "@/lib/profile/display";

const ROOT = process.cwd();

test("Canonical route metadata contract: Discover route has updated title and path", () => {
    const discoverSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/discover/page.tsx"), "utf-8");

    assert.match(discoverSource, /title:\s*['"]Discover · NetworkBase['"]/);
    assert.match(discoverSource, /path:\s*['"]\/discover['"]/);
    assert.doesNotMatch(discoverSource, /title:\s*['"]Hub · NetworkBase['"]/);
});

test("Canonical route metadata contract: Network route has updated title and path", () => {
    const networkSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/network/page.tsx"), "utf-8");

    assert.match(networkSource, /title:\s*['"]Network · NetworkBase['"]/);
    assert.match(networkSource, /path:\s*['"]\/network['"]/);
    assert.doesNotMatch(networkSource, /title:\s*['"]Connections · NetworkBase['"]/);
});

test("Canonical route metadata contract: My profile has updated title fallback and canonical path", () => {
    const myProfileSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/my-profile/page.tsx"), "utf-8");

    assert.match(myProfileSource, /title:\s*['"]My profile · NetworkBase['"]/);
    assert.match(myProfileSource, /path:\s*['"]\/my-profile['"]/);
    assert.doesNotMatch(myProfileSource, /title:\s*['"]Your Profile · NetworkBase['"]/);
    assert.doesNotMatch(myProfileSource, /path:\s*['"]\/profile['"]/);

    assert.equal(buildOwnerProfileTitle({}), "My profile · NetworkBase");
    assert.equal(buildOwnerProfileTitle({ fullName: "Alice" }), "Alice · NetworkBase");
    assert.equal(buildOwnerProfileTitle({ fullName: "Alice", username: "alice" }), "Alice (@alice) · NetworkBase");
});

test("Canonical route metadata contract: Messages, Settings, and Workspace have matching metadata", () => {
    const messagesSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/messages/(lists)/page.tsx"), "utf-8");
    assert.match(messagesSource, /title:\s*['"]Messages · NetworkBase['"]/);
    assert.match(messagesSource, /path:\s*['"]\/messages['"]/);

    const settingsSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/settings/page.tsx"), "utf-8");
    assert.match(settingsSource, /title:\s*['"]Settings · NetworkBase['"]/);
    assert.match(settingsSource, /path:\s*['"]\/settings['"]/);

    const workspaceSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/my-work/page.tsx"), "utf-8");
    assert.match(workspaceSource, /title:\s*['"]My work · NetworkBase['"]/);
    assert.match(workspaceSource, /path:\s*['"]\/my-work['"]/);
    assert.match(workspaceSource, /redirect\(['"]\/discover\?my-work=tasks['"]\)/);
});

// Unified back R8: every page has a clear tab title (it names browser history entries and the back
// arrow's "Back to …"), and in-page tabs, threads and drawers keep it current.
test("every main page has a title from itself or its layout", () => {
    const MAIN = resolve(ROOT, "src/app/(site)/(main)");
    const hasMeta = (file: string) => fs.existsSync(file) && /export (const metadata|(async )?function generateMetadata)/.test(fs.readFileSync(file, "utf-8"));
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === "page.tsx" ? [path.join(dir, e.name)] : []);
    for (const page of walk(MAIN)) {
        const source = fs.readFileSync(page, "utf-8");
        if (/^\s*redirect\(/m.test(source) && !/export default function [^(]*\([^)]*\)\s*{[\s\S]*return\s*</.test(source)) continue; // redirect-only pages never show
        let dir = path.dirname(page);
        let titled = hasMeta(page);
        while (!titled && dir.startsWith(MAIN)) { titled = hasMeta(path.join(dir, "layout.tsx")); dir = path.dirname(dir); }
        assert.ok(titled, `${path.relative(ROOT, page)} has no title`);
    }
});

test("in-page tabs, threads and drawers keep the tab title current", () => {
    const read = (file: string) => readFileSync(resolve(ROOT, file), "utf-8");
    assert.match(read("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx"), /document\.title = `\$\{label\} · \$\{project\.title\} · NetworkBase`/);
    assert.match(read("src/components/discover/DiscoverClient.tsx"), /useDocumentTitlePrefix\(thread\.selected\?\.projectName/);
    assert.match(read("src/components/my-work/MyWorkDrawer.tsx"), /useDocumentTitlePrefix\(isMyWorkOpen \? "My work" : null\)/);
    assert.match(read("src/components/trust/TrustInbox.tsx"), /useDocumentTitlePrefix\(selectedLabel/);
});
