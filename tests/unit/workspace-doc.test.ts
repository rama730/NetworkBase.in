import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
    buildWorkspaceDocExcerpt,
    buildWorkspaceDocPlainText,
    buildWorkspaceDocPublishMetadata,
    extractWorkspaceDocHeadings,
    normalizeWorkspaceDocContent,
    normalizeWorkspaceDocSettings,
    resolveWorkspaceDocPermission,
} from "../../src/lib/workspaces/doc";
import { evaluateWorkspaceDocQuality } from "../../src/lib/workspaces/doc-quality";
import {
    buildInlineReadmeReference,
    parseWorkspaceDocInlineReferences,
    parseWorkspaceDocSmartBlocks,
    replaceInlineReadmeReferencesWithMarkdown,
    splitMarkdownByInlineReferences,
    splitMarkdownBySmartBlocks,
} from "../../src/lib/workspaces/doc-blocks";
import {
    buildWorkspaceDocCommandTargetMaps,
    buildWorkspaceDocRailReport,
    extractWorkspaceDocCommandShortcuts,
} from "../../src/lib/workspaces/doc-quick-console";
import {
    projectDocCommandBlockId,
    projectDocCommandLineTargetId,
    projectDocReferenceTargetId,
} from "../../src/lib/workspaces/doc-navigation";
import {
    buildProjectDocEditorSourceTargets,
    findProjectDocEditorSourceTarget,
    getDocLineStartOffset,
} from "../../src/lib/workspaces/doc-editor-source-map";
import {
    parseWorkspaceDocGithubRepoUrl,
    parseReadmeHtmlDimension,
    buildProjectDocImageMarkdown,
    PROJECT_DOC_IMAGE_INTENTS,
    resolveWorkspaceDocGithubSource,
    resolveWorkspaceDocImage,
} from "../../src/lib/workspaces/doc-media";
import {
    buildProjectDocStylePresetMarkdown,
    PROJECT_DOC_STYLE_PRESETS,
} from "../../src/lib/workspaces/doc-style";
import { buildWorkspaceDocViewModel } from "../../src/lib/workspaces/doc-view-model";

test("Doc permissions keep public, private, and editor access separated", () => {
    const publicPermission = resolveWorkspaceDocPermission({
        projectStatus: "active",
        actorUserId: null,
        projectVisibility: "public",
        publicTabVisibility: { dashboard: true, readme: true, updates: true, files: true, sprints: false, tasks: false },
        hasPublishedReadme: true,
    });
    assert.equal(publicPermission.canReadPublished, true);
    assert.equal(publicPermission.canEdit, false);

    const privateOutsider = resolveWorkspaceDocPermission({
        actorUserId: "user-1",
        projectVisibility: "private",
        publicTabVisibility: { dashboard: true, readme: true, updates: true, files: true, sprints: false, tasks: false },
        hasPublishedReadme: true,
    });
    assert.equal(privateOutsider.canReadPublished, false);

    const coLeader = resolveWorkspaceDocPermission({
        actorUserId: "admin-1",
        projectVisibility: "private",
        membershipRole: "admin",
        isActiveMember: true,
        hasPublishedReadme: false,
    });
    assert.equal(coLeader.canEdit, true);
    assert.equal(coLeader.canPublish, true);

    const memberWithPolicy = resolveWorkspaceDocPermission({
        actorUserId: "member-1",
        membershipRole: "member",
        isActiveMember: true,
        settings: { editPolicy: "members" },
    });
    assert.equal(memberWithPolicy.canEdit, true);
    assert.equal(memberWithPolicy.canPublish, true);
});

test("Doc metadata extracts headings, excerpt, hash, and smart blocks", () => {
    const content = `# Project Overview

This workspace helps teams ship together.

## Getting Started

\`\`\`bash
pnpm install
\`\`\`

{% project.roles %}
`;
    const metadata = buildWorkspaceDocPublishMetadata(content);
    assert.equal(metadata.headings.length, 2);
    assert.equal(metadata.headings[0]!.id, "project-overview");
    assert.ok(metadata.excerpt?.includes("teams ship"));
    assert.equal(metadata.smartBlocks[0]!.kind, "roles");
    assert.equal(metadata.contentHash.length, 64);
});

test("Doc content normalization removes generated collaboration footer text", () => {
    const content = `# Setup

Use this project with care.

Collaborator Rama publish test content
`;
    assert.equal(normalizeWorkspaceDocContent(content), "# Setup\n\nUse this project with care.");
});

test("Doc content normalization keeps ordinary collaborator prose", () => {
    const content = "A collaborator can publish test content after review.";
    assert.equal(normalizeWorkspaceDocContent(content), content);
});

test("Doc quality flags missing guidance and unsafe URLs", () => {
    const report = evaluateWorkspaceDocQuality(`# Project

[bad](javascript:alert(1))
`);
    assert.ok(report.issues.some((issue) => issue.id === "unsafe-url"));
    assert.ok(report.issues.some((issue) => issue.id === "missing-setup"));
});

test("Doc quality flags visual media risks", () => {
    const report = evaluateWorkspaceDocQuality(`# Project

## Install

\`\`\`bash
pnpm install
\`\`\`

<img src="https://example.com/huge.png" width="1800" />

| Before | After |
| --- | --- |
| ![](docs/before.png) | ![After](docs/after.png) |
`);
    assert.ok(report.issues.some((issue) => issue.id === "image-missing-alt"));
    assert.ok(report.issues.some((issue) => issue.id === "external-image"));
    assert.ok(report.issues.some((issue) => issue.id === "image-oversized"));
    assert.ok(report.issues.some((issue) => issue.id === "image-table-layout"));
});

test("Doc smart block parser keeps malformed blocks safe", () => {
    const blocks = parseWorkspaceDocSmartBlocks(`Before
{% project.files ids="a,b" %}
{% project.not_real %}
After`);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.kind, "files");
    assert.deepEqual(blocks[0]!.ids, ["a", "b"]);
    assert.equal(blocks[1]!.kind, "unknown");

    const segments = splitMarkdownBySmartBlocks("A\n{% project.sprints %}\nB");
    assert.equal(segments.length, 3);
});

test("Doc smart block parser supports visual reference picker output", () => {
    const blocks = parseWorkspaceDocSmartBlocks(`
{% project.tasks ids="task-1, task-2" %}
{% project.contributors ids="member-1" %}
{% project.roles %}
`);
    assert.deepEqual(blocks.map((block) => block.kind), ["tasks", "contributors", "roles"]);
    assert.deepEqual(blocks[0]!.ids, ["task-1", "task-2"]);
    assert.deepEqual(blocks[1]!.ids, ["member-1"]);
    assert.deepEqual(blocks[2]!.ids, []);
});

test("Doc inline reference fallback never exposes raw ids as labels", () => {
    const token = `{% ref.tasks id="11111111-1111-4111-8111-111111111111" %}`;
    const refs = parseWorkspaceDocInlineReferences(token);
    assert.equal(refs[0]!.label, "task reference");

    const markdown = replaceInlineReadmeReferencesWithMarkdown(token);
    assert.ok(markdown.includes("[task reference](/__readme-ref/tasks/11111111-1111-4111-8111-111111111111)"));
    assert.ok(!markdown.includes("[11111111-1111-4111-8111-111111111111]"));
});

test("Doc settings normalize safe defaults", () => {
    const settings = normalizeWorkspaceDocSettings({
        editPolicy: "members",
        externalImages: true,
        projectBlocks: false,
    });
    assert.equal(settings.editPolicy, "members");
    assert.equal(settings.externalImages, true);
});

test("Doc headings and excerpt are deterministic", () => {
    const headings = extractWorkspaceDocHeadings("# Intro\n## Intro\n### Usage");
    assert.deepEqual(headings.map((heading) => heading.id), ["intro", "intro-2", "usage"]);
    assert.equal(buildWorkspaceDocExcerpt("```bash\npnpm dev\n```\n# Title\nUseful docs."), "Title Useful docs.");
});

test("Doc headings ignore fenced code and clean inline HTML", () => {
    const headings = extractWorkspaceDocHeadings(`# Before / After

\`\`\`bash
### <img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock"/> not a heading
\`\`\`

## <img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock"/> Install
`);
    assert.deepEqual(headings, [
        { id: "before-after", level: 1, text: "Before / After" },
        { id: "install", level: 2, text: "Install" },
    ]);
});

test("Doc plain text strips decorative HTML before truncating", () => {
    const htmlHeavy = `<p align="center"><img src="https://example.com/rock.png" width="120" /></p>
<h1 align="center">caveman</h1>
<p align="center"><strong>why use many token when few do trick</strong></p>

\`\`\`bash
npm install
\`\`\`
`;
    assert.equal(buildWorkspaceDocPlainText(htmlHeavy, { maxLength: 80 }), "caveman why use many token when few do trick");
    assert.equal(buildWorkspaceDocExcerpt(htmlHeavy), "caveman why use many token when few do trick");
    assert.equal(buildWorkspaceDocPlainText(`<p align="center"><img src="https://example.com/rock.png"`), null);
});

test("Doc quick console extracts labeled copy commands", () => {
    const commands = extractWorkspaceDocCommandShortcuts(`## Install

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Deploy

\`\`\`sh
vercel deploy
\`\`\`
`);
    assert.deepEqual(commands.map((command) => command.label), ["Install", "Run dev", "Deploy"]);
    assert.deepEqual(commands.map((command) => command.blockId), ["readme-command-0", "readme-command-0", "readme-command-1"]);
    assert.deepEqual(commands.map((command) => command.command), ["pnpm install", "pnpm dev", "vercel deploy"]);
});

test("Doc quick console ignores decorative shell block lines", () => {
    const commands = extractWorkspaceDocCommandShortcuts(`## Like this trick? Now get whole agent — caveman-code

\`\`\`bash
<img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock"/> Like this trick? Now get whole agent — caveman-code
npm install -g @juliusbrussee/caveman-code

curl -fsSL \\
  https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh \\
  | bash
\`\`\`
`);
    assert.deepEqual(commands.map((command) => command.command), [
        "npm install -g @juliusbrussee/caveman-code",
        "curl -fsSL \\\nhttps://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh \\\n| bash",
    ]);
    assert.equal(commands[0]!.detail, "Global package");
    assert.ok(commands[0]!.ecosystemTags.includes("Node"));
    assert.ok(commands[0]!.ecosystemTags.includes("Shell"));
    assert.equal(commands[0]!.confidence, "high");
    assert.equal(commands[0]!.confidenceLabel, "Direct match");
    assert.equal(commands[1]!.detail, "macOS, Linux, WSL");
    assert.equal(commands[1]!.riskLabel, "Remote install script");
    assert.deepEqual(commands[1]!.platforms, ["macOS", "Linux", "WSL"]);
    assert.ok(commands[1]!.ecosystemTags.includes("GitHub"));
    assert.ok(commands[1]!.ecosystemTags.includes("Shell"));
    assert.ok(commands.every((command) => !/<img|Like this trick/i.test(`${command.command} ${command.detail ?? ""}`)));
});

test("Doc command shortcuts share renderer command block ids", () => {
    const commands = extractWorkspaceDocCommandShortcuts(`## Notes

\`\`\`
plain fenced content that the renderer leaves unpromoted
\`\`\`

\`\`\`ts
const value = 1;
\`\`\`

\`\`\`bash
pnpm dev
\`\`\`
`);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]!.blockId, projectDocCommandBlockId(1));
    assert.equal(commands[0]!.id, `${projectDocCommandBlockId(1)}-0`);
});

test("Doc command shortcuts expose line-level targets for multi-command blocks", () => {
    const content = `## Install

\`\`\`bash
curl -fsSL \\
  https://example.com/install.sh \\
  | bash
pnpm dev
\`\`\`
`;
    const commands = extractWorkspaceDocCommandShortcuts(content);
    assert.equal(commands.length, 2);
    assert.equal(commands[0]!.targetId, projectDocCommandLineTargetId(0, 0));
    assert.equal(commands[0]!.codeLineStart, 0);
    assert.equal(commands[0]!.codeLineEnd, 2);
    assert.equal(commands[1]!.targetId, projectDocCommandLineTargetId(0, 1));
    assert.equal(commands[1]!.codeLineStart, 3);
    assert.equal(commands[1]!.codeLineEnd, 3);

    const model = buildWorkspaceDocViewModel({ content });
    assert.ok(model.targetRegistry.has(projectDocCommandLineTargetId(0, 0)));
    assert.ok(model.targetRegistry.has(projectDocCommandLineTargetId(0, 1)));
    assert.equal(model.recommendedAction?.targetId, projectDocCommandLineTargetId(0, 0));
});

test("Doc command target maps preserve same-line inline command order", () => {
    const content = "Run `pnpm dev` and then `pnpm test`.";
    const maps = buildWorkspaceDocCommandTargetMaps(content);
    assert.deepEqual(maps.inlineByLineQueue.get(1), [
        projectDocCommandBlockId(0),
        projectDocCommandBlockId(1),
    ]);
});

test("Doc report deduplicates repeated risky command warnings", () => {
    const content = `## Install

\`\`\`bash
curl -fsSL https://example.com/install.sh | bash
curl -fsSL https://example.com/other.sh | bash
\`\`\`
`;
    const commands = extractWorkspaceDocCommandShortcuts(content);
    const report = buildWorkspaceDocRailReport({
        content,
        commands,
        references: [],
        headings: extractWorkspaceDocHeadings(content),
    });
    assert.deepEqual(report.warnings, ["Remote install script"]);
});

test("Doc command extraction skips decorative HTML and unpromoted fences", () => {
    const content = `<p align="center"><img src="docs/assets/dancing-rock.svg" width="22" height="22" alt="rock" /></p>

\`\`\`
plain fenced \`npm run nope\` content that should not become a command
\`\`\`

## Quick Start

\`npm install -g @juliusbrussee/caveman-code\`
`;
    const commands = extractWorkspaceDocCommandShortcuts(content);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]!.group, "recommended");
    assert.equal(commands[0]!.label, "Start here");
    assert.equal(commands[0]!.command, "npm install -g @juliusbrussee/caveman-code");
    assert.ok(commands.every((command) => !/<img|npm run nope/i.test(command.command)));
});

test("Doc quick console extracts Caveman-style install commands, config, and options", () => {
    const content = `# caveman

why use many token when few do trick.

## Install

Agent | Command
--- | ---
Claude Code | \`claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman\`
Gemini CLI | \`gemini extensions install https://github.com/JuliusBrussee/caveman\`
Codex | \`npx skills add JuliusBrussee/caveman -a codex\`

Flag | What
--- | ---
\`--minimal\` | Plugin only.
\`--dry-run\` | Preview.

## caveman-shrink

\`\`\`json
{
  "mcpServers": {
    "fs-shrunk": {
      "command": "npx",
      "args": ["caveman-shrink"]
    }
  }
}
\`\`\`

## Benchmarks

Average token savings: 65%.
`;
    const commands = extractWorkspaceDocCommandShortcuts(content);
    assert.ok(commands.some((command) => command.command.includes("claude plugin marketplace add") && command.group === "claude"));
    assert.ok(commands.some((command) => command.command.includes("gemini extensions install") && command.group === "agents"));
    assert.ok(commands.some((command) => command.command === "--minimal" && command.group === "options"));
    assert.ok(commands.some((command) => command.command.includes('"mcpServers"') && command.group === "config"));
    assert.ok(commands.some((command) => command.command.includes("npx skills add") && command.label === "Codex skill"));
    assert.ok(commands.some((command) => command.ecosystemTags.includes("Claude")));
    assert.ok(commands.some((command) => command.ecosystemTags.includes("Codex")));
    assert.ok(commands.every((command) => command.confidenceLabel));

    const report = buildWorkspaceDocRailReport({
        content,
        commands,
        references: [],
        headings: extractWorkspaceDocHeadings(content),
    });
    assert.ok(report.signals.includes("Claude install"));
    assert.ok(report.signals.includes("Config"));
    assert.ok(report.signals.some((signal) => signal.includes("option")));
    assert.ok(report.signals.includes("Report data"));
    assert.ok(report.briefItems.some((item) => item.label === "Start here"));
    assert.ok(report.briefItems.some((item) => item.label === "Setup paths"));
});

test("Doc view model centralizes tabs, targets, previews, and command metadata", () => {
    const content = `# Caveman

Use fewer tokens.

## Install

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/JuliusBrussee/caveman/main/install.sh | bash
\`\`\`

## Options

\`--minimal\` keeps plugin only.

{% ref.files id="11111111-1111-4111-8111-111111111111" label="README.md" %}
`;
    const model = buildWorkspaceDocViewModel({ content, excerpt: "Use fewer tokens." });

    assert.deepEqual(model.railTabs, ["commands", "brief", "outline", "options", "links"]);
    assert.equal(model.headings[0]!.id, "caveman");
    assert.ok(model.targetRegistry.has("install"));
    assert.ok(model.targetRegistry.has("readme-command-0"));
    assert.ok(model.targetRegistry.has("readme-ref-files-11111111-1111-4111-8111-111111111111-0"));
    assert.ok(model.railActions.some((action) => action.kind === "command" && action.copyText?.includes("curl -fsSL")));
    assert.equal(model.recommendedAction?.kind, "command");
    assert.equal(model.recommendedAction?.targetId, "readme-command-0");
    assert.ok(model.previewBlocks.length > 0);
    assert.equal(model.referencePreviewBlocks.length, 1);
    assert.ok(model.targetSignature.includes("readme-command-0"));
    assert.equal(model.commands[0]!.riskLabel, "Remote install script");
    assert.deepEqual(model.commands[0]!.platforms, ["macOS", "Linux", "WSL"]);
    assert.ok(model.commands[0]!.ecosystemTags.includes("GitHub"));
    assert.equal(model.commands[0]!.confidence, "high");
    assert.equal(model.report.nextAction?.startsWith("Install:"), true);
    assert.equal(model.report.readiness, "actionable");
    assert.ok(model.report.platforms.includes("macOS"));
    assert.ok(model.report.summaryItems.some((item) => item.label === "Commands"));
    assert.ok(model.report.briefItems.some((item) => item.label === "Review"));
});

test("Doc view model cache keys prefer the persisted content hash", () => {
    const first = buildWorkspaceDocViewModel({
        content: "# Same\n\n```bash\npnpm install\n```",
        contentHash: "hash-a",
    });
    const second = buildWorkspaceDocViewModel({
        content: "# Same\n\n```bash\npnpm install\n```",
        contentHash: "hash-a",
    });
    const third = buildWorkspaceDocViewModel({
        content: "# Same\n\n```bash\npnpm install\n```",
        contentHash: "hash-b",
    });

    assert.equal(first, second);
    assert.notEqual(first, third);
});

test("Doc view model reports weak and empty Doc states", () => {
    const weak = buildWorkspaceDocViewModel({ content: "This workspace is described but has no setup path." });
    assert.equal(weak.report.readiness, "weak");
    assert.ok(weak.report.limitations.includes("No copyable setup commands detected"));
    assert.equal(weak.railTabs.includes("brief"), true);

    const empty = buildWorkspaceDocViewModel({ content: "   " });
    assert.equal(empty.report.readiness, "empty");
    assert.ok(empty.report.limitations.includes("Doc is empty"));
    assert.deepEqual(empty.railTabs, []);
});

test("Doc reference target ids are stable and DOM-safe", () => {
    assert.equal(
        projectDocReferenceTargetId("tasks", "11111111-1111-4111-8111-111111111111", 2),
        "readme-ref-tasks-11111111-1111-4111-8111-111111111111-2",
    );
});

test("Doc media resolver preserves GitHub-style image sizing and safety", () => {
    const publicGithubProject = {
        id: "project-1",
        visibility: "public",
        importSource: {
            type: "github",
            repoUrl: "https://github.com/JuliusBrussee/caveman",
            branch: "main",
        },
    };

    assert.deepEqual(parseWorkspaceDocGithubRepoUrl("git@github.com:JuliusBrussee/caveman.git"), {
        owner: "JuliusBrussee",
        repo: "caveman",
    });
    assert.equal(resolveWorkspaceDocGithubSource(publicGithubProject)?.branch, "main");
    assert.equal(parseReadmeHtmlDimension("120px"), 120);

    const logo = resolveWorkspaceDocImage({
        src: "https://em-content.zobj.net/source/apple/391/rock_1faa8.png",
        width: "120",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(logo.src?.includes("rock_1faa8.png"), true);
    assert.equal(logo.kind, "logo");
    assert.equal(logo.width, 120);
    assert.equal(logo.trustedExternal, true);

    const badge = resolveWorkspaceDocImage({
        src: "https://img.shields.io/github/stars/JuliusBrussee/caveman?style=flat&color=yellow",
        alt: "Stars",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(badge.kind, "badge");
    assert.equal(badge.blockedReason, null);

    const relativeIcon = resolveWorkspaceDocImage({
        src: "docs/assets/dancing-rock.svg",
        width: "20",
        height: "20",
        alt: "rock",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(relativeIcon.kind, "icon");
    assert.equal(relativeIcon.src, "https://raw.githubusercontent.com/JuliusBrussee/caveman/main/docs/assets/dancing-rock.svg");

    const protocolRelativeBadge = resolveWorkspaceDocImage({
        src: "//img.shields.io/github/license/JuliusBrussee/caveman",
        alt: "License",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(protocolRelativeBadge.kind, "badge");
    assert.equal(protocolRelativeBadge.src, "https://img.shields.io/github/license/JuliusBrussee/caveman");

    const githubBlobImage = resolveWorkspaceDocImage({
        src: "https://github.com/JuliusBrussee/caveman/blob/main/docs/preview.png?raw=true",
        alt: "Preview",
        allowExternalImages: false,
        project: publicGithubProject,
    });
    assert.equal(githubBlobImage.src, "https://raw.githubusercontent.com/JuliusBrussee/caveman/main/docs/preview.png?raw=true");
    assert.equal(githubBlobImage.trustedExternal, true);

    const metadataOnlyGithubSource = resolveWorkspaceDocGithubSource({
        id: "project-2",
        visibility: "public",
        importSource: {
            type: "github",
            branch: "main",
            metadata: {
                githubOwner: "JuliusBrussee",
                githubName: "caveman",
            },
        },
    });
    assert.deepEqual(metadataOnlyGithubSource, {
        owner: "JuliusBrussee",
        repo: "caveman",
        branch: "main",
    });

    const privateExternal = resolveWorkspaceDocImage({
        src: "https://example.com/private.png",
        allowExternalImages: false,
        project: { id: "private", visibility: "private" },
    });
    assert.equal(privateExternal.src, null);
    assert.equal(privateExternal.blockedReason, "external");
});

test("Doc external image policy is not contradicted by the static CSP", () => {
    const nextConfig = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    const middleware = fs.readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");

    assert.match(middleware, /"img-src 'self' data: blob: https:"/);
    assert.doesNotMatch(nextConfig, /img-src/, "one middleware policy should own image CSP rather than competing static headers");
});

test("Files tab Linked Doc Ecosystem synchronization", () => {
    const repoRoot = process.cwd();
    const fileActions = fs.readFileSync(path.join(repoRoot, "src/components/workspaces/v2/files-tab/file/FileActionsBar.tsx"), "utf8");
    const readmeAction = fs.readFileSync(path.join(repoRoot, "src/app/actions/workspace/doc.ts"), "utf8");
    const docTab = fs.readFileSync(path.join(repoRoot, "src/components/workspaces/tabs/DocTab.tsx"), "utf8");

    assert.match(readmeAction, /linkWorkspaceDocAction/, "readme actions should define linkWorkspaceDocAction");
    assert.match(readmeAction, /unlinkWorkspaceDocAction/, "readme actions should define unlinkWorkspaceDocAction");
    assert.match(readmeAction, /linkedNodeId:\s*nodeId/, "link action should set linkedNodeId in the database");

    assert.doesNotMatch(fileActions, /\blinkWorkspaceDocAction\(/, "docs are added only from the Docs tab");
    assert.match(fileActions, /unlinkWorkspaceDocAction\(/, "Files tab can remove a linked doc");
    assert.match(fileActions, /Remove from docs/, "Files tab labels the remove action");

    assert.match(docTab, /WorkspaceDocViewer/, "linked documents should resolve through the canonical published Doc viewer");
});

test("Doc editor exit discard confirmation logic is present", () => {
    const repoRoot = process.cwd();
    if (!fs.existsSync(path.join(repoRoot, "src/components/workspaces/doc/ProjectDocEditor.tsx"))) {
        assert.ok(true, "the published-only Doc surface has no dirty editor session to discard");
        return;
    }
    const readmeEditor = fs.readFileSync(
        path.join(repoRoot, "src/components/workspaces/doc/ProjectDocEditor.tsx"),
        "utf8",
    );

    assert.match(
        readmeEditor,
        /hasSessionChanges\s*=\s*useMemo/,
        "Doc editor should compute hasSessionChanges"
    );
    assert.match(
        readmeEditor,
        /initialContentRef\s*=\s*useRef/,
        "Doc editor should initialize initialContentRef"
    );
    assert.match(
        readmeEditor,
        /Dialog\s+open=\{showDiscardConfirm\}/,
        "Doc editor should render Dialog component for discard confirmation"
    );
    assert.match(
        readmeEditor,
        /onClick=\{handleDiscardConfirm\}/,
        "Doc editor should call handleDiscardConfirm on discard confirmation"
    );
    assert.match(
        readmeEditor,
        /onClick=\{handleBackClick\}/,
        "Doc editor should use handleBackClick on Back button"
    );
    assert.match(
        readmeEditor,
        /import CodeEditor from "@\/components\/workspaces\/v2\/editor\/CodeEditor"/,
        "Doc editor should statically import CodeEditor"
    );
    assert.match(
        readmeEditor,
        /import \{ ProjectDocWysiwygEditor \} from "@\/components\/workspaces\/doc\/ProjectDocWysiwygEditor"/,
        "Doc editor should statically import ProjectDocWysiwygEditor"
    );
    assert.match(
        readmeEditor,
        /syncYTextContent\(ydoc, ytext, result\.serverDraftContent \?\? "", 'local-discard-sync'\)/,
        "Doc editor should synchronize database discard to Yjs document state"
    );
});

test("Doc editor reference atomic deletion keymap logic is present", () => {
    const repoRoot = process.cwd();
    if (!fs.existsSync(path.join(repoRoot, "src/components/workspaces/doc/ProjectDocEditor.tsx"))) {
        assert.ok(true, "the published-only Doc surface has no editor keymap");
        return;
    }
    const readmeEditor = fs.readFileSync(
        path.join(repoRoot, "src/components/workspaces/doc/ProjectDocEditor.tsx"),
        "utf8",
    );

    assert.match(
        readmeEditor,
        /key:\s*"Backspace",\s*run:\s*\(view:\s*EditorView\)(?::\s*\w+)?\s*=>\s*\{/,
        "Doc editor reference extension should define custom Backspace key handler"
    );
    assert.match(
        readmeEditor,
        /key:\s*"Delete",\s*run:\s*\(view:\s*EditorView\)(?::\s*\w+)?\s*=>\s*\{/,
        "Doc editor reference extension should define custom Delete key handler"
    );
    assert.match(
        readmeEditor,
        /INLINE_REFERENCE_DECORATION_REGEX\.source/,
        "Doc editor reference key handlers should use INLINE_REFERENCE_DECORATION_REGEX"
    );
    assert.match(
        readmeEditor,
        /EditorView\.atomicRanges\.of/,
        "Doc editor reference plugin should configure EditorView.atomicRanges.of"
    );
});

test("Docs tab opens with one action and one context query", () => {
    const docTab = fs.readFileSync(path.join(process.cwd(), "src/components/workspaces/tabs/DocTab.tsx"), "utf8");
    const actions = fs.readFileSync(path.join(process.cwd(), "src/app/actions/workspace/doc.ts"), "utf8");
    const loader = actions.slice(actions.indexOf("async function loadDocProjectBase"), actions.indexOf("type DocProjectBase"));

    assert.doesNotMatch(docTab, /useProjectMarkdowns|listProjectMarkdownsAction/);
    assert.match(actions, /\(await getViewerAuthContext\(\)\)\.userId/);
    assert.match(loader, /db\.query\.projects\.findFirst\(/);
    assert.match(loader, /docs: \{ with: \{ linkedNode:/);
    assert.doesNotMatch(loader, /Promise\.all/);
});
