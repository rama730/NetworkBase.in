'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
interface CardProps {
    title: string
    icon?: React.ReactNode
    children?: React.ReactNode
    className?: string
    action?: React.ReactNode
    onAdd?: () => void
    addLabel?: string
    id?: string
}

export function Card({ title, icon, children, className, action, onAdd, addLabel, id }: CardProps) {
    const headingId = useId()
    return (
        <section
            aria-labelledby={headingId}
            id={id}
            className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-none', className)}
        >
            <div className="border-b border-border px-5 py-4 max-md:px-4 max-md:py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {icon ? <span className="text-muted-foreground [&_svg]:size-[18px]">{icon}</span> : null}
                    <h2 id={headingId} className="nb-card-title text-foreground">{title}</h2>
                </div>
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
