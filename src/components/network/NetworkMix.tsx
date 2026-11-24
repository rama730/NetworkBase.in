"use client";

import { useEffect, useRef, useState } from "react";
import { Users } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useMutualPreview } from "@/components/profile/v2/useMutualPreview";

/** Settings' status pattern for a list that didn't load: tag, what happened, Try again. */
export function NetworkLoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
    return (
        <div role="alert" className="nb-network-error nb-compact">
            <span className="nb-state-tag" data-tone="danger">Not loaded</span>
            <span>{what} didn’t load. Nothing changed.</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
        </div>
    );
}

/**
 * Up to three faces of the mutual connections, like the profile's Mutual stat. Loads once the card is on screen and shares
 * the profile's cache, so a person's faces are read once a minute at most.
 * ponytail: one read per visible card (rate limit 60/min per viewer); past that the count shows alone. Upgrade: return up to
 * three mutual ids with the suggestion and connection rows.
 */
export function MutualFaces({ personId }: { personId: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || seen) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [seen]);
    const preview = useMutualPreview(personId, seen);
    const people = preview.data?.people.slice(0, 3) ?? [];
    return (
        <span ref={ref} className="nb-person-faces" aria-hidden="true">
            {/* Today's icon until the faces arrive (or if they can't load). */}
            {people.length ? people.map((peer) => (
                <span key={peer.id}><UserAvatar identity={peer} size={14} roundedClassName="rounded-[2px]" /></span>
            )) : <Users className="size-3 shrink-0" />}
        </span>
    );
}

/** The request's note one click away on the card's footer; ⋯ › View note stays too. */
export function RequestNote({ name, description, note }: { name: string; description?: string; note: string }) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <button type="button" className="nb-person-note" aria-label={`Read note from ${name}`}>Read note</button>
            </DialogTrigger>
            <DialogContent className="nb-person-dialog">
                <DialogHeader>
                    <DialogTitle>Note from {name}</DialogTitle>
                    {description ? <DialogDescription className="nb-compact break-words">{description}</DialogDescription> : null}
                </DialogHeader>
                <p className="nb-compact whitespace-pre-wrap break-words">{note}</p>
            </DialogContent>
        </Dialog>
    );
}
