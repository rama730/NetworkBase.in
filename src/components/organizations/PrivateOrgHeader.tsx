import Link from 'next/link'

import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { Button } from '@/components/ui/button'

/** What people outside a private org see (report §18.2): picture, name, "Private organization", Join with code. */
export function PrivateOrgHeader({ title, coverImage }: { title: string; coverImage: string | null }) {
    return (
        <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
            <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
                <WorkspaceAvatar project={{ title, coverImage }} />
                <h1 className="nb-page-title text-foreground">{title}</h1>
                <p className="text-sm text-muted-foreground">Private organization</p>
                <Button asChild className="mt-2 min-h-11"><Link href="/join">Join with code</Link></Button>
            </div>
        </div>
    )
}
