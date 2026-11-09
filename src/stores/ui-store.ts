import { create } from 'zustand'

export type MyWorkTaskHandoff = { projectId: string; taskId: string; createdAt: number }
export type MyWorkTab = "tasks" | "requests"
export const MY_WORK_TASK_HANDOFF_STORAGE_KEY = 'nb:my-work-task-handoff'
const MY_WORK_TASK_HANDOFF_MAX_AGE_MS = 5 * 60 * 1000

export function createMyWorkTaskHandoff(projectId: string, taskId: string): MyWorkTaskHandoff {
    return { projectId, taskId, createdAt: Date.now() }
}

export function readMyWorkTaskHandoff(value: string | null): MyWorkTaskHandoff | null {
    if (!value) return null
    try {
        const handoff = JSON.parse(value) as Partial<MyWorkTaskHandoff>
        return typeof handoff.projectId === 'string'
            && typeof handoff.taskId === 'string'
            && typeof handoff.createdAt === 'number'
            && Date.now() - handoff.createdAt >= 0
            && Date.now() - handoff.createdAt < MY_WORK_TASK_HANDOFF_MAX_AGE_MS
            ? handoff as MyWorkTaskHandoff
            : null
    } catch {
        return null
    }
}

interface UIState {
    // Sidebar
    sidebarOpen: boolean
    sidebarCollapsed: boolean

    // Mobile
    mobileMenuOpen: boolean

    // Theme
    theme: 'light' | 'dark' | 'system'

    // Workspace Drawer
    isMyWorkOpen: boolean
    myWorkTab: MyWorkTab
    myWorkTaskHandoff: MyWorkTaskHandoff | null

    // Unified back (B13): the page's real parent, used when nothing of ours is behind it
    backParent: string | null

    // Actions
    setSidebarOpen: (open: boolean) => void
    toggleSidebar: () => void
    setSidebarCollapsed: (collapsed: boolean) => void
    setMobileMenuOpen: (open: boolean) => void
    setTheme: (theme: 'light' | 'dark' | 'system') => void
    setMyWorkOpen: (open: boolean) => void
    openMyWork: (tab?: MyWorkTab) => void
    setMyWorkTab: (tab: MyWorkTab) => void
    setMyWorkTaskHandoff: (handoff: MyWorkTaskHandoff | null) => void
    setBackParent: (href: string | null) => void
}

export const useUIStore = create<UIState>()((set) => ({
    sidebarOpen: true,
    sidebarCollapsed: false,
    mobileMenuOpen: false,
    theme: 'system',

    // Workspace Drawer defaults
    isMyWorkOpen: false,
    myWorkTab: "tasks",
    myWorkTaskHandoff: null,
    backParent: null,

    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
    setTheme: (theme) => set({ theme }),
    setMyWorkOpen: (open) => set({ isMyWorkOpen: open }),
    // ponytail: the launcher always has one predictable destination; callers that need Requests ask for it explicitly instead of restoring stale UI. ceiling: defaults to tasks tab. upgrade: persist last visited workspace tab per project in local storage.
    openMyWork: (tab = "tasks") => set({ isMyWorkOpen: true, myWorkTab: tab }),
    setMyWorkTab: (tab) => set({ myWorkTab: tab }),
    setMyWorkTaskHandoff: (handoff) => set({ myWorkTaskHandoff: handoff }),
    setBackParent: (href) => set({ backParent: href }),
}))
