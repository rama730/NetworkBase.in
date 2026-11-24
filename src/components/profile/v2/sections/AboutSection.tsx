'use client'

import { useState } from 'react'
import { ChevronDown, Pencil, Plus } from '@/components/ui/icons'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { Button } from '@/components/ui/button'
import { currentRoles } from '@/lib/profile/mix'
import type { ProfileCollaborationContribution } from '@/lib/profile/collaboration'

/** "Vijay", from the full name's first word; "@vijay23" when there is no name. */
export function shortName(profile: any) {
    const first = typeof profile?.fullName === 'string' ? profile.fullName.trim().split(/\s+/)[0] : ''
    if (first) return first
    return typeof profile?.username === 'string' && profile.username ? `@${profile.username}` : 'This member'
}

/** Long About text folds here, the same point the Edit profile preview shows. */
export const ABOUT_FOLD = 420

/**
 * About in the app's own body text (never the serif), folding after a few lines with "Read more", and a "Now" line
 * with up to three current roles. The owner's pencil opens Edit profile at About.
 */
export function AboutSection({ profile, isOwner, current, onEdit, onSeeAll }: {
    profile: any
    isOwner: boolean
    current: ProfileCollaborationContribution[]
    onEdit?: () => void
    onSeeAll?: () => void
}) {
    const bio = typeof profile?.bio === 'string' ? profile.bio.trim() : ''
    const [open, setOpen] = useState(false)
    const long = bio.length > ABOUT_FOLD
    const now = currentRoles(current)
    const edit = isOwner && onEdit ? (
        <button type="button" className="nb-pf-ed" onClick={onEdit} aria-label="Edit about in Edit profile" title="Edit in Edit profile"><Pencil className="size-3.5" aria-hidden="true" /></button>
    ) : null
    return (
        <section className="nb-pf-sec" aria-labelledby="pf-about-h">
            <h2 id="pf-about-h" className="nb-pf-label has-rule">About{edit}</h2>
            {!bio ? (
                isOwner ? (
                    <div className="nb-pf-empty">
                        <b>Introduce yourself</b>
                        <span>A few lines about what you build and what you’re looking for. People read this first.</span>
                        {onEdit ? <Button size="sm" onClick={onEdit}><Plus className="size-3.5" aria-hidden="true" />Add an introduction</Button> : null}
                        <span className="nb-pf-only">Only you can see this until you add one</span>
                    </div>
                ) : (
                    <div className="nb-pf-panel nb-pf-about" data-pf-about><p className="text-muted-foreground">{shortName(profile)} hasn’t written an introduction yet.</p></div>
                )
            ) : (
                <div className="nb-pf-panel nb-pf-about" data-pf-about>
                    <div className={long && !open ? 'nb-pf-about-body is-folded' : 'nb-pf-about-body'}>
                        {bio.split(/\n\s*\n/).map((para: string, i: number) => <p key={i}>{para}</p>)}
                    </div>
                    {long ? (
                        <button type="button" className="nb-pf-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
                            {open ? 'Show less' : 'Read more'}<ChevronDown className="size-3.5" aria-hidden="true" />
                        </button>
                    ) : null}
                    {now.shown.length ? (
                        <div className="nb-pf-now">
                            <span className="nb-pf-now-k">Now</span>
                            {now.shown.map((c) => {
                                const inner = (
                                    <>
                                        <WorkspaceAvatar project={{ title: c.projectTitle, coverImage: c.projectCoverImage ?? null }} size="row" placeholder className="size-[18px] rounded-[4px]" />
                                        <span className="nb-pf-now-t">{c.title} <span className="text-muted-foreground">at</span> {c.projectTitle}</span>
                                    </>
                                )
                                return c.projectHref ? <a key={c.id} href={c.projectHref} className="nb-pf-now-i">{inner}</a> : <span key={c.id} className="nb-pf-now-i">{inner}</span>
                            })}
                            {now.more ? <button type="button" className="nb-pf-link" onClick={onSeeAll}>+{now.more} more</button> : null}
                        </div>
                    ) : null}
                </div>
            )}
        </section>
    )
}
