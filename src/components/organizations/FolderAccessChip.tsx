'use client'

import { useContext } from 'react'
import { Globe, Lock } from '@/components/ui/icons'

import { FilesTabRoleContext } from '@/components/workspaces/v2/files-tab/FilesTabRoleContext'

import { readFolderAccess } from '@/lib/organizations/file-rules'

/** Admins only · Public · Template, next to a folder's name (report §23.3), as status badges. */
export function FolderAccessChip({ metadata }: { metadata: unknown }) {
    // Report §16.4: in the Files tab only people who manage files see the chips; members just see what they can open.
    const role = useContext(FilesTabRoleContext)
    const access = readFolderAccess(metadata)
    const template = (metadata as { template?: unknown } | null)?.template === true
    if ((!access && !template) || (role && !role.canManageFiles)) return null
    return (
        <span className="flex shrink-0 items-center gap-1">
            {access === 'admins' ? <span title="Admins only" className="nb-status" data-tone="warning"><Lock className="size-3" aria-hidden="true" />Admins</span> : null}
            {access === 'public' ? <span title="Public" className="nb-status" data-tone="info"><Globe className="size-3" aria-hidden="true" />Public</span> : null}
            {template ? <span className="nb-status" data-tone="neutral">Template</span> : null}
        </span>
    )
}
