'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
interface CardProps {
    title: string
    children?: React.ReactNode
    className?: string
    action?: React.ReactNode
    onAdd?: () => void
    addLabel?: string
    id?: string
}

/** Under an owner's empty-section prompt: visitors don't see this section until it has content. */
export function OwnerOnlyNote({ className }: { className?: string }) {
    return <p className={cn('nb-compact mt-1 text-muted-foreground/80', className)}>Only you can see this</p>
}

export function Card({ title, children, className, action, onAdd, addLabel, id }: CardProps) {
    const headingId = useId()
    return (
        <section
            aria-labelledby={headingId}
            id={id}
            className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-none', className)}
        >
            <div className="border-b border-border px-5 py-4 max-md:px-4 max-md:py-3.5 flex items-center justify-between">
                <h2 id={headingId} className="nb-card-title text-foreground">{title}</h2>
                <div className="flex items-center gap-2">
                    {action}
                    {onAdd && (
                        <button
                            type="button"
                            onClick={onAdd}
                            aria-label={addLabel || `Add ${title.toLowerCase()}`}
                            className="nb-icon-button text-muted-foreground transition-colors"
                        >
                            <Plus className="size-4" aria-hidden="true" />
                        </button>
                    )}
                </div>
            </div>
            <div className="p-0">{children}</div>
        </section>
    )
}
