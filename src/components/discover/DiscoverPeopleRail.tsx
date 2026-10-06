"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { Check, Clock, MapPin, Users } from "lucide-react";
import { toast } from "sonner";

import { SkillIcon } from "@/components/skills";
import { PersonPresenceDot } from "@/components/network/PersonPresenceDot";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { DISCOVER_RAIL_FILTERS } from "@/lib/discover/query";
import {
    getConnectionRequestSuccessMessage,
    type ConnectionFeedPage,
    type DiscoverConnectionItem,
    useConnectionMutations,
    useSuggestedPeople,
} from "@/hooks/useConnections";
import { canonicalSkillKey, matchingSkillLabels } from "@/lib/skills/matching";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { profileHref } from "@/lib/routing/identifiers";

type DiscoverPeopleRailProps = {
    initialPage?: ConnectionFeedPage<DiscoverConnectionItem>;
    variant: "desktop" | "compact";
};

const SHOWN_SKILLS = 2;

/**
 * Spec §12's rail variant: a stacked card (identity first, then headline and skills) with a small
 * secondary action at the bottom right, so a long name never squeezes between avatar and button.
 */
function SuggestedPersonCard({
    profile,
    viewerSkills,
}: {
    profile: DiscoverConnectionItem;
    viewerSkills: string[];
}) {
    useSkillCatalog();
    const { sendRequest } = useConnectionMutations();
    const displayName = profile.fullName || profile.username || "Member";
    // The mutation patches this row in the cache at once (onMutate), so the status shown is always the server's.
    const status = profile.connectionStatus;
    const matchingSkills = matchingSkillLabels(profile.skills ?? [], viewerSkills);
    const matchingSkillKeys = new Set(matchingSkills.map(canonicalSkillKey));
    const sortedSkills = [...(profile.skills ?? [])]
        .sort((left, right) => Number(matchingSkillKeys.has(canonicalSkillKey(right))) - Number(matchingSkillKeys.has(canonicalSkillKey(left))));
    const skills = sortedSkills.slice(0, SHOWN_SKILLS);
    const moreSkills = sortedSkills.length - skills.length;
    const mutual = profile.mutualConnections ?? 0;

    const connect = useCallback(async () => {
        if (status !== "none" || profile.canConnect === false || sendRequest.isPending) return;
        try {
            await toast.promise(sendRequest.mutateAsync({ userId: profile.id }), {
                loading: "Sending request…",
                success: (result) => getConnectionRequestSuccessMessage(result.status),
                error: (error) => error instanceof Error ? error.message : "Failed to send request",
            }).unwrap();
        } catch {
            // The mutation rolls the row back and the toast says why.
        }
    }, [profile.canConnect, profile.id, sendRequest, status]);

    // The same words as the Network page's cards.
    const action = status === "none" ? (
        profile.canConnect === false ? (
            <span className="nb-meta">Not accepting requests</span>
        ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => void connect()} disabled={sendRequest.isPending} aria-label={`Connect with ${displayName}`} className="pointer-coarse:h-11">
                Connect
            </Button>
        )
    ) : status === "pending_sent" ? (
        <span className="nb-meta inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden="true" /> Requested</span>
    ) : status === "pending_received" ? (
        <Button asChild variant="outline" size="sm" className="pointer-coarse:h-11">
            <Link href="/network?tab=invitations">Review request</Link>
        </Button>
    ) : status === "connected" ? (
        <span className="nb-meta inline-flex items-center gap-1"><Check className="size-3.5" aria-hidden="true" /> Connected</span>
    ) : null;

    return (
        <article className="nb-discover-person-card">
            <div className="flex min-w-0 items-center gap-3">
                {/* The name below is the link people tab to; the avatar is the same link for the mouse. */}
                <Link href={profileHref(profile)} tabIndex={-1} aria-hidden="true" className="nb-discover-person-avatar">
                    <UserAvatar identity={profile} size={48} fallbackClassName="text-base font-semibold" />
                    <PersonPresenceDot userId={profile.id} lastActiveAt={profile.lastActiveAt} />
                </Link>
                <div className="min-w-0 flex-1">
                    <Link href={profileHref(profile)} className="nb-person-name block truncate text-foreground hover:text-primary" title={displayName}>
                        {displayName}
                    </Link>
                    {profile.location ? (
                        <p className="nb-meta mt-0.5 flex min-w-0 items-center gap-1" title={profile.location}>
                            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                            <span className="min-w-0 truncate">{profile.location}</span>
                        </p>
                    ) : null}
                </div>
            </div>
            {!profile.isLockedProfile && profile.headline ? (
                <p className="nb-compact line-clamp-2 text-muted-foreground">{profile.headline}</p>
            ) : null}
            {!profile.isLockedProfile && skills.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Skills">
                    {skills.map((skillName) => {
                        const skill = resolveClientSkill(skillName);
                        return <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>;
                    })}
                    {moreSkills > 0 ? <span className="nb-meta">+{moreSkills}</span> : null}
                </div>
            ) : null}
            <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="nb-meta">{mutual > 0 ? `${mutual} mutual` : ""}</span>
                {action}
            </div>
        </article>
    );
}

function RailSkeleton() {
    return (
        <section role="status">
            <span className="sr-only">Loading people you should meet…</span>
            <div className="mb-3 flex items-center gap-3" aria-hidden="true">
                <Skeleton className="h-4 w-40 rounded-sm" />
                <div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2].map((item) => (
                    <div key={item} className="nb-discover-person-card">
                        <div className="flex items-center gap-3">
                            <Skeleton className="size-12 shrink-0 rounded-lg" />
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <Skeleton className="h-4 w-32 max-w-full rounded-sm" />
                                <Skeleton className="h-3 w-24 rounded-sm" />
                            </div>
                        </div>
                        <Skeleton className="h-4 w-full rounded-sm" />
                        <div className="flex gap-1.5">
                            <Skeleton className="h-[22px] w-16 rounded-full" />
                            <Skeleton className="h-[22px] w-14 rounded-full" />
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

export function DiscoverPeopleRail({ initialPage, variant }: DiscoverPeopleRailProps) {
    const { data, isLoading, isError, refetch } = useSuggestedPeople(3, undefined, DISCOVER_RAIL_FILTERS, initialPage, false);
    const people = useMemo(() => data?.pages[0]?.items ?? [], [data]);
    const viewerSkills = data?.pages[0]?.viewerSkills ?? [];

    if (isLoading && people.length === 0) return <RailSkeleton />;

    // A failed refresh keeps the people already shown; only a first load that fails says so.
    if (isError && people.length === 0) return <ErrorNotice what="People to meet" onRetry={() => void refetch()} />;

    // Nothing to suggest: the rail steps aside and the feed takes the width (spec §15).
    if (people.length === 0) return null;

    return (
        <section aria-labelledby={variant === "desktop" ? "people-you-should-meet" : undefined}>
            {/* In the drawer the dialog's title already says it. */}
            {variant === "desktop" ? (
                <div className="mb-3 flex items-center gap-3">
                    <h2 id="people-you-should-meet" className="nb-micro whitespace-nowrap">People you should meet</h2>
                    <div className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>
            ) : null}
            <div className="space-y-3">
                {people.map((profile) => <SuggestedPersonCard key={profile.id} profile={profile} viewerSkills={viewerSkills} />)}
            </div>
            <Button asChild variant="ghost" size="sm" className="mt-2 -ml-2.5 text-primary pointer-coarse:h-11">
                <Link href="/network?tab=suggested"><Users className="size-4" aria-hidden="true" /> Explore people</Link>
            </Button>
        </section>
    );
}
