'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Card, OwnerOnlyNote } from './Card'

interface AboutCardProps {
    profile: any
    isOwner: boolean
    onEdit?: () => void
}

/** "Vijay", from the full name's first word; "@vijay23" when there is no name. */
function shortName(profile: any) {
    const first = typeof profile?.fullName === 'string' ? profile.fullName.trim().split(/\s+/)[0] : ''
    if (first) return first
    return typeof profile?.username === 'string' && profile.username ? `@${profile.username}` : 'This member'
}

export function AboutCard({ profile, isOwner, onEdit }: AboutCardProps) {
    const bio = typeof profile?.bio === 'string' ? profile.bio.trim() : ''
    const hasBio = bio.length > 0
    const [expanded, setExpanded] = useState(false)

    // Always shown to visitors too, so the Overview tab never ends in blank space.
    if (!isOwner && !hasBio) {
        return (
            <Card title="About">
                <p className="nb-body px-5 py-4 text-muted-foreground max-md:px-4">{shortName(profile)} hasn’t written an introduction yet.</p>
            </Card>
        )
    }

    return (
        <Card
            title="About"
            action={isOwner && onEdit ? (
                <button
                    type="button"
                    onClick={onEdit}
                    aria-label="Edit about section"
                    className="nb-touch-target inline-flex items-center justify-center rounded-[3px] p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:rounded-[5px]"
                >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
            ) : null}
        >
            <div className="px-5 py-4 max-md:px-4">
                {hasBio ? (
                    <>
                        <p className={`nb-body max-w-[64ch] whitespace-pre-wrap text-foreground/90 ${expanded ? '' : 'max-md:line-clamp-8'}`}>
                            {bio}
                        </p>
                        {bio.length > 400 ? (
                            <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="nb-ui-label mt-1 inline-flex min-h-11 items-center text-primary md:hidden">
                                {expanded ? 'Show less' : 'Read more'}
                            </button>
                        ) : null}
                    </>
                ) : (
                    <div className="text-center py-6">
                        <p className="nb-body text-muted-foreground">
                            {isOwner ? 'Add a bio to tell others about yourself' : 'No bio added yet'}
                        </p>
                        {isOwner && onEdit ? (
                            <button
                                type="button"
                                onClick={onEdit}
                                className="nb-ui-label mt-2 text-primary hover:text-primary/80 transition-colors max-md:inline-flex max-md:min-h-11 max-md:items-center"
                            >
                                Add bio
                            </button>
                        ) : null}
                        {isOwner ? <OwnerOnlyNote /> : null}
                    </div>
                )}
            </div>
        </Card>
    )
}
