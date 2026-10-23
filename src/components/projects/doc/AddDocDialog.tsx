"use client";

import { useMemo, useState } from "react";
import { Check, FileText, Loader2 } from "lucide-react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast, feedbackError } from "@/lib/feedback";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    PROJECT_DOC_LIST_QUERY_KEY,
    PROJECT_DOCS_QUERY_KEY,
    useProjectDocList,
} from "@/hooks/projects/useProjectDocData";

const MARKDOWN_FILE = /\.(md|mdx|markdown)$/i;

export function AddDocDialog({
    projectId,
    open,
    onOpenChange,
}: {
    projectId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const [filter, setFilter] = useState("");
    const [pendingId, setPendingId] = useState<string | null>(null);
    const { data: docs = [] } = useProjectDocList(projectId, open);

    const files = useInfiniteQuery({
        queryKey: ["project-doc-markdown-files", projectId],
        enabled: open,
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const { getProjectNodes } = await import("@/app/actions/files/nodes");
            // ponytail: server name search for ".md", then exact extension filter here. ceiling: files whose name lacks ".md" (e.g. ".markdown") are missed. upgrade: extension filter param on getProjectNodes.
            return getProjectNodes(projectId, null, ".md", 100, pageParam, { itemType: "file", sort: "name" });
        },
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        staleTime: 30_000,
    });

    const linkedIds = useMemo(() => new Set(docs.map((doc) => doc.linkedNodeId).filter(Boolean)), [docs]);
    const rows = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        return (files.data?.pages ?? [])
            .flatMap((page) => page.nodes)
            .filter((node) => MARKDOWN_FILE.test(node.name))
            .filter((node) => !needle || `${node.path ?? ""}/${node.name}`.toLowerCase().includes(needle));
    }, [files.data, filter]);

    const handlePick = async (nodeId: string) => {
        if (pendingId) return;
        setPendingId(nodeId);
        try {
            const { linkProjectDocAction } = await import("@/app/actions/project/doc");
            const result = await linkProjectDocAction(projectId, nodeId);
            if (!result.success) {
                toast.error(feedbackError(result.error, "Action couldn’t finish"));
                return;
            }
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: PROJECT_DOC_LIST_QUERY_KEY(projectId) }),
                queryClient.invalidateQueries({ queryKey: PROJECT_DOCS_QUERY_KEY(projectId) }),
            ]);
            const params = new URLSearchParams(searchParams?.toString() ?? "");
            params.set("tab", "docs");
            params.set("doc", result.slug);
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            toast.success("Added to Docs");
            onOpenChange(false);
        } catch {
            toast.error("Failed to add doc");
        } finally {
            setPendingId(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[520px] gap-3 p-4">
                <DialogHeader>
                    <DialogTitle>Add doc</DialogTitle>
                    <DialogDescription>Pick a Markdown file from Files.</DialogDescription>
                </DialogHeader>
                <Input
                    autoFocus
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Filter by name or path"
                    aria-label="Filter Markdown files"
                />
                <div className="max-h-[360px] min-h-[120px] overflow-y-auto" role="list" aria-label="Markdown files">
                    {files.isLoading ? (
                        <div className="space-y-1.5">
                            <div aria-hidden="true" className="nb-skeleton h-[44px] w-full rounded-[5px]" />
                            <div aria-hidden="true" className="nb-skeleton h-[44px] w-full rounded-[5px]" />
                            <div aria-hidden="true" className="nb-skeleton h-[44px] w-full rounded-[5px]" />
                        </div>
                    ) : files.isError ? (
                        <p className="py-6 text-center text-[13px] text-muted-foreground">
                            Could not load files.{" "}
                            <button type="button" onClick={() => void files.refetch()} className="font-medium text-foreground underline underline-offset-4">
                                Retry
                            </button>
                        </p>
                    ) : rows.length === 0 ? (
                        <p className="py-6 text-center text-[13px] text-muted-foreground">
                            {filter ? "No matching Markdown files." : "No Markdown files in Files yet."}
                        </p>
                    ) : (
                        rows.map((node) => {
                            const added = linkedIds.has(node.id);
                            return (
                                <button
                                    key={node.id}
                                    type="button"
                                    role="listitem"
                                    disabled={added || pendingId !== null}
                                    onClick={() => void handlePick(node.id)}
                                    className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                                >
                                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13px] font-medium text-foreground">{node.name}</span>
                                        {node.path && node.path !== "/" ? (
                                            <span className="block truncate font-mono text-[11px] text-muted-foreground">{node.path}</span>
                                        ) : null}
                                    </span>
                                    {pendingId === node.id ? (
                                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                                    ) : added ? (
                                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                            <Check className="size-3" /> Added
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })
                    )}
                    {files.hasNextPage ? (
                        <button
                            type="button"
                            onClick={() => void files.fetchNextPage()}
                            disabled={files.isFetchingNextPage}
                            className="mt-1 w-full rounded-[5px] py-2 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            {files.isFetchingNextPage ? "Loading…" : "Load more"}
                        </button>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
