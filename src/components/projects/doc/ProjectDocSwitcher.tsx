"use client";

import { useMemo } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import { useProjectMarkdowns } from "@/hooks/hub/useProjectDocData";
import { cn } from "@/lib/utils";

export function ProjectDocSwitcher({
    projectId,
    activeSlug,
}: {
    projectId: string;
    activeSlug: string;
    canEdit?: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const { data: markdowns = [], isLoading } = useProjectMarkdowns(projectId);

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
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-border pb-4">
            {isLoading ? (
                <div className="flex h-[32px] items-center justify-center px-3 text-muted-foreground text-xs gap-1.5 shrink-0">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    Loading documents...
                </div>
            ) : (
                sortedMarkdowns.map((doc) => (
                    <button
                        key={doc.id}
                        type="button"
                        onClick={() => handleSelect(doc.slug)}
                        className={cn(
                            "inline-flex h-[32px] items-center justify-center rounded-[5px] border px-3 text-[12px] font-medium transition-colors truncate shrink-0 select-none",
                            doc.slug === activeSlug
                                ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                                : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground hover:bg-muted/40",
                        )}
                    >
                        <FileText className="size-3.5 shrink-0 mr-1.5 text-muted-foreground" />
                        <span className="truncate">{doc.filename}</span>
                    </button>
                ))
            )}
        </div>
    );
}
