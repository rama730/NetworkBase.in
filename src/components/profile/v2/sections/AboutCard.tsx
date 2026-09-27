'use client'

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

    return (
        <Card
            title="About"
            icon={<User className="w-5 h-5" />}
            action={isOwner && onEdit ? (
                <button
                    type="button"
                    onClick={onEdit}
                    aria-label="Edit about section"
                    className="p-1.5 rounded-[3px] hover:bg-muted text-muted-foreground transition-colors"
                >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
            ) : null}
        >
            <div className="px-5 py-4">
                {hasBio ? (
                    <p className="nb-body max-w-[64ch] whitespace-pre-wrap text-foreground/90">
                        {bio}
                    </p>
                ) : (
                    <div className="text-center py-6">
                        <p className="nb-body text-muted-foreground">
                            {isOwner ? 'Add a bio to tell others about yourself' : 'No bio added yet'}
                        </p>
                        {isOwner && onEdit ? (
                            <button
                                type="button"
                                onClick={onEdit}
                                className="nb-ui-label mt-2 text-primary hover:text-primary/80 transition-colors"
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
