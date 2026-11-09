'use client'

import { Suspense, useEffect, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { AppSidebar } from './AppSidebar'
import TopNav from '@/components/layout/header/TopNav'
import { PendingDeletionNotice } from './PendingDeletionNotice'
import { MyWorkDrawerHost } from '@/components/my-work/MyWorkDrawerHost'
import { CREATE_WORKSPACE_PATH, rememberCreateWorkspaceReturnPath } from '@/components/workspaces/create-wizard/create-workspace-return'
import { stampEntry } from '@/lib/navigation/in-app-history'

/** Stamps each history entry (unified back A7): in-app Back knows exactly what sits behind this page. */
function HistoryStamp() {
    const pathname = usePathname()
    const search = useSearchParams()?.toString() ?? ''
    useEffect(() => {
        stampEntry(window)
    }, [pathname, search])
    return null
}

interface MainLayoutProps {
    children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
    const pathname = usePathname()
    // Messages tracks the on-screen keyboard height (report 7.12 B11).
    const messagesShell = pathname === '/messages' || pathname?.startsWith('/messages/')

    // Closing the create-project page returns to wherever the user was before it.
    useEffect(() => {
        if (pathname !== CREATE_WORKSPACE_PATH) rememberCreateWorkspaceReturnPath(`${window.location.pathname}${window.location.search}`)
    }, [pathname])

    return (
        <div
            className={`relative h-dvh min-h-0 overflow-clip bg-background flex flex-col${messagesShell ? ' nb-shell--messages' : ''}`}
            data-hardening-shell="v1"
        >
            <Suspense fallback={null}><HistoryStamp /></Suspense>
            <a href="#main-content" className="nb-skip-link">Skip to content</a>
            <AppSidebar />
            <div className="nb-main-frame flex min-h-0 flex-1 flex-col">
            <TopNav />
            <PendingDeletionNotice />
            <main id="main-content" tabIndex={-1} className="flex-1 min-h-0 min-w-0 overflow-clip">
                {children}
            </main>
            </div>
            <MyWorkDrawerHost />
        </div>
    )
}
