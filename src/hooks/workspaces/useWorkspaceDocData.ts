"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import type {
    WorkspaceDocReferenceKind,
    WorkspaceDocSmartBlock,
    WorkspaceDocSmartBlockPreview,
} from "@/lib/workspaces/doc-blocks";
import { normalizeWorkspaceDocSlug } from "@/lib/workspaces/doc";

export const WORKSPACE_DOCS_QUERY_KEY = (projectId: string) => queryKeys.project.detail.readme(projectId);
export const WORKSPACE_DOC_QUERY_KEY = (projectId: string, docSlug: string | null) =>
    [...WORKSPACE_DOCS_QUERY_KEY(projectId), docSlug ? normalizeWorkspaceDocSlug(docSlug) : "default"] as const;
export const WORKSPACE_DOC_SMART_BLOCK_PREVIEWS_QUERY_KEY = (projectId: string, blockSignature: string) =>
    queryKeys.project.detail.readmeSmartBlockPreviews(projectId, blockSignature);

export function useWorkspaceDoc(projectId: string, docSlug: string | null) {
    const queryClient = useQueryClient();
    return useQuery({
        queryKey: WORKSPACE_DOC_QUERY_KEY(projectId, docSlug),
        queryFn: async () => {
            const { readWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
            const result = await readWorkspaceDocAction(projectId, docSlug);
            if (!result.success) throw Object.assign(new Error(result.error), { code: result.code ?? null });
            queryClient.setQueryData(WORKSPACE_DOC_LIST_QUERY_KEY(projectId), result.data.docs);
            return result.data;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        // An invalid or forbidden doc does not become valid on retry.
        retry: (failureCount, error) => !(error as { code?: string | null }).code && failureCount < 2,
    });
}

const MAX_SMART_BLOCK_CACHE_SIZE = 150;
const SMART_BLOCK_CACHE = new Map<string, WorkspaceDocSmartBlockPreview>();

function setCachedSmartBlock(key: string, preview: WorkspaceDocSmartBlockPreview) {
    if (SMART_BLOCK_CACHE.size >= MAX_SMART_BLOCK_CACHE_SIZE) {
        const firstKey = SMART_BLOCK_CACHE.keys().next().value;
        if (firstKey) SMART_BLOCK_CACHE.delete(firstKey);
    }
    SMART_BLOCK_CACHE.set(key, preview);
}

/** `docSlug` is the doc being read: previews follow that doc's visibility, not the README's. */
export function useWorkspaceDocSmartBlockPreviews(projectId: string, blocks: WorkspaceDocSmartBlock[], enabled = true, docSlug = "readme") {
    const blockSignature = useMemo(() => {
        const uniqueBlocks = new Map<string, { kind: string; ids: string[] }>();
        blocks.forEach((b) => {
            const key = `${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
            uniqueBlocks.set(key, { kind: b.kind, ids: b.ids });
        });
        const sorted = Array.from(uniqueBlocks.values()).sort((a, b) => {
            const ak = `${a.kind}:${[...(a.ids ?? [])].sort().join(",")}`;
            const bk = `${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
            return ak.localeCompare(bk);
        });
        return JSON.stringify(sorted);
    }, [blocks]);

    return useQuery({
        queryKey: WORKSPACE_DOC_SMART_BLOCK_PREVIEWS_QUERY_KEY(projectId, `${docSlug}|${blockSignature}`),
        queryFn: async () => {
            // Deduplicate blocks before querying to prevent redundant database resolutions
            const uniqueMap = new Map<string, { kind: WorkspaceDocReferenceKind | "unknown"; ids: string[]; index: number }>();
            blocks.forEach((b, idx) => {
                const key = `${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
                if (!uniqueMap.has(key)) {
                    uniqueMap.set(key, { kind: b.kind, ids: b.ids, index: idx });
                }
            });
            const uniqueBlocksList = Array.from(uniqueMap.values());
            if (!uniqueBlocksList.length) return [];

            const missingBlocks: typeof uniqueBlocksList = [];
            const previews: WorkspaceDocSmartBlockPreview[] = [];

            for (const b of uniqueBlocksList) {
                const cacheKey = `${projectId}:${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
                if (SMART_BLOCK_CACHE.has(cacheKey)) {
                    previews.push(SMART_BLOCK_CACHE.get(cacheKey)!);
                } else {
                    missingBlocks.push(b);
                }
            }

            if (missingBlocks.length > 0) {
                const { readWorkspaceDocSmartBlockPreviewsAction } = await import("@/app/actions/workspace/doc");
                const chunks: any[][] = [];
                for (let index = 0; index < missingBlocks.length; index += 20) {
                    chunks.push(missingBlocks.slice(index, index + 20));
                }
                const results = await Promise.all(chunks.map((chunk) => readWorkspaceDocSmartBlockPreviewsAction(projectId, chunk, docSlug)));
                for (const result of results) {
                    if (!result.success) throw new Error(result.error);
                    for (const preview of result.previews) {
                        const cacheKey = `${projectId}:${preview.key}`;
                        setCachedSmartBlock(cacheKey, preview);
                        previews.push(preview);
                    }
                }
            }
            return previews;
        },
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        enabled: enabled && blocks.length > 0,
    });
}

export const WORKSPACE_DOC_LIST_QUERY_KEY = (projectId: string) =>
    ["project", projectId, "detail", "markdowns_list"] as const;

export function useWorkspaceDocList(projectId: string, enabled = true) {
    return useQuery({
        queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId),
        queryFn: async () => {
            const { listWorkspaceDocsAction } = await import("@/app/actions/workspace/doc");
            const result = await listWorkspaceDocsAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.docs;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        enabled,
    });
}
