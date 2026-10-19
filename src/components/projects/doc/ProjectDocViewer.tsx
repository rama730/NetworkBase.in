"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";

import { 
    useProjectDocSmartBlockPreviews,
} from "@/hooks/projects/useProjectDocData";
import { normalizeProjectDocSlug, type ProjectDocPublishedPayload } from "@/lib/projects/doc";
import type { ProjectDocSmartBlockPreview } from "@/lib/projects/doc-blocks";
import { decodeReadmeHashTarget } from "@/lib/projects/doc-navigation";
import { buildProjectDocViewModel } from "@/lib/projects/doc-view-model";
import { ProjectDocRail, ProjectDocMobileBar, useDocRail } from "@/components/projects/doc/ProjectDocRail";
import type { Project } from "@/types/discover";

const ProjectDocRenderer = dynamic(
    () => import("@/components/projects/doc/ProjectDocRenderer").then((mod) => mod.ProjectDocRenderer),
    { loading: () => null, ssr: false },
);

function shouldReduceMotion() {
    return document.documentElement.dataset.reduceMotion === "true"
        || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const README_TARGET_SCROLL_GAP = 20;
const README_TARGET_SCROLL_BOTTOM_GAP = 48;
const README_TARGET_CENTER_RATIO = 0.5;
const README_HEADING_REVEAL_RATIO = 0.38;
const README_TALL_TARGET_RATIO = 0.82;

function getRouteScrollRoot() {
    return document.querySelector<HTMLElement>('[data-scroll-root="route"]');
}

function getStickyProjectOffset(routeRoot: HTMLElement | null) {
    const stickyTabs = document.querySelector<HTMLElement>('[data-project-sticky-tabs="true"]');
    if (!stickyTabs) return 0;
    const stickyRect = stickyTabs.getBoundingClientRect();
    const rootTop = routeRoot?.getBoundingClientRect().top ?? 0;
    return stickyRect.bottom > rootTop && stickyRect.top <= rootTop + 8 ? stickyRect.height : 0;
}

function resolveReadmeRevealElement(target: HTMLElement) {
    if (target.dataset.readmeTargetKind === "command") {
        return target.closest<HTMLElement>('[data-readme-command-block="true"]') ?? target;
    }
    return target;
}

function readmeRevealRatioForTarget(target: HTMLElement) {
    return target.dataset.readmeTargetKind === "heading"
        ? README_HEADING_REVEAL_RATIO
        : README_TARGET_CENTER_RATIO;
}

function getDocVisibleMetrics(routeRoot: HTMLElement | null) {
    const stickyOffset = getStickyProjectOffset(routeRoot);
    const rootRect = routeRoot?.getBoundingClientRect() ?? {
        top: 0,
        bottom: window.innerHeight,
        height: window.innerHeight,
    };
    const visibleStart = stickyOffset + README_TARGET_SCROLL_GAP;
    const visibleHeight = Math.max(
        160,
        rootRect.height - stickyOffset - README_TARGET_SCROLL_GAP - README_TARGET_SCROLL_BOTTOM_GAP,
    );

    return {
        currentScrollTop: routeRoot ? routeRoot.scrollTop : window.scrollY,
        rootTop: rootRect.top,
        visibleStart,
        visibleHeight,
    };
}

function getCenteredReadmeScrollTop(target: HTMLElement, revealElement: HTMLElement, routeRoot: HTMLElement | null) {
    const metrics = getDocVisibleMetrics(routeRoot);
    const elementRect = revealElement.getBoundingClientRect();
    const elementTop = metrics.currentScrollTop + elementRect.top - metrics.rootTop;
    const ratio = readmeRevealRatioForTarget(target);

    if (elementRect.height >= metrics.visibleHeight * README_TALL_TARGET_RATIO) {
        return Math.max(0, elementTop - metrics.visibleStart);
    }

    const targetTopWithinViewport = metrics.visibleStart + (metrics.visibleHeight * ratio) - (elementRect.height / 2);
    return Math.max(0, elementTop - targetTopWithinViewport);
}

function scrollReadmeTargetIntoView(target: HTMLElement, behavior: ScrollBehavior) {
    const routeRoot = getRouteScrollRoot();
    const revealElement = resolveReadmeRevealElement(target);
    const top = getCenteredReadmeScrollTop(target, revealElement, routeRoot);

    if (routeRoot) {
        routeRoot.scrollTo({
            top,
            behavior,
        });
        return;
    }

    window.scrollTo({ top, behavior });
}

export function ProjectDocViewer({
    project,
    payload,
    docSlug = "readme",
}: {
    project: Project;
    payload: ProjectDocPublishedPayload;
    docSlug?: string;
}) {
    const normalizedDocSlug = useMemo(() => normalizeProjectDocSlug(docSlug), [docSlug]);
    const rail = useDocRail(project.id, normalizedDocSlug);
    
    const version = payload.version;
    const readmeContent = version?.content ?? "";
    const storedReadmeHeadings = version?.headings;
    const readmeExcerpt = version?.excerpt ?? null;
    const readmeViewModel = useMemo(() => buildProjectDocViewModel({
        content: readmeContent,
        contentHash: version?.contentHash,
        excerpt: readmeExcerpt,
        storedHeadings: storedReadmeHeadings,
    }), [readmeContent, readmeExcerpt, storedReadmeHeadings, version?.contentHash]);
    const previewBlocks = payload.settings.projectBlocks
        ? readmeViewModel.previewBlocks
        : readmeViewModel.referencePreviewBlocks;
    const readmePreviewsQuery = useProjectDocSmartBlockPreviews(
        project.id,
        previewBlocks,
        previewBlocks.length > 0,
    );
    const previewByKey = useMemo(() => {
        const map = new Map<string, ProjectDocSmartBlockPreview>();
        for (const preview of readmePreviewsQuery.data ?? []) map.set(preview.key, preview);
        return map;
    }, [readmePreviewsQuery.data]);

    const scrollFrameRef = useRef<number | null>(null);
    const mediaCorrectionFrameRef = useRef<number | null>(null);
    const targetRetryTimerRef = useRef<number | null>(null);
    const lastRevealTargetIdRef = useRef<string | null>(null);
    const readmeTargetIds = readmeViewModel.targetIds;
    const readmeTargetSignature = readmeViewModel.targetSignature;

    const updateHash = useCallback((targetId: string) => {
        const url = new URL(window.location.href);
        url.hash = encodeURIComponent(targetId);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }, []);

    const scrollToTarget = useCallback((rawTargetId: string, options?: {
        behavior?: ScrollBehavior;
        defer?: boolean;
        retry?: boolean;
        retries?: number;
        updateHash?: boolean;
    }) => {
        const targetId = decodeReadmeHashTarget(rawTargetId) ?? rawTargetId;
        const revealTarget = (attemptsRemaining: number): boolean => {
            let element = document.getElementById(targetId);
            let resolvedTargetId = targetId;
            if (!element && targetId.startsWith("line-")) {
                const lineNum = targetId.split("-")[1];
                element = document.querySelector(`[data-readme-source-line="${lineNum}"]`);
                if (element) {
                    resolvedTargetId = element.getAttribute("data-readme-editor-target-id") || element.id || targetId;
                }
            }
            if (!element) {
                if (options?.retry !== false && attemptsRemaining > 0) {
                    if (targetRetryTimerRef.current) window.clearTimeout(targetRetryTimerRef.current);
                    targetRetryTimerRef.current = window.setTimeout(() => revealTarget(attemptsRemaining - 1), 50);
                }
                return false;
            }

            if (targetRetryTimerRef.current) {
                window.clearTimeout(targetRetryTimerRef.current);
                targetRetryTimerRef.current = null;
            }
            const behavior = options?.behavior ?? (shouldReduceMotion() ? "auto" : "smooth");
            scrollReadmeTargetIntoView(element, behavior);
            lastRevealTargetIdRef.current = resolvedTargetId;
            if (typeof element.focus === "function") {
                element.focus({ preventScroll: true });
            }
            if (options?.updateHash !== false) updateHash(resolvedTargetId);
            return true;
        };

        if (options?.defer) {
            if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
            scrollFrameRef.current = window.requestAnimationFrame(() => {
                scrollFrameRef.current = window.requestAnimationFrame(() => {
                    scrollFrameRef.current = null;
                    revealTarget(options?.retries ?? 20);
                });
            });
            return true;
        }

        return revealTarget(options?.retries ?? 20);
    }, [updateHash]);

    const handleReadmeMediaLoad = useCallback(() => {
        const targetId = lastRevealTargetIdRef.current;
        if (!targetId) return;
        if (mediaCorrectionFrameRef.current) window.cancelAnimationFrame(mediaCorrectionFrameRef.current);
        mediaCorrectionFrameRef.current = window.requestAnimationFrame(() => {
            mediaCorrectionFrameRef.current = null;
            scrollToTarget(targetId, {
                behavior: "auto",
                retry: false,
                retries: 0,
                updateHash: false,
            });
        });
    }, [scrollToTarget]);

    useEffect(() => {
        if (!readmeTargetIds.length) return;
        let cancelled = false;
        let timer: number | null = null;
        const resolveHashTarget = (attemptsRemaining: number) => {
            if (cancelled) return;
            const targetId = decodeReadmeHashTarget(window.location.hash);
            if (!targetId) return;
            if (scrollToTarget(targetId, { behavior: "auto", retry: false, updateHash: false })) {
                return;
            }
            if (attemptsRemaining > 0) {
                timer = window.setTimeout(() => resolveHashTarget(attemptsRemaining - 1), 50);
            }
        };
        const frame = window.requestAnimationFrame(() => resolveHashTarget(20));
        const handleHashChange = () => resolveHashTarget(20);
        window.addEventListener("hashchange", handleHashChange);

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
            if (timer) window.clearTimeout(timer);
            window.removeEventListener("hashchange", handleHashChange);
        };
    }, [readmeTargetIds.length, readmeTargetSignature, scrollToTarget]);

    useEffect(() => {
        return () => {
            if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
            if (mediaCorrectionFrameRef.current) window.cancelAnimationFrame(mediaCorrectionFrameRef.current);
            if (targetRetryTimerRef.current) window.clearTimeout(targetRetryTimerRef.current);
        };
    }, []);

    if (!version) return null;

    return (
        <div className="relative mx-auto w-full max-w-[1240px] px-0 py-0">
            <ProjectDocMobileBar
                projectId={project.id}
                activeSlug={normalizedDocSlug}
                canEdit={payload.canEdit}
                rail={rail}
            />
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0">
                    <ProjectDocRenderer
                        content={version.content}
                        project={project}
                        docSlug={normalizedDocSlug}
                        allowExternalImages={payload.settings.externalImages}
                        allowSmartBlocks={payload.settings.projectBlocks}
                        className="mx-auto max-w-none"
                        onRequestTarget={scrollToTarget}
                        onMediaLoad={handleReadmeMediaLoad}
                        previewByKey={previewByKey}
                        previewsLoading={readmePreviewsQuery.isLoading}
                        viewModel={readmeViewModel}
                    />
                </div>
                <ProjectDocRail
                    projectId={project.id}
                    activeSlug={normalizedDocSlug}
                    canEdit={payload.canEdit}
                    rail={rail}
                />
            </div>
            {payload.canEdit ? rail.dialogs : null}
        </div>
    );
}
