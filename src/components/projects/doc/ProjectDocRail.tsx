"use client";

import { useMemo } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import { useProjectDocList } from "@/hooks/projects/useProjectDocData";
import { cn } from "@/lib/utils";

export function ProjectDocRail({
    projectId,
    activeSlug,
}: {
    projectId: string;
    activeSlug: string;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const { data: markdowns = [], isLoading } = useProjectDocList(projectId);

    const sortedMarkdowns = useMemo(() => {
        return [...markdowns].sort((a, b) => {
            if (a.slug === "readme") return -1;
            if (b.slug === "readme") return 1;
            return a.filename.localeCompare(b.filename, undefined, { sensitivity: "base", numeric: true });
        });
    }, [markdowns]);

    const handleSelect = (slug: string) => {
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("tab", "docs");
        params.set("doc", normalizeProjectDocSlug(slug));
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };

    return (
        <aside className="hidden w-full xl:block xl:w-[260px] shrink-0 border-l border-border pl-6" aria-label="Project documents">
            <div className="sticky top-[calc(var(--project-tabs-height,42px)+1rem)] space-y-2">
                <div className="flex items-center justify-between pb-2">
                    <span className="nb-ui-label flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                        <FileText className="size-3.5 text-muted-foreground" />
                        Documents
                    </span>
                    {isLoading ? (
                        <Loader2 className="size-3 animate-spin text-muted-foreground" />
                    ) : (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-border bg-muted/60 px-1 font-mono text-[10px] font-semibold text-muted-foreground">
                            {sortedMarkdowns.length}
                        </span>
                    )}
                </div>

                <nav className="space-y-1" aria-label="Documents list">
                    {isLoading ? (
                        <div className="space-y-1.5">
                            <div aria-hidden="true" className="nb-skeleton h-[34px] w-full rounded-[5px]" />
                            <div aria-hidden="true" className="nb-skeleton h-[34px] w-full rounded-[5px]" />
                        </div>
                    ) : (
                        sortedMarkdowns.map((doc) => {
                            const isActive = doc.slug === activeSlug;
                            return (
                                <button
                                    key={doc.id}
                                    type="button"
                                    onClick={() => handleSelect(doc.slug)}
                                    aria-current={isActive ? "page" : undefined}
                                    className={cn(
                                        "flex w-full items-center gap-2 rounded-[5px] border px-2.5 py-2 text-left text-[13px] font-medium transition-colors select-none",
                                        isActive
                                            ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                                            : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground hover:bg-muted/40",
                                    )}
                                >
                                    <FileText className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                                    <span className="truncate">{doc.filename}</span>
                                </button>
                            );
                        })
                    )}
                </nav>
            </div>
        </aside>
    );
}

export function ProjectDocMobileBar({
    projectId,
    activeSlug,
}: {
    projectId: string;
    activeSlug: string;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const { data: markdowns = [], isLoading } = useProjectDocList(projectId);

    const sortedMarkdowns = useMemo(() => {
        return [...markdowns].sort((a, b) => {
            if (a.slug === "readme") return -1;
            if (b.slug === "readme") return 1;
            return a.filename.localeCompare(b.filename, undefined, { sensitivity: "base", numeric: true });
        });
    }, [markdowns]);

    const handleSelect = (slug: string) => {
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("tab", "docs");
        params.set("doc", normalizeProjectDocSlug(slug));
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };

    if (sortedMarkdowns.length <= 1 && !isLoading) return null;

    return (
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-border pb-4 xl:hidden">
            {isLoading ? (
                <div className="flex h-[32px] items-center justify-center px-3 text-muted-foreground text-xs gap-1.5 shrink-0">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    Loading documents...
                </div>
            ) : (
                sortedMarkdowns.map((doc) => {
                    const isActive = doc.slug === activeSlug;
                    return (
                        <button
                            key={doc.id}
                            type="button"
                            onClick={() => handleSelect(doc.slug)}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                                "inline-flex h-[32px] items-center justify-center rounded-[5px] border px-3 text-[12px] font-medium transition-colors truncate shrink-0 select-none",
                                isActive
                                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                                    : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground hover:bg-muted/40",
                            )}
                        >
                            <FileText className="size-3.5 shrink-0 mr-1.5 text-muted-foreground" />
                            <span className="truncate">{doc.filename}</span>
                        </button>
                    );
                })
            )}
        </div>
    );
}
