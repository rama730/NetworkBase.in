'use client'

import Link from 'next/link'
import { RailSection } from '@/components/ui/rail-section'
import type { ProfileDetailsRow } from '@/lib/profile/details'

/** Facts the header doesn't show. Rows come from profileDetailsRows; no rows, no card. */
export function DetailsCard({ rows }: { rows: ProfileDetailsRow[] }) {
    if (rows.length === 0) return null
    return (
        <RailSection title="Details" contentClassName="p-5 max-md:p-4">
            <dl className="nb-compact space-y-3">
                {rows.map((row) => (
                    <div key={row.key} className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-3">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">
                            {row.value === null ? (
                                row.addHref ? <Link href={row.addHref} className="font-normal text-primary hover:underline">{row.addLabel}</Link> : null
                            ) : Array.isArray(row.value) ? (
                                <ul aria-label={row.label} className="flex flex-wrap justify-end gap-1.5">
                                    {row.value.map((item) => <li key={item} className="nb-tag">{item}</li>)}
                                </ul>
                            ) : row.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </RailSection>
    )
}
