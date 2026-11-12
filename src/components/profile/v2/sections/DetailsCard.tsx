'use client'

import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { RailSection } from '@/components/ui/rail-section'
import type { ProfileDetailsRow } from '@/lib/profile/details'
import { FactList, type Fact } from './FactList'

/** Interests past this many fold behind "+N more"; the rail column is narrow. */
const INTERESTS_SHOWN = 5

/** Facts the header doesn't show, drawn like Collaboration preferences. Rows come from profileDetailsRows; no rows, no card. */
export function DetailsCard({ rows, onEdit }: { rows: ProfileDetailsRow[]; onEdit?: () => void }) {
    if (rows.length === 0) return null
    const facts: Fact[] = rows.map((row) => ({
        label: row.label,
        values: row.value === null ? [] : Array.isArray(row.value) ? row.value : [row.value],
        description: row.description,
        limit: row.key === 'interests' ? INTERESTS_SHOWN : undefined,
        empty: row.addHref ? <Link href={row.addHref} className="font-normal text-primary hover:underline">{row.addLabel}</Link> : null,
    }))
    const editAction = onEdit ? (
        <button
            type="button"
            onClick={onEdit}
            aria-label="Edit details"
            className="nb-touch-target inline-flex items-center justify-center rounded-[5px] p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
            <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
    ) : null
    return (
        <RailSection title="Details" action={editAction} contentClassName="p-5 max-md:p-4">
            <FactList facts={facts} />
        </RailSection>
    )
}
