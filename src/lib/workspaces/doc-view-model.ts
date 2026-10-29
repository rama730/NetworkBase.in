import {
    inlineReferencesToSmartBlocks,
    normalizeReadmeReferenceLabel,
    parseWorkspaceDocInlineReferences,
    splitMarkdownBySmartBlocks,
    type WorkspaceDocInlineReference,
    type WorkspaceDocReferenceOption,
    type WorkspaceDocSmartBlock,
} from "@/lib/workspaces/doc-blocks";
import { extractWorkspaceDocHeadings, type WorkspaceDocHeading } from "@/lib/workspaces/doc-headings";
import {
    buildWorkspaceDocCommandTargetMaps,
    buildWorkspaceDocRailReport,
    extractWorkspaceDocCommandShortcuts,
    WORKSPACE_DOC_PRIMARY_COMMAND_GROUPS,
    type WorkspaceDocCommandGroup,
    type WorkspaceDocQuickCommand,
    type WorkspaceDocRailReport,
} from "@/lib/workspaces/doc-quick-console";
import { projectDocReferenceTargetId } from "@/lib/workspaces/doc-navigation";

export type WorkspaceDocRailTabId = "brief" | "commands" | "links" | "outline" | "config" | "options" | "search";
export type WorkspaceDocRailActionKind = "command" | "heading" | "reference";

export type WorkspaceDocRailAction = {
    id: string;
    kind: WorkspaceDocRailActionKind;
    railTab: WorkspaceDocRailTabId;
    label: string;
    description: string | null;
    targetId: string;
    copyText: string | null;
    openHref: string | null;
    sourceIndex: number;
    command?: WorkspaceDocQuickCommand;
    commandGroup?: WorkspaceDocCommandGroup;
    groupLabel?: string;
    platforms: string[];
    riskLevel?: WorkspaceDocQuickCommand["riskLevel"];
    riskLabel?: string | null;
    reference?: WorkspaceDocInlineReference;
    referencePreviewKey?: string;
    previewOption?: WorkspaceDocReferenceOption | null;
    previewLoading?: boolean;
    previewError?: boolean;
    heading?: WorkspaceDocHeading;
};

export type WorkspaceDocTargetRegistryEntry = {
    id: string;
    kind: "heading" | "command" | "reference";
    label: string;
    railTab: WorkspaceDocRailTabId;
    level?: number;
    sourceIndex: number;
};

export type WorkspaceDocViewModel = {
    content: string;
    excerpt: string | null;
    headings: WorkspaceDocHeading[];
    commands: WorkspaceDocQuickCommand[];
    references: WorkspaceDocInlineReference[];
    segments: ReturnType<typeof splitMarkdownBySmartBlocks>;
    smartBlocks: WorkspaceDocSmartBlock[];
    referencePreviewBlocks: WorkspaceDocSmartBlock[];
    previewBlocks: WorkspaceDocSmartBlock[];
    commandTargetMaps: ReturnType<typeof buildWorkspaceDocCommandTargetMaps>;
    report: WorkspaceDocRailReport;
    railTabs: WorkspaceDocRailTabId[];
    railActions: WorkspaceDocRailAction[];
    recommendedAction: WorkspaceDocRailAction | null;
    targetRegistry: Map<string, WorkspaceDocTargetRegistryEntry>;
    targetIds: string[];
    targetSignature: string;
};

const VIEW_MODEL_CACHE_LIMIT = 12;
// ponytail: per-process LRU Maps (12 here, qualityCache 24, DOC_METADATA_CACHE 200). ceiling: each replica warms its own copy. upgrade: shared cache only if doc renders show up in p95.
const viewModelCache = new Map<string, WorkspaceDocViewModel>();

function stableReadmeHash(value: string) {
    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
    }
    return (hash >>> 0).toString(36);
}

function readmeViewModelCacheKey(input: {
    content: string;
    contentHash?: string | null;
    excerpt?: string | null;
    storedHeadings?: WorkspaceDocHeading[];
}) {
    if (input.contentHash) return `content-hash:${input.contentHash}`;
    const headingSignature = input.storedHeadings?.map((heading) => `${heading.id}:${heading.text}:${heading.level}`).join("|") ?? "";
    return [
        input.content.length,
        stableReadmeHash(input.content),
        stableReadmeHash(input.excerpt ?? ""),
        stableReadmeHash(headingSignature),
    ].join(":");
}

function rememberViewModel(key: string, model: WorkspaceDocViewModel) {
    if (viewModelCache.has(key)) viewModelCache.delete(key);
    viewModelCache.set(key, model);
    while (viewModelCache.size > VIEW_MODEL_CACHE_LIMIT) {
        const oldestKey = viewModelCache.keys().next().value;
        if (!oldestKey) break;
        viewModelCache.delete(oldestKey);
    }
    return model;
}

function uniquePreviewBlocks(blocks: WorkspaceDocSmartBlock[]) {
    const seen = new Set<string>();
    const unique: WorkspaceDocSmartBlock[] = [];
    for (const block of blocks) {
        const key = `${block.kind}:${block.ids.join(",")}:${block.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(block);
    }
    return unique;
}

function buildRailTabs(input: {
    report: WorkspaceDocRailReport;
    commands: WorkspaceDocQuickCommand[];
    references: WorkspaceDocInlineReference[];
    headings: WorkspaceDocHeading[];
}) {
    const tabs: Array<{ id: WorkspaceDocRailTabId; score: number; order: number }> = [];
    const primaryCommands = input.commands.filter((command) => WORKSPACE_DOC_PRIMARY_COMMAND_GROUPS.has(command.group));
    const configCommands = input.commands.filter((command) => command.group === "config");
    const optionCommands = input.commands.filter((command) => command.group === "options");
    const setupCommands = primaryCommands.filter((command) => (
        command.group === "recommended"
        || command.group === "install"
        || command.group === "claude"
        || command.group === "agents"
    ));
    const hasBrief = Boolean(input.report.summary || input.report.summaryItems.length || input.report.signals.length || input.report.nextAction);
    const add = (id: WorkspaceDocRailTabId, score: number) => {
        tabs.push({ id, score, order: tabs.length });
    };

    if (hasBrief) {
        add("brief", input.report.readiness === "weak" ? 100 : setupCommands.length ? 84 : 92);
    }
    if (primaryCommands.length) {
        add("commands", setupCommands.length ? 110 : 88);
    }
    if (input.headings.length) {
        add("outline", primaryCommands.length ? 82 : 94);
    }
    if (configCommands.length) {
        add("config", setupCommands.length ? 78 : 70);
    }
    if (optionCommands.length) {
        add("options", setupCommands.length ? 76 : 68);
    }
    if (input.references.length) {
        add("links", primaryCommands.length || input.headings.length ? 64 : 86);
    }

    return tabs
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map((tab) => tab.id);
}

function commandRailTab(command: WorkspaceDocQuickCommand): WorkspaceDocRailTabId {
    if (command.group === "config") return "config";
    if (command.group === "options") return "options";
    return "commands";
}

function buildRailActions(input: {
    headings: WorkspaceDocHeading[];
    commands: WorkspaceDocQuickCommand[];
    references: WorkspaceDocInlineReference[];
}) {
    const commandActions: WorkspaceDocRailAction[] = input.commands.map((command, index) => ({
        id: `command:${command.id}`,
        kind: "command",
        railTab: commandRailTab(command),
        label: command.label,
        description: command.detail,
        targetId: command.targetId,
        copyText: command.command,
        openHref: null,
        sourceIndex: index,
        command,
        commandGroup: command.group,
        groupLabel: command.groupLabel,
        platforms: command.platforms,
        riskLevel: command.riskLevel,
        riskLabel: command.riskLabel,
    }));

    const referenceActions: WorkspaceDocRailAction[] = input.references.map((reference, index) => ({
        id: `reference:${reference.kind}:${reference.id}:${index}`,
        kind: "reference",
        railTab: "links",
        label: normalizeReadmeReferenceLabel(reference.kind, reference.label),
        description: null,
        targetId: projectDocReferenceTargetId(reference.kind, reference.id, index),
        copyText: null,
        openHref: null,
        sourceIndex: index,
        reference,
        referencePreviewKey: `${reference.kind}:${reference.id}:${index}`,
        platforms: [],
    }));

    const headingActions: WorkspaceDocRailAction[] = input.headings.map((heading, index) => ({
        id: `heading:${heading.id}:${index}`,
        kind: "heading",
        railTab: "outline",
        label: heading.text,
        description: null,
        targetId: heading.id,
        copyText: null,
        openHref: null,
        sourceIndex: index,
        heading,
        platforms: [],
    }));

    return [...commandActions, ...referenceActions, ...headingActions];
}

function pickRecommendedAction(actions: WorkspaceDocRailAction[]) {
    const commandActions = actions.filter((action) => action.kind === "command");
    return commandActions.find((action) => action.commandGroup === "recommended")
        ?? commandActions.find((action) => action.commandGroup === "install" || action.commandGroup === "claude" || action.commandGroup === "agents")
        ?? commandActions.find((action) => action.commandGroup === "develop")
        ?? commandActions[0]
        ?? actions.find((action) => action.kind === "heading")
        ?? actions.find((action) => action.kind === "reference")
        ?? null;
}

function buildTargetRegistry(input: {
    headings: WorkspaceDocHeading[];
    commands: WorkspaceDocQuickCommand[];
    references: WorkspaceDocInlineReference[];
}) {
    const registry = new Map<string, WorkspaceDocTargetRegistryEntry>();
    input.headings.forEach((heading, index) => {
        registry.set(heading.id, {
            id: heading.id,
            kind: "heading",
            label: heading.text,
            railTab: "outline",
            level: heading.level,
            sourceIndex: index,
        });
    });

    input.commands.forEach((command, index) => {
        if (registry.has(command.targetId)) return;
        registry.set(command.targetId, {
            id: command.targetId,
            kind: "command",
            label: command.label,
            railTab: command.group === "config" ? "config" : command.group === "options" ? "options" : "commands",
            sourceIndex: index,
        });
    });

    input.references.forEach((reference, index) => {
        const id = projectDocReferenceTargetId(reference.kind, reference.id, index);
        registry.set(id, {
            id,
            kind: "reference",
            label: reference.label,
            railTab: "links",
            sourceIndex: index,
        });
    });
    return registry;
}

function stripFrontmatter(markdown: string): string {
    const trimmed = markdown.trimStart();
    if (trimmed.startsWith("---")) {
        const lines = markdown.split("\n");
        let endIdx = -1;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line !== undefined && line.trim() === "---") {
                endIdx = i;
                break;
            }
        }
        if (endIdx !== -1) {
            return lines.slice(endIdx + 1).join("\n");
        }
    }
    return markdown;
}

export function buildWorkspaceDocViewModel(input: {
    content: string;
    contentHash?: string | null;
    excerpt?: string | null;
    storedHeadings?: WorkspaceDocHeading[];
    }): WorkspaceDocViewModel {
    const cacheKey = readmeViewModelCacheKey(input);
    const cached = viewModelCache.get(cacheKey);
    if (cached) return cached;

    const content = stripFrontmatter(input.content);
    const headingsFromContent = extractWorkspaceDocHeadings(content);
    const headings = headingsFromContent.length ? headingsFromContent : input.storedHeadings ?? [];
    const commands = extractWorkspaceDocCommandShortcuts(content);
    const references = parseWorkspaceDocInlineReferences(content);
    const segments = splitMarkdownBySmartBlocks(content);
    const smartBlocks = segments.flatMap((segment) => segment.kind === "block" ? [segment.block] : []);
    const referencePreviewBlocks = inlineReferencesToSmartBlocks(references);
    const previewBlocks = uniquePreviewBlocks([
        ...smartBlocks,
        ...referencePreviewBlocks,
    ]);
    const report = buildWorkspaceDocRailReport({
        content,
        excerpt: input.excerpt,
        commands,
        references,
        headings,
    });
    const railTabs = buildRailTabs({ report, commands, references, headings });
    const railActions = buildRailActions({ headings, commands, references });
    const recommendedAction = pickRecommendedAction(railActions);
    const targetRegistry = buildTargetRegistry({ headings, commands, references });
    const targetIds = Array.from(targetRegistry.keys());

    return rememberViewModel(cacheKey, {
        content,
        excerpt: input.excerpt ?? null,
        headings,
        commands,
        references,
        segments,
        smartBlocks,
        referencePreviewBlocks,
        previewBlocks,
        commandTargetMaps: buildWorkspaceDocCommandTargetMaps(content),
        report,
        railTabs,
        railActions,
        recommendedAction,
        targetRegistry,
        targetIds,
        targetSignature: targetIds.join("|"),
    });
}
