'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Link2 } from 'lucide-react'
import { RailSection } from '@/components/ui/rail-section'
import { normalizeProfile } from '@/lib/utils/normalize-profile'
import { normalizeSocialLinks as normalizeSocialLinksShared } from '@/lib/profile/normalization'
import { SocialPresenceIcon } from '@/components/profile/SocialPresenceIcon'
import { OwnerOnlyNote } from './sections/Card'
import { completionItemSection, type ProfileEditSection } from "@/lib/profile/edit-route"

export function ProfileRightRail({
    profile,
    isOwner,
    canMessage = false,
    socialLinks,
    onEditSection,
}: {
    profile: any
    isOwner: boolean
    canMessage?: boolean
    socialLinks: any
    onEditSection?: (section: ProfileEditSection) => void
}) {
    const vm = normalizeProfile(profile)
    const [showAllLinks, setShowAllLinks] = useState(false)
    if (!vm) return null
    const links = normalizeSocialLinksShared({ ...profile, socialLinks: vm.socialLinks }, socialLinks)
    const linkHealth = (isOwner && profile?.socialLinkMetadata && typeof profile.socialLinkMetadata === 'object')
        ? profile.socialLinkMetadata as Record<string, { health?: string }>
        : {}
    const visibleLinks = showAllLinks ? links : links.slice(0, 4)

    const completionScore = Number(vm.profileStrength || 0)
    const missingItems: string[] = Array.isArray((profile as any)?.completionMissing)
        ? (profile as any).completionMissing
        : []

    return (
        <>
            {links.length > 0 ? (
                <RailSection title="Links" contentClassName="px-5 max-md:px-4">
                    <div className={cn("grid gap-2 max-md:grid-cols-1", links.length > 4 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
                        {visibleLinks.map((l) => (
                            <div key={l.id || l.canonicalKey} className="min-w-0">
                                <a
                                    href={`/go/profile/${encodeURIComponent(vm.id)}/${encodeURIComponent(l.id || l.canonicalKey)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open ${l.platformLabel}: ${l.accountLabel}`}
                                    className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[3px] border border-border bg-card px-3 text-foreground hover:bg-muted transition-colors"
                                >
                                    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-foreground">
                                        <span className="shrink-0 text-muted-foreground">{l.iconKey ? <SocialPresenceIcon iconKey={l.iconKey} /> : <Link2 className="h-4 w-4" aria-hidden="true" />}</span>
                                        <span className="nb-ui-label truncate">{l.platformLabel}</span>
                                    </span>
                                    <span title={l.customLabel || l.accountLabel} className="nb-meta min-w-0 truncate whitespace-nowrap text-right">{l.customLabel || l.accountLabel}</span>
                                </a>
                                {isOwner && l.id && linkHealth[l.id]?.health === 'unavailable' && onEditSection ? (
                                    <button type="button" onClick={() => onEditSection('social')} className="nb-touch-target nb-ui-label max-md:min-h-11 flex items-center rounded-[3px] border border-amber-300 px-2 py-1.5 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40">Update</button>
                                ) : null}
                            </div>
                        ))}
                        {links.length > 4 ? (
                            <button
                                type="button"
                                onClick={() => setShowAllLinks((value) => !value)}
                                className="nb-touch-target nb-ui-label col-span-full justify-self-start rounded-[3px] border border-border bg-card px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                aria-expanded={showAllLinks}
                            >
                                {showAllLinks ? 'Show less' : `+${links.length - 4} more`}
                            </button>
                        ) : null}
                    </div>
                </RailSection>
            ) : isOwner && onEditSection ? (
                <RailSection title="Links" contentClassName="px-5 max-md:px-4">
                    <p className="nb-compact text-muted-foreground">Add your GitHub, LinkedIn or site.</p>
                    <button type="button" onClick={() => onEditSection('social')} className="nb-ui-label mt-2 inline-flex text-primary hover:underline max-md:min-h-11 max-md:items-center">
                        Add links
                    </button>
                    <OwnerOnlyNote />
                </RailSection>
            ) : null}

            {isOwner ? (
                // Phones get the completion prompt in the profile header instead (spec §17).
                <RailSection title="Profile completeness" className="max-md:hidden" contentClassName="px-5 max-md:px-4">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="nb-compact text-muted-foreground">Completion</span>
                            <span className="nb-meta font-semibold text-foreground">
                                {completionScore}%
                            </span>
                        </div>
                        <div
                            role="progressbar"
                            aria-valuenow={Math.max(0, Math.min(100, completionScore))}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Profile completeness: ${completionScore}%`}
                            className="h-2 rounded-[3px] bg-muted overflow-hidden"
                        >
                            <div
                                className="h-full bg-primary transition-[color,background-color,border-color,box-shadow,opacity,transform]"
                                style={{ width: `${Math.max(0, Math.min(100, completionScore))}%` }}
                            />
                        </div>
                        {missingItems.length > 0 ? (
                            <ul className="nb-compact space-y-1 text-muted-foreground">
                                {missingItems.slice(0, 3).map((item) => (
                                    <li key={item}>
                                        {onEditSection ? (
                                            <button type="button" onClick={() => onEditSection(completionItemSection(item))} className="text-left hover:text-primary hover:underline max-md:min-h-11">
                                                • {item}
                                            </button>
                                        ) : <>• {item}</>}
                                    </li>
                                ))}
                            </ul>
                        ) : completionScore >= 100 ? (
                            <p className="nb-compact text-[var(--status-success)]">
                                Profile is complete. Great work.
                            </p>
                        ) : null}
                    </div>
                </RailSection>
            ) : null}
        </>
    )
}
