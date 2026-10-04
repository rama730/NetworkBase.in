'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { NB_CARD_HEADER_MOBILE } from '@/components/projects/dashboard/DashboardCard'

interface CardProps {
    title: string
    /** Sentence-case title shown below md; desktop keeps `title` (spec §04, strict desktop freeze). */
    mobileTitle?: string
    icon?: React.ReactNode
    children?: React.ReactNode
    className?: string
    action?: React.ReactNode
    onAdd?: () => void
    addLabel?: string
    density?: 'default' | 'compact'
    id?: string
}

export function Card({ title, mobileTitle, icon, children, className, action, onAdd, addLabel, density = 'default', id }: CardProps) {
    const headingId = useId()
    return (
        <section
            aria-labelledby={headingId}
            id={id}
            className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-none', className)}
        >
            <div className={cn("border-b border-border px-5 py-4 flex items-center justify-between", NB_CARD_HEADER_MOBILE)}>
                <div className="flex items-center gap-2">
                    {icon ? <span className="text-muted-foreground [&_svg]:size-[18px]">{icon}</span> : null}
                    <h2 id={headingId} className="nb-card-title text-foreground">{mobileTitle ? <><span className="md:hidden">{mobileTitle}</span><span className="hidden md:inline">{title}</span></> : title}</h2>
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
