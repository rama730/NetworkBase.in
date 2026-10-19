import { Skeleton } from '@/components/ui/skeleton';

export default function EditProfileLoading() {
    return <div role="status" aria-label="Loading profile editor" className="flex h-full min-h-0 flex-col bg-card md:flex-row">
        <div className="shrink-0 border-b border-border px-3 py-4 md:w-[var(--nb-sidebar-width)] md:border-r md:border-b-0">
            <div className="mb-3 space-y-3 px-2 pr-3"><Skeleton className="h-3 w-24" /><div className="h-px w-full bg-border" aria-hidden="true" /></div>
            <div className="flex flex-wrap gap-1 md:flex-col">{Array.from({length:5},(_,index)=><Skeleton key={index} className="h-[var(--ui-nav-item-height)] w-full" />)}</div>
        </div>
        <div className="min-w-0 flex-1 p-4 md:p-[calc(var(--ui-panel-padding)+4px)]"><div className="mx-auto w-full max-w-4xl space-y-6"><Skeleton className="size-[72px]" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-32 w-full" /></div></div>
        <span className="sr-only">Loading profile editor…</span>
    </div>;
}
