import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildOwnerProfileTitle } from "@/lib/profile/display";

const ROOT = process.cwd();

test("Canonical route metadata contract: Discover route has updated title and path", () => {
    const hubSource = readFileSync(resolve(ROOT, "src/app/(main)/hub/page.tsx"), "utf-8");
    const discoverSource = readFileSync(resolve(ROOT, "src/app/(main)/discover/page.tsx"), "utf-8");

    assert.match(hubSource, /title:\s*['"]Discover \| NetworkBase['"]/);
    assert.match(hubSource, /path:\s*['"]\/discover['"]/);
    assert.doesNotMatch(hubSource, /title:\s*['"]Hub \| NetworkBase['"]/);

    assert.match(discoverSource, /export\s*\{\s*default,\s*generateMetadata\s*\}\s*from\s*['"]\.\.\/hub\/page['"]/);
});

test("Canonical route metadata contract: Network route has updated title and path", () => {
    const peopleSource = readFileSync(resolve(ROOT, "src/app/(main)/people/page.tsx"), "utf-8");
    const networkSource = readFileSync(resolve(ROOT, "src/app/(main)/network/page.tsx"), "utf-8");

    assert.match(peopleSource, /title:\s*['"]Network \| NetworkBase['"]/);
    assert.match(peopleSource, /path:\s*['"]\/network['"]/);
    assert.doesNotMatch(peopleSource, /title:\s*['"]Connections \| NetworkBase['"]/);

    assert.match(networkSource, /export\s*\{\s*default,\s*generateMetadata\s*\}\s*from\s*['"]\.\.\/people\/page['"]/);
});

test("Canonical route metadata contract: My Profile has updated title fallback and canonical path", () => {
    const profileSource = readFileSync(resolve(ROOT, "src/app/(main)/profile/page.tsx"), "utf-8");
    const myProfileSource = readFileSync(resolve(ROOT, "src/app/(main)/my-profile/page.tsx"), "utf-8");

    assert.match(profileSource, /title:\s*['"]My Profile \| NetworkBase['"]/);
    assert.match(profileSource, /path:\s*['"]\/my-profile['"]/);
    assert.doesNotMatch(profileSource, /title:\s*['"]Your Profile \| NetworkBase['"]/);
    assert.doesNotMatch(profileSource, /path:\s*['"]\/profile['"]/);

    assert.match(myProfileSource, /export\s*\{\s*default,\s*generateMetadata\s*\}\s*from\s*['"]\.\.\/profile\/page['"]/);

    assert.equal(buildOwnerProfileTitle({}), "My Profile | NetworkBase");
    assert.equal(buildOwnerProfileTitle({ fullName: "Alice" }), "Alice | NetworkBase");
    assert.equal(buildOwnerProfileTitle({ fullName: "Alice", username: "alice" }), "Alice (@alice) | NetworkBase");
});

test("Canonical route metadata contract: Messages, Settings, and Workspace have matching metadata", () => {
    const messagesSource = readFileSync(resolve(ROOT, "src/app/(main)/messages/page.tsx"), "utf-8");
    assert.match(messagesSource, /title:\s*['"]Messages \| NetworkBase['"]/);
    assert.match(messagesSource, /path:\s*['"]\/messages['"]/);

    const settingsSource = readFileSync(resolve(ROOT, "src/app/(main)/settings/page.tsx"), "utf-8");
    assert.match(settingsSource, /title:\s*['"]Settings \| NetworkBase['"]/);
    assert.match(settingsSource, /path:\s*['"]\/settings['"]/);

    const workspaceSource = readFileSync(resolve(ROOT, "src/app/(main)/workspace/page.tsx"), "utf-8");
    assert.match(workspaceSource, /title:\s*['"]Workspace \| NetworkBase['"]/);
    assert.match(workspaceSource, /path:\s*['"]\/workspace['"]/);
    assert.match(workspaceSource, /redirect\(['"]\/discover\?workspace=tasks['"]\)/);
});
