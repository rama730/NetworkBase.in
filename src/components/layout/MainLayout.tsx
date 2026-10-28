'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { AppSidebar } from './AppSidebar'
import TopNav from '@/components/layout/header/TopNav'
import { PendingDeletionNotice } from './PendingDeletionNotice'
import { WorkspaceDrawerHost } from '@/components/workspace/WorkspaceDrawerHost'
import { CREATE_PROJECT_PATH, rememberCreateProjectReturnPath } from '@/components/projects/create-wizard/create-project-return'
import { noteNavigation } from '@/lib/navigation/in-app-history'

interface MainLayoutProps {
    children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
    const pathname = usePathname()
    // Messages tracks the on-screen keyboard height (report 7.12 B11).
    const messagesShell = pathname === '/messages' || pathname?.startsWith('/messages/')

    // Closing the create-project page returns to wherever the user was before it.
    useEffect(() => {
        if (pathname !== CREATE_PROJECT_PATH) rememberCreateProjectReturnPath(`${window.location.pathname}${window.location.search}`)
    }, [pathname])

    // In-app Back (Messages) only goes back when there's one of our pages behind this one.
    useEffect(() => {
        if (pathname) noteNavigation(pathname)
    }, [pathname])

    return (
        <div
            className={`h-dvh min-h-0 overflow-hidden bg-background flex flex-col${messagesShell ? ' nb-shell--messages' : ''}`}
            data-hardening-shell="v1"
        >
            <a href="#main-content" className="nb-skip-link">Skip to content</a>
            <AppSidebar />
            <div className="nb-main-frame flex min-h-0 flex-1 flex-col">
            <TopNav />
            <PendingDeletionNotice />
            <main id="main-content" tabIndex={-1} className="flex-1 min-h-0 min-w-0 overflow-hidden">
                {children}
            </main>
            </div>
            <WorkspaceDrawerHost />
        </div>
    )
}
