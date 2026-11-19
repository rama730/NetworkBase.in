"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";

import {
    WORKSPACE_DOC_LIST_QUERY_KEY,
    WORKSPACE_DOCS_QUERY_KEY,
    useWorkspaceDocSmartBlockPreviews,
} from "@/hooks/workspaces/useWorkspaceDocData";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/feedback";
import { normalizeWorkspaceDocSlug, type WorkspaceDocPublishedPayload } from "@/lib/workspaces/doc";
import type { WorkspaceDocSmartBlockPreview } from "@/lib/workspaces/doc-blocks";
import { decodeReadmeHashTarget } from "@/lib/workspaces/doc-navigation";
import { buildWorkspaceDocViewModel } from "@/lib/workspaces/doc-view-model";
import { WorkspaceDocRail, WorkspaceDocMobileBar, useDocRail } from "@/components/workspaces/doc/WorkspaceDocRail";
import { OrgDocHeader, uploadWorkspaceFile, useOrgDocs } from "@/components/organizations/OrgDocParts";
import { MoveToSectionMenu } from "@/components/workspaces/doc/MoveToSectionMenu";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { docSectionOf } from "@/lib/workspaces/doc-sections";
import { docTitle, isEmptyDoc } from "@/lib/organizations/doc-rules";
import { useMainProtected, useSaveToBranch } from "@/components/workspaces/v2/files-tab/SaveToBranch";
import type { Workspace } from "@/types/discover";

const WorkspaceDocRenderer = dynamic(
    () => import("@/components/workspaces/doc/WorkspaceDocRenderer").then((mod) => mod.WorkspaceDocRenderer),
    { loading: () => null, ssr: false },
);

/**
 * Edit for someone who may edit the doc (0.8 #15). A doc with a file opens it in Files; a starter README with no file
 * yet gets one on the first Edit, as the CLI's first save does: /README.md with what it says now, attached to this
 * doc, then opened in the editor.
 */
function DocEditButton({ projectId, docSlug, filename, content, fileHref }: { projectId: string; docSlug: string; filename: string; content: string; fileHref: string | null }) {
    const router = useRouter();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    // A protected main takes merge requests only (H24): the first README goes on a new branch instead.
    const mainProtected = useMainProtected(projectId);
    const { offer, dialog } = useSaveToBranch(projectId);
    if (fileHref) return <Button asChild variant="outline" size="sm"><Link href={fileHref}>Edit</Link></Button>;
    const start = async () => {
        if (busy) return;
        if (mainProtected) { offer({ title: `Add ${filename}`, what: filename, change: { kind: "text", path: `/${filename}`, text: content, baseHash: null } }); return; }
        setBusy(true);
        try {
            const node = await uploadWorkspaceFile(projectId, null, filename, new Blob([content], { type: "text/markdown" }));
            const { attachWorkspaceDocFileAction } = await import("@/app/actions/workspace/doc");
            const attached = await attachWorkspaceDocFileAction(projectId, docSlug, node.id).catch(() => ({ success: false as const, error: "Couldn’t start the file." }));
            if (!attached.success) {
                // The new file isn't left behind when attaching it fails (as Add doc does).
                const { bulkTrashNodes } = await import("@/app/actions/files/mutations");
                await bulkTrashNodes([node.id], projectId).catch(() => undefined);
                throw new Error(attached.error);
            }
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
                queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
            ]);
            router.push(`${pathname}?tab=files&fileId=${encodeURIComponent(node.id)}&edit=1`, { scroll: false });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn’t start the file", { action: { label: "Retry", onClick: () => void start() } });
        } finally {
            setBusy(false);
        }
    };
    return <>{dialog}<Button variant="outline" size="sm" onClick={() => void start()} disabled={busy}>{busy ? "Starting…" : "Edit"}</Button></>;
}

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

export function WorkspaceDocViewer({
    project,
    payload,
    docSlug = "readme",
    inPlaceBanner,
    reportMenu,
}: {
    project: Workspace;
    payload: WorkspaceDocPublishedPayload;
    docSlug?: string;
    /** An org doc read inside a child project: this banner instead of the doc rail (report §19.7). */
    inPlaceBanner?: React.ReactNode;
    /** Report this doc, for people who can't edit it (C15). Student check 4: it never replaces the header and list. */
    reportMenu?: React.ReactNode;
}) {
    const normalizedDocSlug = useMemo(() => normalizeWorkspaceDocSlug(docSlug), [docSlug]);
    const rail = useDocRail(project.id, normalizedDocSlug);
    // An organization's document reads with its own header (live-fix 22); a workspace's docs stay as they are.
    const orgDocs = useOrgDocs(project.id).data;
    const orgDoc = !inPlaceBanner && orgDocs?.mode === "org" ? orgDocs.docs.find((doc) => doc.slug === normalizedDocSlug) : undefined;
    const listed = rail.docs.find((doc) => doc.slug === normalizedDocSlug);
    const addedWorkflows = useAddedWorkflows();
    const title = docTitle(orgDoc?.filename ?? listed?.filename ?? "");
    const fileHref = payload.linkedNode ? `/workspaces/${encodeURIComponent(project.slug ?? project.id)}?tab=files&fileId=${encodeURIComponent(payload.linkedNode.id)}` : null;
    
    const version = payload.version;
    const readmeContent = version?.content ?? "";
    const storedReadmeHeadings = version?.headings;
    const readmeExcerpt = version?.excerpt ?? null;
    const readmeViewModel = useMemo(() => buildWorkspaceDocViewModel({
        content: readmeContent,
        contentHash: version?.contentHash,
        excerpt: readmeExcerpt,
        storedHeadings: storedReadmeHeadings,
    }), [readmeContent, readmeExcerpt, storedReadmeHeadings, version?.contentHash]);
    const previewBlocks = payload.settings.projectBlocks
        ? readmeViewModel.previewBlocks
        : readmeViewModel.referencePreviewBlocks;
    const readmePreviewsQuery = useWorkspaceDocSmartBlockPreviews(
        project.id,
        previewBlocks,
        previewBlocks.length > 0,
        normalizedDocSlug,
    );
    const previewByKey = useMemo(() => {
        const map = new Map<string, WorkspaceDocSmartBlockPreview>();
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

    // Report §7.4, live-fix 23: an empty document says so (blank, or only its title as a heading); editors get Start writing.
    const renderer = !version || isEmptyDoc(version.content, title) ? (
        <div className="nb-empty-state py-12" role="status">
            <p className="nb-card-title text-foreground">This document is empty</p>
            {payload.canEdit && fileHref ? (
                <Link href={fileHref} className="mt-3 inline-flex text-sm font-medium text-primary underline underline-offset-4">Start writing</Link>
            ) : null}
        </div>
    ) : (
        <WorkspaceDocRenderer
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
    );
    if (inPlaceBanner) {
        return (
            <div className="relative mx-auto w-full max-w-[1240px] px-0 py-0">
                {inPlaceBanner}
                {renderer}
            </div>
        );
    }

    return (
        <div className="relative mx-auto w-full max-w-[1240px] px-0 py-0">
            <WorkspaceDocMobileBar
                projectId={project.id}
                activeSlug={normalizedDocSlug}
                canEdit={payload.canEdit}
                rail={rail}
            />
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0">
                    {reportMenu}
                    {orgDocs?.mode === "org" && orgDoc ? (
                        <OrgDocHeader data={orgDocs} doc={orgDoc} updatedBy={version?.createdByName ?? null} updatedAt={version?.createdAt ?? null}
                            editHref={payload.canEdit ? fileHref : null} onRemove={payload.canEdit && listed ? () => rail.askRemove(listed) : null} visibility={payload.settings.visibilityOverride} />
                    ) : payload.canEdit ? (
                        <div className="mb-3 flex items-center justify-end gap-1">
                            <DocEditButton projectId={project.id} docSlug={normalizedDocSlug} filename={listed?.filename ?? "README.md"} content={readmeContent} fileHref={fileHref} />
                            {listed ? <MoveToSectionMenu projectId={project.id} docSlug={normalizedDocSlug} current={docSectionOf(listed, addedWorkflows)} date={listed.date} /> : null}
                        </div>
                    ) : null}
                    {renderer}
                </div>
                <WorkspaceDocRail
                    projectId={project.id}
                    activeSlug={normalizedDocSlug}
                    canEdit={payload.canEdit}
                    rail={rail}
                    visibility={payload.settings.visibilityOverride}
                />
            </div>
            {payload.canEdit ? rail.dialogs : null}
        </div>
    );
}
