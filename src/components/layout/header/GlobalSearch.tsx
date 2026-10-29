"use client";

import { confirmAppNavigation } from "@/lib/navigation/confirm-navigation";

import { Search, X } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

import {
    buildGlobalSearchClearHref,
    getGlobalSearchQuery,
    resolveGlobalSearchContext,
    type GlobalSearchContext,
} from "./global-search";

interface GlobalSearchProps {
    onOpenCommandPalette: (initialQuery?: string, context?: GlobalSearchContext) => void;
    condensed?: boolean;
}

export default function GlobalSearch({ onOpenCommandPalette, condensed = false }: GlobalSearchProps) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const paramsString = searchParams?.toString() ?? "";
    const { context, placeholder } = useMemo(
        () => resolveGlobalSearchContext(pathname, new URLSearchParams(paramsString)),
        [paramsString, pathname],
    );
    const query = useMemo(
        () => getGlobalSearchQuery(new URLSearchParams(searchParams?.toString()), context),
        [context, searchParams],
    );

    const isMac = useMemo(() => {
        if (typeof navigator === "undefined") return false;
        return navigator.platform.toUpperCase().includes("MAC");
    }, []);

    const triggerLabel = useMemo(() => {
        const contextLabel = (() => {
            switch (context) {
                case "discover":
                    return "Search workspaces";
                case "network":
                    return placeholder.replace(/\.\.\.$/, "");
                case "messages":
                    return "Find a conversation";
                case "project":
                    return "Search this workspace";
                case "settings":
                    return "Search settings";
                default:
                    return "Search workspaces";
            }
        })();

        if (!query.trim()) {
            return contextLabel;
        }

        return `${contextLabel}. Current query: ${query.trim()}`;
    }, [context, placeholder, query]);

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        const href = buildGlobalSearchClearHref({
            pathname: pathname || "/",
            searchParams: new URLSearchParams(searchParams?.toString()),
            context,
        });
        if (confirmAppNavigation()) router.push(href);
    };

    return (
        <div
            className={`
                hidden md:flex items-center rounded-[5px]
                border bg-card
                transition-colors duration-[130ms] group relative overflow-hidden shadow-none
                ${condensed
                    ? 'h-10 w-10 shrink-0 justify-center gap-0 border-transparent bg-transparent px-0 py-0 hover:bg-muted'
                    : `h-[var(--ui-control-height)] w-60 lg:w-80 gap-2 px-3 ${query
                        ? 'border-primary/40 ring-1 ring-primary/10'
                        : 'border-border hover:border-input'
                    }`
                }
            `}
        >
            <button
                type="button"
                onClick={() => {
                    // A page with its own search box (Discover): one search, so the top bar goes to it.
                    const pageSearch = document.querySelector<HTMLInputElement>('[data-page-search] input');
                    if (pageSearch) pageSearch.focus();
                    else onOpenCommandPalette(query, context);
                }}
                aria-label={triggerLabel}
                className={`flex min-w-0 items-center rounded-[5px] transition-colors duration-[130ms] focus:outline-none ${
                    condensed ? 'justify-center' : 'flex-1 gap-2'
                }`}
            >
                <Search className={`size-4 shrink-0 transition-colors duration-[180ms]
                    ${condensed
                        ? 'text-muted-foreground hover:text-foreground'
                        : (query ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")
                    }`}
                />

                <div className={`items-center flex-1 overflow-hidden ${condensed ? 'hidden' : 'flex w-auto opacity-100'}`}>
                    <span className={`text-xs whitespace-nowrap truncate transition-colors ${query ? "text-foreground font-medium" : "text-muted-foreground group-hover:text-foreground"}`}>
                        {query || placeholder}
                    </span>
                </div>
            </button>

            <div className={`items-center shrink-0 ${condensed ? 'hidden' : 'flex w-auto opacity-100 ml-auto'}`}>
                {query ? (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="flex size-5 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label="Clear search"
                    >
                        <X className="size-3.5" />
                    </button>
                ) : (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[3px] bg-muted/60 border border-border text-[11px] font-mono text-muted-foreground shadow-none">
                        {isMac ? "⌘" : "Ctrl"}K
                    </kbd>
                )}
            </div>
        </div>
    );
}
