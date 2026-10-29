import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildOwnerProfileTitle } from "@/lib/profile/display";

const ROOT = process.cwd();

test("Canonical route metadata contract: Discover route has updated title and path", () => {
    const discoverSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/discover/page.tsx"), "utf-8");

    assert.match(discoverSource, /title:\s*['"]Discover \| NetworkBase['"]/);
    assert.match(discoverSource, /path:\s*['"]\/discover['"]/);
    assert.doesNotMatch(discoverSource, /title:\s*['"]Hub \| NetworkBase['"]/);
});

test("Canonical route metadata contract: Network route has updated title and path", () => {
    const networkSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/network/page.tsx"), "utf-8");

    assert.match(networkSource, /title:\s*['"]Network \| NetworkBase['"]/);
    assert.match(networkSource, /path:\s*['"]\/network['"]/);
    assert.doesNotMatch(networkSource, /title:\s*['"]Connections \| NetworkBase['"]/);
});

test("Canonical route metadata contract: My Profile has updated title fallback and canonical path", () => {
    const myProfileSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/my-profile/page.tsx"), "utf-8");

    assert.match(myProfileSource, /title:\s*['"]My Profile \| NetworkBase['"]/);
    assert.match(myProfileSource, /path:\s*['"]\/my-profile['"]/);
    assert.doesNotMatch(myProfileSource, /title:\s*['"]Your Profile \| NetworkBase['"]/);
    assert.doesNotMatch(myProfileSource, /path:\s*['"]\/profile['"]/);

    assert.equal(buildOwnerProfileTitle({}), "My Profile | NetworkBase");
    assert.equal(buildOwnerProfileTitle({ fullName: "Alice" }), "Alice | NetworkBase");
    assert.equal(buildOwnerProfileTitle({ fullName: "Alice", username: "alice" }), "Alice (@alice) | NetworkBase");
});

test("Canonical route metadata contract: Messages, Settings, and Workspace have matching metadata", () => {
    const messagesSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/messages/(lists)/page.tsx"), "utf-8");
    assert.match(messagesSource, /title:\s*['"]Messages \| NetworkBase['"]/);
    assert.match(messagesSource, /path:\s*['"]\/messages['"]/);

    const settingsSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/settings/page.tsx"), "utf-8");
    assert.match(settingsSource, /title:\s*['"]Settings \| NetworkBase['"]/);
    assert.match(settingsSource, /path:\s*['"]\/settings['"]/);

    const workspaceSource = readFileSync(resolve(ROOT, "src/app/(site)/(main)/my-work/page.tsx"), "utf-8");
    assert.match(workspaceSource, /title:\s*['"]My work \| NetworkBase['"]/);
    assert.match(workspaceSource, /path:\s*['"]\/my-work['"]/);
    assert.match(workspaceSource, /redirect\(['"]\/discover\?my-work=tasks['"]\)/);
});
