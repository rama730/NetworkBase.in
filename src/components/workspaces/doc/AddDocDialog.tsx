"use client";

import { useMemo, useState } from "react";
import { Check, FileText, Loader2 } from "lucide-react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast, feedbackError } from "@/lib/feedback";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    WORKSPACE_DOC_LIST_QUERY_KEY,
    WORKSPACE_DOCS_QUERY_KEY,
    useWorkspaceDocList,
} from "@/hooks/workspaces/useWorkspaceDocData";
import { Button } from "@/components/ui/button";
import { createDocFile, ORG_DOCS_QUERY_KEY, useOrgDocs } from "@/components/organizations/OrgDocParts";
import { docFileName } from "@/lib/organizations/doc-rules";

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
    const { data: docs = [] } = useWorkspaceDocList(projectId, open);
    const org = useOrgDocs(projectId, open).data ?? null;
    // Blank, or start from a template (live-fix 26): the organization's templates, in the organization and its workspaces.
    const templates = org ? org.docs.filter((doc) => doc.template) : [];
    const [title, setTitle] = useState("");
    const [creating, setCreating] = useState<string | null>(null);

    /** New doc (report §19.3) and org template copies (§19.7): a Markdown file in Docs, opened in the editor. */
    const createDoc = async (key: string, make: () => Promise<{ filename: string; content: string }>) => {
        if (creating) return;
        setCreating(key);
        try {
            const { filename, content } = await make();
            const created = await createDocFile(projectId, filename, content);
            if (org?.mode === "org") {
                const { updateOrgDocOptionsAction } = await import("@/app/actions/org-docs");
                await updateOrgDocOptionsAction(org.orgId, created.id, { visibility: "members_only" });
            }
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
                queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
                queryClient.invalidateQueries({ queryKey: ORG_DOCS_QUERY_KEY(projectId) }),
            ]);
            const path = (created.node.path ?? "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
            const params = new URLSearchParams(searchParams?.toString() ?? "");
            params.delete("doc");
            params.delete("from");
            params.set("tab", "files");
            params.set("fileId", created.node.id);
            if (path) params.set("path", path);
            router.push(`${pathname}?${params.toString()}`, { scroll: false });
            toast.success("Document created");
            setTitle("");
            onOpenChange(false);
        } catch (error) {
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t create doc", "Couldn’t create doc"));
        } finally {
            setCreating(null);
        }
    };

    const files = useInfiniteQuery({
        queryKey: ["project-doc-markdown-files", projectId],
        enabled: open,
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const { getWorkspaceNodes } = await import("@/app/actions/files/nodes");
            // ponytail: server name search for ".md", then exact extension filter here. ceiling: files whose name lacks ".md" (e.g. ".markdown") are missed. upgrade: extension filter param on getWorkspaceNodes.
            return getWorkspaceNodes(projectId, null, ".md", 100, pageParam, { itemType: "file", sort: "name" });
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
            const { linkWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
            const result = await linkWorkspaceDocAction(projectId, nodeId);
            if (!result.success) {
                toast.error(feedbackError(result.error, "Action couldn’t finish"));
                return;
            }
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
                queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
            ]);
            const params = new URLSearchParams(searchParams?.toString() ?? "");
            params.set("tab", "docs");
            params.set("doc", result.slug);
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            toast.success("Added to Documents");
            onOpenChange(false);
        } catch {
            toast.error("Couldn’t add document");
        } finally {
            setPendingId(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[520px] gap-3 p-4">
                <DialogHeader>
                    <DialogTitle>Add document</DialogTitle>
                    <DialogDescription>{templates.length ? "Blank, or start from a template. You can also pick a Markdown file from Files." : "Start a new doc, or pick a Markdown file from Files."}</DialogDescription>
                </DialogHeader>
                <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const clean = title.trim();
                        // Live-fix 23: blank; the title comes from the file name.
                        if (clean) void createDoc("new", async () => ({ filename: docFileName(clean), content: "" }));
                    }}
                >
                    <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Document title" aria-label="Document title" />
                    <Button type="submit" disabled={!title.trim() || creating !== null}>
                        {creating === "new" ? <Loader2 className="size-4 animate-spin" /> : null}
                        Add document
                    </Button>
                </form>
                {templates.length > 0 ? (
                    <div role="list" aria-label={`From ${org?.orgTitle} templates`} className="space-y-1">
                        <p className="text-[12px] font-medium text-muted-foreground">From {org?.orgTitle} templates</p>
                        {templates.map((template) => (
                            <button
                                key={template.id}
                                type="button"
                                role="listitem"
                                disabled={creating !== null}
                                onClick={() => void createDoc(template.id, async () => {
                                    const { readOrgTemplateCopyAction } = await import("@/app/actions/org-docs");
                                    const copy = await readOrgTemplateCopyAction(projectId, template.id);
                                    if (!copy.success) throw new Error(copy.error);
                                    return copy;
                                })}
                                className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                <FileText className="size-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate">{template.filename}</span>
                                {creating === template.id ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : <span className="text-[11px] text-muted-foreground">Use this template</span>}
                            </button>
                        ))}
                    </div>
                ) : null}
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
                            Couldn’t load files.{" "}
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
