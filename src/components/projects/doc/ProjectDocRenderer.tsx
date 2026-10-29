"use client";

import React, { Suspense, useMemo, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import {
    normalizeReadmeReferenceLabel,
    parseReadmeReferenceHref,
    readmeReferenceHref,
    replaceInlineReadmeReferencesWithMarkdown,
    type ProjectDocReferenceKind,
    type ProjectDocReferenceOption,
    type ProjectDocSmartBlockPreview,
} from "@/lib/projects/doc-blocks";
import { buildProjectDocPlainText } from "@/lib/projects/doc-plain-text";
import { slugifyReadmeHeading } from "@/lib/projects/doc-headings";
import {
    projectDocReferenceTargetId,
} from "@/lib/projects/doc-navigation";
import {
    projectDocEditorTargetId,
    type ProjectDocEditorTargetKind,
} from "@/lib/projects/doc-editor-source-map";
import { resolveProjectDocImage, type ProjectDocImageKind } from "@/lib/projects/doc-media";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import { buildProjectDocViewModel, type ProjectDocViewModel } from "@/lib/projects/doc-view-model";
import { ProjectDocCommandBlock } from "@/components/projects/doc/ProjectDocCommandBlock";
import { ProjectDocSmartBlock } from "@/components/projects/doc/ProjectDocSmartBlock";
import { useProjectDocSmartBlockPreviews } from "@/hooks/projects/useProjectDocData";
import type { Project } from "@/types/discover";
import { cn } from "@/lib/utils";

const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });

function splitMarkdownIntoSections(content: string): string[] {
    const lines = content.split("\n");
    const sections: string[] = [];
    let currentSection: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
        }

        // Split on H1 or H2 headings only if not in a code block
        if (!inCodeBlock && /^(?:#{1,2})\s+/.test(line)) {
            if (currentSection.length > 0) {
                sections.push(currentSection.join("\n"));
                currentSection = [];
            }
        }
        currentSection.push(line);
    }
    if (currentSection.length > 0) {
        sections.push(currentSection.join("\n"));
    }
    return sections;
}

function extractReferenceLinks(content: string): string {
    const lines = content.split("\n");
    const linkLines: string[] = [];
    let inCodeBlock = false;
    for (const line of lines) {
        if (line.trim().startsWith("```")) {
            inCodeBlock = !inCodeBlock;
        }
        if (!inCodeBlock && /^\s*\[[^\]]+\]:\s*\S+/.test(line)) {
            linkLines.push(line);
        }
    }
    return linkLines.join("\n");
}

const MemoizedMarkdownSegment = React.memo(function MemoizedMarkdownSegment({
    content,
    components,
    renderSignature,
}: {
    content: string;
    components: any;
    renderSignature: string;
}) {
    void renderSignature;
    return (
        <ReactMarkdown
            rehypePlugins={README_REHYPE_PLUGINS as any}
            remarkPlugins={[remarkGfm]}
            skipHtml={false}
            components={components}
        >
            {replaceInlineReadmeReferencesWithMarkdown(content)}
        </ReactMarkdown>
    );
}, (previous, next) => (
    previous.content === next.content
    && previous.renderSignature === next.renderSignature
));

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
const README_HTML_ALIGN_VALUES = ["left", "right", "center", "justify"];
const README_HTML_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        "*": [
            ...(defaultSchema.attributes?.["*"] ?? []),
            ["align", ...README_HTML_ALIGN_VALUES],
            "title",
        ],
        a: [
            ...(defaultSchema.attributes?.a ?? []),
            "href",
            "title",
        ],
        img: [
            ...(defaultSchema.attributes?.img ?? []),
            "src",
            "alt",
            "title",
            "width",
            "height",
        ],
    },
    protocols: {
        ...defaultSchema.protocols,
        href: ["http", "https", "mailto", "tel"],
        src: ["http", "https"],
    },
};
const README_REHYPE_PLUGINS = [
    rehypeRaw,
    [rehypeSanitize, README_HTML_SANITIZE_SCHEMA],
] as const;
const README_MEDIA_MAX_WIDTH_BY_KIND: Record<ProjectDocImageKind, number> = {
    badge: 180,
    icon: 48,
    logo: 220,
    diagram: 980,
    content: 980,
};

type MarkdownAstNode = {
    position?: {
        start?: {
            line?: number;
            offset?: number;
        };
    };
};

function sourceTargetProps(
    kind: ProjectDocEditorTargetKind,
    node?: MarkdownAstNode,
) {
    const line = node?.position?.start?.line ?? null;
    const offset = node?.position?.start?.offset ?? null;
    const targetId = projectDocEditorTargetId(kind, line, offset);
    return {
        "data-readme-source-line": line ?? undefined,
        "data-readme-source-offset": offset ?? undefined,
        "data-readme-source-kind": kind,
        "data-readme-editor-target-id": targetId,
    };
}



function adjustNodePosition(node: MarkdownAstNode | undefined, lineOffset: number, charOffset: number): MarkdownAstNode | undefined {
    if (!node || !node.position || !node.position.start) return node;
    return {
        ...node,
        position: {
            ...node.position,
            start: {
                ...node.position.start,
                line: typeof node.position.start.line === "number" ? node.position.start.line + lineOffset : undefined,
                offset: typeof node.position.start.offset === "number" ? node.position.start.offset + charOffset : undefined,
            }
        }
    };
}

function ProjectDocInlineReferenceChip({
    fallback,
    option,
    reference,
    targetId,
    onRequestTarget,
    project,
}: {
    fallback: React.ReactNode;
    option?: ProjectDocReferenceOption | null;
    reference?: { kind: ProjectDocReferenceKind; id: string } | null;
    targetId?: string | null;
    onRequestTarget?: (targetId: string) => void;
    project?: Project | null;
}) {
    const router = useRouter();
    const kind = option?.kind ?? reference?.kind ?? null;
    const fallbackText = kind
        ? normalizeReadmeReferenceLabel(kind, textFromReactNode(fallback) || "")
        : textFromReactNode(fallback) || "Project reference";
    const label = kind
        ? normalizeReadmeReferenceLabel(kind, option?.title || fallbackText)
        : option?.title || fallbackText;
    const status = option?.status || option?.kindLabel || null;
    const meta = option?.meta || option?.subtitle || null;
    const detail = option?.context || [status, meta].filter(Boolean).join(" · ");
    const isContributor = kind === "contributors";
    const content = (
        <>
            {option?.avatarUrl ? (
                <Image src={option.avatarUrl} alt="" width={16} height={16} sizes="16px" className="h-4 w-4 rounded-[3px] border border-border object-cover align-[-0.2rem]" />
            ) : isContributor ? (
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] bg-muted text-[10px] max-md:text-[11px] font-mono font-semibold uppercase text-muted-foreground align-[-0.2rem]">
                    {label.charAt(0).toUpperCase()}
                </span>
            ) : null}
            <span className="font-semibold text-foreground transition-colors group-hover:text-primary">{label}</span>
        </>
    );
    const className = "group mx-0.5 inline-flex max-w-full cursor-pointer items-baseline gap-1 rounded-[3px] align-baseline text-sm leading-[inherit] no-underline outline-none transition-colors hover:text-primary";
    const title = [label, detail].filter(Boolean).join(" · ");
    const optionHref = option?.href;
    const targetProps = targetId
        ? {
            id: targetId,
            "data-readme-target": "true",
            "data-readme-target-kind": "reference",
            "data-readme-target-id": targetId,
        }
        : {};

    const handleClick = React.useCallback(
        (event: React.MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault();
            event.stopPropagation();

            let href = optionHref;
            if (!href && kind && reference?.id && project) {
                const projectSlug = project.slug || project.id;
                if (kind === "tasks") {
                    href = `/projects/${projectSlug}?tab=tasks&drawerType=task&drawerId=${reference.id}`;
                } else if (kind === "sprints") {
                    href = `/projects/${projectSlug}?tab=sprints&sprintId=${reference.id}`;
                } else if (kind === "files") {
                    href = `/projects/${projectSlug}?tab=files&fileId=${reference.id}`;
                }
            }

            if (href) {
                router.push(href);
            } else if (targetId && onRequestTarget) {
                onRequestTarget(targetId);
            }
        },
        [optionHref, kind, reference, project, targetId, onRequestTarget, router]
    );

    if (targetId && onRequestTarget) {
        return (
            <a
                href={option?.href || `#${encodeURIComponent(targetId)}`}
                className={className}
                title={title}
                onClick={handleClick}
                {...targetProps}
            >
                {content}
            </a>
        );
    }

    if (option?.href) {
        return (
            <a href={option.href} onClick={handleClick} className={className} title={title} {...targetProps}>
                {content}
            </a>
        );
    }

    return (
        <span className={className} title={title} tabIndex={targetId ? -1 : undefined} {...targetProps}>
            {content}
        </span>
    );
}

function textFromReactNode(node: React.ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textFromReactNode).join("");
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textFromReactNode(node.props.children);
    return "";
}

function sanitizeMarkdownUrl(raw: string, allowRelative: boolean, isImage: boolean, allowExternalImages: boolean): string {
    const value = raw.replace(CONTROL_CHARS_REGEX, "").trim();
    if (!value) return "";
    if (value.startsWith("#")) return allowRelative ? value : "";
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
        if (!allowRelative && !value.startsWith("/api/v1/projects/")) return "";
        if (value.startsWith("//")) return "";
        return value;
    }
    try {
        const parsed = new URL(value);
        const allowedProtocols = isImage ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS;
        if (!allowedProtocols.has(parsed.protocol)) return "";
        if (isImage && !allowExternalImages) return "";
        return parsed.toString();
    } catch {
        return "";
    }
}

function readmeMediaStyle(input: ReturnType<typeof resolveProjectDocImage>): CSSProperties {
    const maxWidth = README_MEDIA_MAX_WIDTH_BY_KIND[input.kind];
    const style: CSSProperties = {
        maxWidth: "100%",
        height: "auto",
    };
    if (input.widthPercent) {
        style.width = `${input.widthPercent}%`;
    } else if (input.width) {
        style.width = `${Math.min(input.width, maxWidth)}px`;
    } else if (input.kind === "badge") {
        style.maxHeight = "22px";
    } else if (input.kind === "icon") {
        style.maxHeight = "24px";
    }
    if (input.height && (input.kind === "badge" || input.kind === "icon")) {
        style.height = `${Math.min(input.height, input.kind === "badge" ? 24 : 48)}px`;
        style.width = input.width ? `${Math.min(input.width, maxWidth)}px` : "auto";
    }
    return style;
}

function readmeMediaClass(kind: ProjectDocImageKind) {
    return cn(
        "outline-none",
        kind === "badge" && "mx-0.5 my-1 inline-block rounded-none border-0 align-middle shadow-none",
        kind === "icon" && "mx-0.5 my-0 inline-block rounded-none border-0 align-[-0.2rem] shadow-none",
        kind === "logo" && "my-3 inline-block rounded-none border-0 shadow-none",
        kind === "diagram" && "my-5 block h-auto rounded-[5px] border border-border bg-card",
        kind === "content" && "my-4 block h-auto rounded-[5px] border border-border",
    );
}

function readmeHiddenMediaClass(kind: ProjectDocImageKind) {
    return cn(
        "text-muted-foreground outline-none",
        (kind === "badge" || kind === "icon")
            ? "mx-1 inline-flex max-w-full items-center rounded-[3px] border border-dashed border-border px-2 py-0.5 text-[11px] leading-4 align-middle"
            : "my-3 flex max-w-full items-center rounded-[5px] border border-dashed border-border px-3 py-2 text-xs leading-5",
    );
}

function buildProjectDocSegmentRenderPlans(segments: ProjectDocViewModel["segments"]) {
    let lineOffset = 0;
    let charOffset = 0;
    return segments.map((segment, index) => {
        if (segment.kind === "block") {
            const plan = {
                kind: "block" as const,
                index,
                segment,
            };
            lineOffset += (segment.block.raw.match(/\n/g) || []).length;
            charOffset += segment.block.raw.length;
            return plan;
        }

        const referenceLinks = extractReferenceLinks(segment.content);
        const subSections = splitMarkdownIntoSections(segment.content);
        const sections = subSections.map((section, secIdx) => {
            const isLastSection = secIdx === subSections.length - 1;
            const plan = {
                key: `sec-${index}-${secIdx}`,
                content: referenceLinks ? `${section}\n\n${referenceLinks}` : section,
                lineOffset,
                charOffset,
            };
            lineOffset += (section.match(/\n/g) || []).length + (isLastSection ? 0 : 1);
            charOffset += section.length + (isLastSection ? 0 : 1);
            return plan;
        });

        return {
            kind: "markdown" as const,
            index,
            sections,
        };
    });
}

export const ProjectDocRenderer = React.memo(function ProjectDocRenderer({
    content,
    project,
    allowExternalImages = false,
    allowSmartBlocks = true,
    editorMode = false,
    fidelity = "app",
    className,
    onMediaLoad,
    onRequestTarget,
    onAllowExternalImages,
    previewsLoading,
    previewByKey,
    viewModel,
    docSlug,
    renderedSlugs = [],
}: {
    content: string;
    project: Project;
    allowExternalImages?: boolean;
    allowSmartBlocks?: boolean;
    editorMode?: boolean;
    fidelity?: "app" | "github";
    className?: string;
    onMediaLoad?: () => void;
    onRequestTarget?: (targetId: string) => void;
    onAllowExternalImages?: () => void;
    previewsLoading?: boolean;
    previewByKey?: Map<string, ProjectDocSmartBlockPreview>;
    viewModel?: ProjectDocViewModel;
    docSlug?: string;
    renderedSlugs?: string[];
}) {
    const searchParams = useSearchParams();
    const normalizedDocSlug = normalizeProjectDocSlug(docSlug ?? searchParams?.get("doc") ?? "readme");
    const isCircularDocReference = renderedSlugs.includes(normalizedDocSlug);

    const readmeModel = useMemo(() => viewModel ?? buildProjectDocViewModel({ content }), [content, viewModel]);
    const segments = readmeModel.segments;
    const headingTargets = readmeModel.headings;
    const headingTargetQueues = useMemo(() => {
        const queues = new Map<string, string[]>();
        headingTargets.forEach((heading) => {
            const key = buildProjectDocPlainText(heading.text, { maxLength: 120, stripCodeBlocks: false }) ?? heading.text;
            queues.set(key, [...(queues.get(key) ?? []), heading.id]);
        });
        return queues;
    }, [headingTargets]);
    const inlineReferences = readmeModel.references;
    const blocks = isCircularDocReference ? [] : (allowSmartBlocks ? readmeModel.previewBlocks : readmeModel.referencePreviewBlocks);
    const commandTargetMaps = readmeModel.commandTargetMaps;
    const previewsQuery = useProjectDocSmartBlockPreviews(project.id, blocks, !previewByKey && blocks.length > 0, normalizedDocSlug);
    const fallbackPreviewByKey = useMemo(() => {
        const map = new Map<string, NonNullable<typeof previewsQuery.data>[number]>();
        for (const preview of previewsQuery.data ?? []) {
            map.set(preview.key, preview);
            const parts = preview.key.split(":");
            if (parts.length >= 2) {
                map.set(`${parts[0]}:${parts[1]}`, preview);
            }
        }
        return map;
    }, [previewsQuery.data]);
    const effectivePreviewByKey = previewByKey ?? fallbackPreviewByKey;
    const effectivePreviewsLoading = typeof previewsLoading === "boolean" ? previewsLoading : previewsQuery.isLoading;
    const previewRenderSignature = useMemo(() => (
        Array.from(effectivePreviewByKey.entries())
            .map(([key, preview]) => `${key}:${preview.items.map((item) => `${item.id}:${item.title}:${item.status ?? ""}`).join(",")}`)
            .join("|")
    ), [effectivePreviewByKey]);


    const markdownRenderSignature = `${fidelity}:${allowExternalImages ? "external" : "safe"}:${previewRenderSignature}`;
    const inlineReferenceEntriesByHref = useMemo(() => {
        const map = new Map<string, Array<{
            targetId: string;
            option?: ProjectDocReferenceOption | null;
            reference: { kind: ProjectDocReferenceKind; id: string };
        }>>();
        inlineReferences.forEach((reference, index) => {
            const key = `${reference.kind}:${reference.id}:${index}`;
            const stableKey = `${reference.kind}:${reference.id}`;
            const option = (effectivePreviewByKey.get(key) ?? effectivePreviewByKey.get(stableKey))?.items[0];
            const href = readmeReferenceHref(reference.kind, reference.id);
            const entries = map.get(href) ?? [];
            entries.push({
                targetId: projectDocReferenceTargetId(reference.kind, reference.id, index),
                option,
                reference,
            });
            map.set(href, entries);
        });
        return map;
    }, [effectivePreviewByKey, inlineReferences]);
    const fallbackHeadingIds = new Set<string>();
    const headingRenderCounts = new Map<string, number>();
    const inlineReferenceRenderCounts = new Map<string, number>();
    const codeBlockRenderCounts = new Map<number, number>();
    const inlineCodeRenderCounts = new Map<number, number>();

    const renderHeading = (
        Tag: "h1" | "h2" | "h3" | "h4",
        children: React.ReactNode,
        id: string | undefined,
        className: string,
        node: MarkdownAstNode | undefined,
        props: React.HTMLAttributes<HTMLHeadingElement> & { align?: string },
    ) => {
        const headingText = buildProjectDocPlainText(textFromReactNode(children), { maxLength: 120, stripCodeBlocks: false }) ?? textFromReactNode(children);
        const occurrenceIndex = headingRenderCounts.get(headingText) ?? 0;
        headingRenderCounts.set(headingText, occurrenceIndex + 1);
        const targetId = id || headingTargetQueues.get(headingText)?.[occurrenceIndex] || slugifyReadmeHeading(headingText, fallbackHeadingIds);
        const sourceProps = sourceTargetProps("heading", node);
        const align = props.align;
        return (
            <Tag
                id={targetId}
                tabIndex={-1}
                {...sourceProps}
                data-readme-target="true"
                data-readme-target-kind="heading"
                data-readme-target-id={targetId}
                className={cn(
                    className,
                    align === "center" && "text-center",
                    align === "right" && "text-right",
                    align === "left" && "text-left",
                    "outline-none"
                )}
                {...props}
            >
                {children}
            </Tag>
        );
    };

    const components = {
        h1: ({ children, id, node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: MarkdownAstNode }) => renderHeading("h1", children, id, cn("mb-5 mt-2 scroll-mt-24 border-b border-border pb-3 font-semibold text-foreground", fidelity === "github" ? "text-[2em] leading-tight" : "text-[24px] sm:text-[30px] leading-[1.2] tracking-[-0.015em]"), node, props),
        h2: ({ children, id, node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: MarkdownAstNode }) => renderHeading("h2", children, id, cn("mb-4 mt-8 scroll-mt-24 border-b border-border pb-2.5 font-semibold text-foreground", fidelity === "github" ? "text-[1.5em] leading-snug" : "text-[20px] sm:text-[24px] leading-[1.25] tracking-[-0.015em]"), node, props),
        h3: ({ children, id, node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: MarkdownAstNode }) => renderHeading("h3", children, id, "mb-3 mt-6 scroll-mt-24 text-[17px] sm:text-[20px] font-semibold leading-[1.28] text-foreground", node, props),
        h4: ({ children, id, node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: MarkdownAstNode }) => renderHeading("h4", children, id, "mb-2 mt-5 scroll-mt-24 text-[15px] sm:text-[17px] font-semibold leading-[1.28] text-foreground", node, props),
        p: ({ node, align, className: pClass, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { node?: MarkdownAstNode; align?: string }) => {
            const sourceProps = sourceTargetProps("paragraph", node);
            return (
                <p
                    className={cn(
                        "mb-4 text-[15px] leading-[1.65] text-foreground/90",
                        align === "center" && "text-center",
                        align === "right" && "text-right",
                        align === "left" && "text-left",
                        pClass
                    )}
                    {...sourceProps}
                    {...props}
                />
            );
        },
        div: ({ align, className: divClass, ...props }: React.HTMLAttributes<HTMLDivElement> & { align?: string }) => (
            <div
                className={cn(
                    align === "center" && "text-center",
                    align === "right" && "text-right",
                    align === "left" && "text-left",
                    divClass
                )}
                {...props}
            />
        ),
        details: ({ className: detailsClass, ...props }: React.DetailsHTMLAttributes<HTMLDetailsElement>) => (
            <details className={cn("my-4 rounded-[6px] border border-border bg-card p-3 text-sm", detailsClass)} {...props} />
        ),
        summary: ({ className: summaryClass, ...props }: React.HTMLAttributes<HTMLElement>) => (
            <summary className={cn("cursor-pointer font-medium text-foreground select-none hover:text-primary transition-colors", summaryClass)} {...props} />
        ),
        ul: ({ node, ...props }: React.HTMLAttributes<HTMLUListElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("list", node);
            return <ul className="mb-4 list-disc space-y-1.5 pl-5 text-[15px] leading-[1.65] text-foreground/90" {...sourceProps} {...props} />;
        },
        ol: ({ node, ...props }: React.HTMLAttributes<HTMLOListElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("list", node);
            return <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[15px] leading-[1.65] text-foreground/90" {...sourceProps} {...props} />;
        },
        blockquote: ({ node, ...props }: React.HTMLAttributes<HTMLQuoteElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("blockquote", node);
            return <blockquote className="my-5 border-l-2 border-border pl-4 text-[14px] sm:text-[15px] italic leading-relaxed text-muted-foreground" {...sourceProps} {...props} />;
        },
        a: ({ href, rel, target, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
            const reference = parseReadmeReferenceHref(typeof href === "string" ? href : null);
            if (reference && href) {
                const count = inlineReferenceRenderCounts.get(href) ?? 0;
                inlineReferenceRenderCounts.set(href, count + 1);
                const entry = inlineReferenceEntriesByHref.get(href)?.[count] ?? null;
                const targetId = entry?.targetId ?? projectDocReferenceTargetId(reference.kind, reference.id, count);
                return (
                    <ProjectDocInlineReferenceChip
                        fallback={props.children}

                        onRequestTarget={onRequestTarget}
                        option={entry?.option}
                        reference={entry?.reference ?? reference}
                        targetId={targetId}
                        project={project}
                    />
                );
            }
            const safeHref = typeof href === "string" ? sanitizeMarkdownUrl(href, true, false, allowExternalImages) : "";
            if (!safeHref) return <span className="text-muted-foreground">{props.children}</span>;
            const isExternal = /^https?:\/\//i.test(safeHref);
            const isDocTarget = safeHref.startsWith("#") && safeHref.length > 1;
            return (
                <a
                    href={safeHref}
                    onClick={isDocTarget && onRequestTarget ? (event) => {
                        event.preventDefault();
                        onRequestTarget(safeHref.slice(1));
                    } : undefined}
                    rel={isExternal ? "noopener noreferrer" : rel}
                    target={isExternal ? "_blank" : target}
                    className="font-medium text-primary hover:underline underline-offset-4"
                    {...props}
                />
            );
        },
        code: ({ className: codeClassName, children, node, ...props }: React.HTMLAttributes<HTMLElement> & {
            node?: MarkdownAstNode;
        }) => {
            const match = /language-([a-z0-9_-]+)/i.exec(codeClassName || "");
            const value = String(children ?? "");
            const offset = node?.position?.start?.offset;
            const line = node?.position?.start?.line;
            if (!match) {
                const inlineCommandId = typeof line === "number"
                    ? (() => {
                        const occurrence = inlineCodeRenderCounts.get(line) ?? 0;
                        inlineCodeRenderCounts.set(line, occurrence + 1);
                        return commandTargetMaps.inlineByLineQueue.get(line)?.[occurrence] ?? commandTargetMaps.inlineByLine.get(line);
                    })()
                    : typeof offset === "number"
                        ? commandTargetMaps.inlineByOffset.get(offset)
                        : undefined;
                const sourceProps = sourceTargetProps("inline-code", node);
                return (
                    <code
                        id={inlineCommandId}
                        tabIndex={inlineCommandId ? -1 : undefined}
                        {...sourceProps}
                        data-readme-target={inlineCommandId ? "true" : undefined}
                        data-readme-target-kind={inlineCommandId ? "command" : undefined}
                        data-readme-target-id={inlineCommandId}
                        className="rounded-[3px] border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[13px] text-foreground outline-none"
                        {...props}
                    >
                        {children}
                    </code>
                );
            }
            const commandId = typeof line === "number"
                ? (() => {
                    const occurrence = codeBlockRenderCounts.get(line) ?? 0;
                    codeBlockRenderCounts.set(line, occurrence + 1);
                    return commandTargetMaps.byLineQueue.get(line)?.[occurrence] ?? commandTargetMaps.byLine.get(line);
                })()
                : typeof offset === "number"
                    ? commandTargetMaps.byOffset.get(offset)
                    : undefined;
            const lineTargets = commandId
                ? readmeModel.commands
                    .filter((command) => command.blockId === commandId && command.targetKind === "block" && command.targetId !== command.blockId && command.codeLineStart !== null && command.codeLineEnd !== null)
                    .map((command) => ({
                        id: command.targetId,
                        startLine: command.codeLineStart ?? 0,
                        endLine: command.codeLineEnd ?? command.codeLineStart ?? 0,
                    }))
                : [];
            return (
                <ProjectDocCommandBlock
                    id={commandId}
                    code={value}
                    language={match[1]}
                    lineTargets={lineTargets}
                    sourceLine={line ?? null}
                    sourceOffset={offset ?? null}
                />
            );
        },
        img: ({ src, alt = "", title, width, height, node }: React.ImgHTMLAttributes<HTMLImageElement> & { node?: MarkdownAstNode }) => {
            const image = resolveProjectDocImage({
                src,
                alt,
                title,
                width,
                height,
                allowExternalImages,
                project,
            });
            const sourceProps = sourceTargetProps("image", node);
            if (!image.src) {
                const canUnlock = image.blockedReason === "external" && typeof onAllowExternalImages === "function";
                return (
                    <span
                        role={canUnlock ? "button" : undefined}
                        tabIndex={canUnlock ? 0 : undefined}
                        onClick={canUnlock ? (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onAllowExternalImages?.();
                        } : undefined}
                        onKeyDown={canUnlock ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                onAllowExternalImages?.();
                            }
                        } : undefined}
                        className={cn(
                            readmeHiddenMediaClass(image.kind),
                            canUnlock && "cursor-pointer hover:bg-muted/70 hover:text-foreground transition-colors select-none"
                        )}
                        data-readme-media-kind={image.kind}
                        data-readme-media-blocked={image.blockedReason ?? "invalid"}
                        title={image.blockedReason === "external" ? (canUnlock ? "Images from other websites are hidden for privacy. Show images." : "External image hidden by document settings.") : "Image couldn’t load."}
                        {...sourceProps}
                    >
                        {image.blockedReason === "external" ? (
                            canUnlock ? (
                                <>
                                    <span className="font-medium text-foreground">Image blocked</span>
                                    <span aria-hidden="true" className="mx-1">•</span>
                                    <span className="underline underline-offset-2">Load</span>
                                </>
                            ) : "Image hidden"
                        ) : "Image unavailable"}
                    </span>
                );
            }
            return (
                <img
                    src={image.src}
                    alt={alt || ""}
                    title={typeof title === "string" ? title : undefined}
                    width={image.width ?? undefined}
                    height={image.height ?? undefined}
                    loading={image.kind === "badge" || image.kind === "icon" || image.kind === "logo" ? "eager" : "lazy"}
                    decoding="async"
                    referrerPolicy={image.trustedExternal || !allowExternalImages ? "no-referrer" : undefined}
                    onLoad={onMediaLoad}
                    style={readmeMediaStyle(image)}
                    data-readme-media-kind={image.kind}
                    data-readme-media-original-src={image.originalSrc || undefined}
                    className={readmeMediaClass(image.kind)}
                    {...sourceProps}

                />
            );
        },
        table: ({ node, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { node?: MarkdownAstNode }) => {
            const sourceProps = sourceTargetProps("table", node);
            return (
                <div className="my-6 overflow-x-auto rounded-[8px] border border-border bg-card" {...sourceProps}>
                    <table className="min-w-full table-fixed border-collapse text-left text-[13px]" {...props} />
                </div>
            );
        },
        th: ({ ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className="border-b border-border bg-muted/40 px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-[0.05em] text-muted-foreground text-left align-top font-medium" {...props} />,
        td: ({ ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
            <td
                className="border-b border-border/60 px-3.5 py-2.5 align-top text-[13px] leading-relaxed text-foreground [&>p:last-child]:mb-0 [&_blockquote:last-child]:mb-0 [&_img[data-readme-media-kind='badge']]:my-0 [&_img[data-readme-media-kind='icon']]:my-0"
                {...props}
            />
        ),
        hr: ({ ...props }: React.HTMLAttributes<HTMLHRElement>) => <hr className="my-8 border-border" {...props} />,
    };

    const renderMarkdownWithInlineReferences = (content: string, segmentKey: string, lineOffset: number, charOffset: number) => {
        const adjustedComponents = {
            ...components,
            h1: ({ children, id, node, ...props }: any) => components.h1({ children, id, node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            h2: ({ children, id, node, ...props }: any) => components.h2({ children, id, node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            h3: ({ children, id, node, ...props }: any) => components.h3({ children, id, node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            h4: ({ children, id, node, ...props }: any) => components.h4({ children, id, node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            p: ({ node, ...props }: any) => components.p({ node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            ul: ({ node, ...props }: any) => components.ul({ node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            ol: ({ node, ...props }: any) => components.ol({ node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            blockquote: ({ node, ...props }: any) => components.blockquote({ node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            code: ({ className: codeClassName, children, node, ...props }: any) => components.code({ className: codeClassName, children, node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
            img: ({ src, alt, title, width, height, node }: any) => components.img({ src, alt, title, width, height, node: adjustNodePosition(node, lineOffset, charOffset) }),
            table: ({ node, ...props }: any) => components.table({ node: adjustNodePosition(node, lineOffset, charOffset), ...props }),
        };

        return (
            <MemoizedMarkdownSegment
                key={segmentKey}
                content={content}
                components={adjustedComponents}
                renderSignature={markdownRenderSignature}
            />
        );
    };

    const segmentRenderPlans = useMemo(() => buildProjectDocSegmentRenderPlans(segments), [segments]);

    if (isCircularDocReference) {
        return (
            <div className="rounded-[5px] border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                Circular reference detected: rendering of &quot;{normalizedDocSlug}&quot; was aborted to prevent infinite loops.
            </div>
        );
    }

    return (
        <article
            className={cn("readme-body min-w-0 text-foreground", className)}
            data-readme-preview-fidelity={fidelity}
        >
            <Suspense fallback={<div className="text-sm text-muted-foreground">Rendering document…</div>}>
                {segmentRenderPlans.map((plan) => {
                    if (plan.kind === "block") {
                        const previewKey = `${plan.segment.block.kind}:${plan.segment.block.ids.join(",")}:${plan.segment.block.index}`;
                        const stablePreviewKey = `${plan.segment.block.kind}:${plan.segment.block.ids.join(",")}`;
                        const preview = effectivePreviewByKey.get(previewKey) ?? effectivePreviewByKey.get(stablePreviewKey) ?? null;

                        return allowSmartBlocks
                            ? (
                                <ProjectDocSmartBlock
                                    key={`block-${plan.index}`}
                                    block={plan.segment.block}
                                    project={project}
                                    editorMode={editorMode}
                                    preview={preview}
                                    loading={effectivePreviewsLoading}
                                />
                            )
                            : null;
                    }

                    return (
                        <React.Fragment key={`segment-group-${plan.index}`}>
                            {plan.sections.map((section) => renderMarkdownWithInlineReferences(section.content, section.key, section.lineOffset, section.charOffset))}
                        </React.Fragment>
                    );
                })}
            </Suspense>
        </article>
    );
});
