'use client';

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

const SEARCH_COMMIT_DELAY_MS = 180;

export function CollaboratorSearchField({ onCommit, disabled = false, label = "Search collaborators", placeholder = "Search collaborators by name, username, or role..." }: { onCommit: (value: string) => void; label?: string; placeholder?: string; disabled?: boolean }) {
    const [draft, setDraft] = useState("");

    useEffect(() => {
        if (disabled) return;
        const timer = window.setTimeout(() => onCommit(draft), SEARCH_COMMIT_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [draft, onCommit, disabled]);

    return (
        <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
                disabled={disabled}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={placeholder}
                aria-label={label}
                className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background pl-9 pr-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground"
            />
        </div>
    );
}
