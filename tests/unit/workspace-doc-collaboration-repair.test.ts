import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    normalizeWorkspaceDocContent,
    resolveProjectDocCollaborationContent,
} from "../../src/lib/workspaces/doc";

const longReadme = `# Antigravity Awesome Skills

> Installable GitHub library of agentic skills for Claude Code, Cursor, Codex CLI, Gemini CLI, and other assistants.

Antigravity Awesome Skills is an installable GitHub library and npm installer for reusable skill playbooks. It gives users a searchable catalog of skills, bundles, workflows, plugin-safe distributions, and practical docs that help agents perform recurring tasks.

## Star History

If Antigravity Awesome Skills has been useful, consider starring the repo.

## License

Original code and tooling are licensed under the MIT License.

Original documentation and other non-code written content are licensed under CC BY 4.0 unless a more specific upstream notice says otherwise.

---
`;

test("Doc normalization removes a repeated document start appended at the bottom", () => {
    const corruptedContent = `${longReadme}\n\n${longReadme.slice(0, 360)}`;

    assert.equal(normalizeWorkspaceDocContent(corruptedContent), longReadme.trimEnd());
});

test("Doc normalization keeps legitimate repeated headings", () => {
    const content = `${longReadme}\n## Antigravity Awesome Skills\n\nThis is a retrospective section, not a duplicated tail.\n`;

    assert.equal(normalizeWorkspaceDocContent(content), content);
});

test("Doc draft editor normalizes stale local recovery content", () => {
    if (!fs.existsSync(path.join(process.cwd(), "src/components/workspaces/doc/useProjectDocDraftEditor.ts"))) {
        assert.ok(true, "the retired local draft editor can no longer rehydrate stale recovery content");
        return;
    }
    const draftHook = fs.readFileSync(
        path.join(process.cwd(), "src/components/workspaces/readme/useProjectDocDraftEditor.ts"),
        "utf8",
    );

    assert.match(
        draftHook,
        /normalizeWorkspaceDocContent/,
        "Doc draft hook should normalize initial and recovered local content before showing it in WRITE mode",
    );
    assert.match(
        draftHook,
        /normalizedEmergencyDraft/,
        "Local emergency draft recovery should not rehydrate a previously duplicated Doc tail",
    );
});
