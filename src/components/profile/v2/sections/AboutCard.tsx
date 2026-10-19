'use client'

import { useState } from 'react'
import { Pencil, User } from 'lucide-react'
import { Card } from './Card'

interface AboutCardProps {
    profile: any
    isOwner: boolean
    onEdit?: () => void
}

export function AboutCard({ profile, isOwner, onEdit }: AboutCardProps) {
    const bio = typeof profile?.bio === 'string' ? profile.bio.trim() : ''
    const hasBio = bio.length > 0
    const [expanded, setExpanded] = useState(false)

    if (!isOwner && !hasBio) {
        return null
    }

    return (
        <Card
            title="About"
            icon={<User className="w-5 h-5" />}
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
                                Add Bio
                            </button>
                        ) : null}
                    </div>
                )}
            </div>
        </Card>
    )
}
