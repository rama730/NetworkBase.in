'use client'

import { Globe, Lock } from 'lucide-react'

import { readFolderAccess } from '@/lib/organizations/file-rules'

/** 🔒 Admins only · 🌐 Public · Template, next to a folder's name (report §23.3). */
export function FolderAccessChip({ metadata }: { metadata: unknown }) {
    const access = readFolderAccess(metadata)
    const template = (metadata as { template?: unknown } | null)?.template === true
    if (!access && !template) return null
    return (
        <span className="flex shrink-0 items-center gap-1">
            {access === 'admins' ? <span title="Admins only" className="inline-flex items-center gap-0.5 rounded-[3px] border border-border px-1 text-[10px] text-muted-foreground"><Lock className="size-2.5" aria-hidden="true" />Admins</span> : null}
            {access === 'public' ? <span title="Public" className="inline-flex items-center gap-0.5 rounded-[3px] border border-border px-1 text-[10px] text-muted-foreground"><Globe className="size-2.5" aria-hidden="true" />Public</span> : null}
            {template ? <span className="rounded-[3px] border border-border px-1 text-[10px] text-muted-foreground">Template</span> : null}
        </span>
    )
}
