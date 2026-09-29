"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { SkillIcon } from "@/components/skills";
import { PersonPresenceDot } from "@/components/network/PersonPresenceDot";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
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

function SuggestedPersonCard({
    profile,
    viewerSkills,
}: {
    profile: DiscoverConnectionItem;
    viewerSkills: string[];
}) {
    useSkillCatalog();
    const { sendRequest } = useConnectionMutations();
    const [requestSent, setRequestSent] = useState(false);
    const displayName = profile.fullName || profile.username || "NetworkBase member";
    const status = requestSent ? "pending_sent" : profile.connectionStatus;
    const matchingSkills = matchingSkillLabels(profile.skills ?? [], viewerSkills);
    const matchingSkillKeys = new Set(matchingSkills.map(canonicalSkillKey));
    const skills = [...(profile.skills ?? [])]
        .sort((left, right) => Number(matchingSkillKeys.has(canonicalSkillKey(right))) - Number(matchingSkillKeys.has(canonicalSkillKey(left))))
        .slice(0, 2);

    const connect = useCallback(async () => {
        if (status !== "none" || profile.canConnect === false || sendRequest.isPending) return;
        setRequestSent(true);
        try {
            await toast.promise(sendRequest.mutateAsync({ userId: profile.id }), {
                loading: "Sending request…",
                success: (result) => getConnectionRequestSuccessMessage(result.status),
                error: (error) => error instanceof Error ? error.message : "Failed to send request",
            });
        } catch {
            setRequestSent(false);
        }
    }, [profile.canConnect, profile.id, sendRequest, status]);

    const action = status === "none" ? (
        <button
            type="button"
            onClick={() => void connect()}
            disabled={profile.canConnect === false || sendRequest.isPending}
            className="nb-person-connect nb-person-connect--compact"
            aria-label={`Connect with ${displayName}`}
        >
            {sendRequest.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Connect"}
        </button>
    ) : status === "pending_sent" ? (
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground">
            <Check className="size-4" aria-hidden="true" /> Sent
        </span>
    ) : status === "pending_received" ? (
        <Link href="/network?tab=invitations" className="nb-touch-target inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Clock className="size-4" aria-hidden="true" /> Review
        </Link>
    ) : null;

    return (
        <article className="nb-discover-person-card">
            <Link href={profileHref(profile)} className="nb-discover-person-avatar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <UserAvatar identity={profile} size={56} fallbackClassName="text-base font-semibold" />
                <PersonPresenceDot lastActiveAt={profile.lastActiveAt} compact />
            </Link>
            <div className="nb-discover-person-content">
                <div className="flex min-w-0 items-baseline gap-1.5">
                    <Link href={profileHref(profile)} className="truncate text-[15px] font-semibold leading-5 text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {displayName}
                    </Link>
                    {profile.location ? <span className="truncate text-xs text-muted-foreground">{profile.location}</span> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {profile.isLockedProfile ? "Private profile" : profile.headline || "NetworkBase member"}
                </p>
                {!profile.isLockedProfile && skills.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Skills">
                        {skills.map((skillName) => {
                            const skill = resolveClientSkill(skillName);
                            return <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>;
                        })}
                    </div>
                ) : null}
            </div>
            {action ? <div className="nb-discover-person-action">{action}</div> : null}
        </article>
    );
}

function RailSkeleton() {
    return (
        <section aria-label="Loading people you should meet" role="status" aria-live="polite">
            <span className="sr-only">Loading people you should meet…</span>
            <div className="mb-3 flex items-center gap-3" aria-hidden="true">
                <Skeleton className="h-4 w-44 rounded" />
                <div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2].map((item) => (
                    <article key={item} className="nb-discover-person-card">
                        <Skeleton className="size-14 shrink-0 rounded-md" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-36 max-w-full rounded" />
                            <Skeleton className="h-3.5 w-full rounded" />
                            <div className="flex gap-1.5 pt-0.5">
                                <Skeleton className="h-5 w-16 rounded-[4px]" />
                                <Skeleton className="h-5 w-14 rounded-[4px]" />
                            </div>
                        </div>
                        <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
                    </article>
                ))}
            </div>
        </section>
    );
}

export function DiscoverPeopleRail({ initialPage, variant }: DiscoverPeopleRailProps) {
    const { data, isLoading, isError, refetch } = useSuggestedPeople(3, undefined, undefined, initialPage);
    const people = useMemo(() => data?.pages[0]?.items ?? [], [data]);
    const viewerSkills = data?.pages[0]?.viewerSkills ?? [];

    if (isLoading && people.length === 0) return <RailSkeleton />;

    if (isError) {
        return (
            <section className="nb-discover-people-state" aria-live="polite">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load people to meet.</p>
                <button type="button" onClick={() => void refetch()} className="text-sm font-medium text-primary hover:underline">Try again</button>
            </section>
        );
    }

    if (people.length === 0) {
        return (
            <section className="nb-discover-people-state">
                <p className="text-sm text-muted-foreground">New recommendations will appear as your network grows.</p>
            </section>
        );
    }

    return (
        <section aria-labelledby={`people-you-should-meet-${variant}`}>
            <div className="mb-3 flex items-center gap-3">
                <h2 id={`people-you-should-meet-${variant}`} className="nb-micro whitespace-nowrap">People you should meet</h2>
                <div className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>
            <div className="space-y-3">
                {people.map((profile) => <SuggestedPersonCard key={profile.id} profile={profile} viewerSkills={viewerSkills} />)}
            </div>
            <Link href="/network?tab=suggested" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                <Users className="size-4" aria-hidden="true" /> Explore people
            </Link>
        </section>
    );
}
