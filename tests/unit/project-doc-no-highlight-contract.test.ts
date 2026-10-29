import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { nextFreeDocSlug } from "../../src/lib/projects/doc-slug";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("nextFreeDocSlug suffixes taken slugs", () => {
    assert.equal(nextFreeDocSlug("readme", new Set()), "readme");
    assert.equal(nextFreeDocSlug("readme", new Set(["readme"])), "readme-2");
    assert.equal(nextFreeDocSlug("readme", new Set(["readme", "readme-2"])), "readme-3");
});

test("Docs tab never paints orange highlight", () => {
    const docDir = path.join(root, "src/components/projects/doc");
    for (const file of fs.readdirSync(docDir)) {
        const source = fs.readFileSync(path.join(docDir, file), "utf8");
        assert.doesNotMatch(source, /ring-primary|bg-primary\/|border-primary|data-readme-highlighted/, `${file} must not highlight in orange`);
    }
    const commandBlock = read("src/components/projects/doc/ProjectDocCommandBlock.tsx");
    assert.doesNotMatch(commandBlock, /onCopied/, "copy must not call back into scroll/hash logic");
    assert.match(commandBlock, /animate-in zoom-in-50/, "copy shows an animated tick");
});

test("Removing a doc deletes the row for every slug", () => {
    const actions = read("src/app/actions/project/doc.ts");
    const unlink = actions.slice(actions.indexOf("export async function unlinkProjectDocAction"), actions.indexOf("export async function listProjectDocsAction"));
    assert.doesNotMatch(unlink, /docSlug === "readme"/, "readme must not be special-cased");
    assert.match(unlink, /db\.delete\(projectDocs\)/);
    const link = actions.slice(actions.indexOf("export async function linkProjectDocAction"), actions.indexOf("export async function unlinkProjectDocAction"));
    assert.doesNotMatch(link, /docSlug: string/, "slug is derived server-side");
    assert.match(link, /nextFreeDocSlug\(/);
    const migrations = fs.readdirSync(path.join(root, "drizzle")).filter((f) => f.endsWith(".sql"));
    assert.ok(
        migrations.some((f) => /DROP TRIGGER IF EXISTS project_docs_prevent_delete/.test(read(`drizzle/${f}`))),
        "a migration drops the readme delete guard",
    );
});

test("Docs are added only from the Docs tab", () => {
    for (const file of [
        "src/components/projects/v2/files-tab/FilesTabSidebar.tsx",
        "src/components/projects/v2/files-tab/folder/FolderListView.tsx",
        "src/components/projects/v2/files-tab/file/FileActionsBar.tsx",
    ]) {
        const source = read(file);
        assert.doesNotMatch(source, /Use as (a )?doc|\blinkProjectDocAction\(/i, `${file} must not add docs`);
    }
    assert.match(read("src/components/projects/doc/AddDocDialog.tsx"), /\blinkProjectDocAction\(/);
    assert.match(read("src/components/projects/v2/files-tab/file/FileActionsBar.tsx"), /Remove from docs/);
});
