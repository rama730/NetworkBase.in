'use client'

import { useState, type ReactNode } from 'react'

export type Fact = {
    label: string
    values: string[]
    /** Full wording for hover and screen readers when the shown value is short, e.g. "5–10 hours a week". */
    description?: string
    /** Show this many values, then a "+N more" button. */
    limit?: number
    /** Shown instead of values when there are none, e.g. an owner's "Add interests" link. */
    empty?: ReactNode
}

/**
 * The label and value rows of the profile's right-column cards (Collaboration preferences, Details).
 * One markup, so the cards can't drift: same label width, weight, comma list and wrapping.
 */
export function FactList({ facts }: { facts: Fact[] }) {
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
    return (
        <dl className="nb-compact space-y-3">
            {facts.map((fact) => {
                const open = expanded.has(fact.label)
                const hidden = fact.limit && !open ? Math.max(0, fact.values.length - fact.limit) : 0
                const shown = hidden ? fact.values.slice(0, fact.limit) : fact.values
                return (
                    // items-start: when a value wraps, the label stays on its first line.
                    <div key={fact.label} className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-3">
                        <dt className="text-muted-foreground">{fact.label}</dt>
                        <dd className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">
                            {fact.values.length === 0 ? fact.empty ?? null : (
                                <ul aria-label={fact.label} className="flex flex-wrap justify-end gap-x-1 gap-y-1">
                                    {shown.map((value, index) => (
                                        <li key={value} title={fact.description} className="max-w-full">
                                            <span aria-hidden={fact.description ? true : undefined}>{value}</span>
                                            {fact.description ? <span className="sr-only">{fact.description}</span> : null}
                                            {index < shown.length - 1 ? ',' : null}
                                        </li>
                                    ))}
                                    {hidden || (fact.limit && open && fact.values.length > fact.limit) ? (
                                        <li>
                                            <button
                                                type="button"
                                                aria-expanded={open}
                                                onClick={() => setExpanded((current) => {
                                                    const next = new Set(current)
                                                    if (open) next.delete(fact.label)
                                                    else next.add(fact.label)
                                                    return next
                                                })}
                                                className="font-normal text-primary hover:underline max-md:min-h-11"
                                            >{open ? 'Show less' : `+${hidden} more`}</button>
                                        </li>
                                    ) : null}
                                </ul>
                            )}
                        </dd>
                    </div>
                )
            })}
        </dl>
    )
}
